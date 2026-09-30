# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""手元の claude -p で、受入の画を採点表に当てる (M25-06、ADR 0001 段 5)。

    pnpm run judge                                   # 正本の judge: "llm" の手順を、その手順の画に当てる
    pnpm run judge -- --step SEL-003/2               # 任意の手順 (ID/手順の番号、1 から) を当てる。正本は変えない
    pnpm run judge -- --step SEL-003/2 --image x.png # 画を指す (仕込んだ欠陥の画を当てるとき)
    pnpm run judge -- --dry-run                      # 何を何回呼ぶかだけ出す

1 枚の画に 3 回 claude -p を呼び、問いごとに多数決を取る (温度は送れないので、問いを yes / no に固定して票を数える)。
  - 3 票とも no の問い: fail。票が割れた (yes と no が混ざる・呼び出しが失敗した) 問い: undecided。
  - fail と undecided だけを results.json に {verdict, note, at, by: "llm", llm} で書く。合格は書かない。
    人の判定 (by が llm でない項目) は上書きしない。
  - 画素の基準 (tests/e2e/baselines/) を持つ画は、3 票とも yes でも LLM では合格にしない (比べが合格にする)。
  - 全部の票と根拠は judge.json (受入の画面の置き場) に書く。results.json と違い、合格も残る。
CI では回さない (Claude Code の認証も基準画も無い)。鍵は持たず、Claude Code の認証をそのまま使う。
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from acceptance import (
    SHOTS_DIR,
    SOT,
    Problem,
    Sot,
    acceptance_dir,
    load,
    shots_of,
)

VOTES = 3
JOBS = 4
MODEL = "sonnet"
RUBRICS = Path("docs/acceptance/rubrics.json")
BASELINES = Path("tests/e2e/baselines")
JUDGE_LOG = "judge.json"
STEP_SPEC = re.compile(r"^(?P<id>[A-Z]{3}-\d{3})/(?P<n>\d+)$")
# 手順の文の「画 1」「画 1〜3」「画 1 (…)・画 2」が指す画の番号
SHOT_REF = re.compile(r"画\s*(\d+)(?:\s*[〜~]\s*(\d+))?")
TAG_AND_SHOT = re.compile(r"^【[^】]*】\s*(?:画[^:：]*[:：]\s*)?")

SYSTEM_PROMPT = "受入の画を採点表で採点する。道具は Read だけ使う。"
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["image", "answers"],
    "properties": {
        "image": {"type": "string"},
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "answer", "evidence"],
                "properties": {
                    "id": {"type": "string"},
                    "answer": {"type": "string", "enum": ["yes", "no"]},
                    "evidence": {"type": "string"},
                },
            },
        },
    },
}


@dataclass(frozen=True)
class Question:
    id: str
    text: str


@dataclass(frozen=True)
class Vote:
    """claude -p 1 回の答え。answers は問いの id から (yes か no, 根拠)。失敗した呼び出しは answers が None"""

    answers: Mapping[str, tuple[str, str]] | None
    cost_usd: float = 0.0
    duration_ms: int = 0
    model: str = ""
    error: str = ""


# 1 枚の画の 1 回の呼び出し。(prompt, image, model) から claude -p の標準出力を返す。試験は偽のものに替える
Runner = Callable[[str, Path, str], str]


@dataclass(frozen=True)
class QuestionResult:
    question: Question
    votes: tuple[str, ...]  # "yes" / "no" / "error"
    evidence: tuple[str, ...]
    outcome: str  # "yes" / "no" / "split"


@dataclass(frozen=True)
class ImageResult:
    image: Path
    questions: tuple[QuestionResult, ...]
    cost_usd: float
    duration_ms: int
    models: tuple[str, ...]
    pixel_baseline: bool


@dataclass(frozen=True)
class StepRef:
    scenario: str
    n: int  # 1 から
    text: str

    @property
    def key(self) -> str:
        return f"{self.scenario}/{self.n}"


