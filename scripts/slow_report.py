# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""回帰の通し実行 (tests/slow) を分けて並列に回し、シナリオごとの結果と所要時間の表を出す (M19-03)。

    pnpm run test:slow:table                       # 2 本並列で回し、表と合計時間を出す
    pnpm run test:slow:table --jobs 1              # 1 本で (分けを 1 つにまとめて)
    uv run scripts/slow_report.py report a.json …  # vitest の JSON の報告から表だけ作る
    uv run scripts/slow_report.py compare <置き場 A> <置き場 B>  # 2 回の結果 (実際と合否) を比べる

並列の単位
vitest が worker に配る単位はファイルで、ファイルの中の試験は 1 つの worker で順に回る。
tests/slow の試験はほぼ全部が 1 つのファイル (scenarios.playthrough.test.ts) にあり、
本体は同期の CPU の回し (await が無い) なので it.concurrent でも重ならない。
そこで describe の題ごとに `-t` の名の型で分け、分けごとに vitest の処理を 1 つ立てて並列に回す。
GROUPS に無い describe (新しいシナリオ) は残り (REST) の分けが拾い、回らない試験は出ない。
どの試験もちょうど 1 つの分けで回ったかを表を作るときに確かめる (二度回った・回らなかったを落とす)。

出すもの (既定の置き場は .claude/verify/<YYYYMMDD-HHMM>-slow/。git の外)
- <分け>.json・<分け>.log: vitest の JSON の報告と dot の出力
- slow.md: 表 (シナリオごとの期待・実際・結果・秒) と、合計の壁時計・試験の時間の和・上限との比べ