@dataclass(frozen=True)
class StepResult:
    step: StepRef
    images: tuple[ImageResult, ...] = field(default_factory=tuple)

    @property
    def errored(self) -> bool:
        """どれかの画で、呼び出しがすべて失敗した (認証切れ・claude が無い)。記録を書き換えない"""
        return any(
            all(v == "error" for q in i.questions for v in q.votes) for i in self.images
        )

    @property
    def verdict(self) -> str:
        """fail (3 票とも no の問いがある) > undecided (割れた問いがある) > yes。
        画素の基準を持つ画の yes は yes のまま返し、合格にするかは呼び手 (writes_pass) が決める"""
        outcomes = [q.outcome for i in self.images for q in i.questions]
        if "no" in outcomes:
            return "fail"
        if "split" in outcomes:
            return "undecided"
        return "yes"


def select_steps(sot: Sot, specs: Sequence[str]) -> list[StepRef]:
    """--step の指定 (ID/n) の手順。指定が無ければ正本の judge が llm の手順。知らない指定は ValueError"""
    by_id = {s.id: s for s in sot.scenarios if s.status == "active"}
    if not specs:
        return [
            StepRef(s.id, n, text)
            for s in by_id.values()
            for n, ((_, text), mark) in enumerate(
                zip(s.steps, s.marks, strict=True), start=1
            )
            if mark is not None and mark.judge == "llm"
        ]
    out: list[StepRef] = []
    for spec in specs:
        m = STEP_SPEC.match(spec)
        if not m or m["id"] not in by_id:
            raise ValueError(f"--step は active の行の <ID>/<手順の番号>: {spec!r}")
        steps = by_id[m["id"]].steps
        n = int(m["n"])
        if not 1 <= n <= len(steps):
            raise ValueError(f"{m['id']} の手順は 1〜{len(steps)}: {spec!r}")
        out.append(StepRef(m["id"], n, steps[n - 1][1]))
    return out


def shot_numbers(step_text: str) -> frozenset[int]:
    """手順の文が「画 N」で指す画の番号。無ければ空 (その行の画すべて)"""
    nums: set[int] = set()
    for m in SHOT_REF.finditer(step_text):
        lo, hi = int(m[1]), int(m[2] or m[1])
        nums.update(range(lo, hi + 1))
    return frozenset(nums)


def images_of(
    step: StepRef, shots: Mapping[str, Sequence[str]], shots_root: Path
) -> list[Path]:
    """手順の画。文が画の番号を指していればその画、指さなければその行の画すべて。shots は acceptance.shots_of の形"""
    rels = shots.get(step.scenario, ())
    wanted = shot_numbers(step.text)
    by_n = {int(Path(rel).stem.rsplit("-", 1)[1]): rel for rel in rels}
    missing = sorted(wanted - by_n.keys())
    if missing:
        raise FileNotFoundError(
            f"{step.key} が指す画 {'・'.join(map(str, missing))} が {shots_root} に無い"
        )
    chosen = [by_n[n] for n in sorted(wanted or by_n)]
    return [shots_root.parent / rel for rel in chosen]


def has_pixel_baseline(image: Path, baselines: Path) -> bool:
    """この画 (<ID>-<番号>.png) の要素ごとの基準画 (<ID>-<番号>-<要素>.png) があるか"""
    return any(baselines.glob(f"{image.stem}-*.png"))


def questions_of(step: StepRef, rubrics: Mapping[str, Sequence[Mapping[str, str]]]):
    """採点表の問い。rubrics.json に <ID>/<n> があればそれ、無ければ手順の文を 1 つの問いにする"""
    rows = rubrics.get(step.key)
    if rows:
        return [Question(r["id"], r["q"]) for r in rows]
    claim = TAG_AND_SHOT.sub("", step.text)
    return [
        Question(
            "S",
            f"この画で、次の文が成り立つ: {claim}"
            " (文が途中で切れている・字が欠けている・文の言う物が見えない・読めないなら no)",
        )
    ]


def prompt_of(questions: Sequence[Question], image: Path) -> str:
    lines = "\n".join(f"- {q.id}: {q.text}" for q in questions)
    return (
        "あなたは受入の画の採点者。指定の画像ファイルを Read で 1 回だけ開き、次の問いのすべてに yes か no で答える。"
        "evidence は日本語で、画の中の位置 (左上・中央など) と見えたものを 1 文で書く。"
        "推測で yes にしない。見えないもの・確かめられないものは no。\n"
        f"{lines}\n\n画像ファイル: {image}"
    )