期待は題の「→ alive/dead/escaped」(観察の試験は「結末 …」) から読む。題に無い試験は「—」。
実際は、通った試験は期待と同じ、落ちた試験は `expected 'X' to be 'Y'` の X。
時間切れ (Test timed out) は「timeout」。本体は同期なので vitest は回し終えてから時間切れを言い、結末は残らない。
上限 (既定 30 分) と超えたときの方針は docs/specs/2026-10-18-decisions-current.md の節「回帰の通し実行の時間」。
"""

from __future__ import annotations

import argparse
import datetime
import heapq
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

# tests/slow の describe の題と、1 本で回したときの分 (分けの重さ)。
# 2026-10-20 の Lane 1 の 1 回目から: 時間切れの無かった群は実測、時間切れを含む群は通った試験の和に
# 時間切れの試験を同じ群の平均で足した見積もり。新しい describe はここに足さなくても REST の分けで回る
GROUPS: tuple[tuple[str, float], ...] = (
    ("scenario playthroughs (size 64)", 12.3),
    ("tower scenario v2 playthroughs (size 64)", 4.5),
    ("faith scenarios (M9-04, size 64)", 13.0),
    ("intercept-tower scenario playthroughs (size 64)", 15.0),
    ("sky-ship scenario playthroughs (size 64)", 14.0),
    ("観察画面の 4 場面が空の舟の実プレイで引かれる (M22-09)", 1.6),
)
REST = "(残り)"

VERDICTS = ("alive", "dead", "escaped")
_EXPECTED = re.compile(r"(?:→|結末)\s*(alive|dead|escaped)\b")
_ACTUAL = re.compile(r"expected '(\w+)' to be '(\w+)'")
_TIMEOUT = re.compile(r"(?:Error: )?Test timed out in ")
_JS_SPECIAL = re.compile(r"([\\^$.*+?()\[\]{}|/])")
RAN = frozenset({"passed", "failed"})
LIMIT_MINUTES = 30


@dataclass(frozen=True)
class Row:
    file: str
    group: str
    title: str
    status: str
    expected: str
    observed: str
    seconds: float
    shard: str = ""

    @property
    def key(self) -> str:
        return f"{self.file} > {self.group} > {self.title}"


def expected_of(title: str) -> str:
    """題が言う結末。題に無ければ「—」"""
    m = _EXPECTED.search(title)
    return m.group(1) if m else "—"


def observed_of(status: str, expected: str, failures: Sequence[str]) -> str:
    """実際の結末。通った試験は期待どおり、落ちた試験は判定の比べから読む。回っていなければ空"""
    if status == "passed":
        return expected
    if status != "failed":
        return ""
    if any(_TIMEOUT.match(message) for message in failures):
        return "timeout"
    for message in failures:
        m = _ACTUAL.search(message)
        if m and m.group(1) in VERDICTS:
            return m.group(1)
    return "?"


def _relative(path: str, root: str) -> str:
    prefix = root.rstrip("/") + "/"
    return path.removeprefix(prefix)


def rows_of(report: Mapping, root: str, shard: str = "") -> list[Row]:
    """vitest の JSON の報告 1 つを行にする (飛ばした試験も含む)"""
    rows: list[Row] = []
    for file in report.get("testResults", []):
        name = _relative(str(file.get("name", "")), root)
        for t in file.get("assertionResults", []):
            title = str(t.get("title", ""))
            ancestors = t.get("ancestorTitles") or []
            status = str(t.get("status", ""))
            expected = expected_of(title)
            rows.append(
                Row(
                    file=name,
                    group=str(ancestors[0]) if ancestors else "",
                    title=title,
                    status=status,
                    expected=expected,
                    observed=observed_of(
                        status, expected, t.get("failureMessages") or []
                    ),
                    seconds=float(t.get("duration") or 0) / 1000,
                    shard=shard,
                )
            )
    return rows


def span_seconds(reports: Sequence[Mapping]) -> float:
    """試験が回ったファイルの、最初の始まりから最後の終わりまで (秒)"""
    spans = [
        (f["startTime"], f["endTime"])
        for r in reports
        for f in r.get("testResults", [])
        if any(t.get("status") in RAN for t in f.get("assertionResults", []))
    ]
    if not spans:
        return 0.0
    return (max(e for _, e in spans) - min(s for s, _ in spans)) / 1000


def check_partition(rows: Sequence[Row]) -> tuple[list[Row], list[str], list[str]]:
    """回った行 (試験ごとに 1 つ、初出の順)・二度回った試験・どの分けでも回らなかった試験"""
    order: list[str] = []
    ran: dict[str, list[Row]] = {}
    for r in rows:
        if r.key not in ran:
            order.append(r.key)
            ran[r.key] = []
        if r.status in RAN:
            ran[r.key].append(r)
    kept = [ran[k][0] for k in order if ran[k]]
    duplicated = [k for k in order if len(ran[k]) > 1]
    missing = [k for k in order if not ran[k]]
    return kept, duplicated, missing


def compare_rows(a: Sequence[Row], b: Sequence[Row]) -> list[str]:
    """2 回の通し実行で、試験ごとの実際と結果が違うもの (片方にしか無いものも)"""

    def verdicts(rows: Sequence[Row]) -> dict[str, str]:
        return {r.key: f"{r.observed or '?'}/{r.status}" for r in rows}

    va, vb = verdicts(a), verdicts(b)
    keys = list(va) + [k for k in vb if k not in va]
    return [
        f"{k}: {va.get(k, '(無し)')} ≠ {vb.get(k, '(無し)')}"
        for k in keys
        if va.get(k) != vb.get(k)
    ]


def js_escape(text: str) -> str:
    """JavaScript の RegExp の特別な字を逃がす (空白・かな漢字はそのまま)"""
    return _JS_SPECIAL.sub(r"\\\1", text)


def pattern_of(groups: Sequence[str]) -> str:
    """分けの `-t` の型。vitest は「describe の題 + 空白 + 試験の題」に当てる。REST は GROUPS の外の全部"""
    named = [js_escape(g) + " " for g in groups if g != REST]
    if REST in groups:
        every = "|".join(js_escape(g) + " " for g, _ in GROUPS)
        named.append(f"(?!(?:{every}))")
    return "^(?:" + "|".join(named) + ")"


def bins_of(weights: Sequence[tuple[str, float]], jobs: int) -> list[list[str]]:
    """重い順に、いちばん軽い分けへ入れる。REST は最後に、いちばん軽い分けへ。空の分けは捨てる"""
    if jobs < 1:
        raise ValueError("jobs は 1 以上")
    heap = [(0.0, i) for i in range(jobs)]
    bins: list[list[str]] = [[] for _ in range(jobs)]
    for name, weight in sorted(weights, key=lambda w: -w[1]):
        load, i = heapq.heappop(heap)
        bins[i].append(name)
        heapq.heappush(heap, (load + weight, i))
    _, i = heapq.heappop(heap)
    bins[i].append(REST)
    return [b for b in bins if b]


def command_of(pattern: str, out: Path, caffeinate: str | None) -> list[str]:
    """分け 1 つの vitest の命令 (SLOW=1 は環境で渡す)"""
    cmd = [
        "pnpm",
        "exec",
        "vitest",
        "run",
        "-t",
        pattern,
        "--reporter=dot",
        "--reporter=json",
        f"--outputFile.json={out}",
    ]
    # -s が要る。蓋を閉じた Mac は DarkWake の間に回り、-i だけでは眠りに戻って時間切れになる (2026-10-20)
    return [caffeinate, "-ims", *cmd] if caffeinate else cmd


def format_clock(seconds: float) -> str:
    total = round(seconds)
    h, rest = divmod(total, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def render(
    rows: Sequence[Row],
    wall: float,
    limit_minutes: int,
    label: str,
    duplicated: Sequence[str] = (),
    missing: Sequence[str] = (),
    load: tuple[float, float] | None = None,
) -> str:
    passed = sum(1 for r in rows if r.status == "passed")
    failed = sum(1 for r in rows if r.status == "failed")
    total = sum(r.seconds for r in rows)
    limit = limit_minutes * 60
    side = "の内" if wall <= limit else "を超えた"
    lines = [
        f"# 通し実行 {label}",
        "",
        f"- 件数: {len(rows)} (pass {passed}、fail {failed})",
        (
            f"- 合計の壁時計: {format_clock(wall)} ({round(wall)} s)。"
            f"上限 {format_clock(limit)} {side}"
        ),
        f"- 試験の時間の和: {format_clock(total)} ({round(total)} s)",
    ]
    if load is not None:
        lines.append(
            f"- 負荷 (1 分の load average): 始め {load[0]:.2f}、終わり {load[1]:.2f}"
        )
    lines += [f"- 二度回った: {k}" for k in duplicated]
    lines += [f"- 回らなかった: {k}" for k in missing]
    lines += [
        "",
        "| # | 群 | 題 | 期待 | 実際 | 結果 | 秒 | 分け |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for n, r in enumerate(rows, start=1):
        result = (
            "pass" if r.status == "passed" else f"**{r.status.upper()[:4] or '?'}**"
        )
        lines.append(
            f"| {n} | {_cell(r.group)} | {_cell(r.title)} | {r.expected} | "
            f"{r.observed} | {result} | {r.seconds:.1f} | {r.shard} |"
        )
    sums: dict[str, list[float]] = {}
    for r in rows:
        sums.setdefault(r.group, []).append(r.seconds)
    lines += ["", "| 群 | 件 | 時間 |", "|---|---|---|"]
    lines += [
        f"| {_cell(g)} | {len(s)} | {format_clock(sum(s))} |" for g, s in sums.items()
    ]
    return "\n".join(lines) + "\n"


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    rep = sub.add_parser("report", help="vitest の JSON の報告から表を作る")
    rep.add_argument("json", nargs="+", type=Path)
    rep.add_argument("--wall", type=float, help="壁時計の秒 (無ければ報告の時刻から)")
    run = sub.add_parser("run", help="分けて並列に回し、表を作る")
    run.add_argument("--jobs", type=int, default=2)
    run.add_argument(
        "--dir", type=Path, help="出す置き場 (既定 .claude/verify/<日時>-slow)"
    )
    cmp = sub.add_parser("compare", help="2 回の通し実行の置き場を比べる (実際と結果)")
    cmp.add_argument("a", type=Path)
    cmp.add_argument("b", type=Path)
    cmp.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    for p in (rep, run):
        p.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
        p.add_argument(
            "--out", type=Path, help="表の .md (run の既定は <置き場>/slow.md)"
        )
        p.add_argument("--limit-minutes", type=int, default=LIMIT_MINUTES)
        p.add_argument("--label", default="")
    return parser.parse_args(argv)


def _load(paths: Sequence[Path]) -> list[tuple[str, dict]]:
    return [(p.stem, data) for p, data in _load_pairs(paths)]


def _finish(
    reports: Sequence[tuple[str, dict]],
    root: str,
    wall: float | None,
    limit_minutes: int,
    label: str,
    out: Path | None,
    load: tuple[float, float] | None = None,
) -> int:
    rows = [r for shard, data in reports for r in rows_of(data, root, shard)]
    kept, duplicated, missing = check_partition(rows)
    seconds = wall if wall is not None else span_seconds([d for _, d in reports])
    text = render(kept, seconds, limit_minutes, label, duplicated, missing, load)
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
    print(text, end="")
    bad = any(r.status != "passed" for r in kept) or duplicated or missing
    return 1 if bad else 0


def _run(args: argparse.Namespace) -> int:
    root = Path(args.root)
    stamp = datetime.datetime.now().astimezone().strftime("%Y%m%d-%H%M")
    out_dir = args.dir or root / ".claude" / "verify" / f"{stamp}-slow"
    out_dir.mkdir(parents=True, exist_ok=True)
    bins = bins_of(GROUPS, args.jobs)
    caffeinate = shutil.which("caffeinate")
    env = {**os.environ, "SLOW": "1"}
    procs: list[tuple[str, subprocess.Popen, object]] = []
    plan = []
    start = time.monotonic()
    load_start = os.getloadavg()[0]
    for n, groups in enumerate(bins, start=1):
        shard = f"s{n}"
        pattern = pattern_of(groups)
        plan.append({"shard": shard, "groups": groups, "pattern": pattern})
        log = (out_dir / f"{shard}.log").open("w", encoding="utf-8")
        cmd = command_of(pattern, out_dir / f"{shard}.json", caffeinate)
        print(f"[{shard}] {' / '.join(groups)}", file=sys.stderr)
        procs.append(
            (
                shard,
                subprocess.Popen(
                    cmd, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT
                ),
                log,
            )
        )
    (out_dir / "shards.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    for shard, proc, log in procs:
        code = proc.wait()
        log.close()  # type: ignore[attr-defined]
        print(
            f"[{shard}] 終わり exit {code} ({format_clock(time.monotonic() - start)})",
            file=sys.stderr,
        )
    wall = time.monotonic() - start
    load_end = os.getloadavg()[0]
    paths = [out_dir / f"s{n}.json" for n in range(1, len(bins) + 1)]
    lost = [p.name for p in paths if not p.exists()]
    if lost:
        print(
            f"JSON の報告が無い: {', '.join(lost)} (<分け>.log を見る)", file=sys.stderr
        )
        return 1
    reports = _load(paths)
    label = args.label or f"(jobs {args.jobs}、{out_dir.name})"
    return _finish(
        reports,
        str(root),
        wall,
        args.limit_minutes,
        label,
        args.out or out_dir / "slow.md",
        (load_start, load_end),
    )


def _rows_in(directory: Path, root: str) -> list[Row]:
    reports = [
        (p.stem, data)
        for p, data in _load_pairs(sorted(directory.glob("*.json")))
        if "testResults" in data
    ]
    rows = [r for shard, data in reports for r in rows_of(data, root, shard)]
    return check_partition(rows)[0]


def _load_pairs(paths: Sequence[Path]) -> list[tuple[Path, dict]]:
    return [(p, json.loads(p.read_text(encoding="utf-8"))) for p in paths]


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "run":
        return _run(args)
    if args.command == "compare":
        a, b = _rows_in(args.a, args.root), _rows_in(args.b, args.root)
        diff = compare_rows(a, b)
        for line in diff:
            print(line)
        print(f"{len(a)} 件と {len(b)} 件を比べ、違い {len(diff)} 件")
        return 1 if diff else 0
    return _finish(
        _load(args.json),
        args.root,
        args.wall,
        args.limit_minutes,
        args.label,
        args.out,
    )


if __name__ == "__main__":
    sys.exit(main())