def parse_output(stdout: str, questions: Sequence[Question]) -> Vote:
    """claude -p --output-format json の標準出力を票にする。形が違えば error つきの票 (投げない)"""
    try:
        doc = json.loads(stdout)
    except json.JSONDecodeError as e:
        return Vote(None, error=f"出力が JSON でない: {e}")
    if not isinstance(doc, dict):
        return Vote(None, error="出力が連想配列でない")
    cost = float(doc.get("total_cost_usd") or 0)
    duration = int(doc.get("duration_ms") or 0)
    usage = doc.get("modelUsage")
    model = ",".join(sorted(usage)) if isinstance(usage, dict) else ""

    def failed(why: str) -> Vote:
        return Vote(None, cost, duration, model, why)

    if doc.get("is_error"):
        return failed(f"claude が失敗: {str(doc.get('result', ''))[:200]}")
    out = doc.get("structured_output")
    rows = out.get("answers") if isinstance(out, dict) else None
    if not isinstance(rows, list):
        return failed("structured_output.answers が無い")
    answers: dict[str, tuple[str, str]] = {}
    for row in rows:
        if (
            isinstance(row, dict)
            and row.get("answer") in ("yes", "no")
            and isinstance(row.get("id"), str)
        ):
            answers[row["id"]] = (row["answer"], str(row.get("evidence", "")))
    missing = [q.id for q in questions if q.id not in answers]
    if missing:
        return failed(f"答えの無い問い: {'・'.join(missing)}")
    return Vote(answers, cost, duration, model)


def run_claude(prompt: str, image: Path, model: str) -> str:
    """本物の claude -p。手元の CLAUDE.md・MCP・スキルを読ませず (ADR 付録 B の 4)、Read だけを許す。
    標準入力は閉じる (開けたままだと 3 秒待つ)。鍵の環境変数は渡さず、Claude Code の認証を使う"""
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
    }
    done = subprocess.run(
        [
            "claude",
            "-p",
            prompt,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(SCHEMA),
            "--model",
            model,
            "--system-prompt",
            SYSTEM_PROMPT,
            "--tools",
            "Read",
            "--allowedTools",
            "Read",
            "--add-dir",
            str(image.parent),
            "--max-turns",
            "4",
            "--no-session-persistence",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--setting-sources",
            "",
        ],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=240,
        env=env,
        check=False,
    )
    if done.returncode != 0 and not done.stdout.strip():
        raise subprocess.SubprocessError(
            f"claude が終了コード {done.returncode}: {done.stderr.strip()[:200]}"
        )
    return done.stdout


def _one_vote(
    runner: Runner, questions: Sequence[Question], image: Path, model: str
) -> Vote:
    try:
        return parse_output(
            runner(prompt_of(questions, image), image, model), questions
        )
    except (OSError, subprocess.SubprocessError) as e:
        return Vote(None, error=f"{type(e).__name__}: {e}")


def tally(
    questions: Sequence[Question], votes: Sequence[Vote]
) -> tuple[QuestionResult, ...]:
    """問いごとの多数決。3 票とも yes なら yes、3 票とも no なら no、それ以外 (割れ・失敗を含む) は split"""
    out = []
    for q in questions:
        got = [
            (v.answers[q.id][0], v.answers[q.id][1])
            if v.answers
            else ("error", v.error)
            for v in votes
        ]
        kinds = {a for a, _ in got}
        outcome = kinds.pop() if len(kinds) == 1 and kinds != {"error"} else "split"
        out.append(
            QuestionResult(
                q,
                tuple(a for a, _ in got),
                tuple(e for _, e in got),
                outcome if outcome in ("yes", "no") else "split",
            )
        )
    return tuple(out)


def image_result(
    questions: Sequence[Question],
    image: Path,
    votes: Sequence[Vote],
    *,
    pixel_baseline: bool,
) -> ImageResult:
    return ImageResult(
        image,
        tally(questions, votes),
        sum(v.cost_usd for v in votes),
        sum(v.duration_ms for v in votes),
        tuple(sorted({v.model for v in votes if v.model})),
        pixel_baseline,
    )


def writes_pass(result: StepResult) -> bool:
    """LLM の 3 票の yes だけで合格にしてよい手順か。画素の基準を持つ画が 1 枚でもあれば、しない"""
    return result.verdict == "yes" and not any(i.pixel_baseline for i in result.images)


def record_of(result: StepResult) -> dict[str, object]:
    """1 手順の票と根拠 (judge.json にも results.json の llm.steps にも同じ形で書く)"""
    return {
        "step": result.step.text,
        "verdict": result.verdict,
        "images": [
            {
                "image": i.image.name,
                "pixel_baseline": i.pixel_baseline,
                "cost_usd": round(i.cost_usd, 4),
                "duration_ms": i.duration_ms,
                "questions": [
                    {
                        "id": q.question.id,
                        "q": q.question.text,
                        "outcome": q.outcome,
                        "votes": list(q.votes),
                        "evidence": list(q.evidence),
                    }
                    for q in i.questions
                ],
            }
            for i in result.images
        ],
    }


def note_of(steps: Mapping[str, Mapping[str, object]]) -> str:
    """results.json の note。人が読む 1 行ずつ。どの画のどの問いが、どの票で、何を根拠に落ちたか"""
    lines = ["LLM の判定 (手元の claude -p の多数決)。人が見て決める。"]
    for key, rec in steps.items():
        for img in rec["images"]:  # type: ignore[attr-defined]
            for q in img["questions"]:
                if q["outcome"] == "yes":
                    continue
                label = (
                    f"不合格 ({len(q['votes'])} 票とも no)"
                    if q["outcome"] == "no"
                    else "票が割れた"
                )
                why = next(
                    (
                        e
                        for e, v in zip(q["evidence"], q["votes"], strict=True)
                        if v != "yes"
                    ),
                    "",
                )
                lines.append(
                    f"- {key} {img['image']} {q['id']} {label} [{'/'.join(q['votes'])}]: {why}"
                )
    return "\n".join(lines)


def merge_entry(
    existing: Mapping[str, object] | None,
    scenario: str,
    results: Sequence[StepResult],
    *,
    at: str,
    cli: str,
    model: str,
) -> dict[str, object] | None:
    """results.json の 1 項目。人が書いた項目 (by が llm でない) は None (書かない)。
    LLM が前に書いた手順のうち今回当てなかったものは残し、当てた手順は置き換える。合格 (yes) の手順は残さない。
    fail も undecided も無くなれば、空を返して項目を消させる (呼び手が判断する)"""
    if existing is not None and (
        not isinstance(existing, Mapping) or existing.get("by") != "llm"
    ):
        return None
    old = existing.get("llm") if existing else None
    steps: dict[str, dict[str, object]] = (
        dict(old.get("steps", {})) if isinstance(old, dict) else {}
    )
    for r in results:
        if r.errored:
            continue
        if r.verdict == "yes":
            steps.pop(r.step.key, None)
        else:
            steps[r.step.key] = record_of(r)
    if all(r.errored for r in results):
        return dict(existing) if existing else {}
    if not steps:
        return {}
    verdicts = {rec["verdict"] for rec in steps.values()}
    return {
        "verdict": "fail" if "fail" in verdicts else "undecided",
        "note": note_of(steps),
        "at": at,
        "by": "llm",
        "llm": {
            "cli": cli,
            "model": model,
            "cost_usd": round(
                sum(img["cost_usd"] for rec in steps.values() for img in rec["images"]),
                4,
            ),
            "steps": steps,
        },
    }


def apply_results(
    current: Mapping[str, Mapping[str, object]],
    results: Sequence[StepResult],
    *,
    at: str,
    cli: str,
    model: str,
) -> tuple[dict[str, Mapping[str, object]], list[str]]:
    """results.json の新しい中身と、人の判定があって書かなかった id。読むだけで、current は変えない"""
    out = dict(current)
    skipped: list[str] = []
    for scenario in dict.fromkeys(r.step.scenario for r in results):
        mine = [r for r in results if r.step.scenario == scenario]
        entry = merge_entry(
            current.get(scenario),
            scenario,
            mine,
            at=at,
            cli=cli,
            model=model,
        )
        if entry is None:
            skipped.append(scenario)
        elif entry:
            out[scenario] = entry
        else:
            out.pop(scenario, None)
    return out, skipped


def _write_json(path: Path, data: object) -> None:
    """一時ファイルは名前を一意にする (受入の画面のサーバーも results.json.tmp に書くので、同じ名前を使わない)"""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, path)


def _read_json(path: Path) -> dict:
    """無ければ空。壊れている・連想配列でなければ ValueError (呼び出しの費用を払う前に確かめる)"""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"{path} が JSON でない: {e}") from e
    if isinstance(data, dict):
        return data
    raise ValueError(f"{path} が連想配列でない")


def _cli_version() -> str:
    try:
        done = subprocess.run(
            ["claude", "--version"],
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            check=False,
        )
        return done.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


def plan_of(
    root: Path,
    out_dir: Path,
    steps: Sequence[StepRef],
    image_override: Sequence[Path],
) -> list[tuple[StepRef, list[Question], Path, bool]]:
    """(手順, 問い, 画, 画素の基準を持つか) の表。画が無ければ FileNotFoundError (黙って飛ばさない)。
    --image で画を替えたときの基準は、手順が本来指す画のものを見る"""
    rubrics = _read_json(root / RUBRICS)
    shots_dir = out_dir / SHOTS_DIR
    shots = shots_of(
        p.name for p in (shots_dir.iterdir() if shots_dir.is_dir() else ())
    )
    plan = []
    for step in steps:
        nominal = images_of(step, shots, shots_dir) if shots.get(step.scenario) else []
        images = list(image_override) or nominal
        if not images:
            raise FileNotFoundError(
                f"{step.key} の画が {shots_dir} に無い ({step.scenario}-*.png)"
            )
        missing = [p for p in images if not p.is_file()]
        if missing:
            raise FileNotFoundError(
                f"{step.key} の画が無い: {[str(p) for p in missing]}"
            )
        qs = questions_of(step, rubrics)
        baselined = any(has_pixel_baseline(p, root / BASELINES) for p in nominal)
        plan += [
            (
                step,
                qs,
                p,
                baselined
                if image_override
                else has_pixel_baseline(p, root / BASELINES),
            )
            for p in images
        ]
    return plan


def run(
    root: Path,
    out_dir: Path,
    steps: Sequence[StepRef],
    *,
    runner: Runner,
    model: str,
    votes: int,
    jobs: int,
    image_override: Sequence[Path] = (),
    cli: str = "unknown",
    now: Callable[[], datetime.datetime] = lambda: datetime.datetime.now(datetime.UTC),
) -> tuple[list[StepResult], float, float, list[str]]:
    """steps を当てる。(結果, かかった秒, 換算額の合計, 人の判定があって書かなかった id)。
    results.json と judge.json を書く。ただし --image で画を替えたとき (仕込んだ欠陥の試し) は書かない"""
    plan = plan_of(root, out_dir, steps, image_override)
    current = _read_json(out_dir / "results.json")
    log = _read_json(out_dir / JUDGE_LOG)
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = [
            [pool.submit(_one_vote, runner, qs, image, model) for _ in range(votes)]
            for _, qs, image, _ in plan
        ]
        got = [[f.result() for f in fs] for fs in futures]
    elapsed = time.monotonic() - started
    by_step: dict[StepRef, list[ImageResult]] = {}
    for (step, qs, image, baselined), vs in zip(plan, got, strict=True):
        by_step.setdefault(step, []).append(
            image_result(qs, image, vs, pixel_baseline=baselined)
        )
    results = [StepResult(step, tuple(imgs)) for step, imgs in by_step.items()]
    cost = sum(i.cost_usd for r in results for i in r.images)
    if image_override:
        return results, elapsed, cost, []
    models = ",".join(sorted({m for r in results for i in r.images for m in i.models}))
    at = now().isoformat(timespec="seconds").replace("+00:00", "Z")
    # 書く直前に読み直す (呼び出しの間に人が画面で保存した判定を失わない)
    current = _read_json(out_dir / "results.json")
    new, skipped = apply_results(current, results, at=at, cli=cli, model=models)
    if new != current:
        _write_json(out_dir / "results.json", new)
    for r in results:
        if r.errored:
            continue
        log[r.step.key] = {
            **record_of(r),
            "at": at,
            "cli": cli,
            "model": models,
            "writes_pass": writes_pass(r),
        }
    _write_json(out_dir / JUDGE_LOG, log)
    return results, elapsed, cost, skipped


def summary_of(
    results: Sequence[StepResult], elapsed: float, cost: float, skipped: Sequence[str]
) -> str:
    lines = []
    for r in results:
        note = (
            ""
            if r.verdict != "yes"
            else (
                " (画素の基準があるので合格にしない)"
                if not writes_pass(r)
                else " (合格候補)"
            )
        )
        lines.append(f"{r.step.key}: {r.verdict}{note}")
        for i in r.images:
            for q in i.questions:
                lines.append(
                    f"  {i.image.name} {q.question.id}: {'/'.join(q.votes)} -> {q.outcome}"
                )
    n_calls = sum(
        len(q.votes) for r in results for i in r.images for q in i.questions[:1]
    )
    lines.append(f"{n_calls} 回の呼び出し、{elapsed:.0f} 秒、換算 {cost:.3f} USD")
    lines += [f"{s}: 人の判定があるので書かない" for s in skipped]
    return "\n".join(lines)


def main(
    argv: Sequence[str] | None = None,
    root: Path | None = None,
    runner: Runner = run_claude,
) -> int:
    root = root or Path.cwd()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--step",
        action="append",
        default=[],
        metavar="ID/n",
        help="当てる手順。無ければ正本の judge が llm の手順",
    )
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        type=Path,
        help="手順の画の代わりに当てる画 (--step が 1 つのとき)",
    )
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--votes", type=int, default=VOTES)
    parser.add_argument("--jobs", type=int, default=JOBS)
    parser.add_argument(
        "--dry-run", action="store_true", help="呼ばずに、何を何回呼ぶかだけ出す"
    )
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["--"]:
        argv = argv[1:]
    args = parser.parse_args(argv)
    if args.image and len(args.step) != 1:
        parser.error("--image は --step を 1 つだけ指すときに使う")
    if args.votes < 1 or args.jobs < 1:
        parser.error("--votes と --jobs は 1 以上")

    sot, problems = load((root / SOT).read_text(encoding="utf-8"))
    if problems:
        _print(problems)
        return 1
    try:
        steps = select_steps(sot, args.step)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 2
    if not steps:
        print('正本に judge が "llm" の手順は無い。--step <ID>/<n> で当てる手順を指す')
        return 0
    out_dir = acceptance_dir(root, os.environ)
    try:
        plan = plan_of(root, out_dir, steps, args.image)
    except (FileNotFoundError, ValueError) as e:
        print(e, file=sys.stderr)
        return 1
    if args.dry_run:
        for step, qs, image, _ in plan:
            print(f"{step.key} {image.name}: 問い {len(qs)} つ x {args.votes} 回")
        print(f"計 {len(plan) * args.votes} 回の claude -p ({args.model})")
        return 0
    try:
        results, elapsed, cost, skipped = run(
            root,
            out_dir,
            steps,
            runner=runner,
            model=args.model,
            votes=args.votes,
            jobs=args.jobs,
            image_override=args.image,
            cli=_cli_version(),
        )
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    print(summary_of(results, elapsed, cost, skipped))
    if args.image:
        print("--image で画を替えたので、results.json と judge.json には書かない")
    failed = [r.step.key for r in results if r.errored]
    if failed:
        print(
            f"{'・'.join(failed)}: 呼び出しがすべて失敗した。記録は書き換えていない",
            file=sys.stderr,
        )
        return 1
    return 0


def _print(problems: Sequence[Problem]) -> None:
    for p in problems:
        print(f"{p.where}: [{p.rule}] {p.detail}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
