# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""受入の確かめの正本の検査と、受入の画面の items.json の生成 (M21-06)。

正本は docs/acceptance/scenarios.jsonl。1 行が code (領域) か scenario (Gherkin の 1 シナリオ)。
人が見るのは mode が human の行だけ。auto の行は covered_by の自動の試験に任せる。
設計は docs/design/2026-09-29-acceptance-redesign.md。

    uv run scripts/acceptance.py check                 # pnpm run check でも test_acceptance.py が回す
    uv run scripts/acceptance.py page                  # 人の 1 周の items.json を書く
    uv run scripts/acceptance.py page --when deploy    # 配ったあとの本番の回
    uv run scripts/acceptance.py feature               # Gherkin の文で読む
    uv run scripts/acceptance.py next HBR              # 次の id (退役した行も数える)
    uv run scripts/acceptance.py dir                   # 受入の画面の置き場 (pnpm run shots が画を書く先)

行は消さない。要らなくなった行は status を retired にし、retired に日付・理由・代わりの id を書く。
行を消すと領域の連番に穴が空いて check が落ちる (一度付けた id を使い回さないため)。
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from check_free_tier import parse_jsonc

SOT = Path("docs/acceptance/scenarios.jsonl")

CODE_PATTERN = re.compile(r"^[A-Z]{3}$")
ID_PATTERN = re.compile(r"^(?P<code>[A-Z]{3})-(?P<num>\d{3})$")
TICKET_PATTERN = re.compile(r"^[A-Z][A-Z0-9]*-\d{2}$")
# tests/e2e/shots.spec.ts が受入の画面の置き場の shots/ に書く画 (M21-08)
SHOT_PATTERN = re.compile(r"^(?P<id>[A-Z]{3}-\d{3})-(?P<n>\d+)\.png$")
SHOTS_DIR = "shots"
# 受入の画面のサーバー (server.mjs) が受ける id の形。旧い手順書の id もこれに収まる
LEGACY_PATTERN = re.compile(r"^[\w-]+$")

KEYWORDS = ("前提", "もし", "ならば", "かつ", "しかし")
# 人の確かめの 1 回の上限 (分、待ちを含む)。2026-09-29 のユーザーの依頼「手間がかかりすぎ」から
ROUND_MINUTES = 15
WHENS = ("round", "deploy")
# wrangler dev の既定の口。受入のビルド (pnpm run dev:acceptance) はここで答える
WRANGLER_DEV_PORT = 8787
# workers.dev のアカウントのサブドメイン。repo の設定には無いので、ここに置く (公開の URL の一部)
WORKERS_SUBDOMAIN = "dev-sim-bio"

CODE_KEYS = {"kind", "code", "name", "background"}
SCENARIO_KEYS = {
    "kind",
    "id",
    "status",
    "mode",
    "title",
    "tickets",
    "from",
    "steps",
    "covered_by",
}
# 手順の札。札の付いた手順は、何が判じるか (checks か judge) を持つ (ADR 0001 段 4)
TAG_PATTERN = re.compile(r"^【(?:見た目|読みやすさ|手触り)】")
MARK_KEYS = {"checks", "judge"}
STEP_JUDGES = ("llm", "human")
# tests/e2e/lens.ts の `export const LENSES = { 名前: 関数, ... }` の名前が、checks の lens に書ける名前
LENS_FILE = "tests/e2e/lens.ts"
LENSES_PATTERN = re.compile(
    r"^export const LENSES\s*=\s*\{(?P<body>[^}]*)\}", re.MULTILINE
)
LENS_NAME_PATTERN = re.compile(r"(?:^|,)\s*(\w+)\s*:", re.MULTILINE)
HUMAN_KEYS = {"when", "minutes", "links", "judge"}
OPTIONAL_KEYS = HUMAN_KEYS | {"retired"}


@dataclass(frozen=True)
class Code:
    code: str
    name: str
    background: tuple[str, ...]


@dataclass(frozen=True)
class Link:
    label: str
    # 画面の根からの道 (`/?scenario=…`)。scheme と host は持たない。base は環境から決める
    path: str


@dataclass(frozen=True)
class Check:
    """機械が見る 1 つ。lens は tests/e2e/lens.ts の LENSES の名前、target は撮る要素の名前 (shotsOf に渡す名)"""

    lens: str
    target: str


@dataclass(frozen=True)
class Mark:
    """1 つの手順を何が判じるか。checks は機械、judge は "llm" か "human" """

    checks: tuple[Check, ...]
    judge: str | None


@dataclass(frozen=True)
class Cover:
    """このシナリオを確かめる自動の試験。title は file の中の試験の題名 (の一部)"""

    file: str
    title: str
    # まだ無い試験を約束するチケット。試験ができたら外す
    planned: str | None


@dataclass(frozen=True)
class Retired:
    on: str
    reason: str
    replaced_by: tuple[str, ...]


@dataclass(frozen=True)
class Scenario:
    id: str
    status: str
    mode: str
    title: str
    tickets: tuple[str, ...]
    # 再設計の前の手順書の id (results.json の鍵)。1 つの旧 id を複数の行が引いてよい
    from_: tuple[str, ...]
    steps: tuple[tuple[str, str], ...]
    # steps と同じ長さ。札のない手順や、何も書かれていない手順は None
    marks: tuple[Mark | None, ...]
    covered_by: tuple[Cover, ...]
    when: str | None
    minutes: float | None
    links: tuple[Link, ...]
    judge: str | None
    retired: Retired | None
    # human の鍵が 1 つでも書かれているか (auto の行に書かれていたら誤り)
    has_human_keys: bool

    @property
    def code(self) -> str:
        return self.id[:3]


@dataclass(frozen=True)
class Sot:
    codes: tuple[Code, ...]
    scenarios: tuple[Scenario, ...]


@dataclass(frozen=True)
class Problem:
    # シナリオの id か、読めない行なら "line N"
    where: str
    rule: str
    detail: str


def _strs(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValueError(f"文字列の配列でない: {value!r}")
    return tuple(value)


def _parse_code(row: Mapping[str, object]) -> Code:
    return Code(str(row["code"]), str(row["name"]), _strs(row.get("background", [])))


def _parse_mark(raw: object) -> Mark:
    if not isinstance(raw, dict) or set(raw) - MARK_KEYS:
        raise ValueError(f"手順の 3 つ目は {{checks, judge}} の連想配列: {raw!r}")
    checks = raw.get("checks", [])
    if not isinstance(checks, list) or not all(
        isinstance(c, dict)
        and set(c) == {"lens", "target"}
        and all(isinstance(v, str) for v in c.values())
        for c in checks
    ):
        raise ValueError("checks は {lens, target} の配列")
    judge = raw.get("judge")
    if judge is not None and not isinstance(judge, str):
        raise ValueError("judge は文字列")
    return Mark(tuple(Check(c["lens"], c["target"]) for c in checks), judge)


def _parse_scenario(row: Mapping[str, object]) -> Scenario:
    steps = row["steps"]
    if not isinstance(steps, list) or not all(
        isinstance(s, list)
        and len(s) in (2, 3)
        and all(isinstance(x, str) for x in s[:2])
        for s in steps
    ):
        raise ValueError(
            "steps は [キーワード, 文] か [キーワード, 文, {checks, judge}] の配列"
        )
    covers = row["covered_by"]
    if not isinstance(covers, list) or not all(isinstance(c, dict) for c in covers):
        raise ValueError("covered_by は {file, title, planned?} の配列")
    links = row.get("links", [])
    if not isinstance(links, list) or not all(isinstance(link, dict) for link in links):
        raise ValueError("links は {label, path} の配列")
    retired = row.get("retired")
    if retired is not None and not isinstance(retired, dict):
        raise ValueError("retired は {on, reason, replaced_by}")
    minutes = row.get("minutes")
    if minutes is not None and not isinstance(minutes, int | float):
        raise ValueError("minutes は数")
    judge = row.get("judge")
    when = row.get("when")
    return Scenario(
        id=str(row["id"]),
        status=str(row["status"]),
        mode=str(row["mode"]),
        title=str(row["title"]),
        tickets=_strs(row["tickets"]),
        from_=_strs(row["from"]),
        steps=tuple((s[0], s[1]) for s in steps),
        marks=tuple(_parse_mark(s[2]) if len(s) == 3 else None for s in steps),
        covered_by=tuple(
            Cover(str(c.get("file", "")), str(c.get("title", "")), c.get("planned"))
            for c in covers
        ),
        when=None if when is None else str(when),
        minutes=minutes,
        links=tuple(
            Link(str(link.get("label", "")), str(link.get("path", "")))
            for link in links
        ),
        judge=None if judge is None else str(judge),
        retired=None
        if retired is None
        else Retired(
            str(retired.get("on", "")),
            str(retired.get("reason", "")),
            _strs(retired.get("replaced_by", [])),
        ),
        has_human_keys=any(k in row for k in HUMAN_KEYS),
    )


def load(text: str) -> tuple[Sot, list[Problem]]:
    """正本の全文を読む。空行は飛ばす。読めない行・知らない鍵は行番号つきの Problem にして飛ばし、
    読めた行は返す (投げない)"""
    codes: list[Code] = []
    scenarios: list[Scenario] = []
    problems: list[Problem] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        where = f"line {lineno}"
        try:
            row = json.loads(line)
        except json.JSONDecodeError as e:
            problems.append(Problem(where, "json", str(e)))
            continue
        kind = row.get("kind") if isinstance(row, dict) else None
        if kind == "code":
            required, allowed = CODE_KEYS - {"background"}, CODE_KEYS
        elif kind == "scenario":
            required, allowed = SCENARIO_KEYS, SCENARIO_KEYS | OPTIONAL_KEYS
        else:
            problems.append(
                Problem(where, "shape", f"kind は code か scenario: {kind!r}")
            )
            continue
        unknown = sorted(set(row) - allowed)
        missing = sorted(required - set(row))
        if unknown or missing:
            detail = "、".join(
                [f"知らない鍵 {k}" for k in unknown] + [f"無い鍵 {k}" for k in missing]
            )
            problems.append(Problem(where, "shape", detail))
            continue
        try:
            if kind == "code":
                codes.append(_parse_code(row))
            else:
                scenarios.append(_parse_scenario(row))
        except (ValueError, TypeError, AttributeError) as e:
            problems.append(Problem(where, "shape", str(e)))
    return Sot(tuple(codes), tuple(scenarios)), problems


def _check_ids(sot: Sot) -> list[Problem]:
    problems: list[Problem] = []
    declared: set[str] = set()
    for c in sot.codes:
        if not CODE_PATTERN.match(c.code) or c.code in declared:
            problems.append(
                Problem(c.code, "id", "領域は英大文字 3 字で、1 度だけ宣言する")
            )
        declared.add(c.code)
    seen: set[str] = set()
    numbers: dict[str, set[int]] = {}
    for s in sot.scenarios:
        m = ID_PATTERN.match(s.id)
        if not m:
            problems.append(
                Problem(s.id, "id", "id は <領域 3 字>-<3 桁> (例 HBR-004)")
            )
        elif m["code"] not in declared:
            problems.append(Problem(s.id, "id", f"領域 {m['code']} の code の行が無い"))
        elif s.id in seen:
            problems.append(Problem(s.id, "id", "同じ id の行が 2 つある"))
        else:
            numbers.setdefault(m["code"], set()).add(int(m["num"]))
        seen.add(s.id)
    for c, nums in numbers.items():
        missing = [f"{c}-{n:03d}" for n in range(1, max(nums) + 1) if n not in nums]
        if missing:
            problems.append(
                Problem(
                    c,
                    "never-reuse",
                    f"{'・'.join(missing)} が無い。行は消さず status を retired にする",
                )
            )
    return problems


def _check_shape(s: Scenario, ids: set[str]) -> list[Problem]:
    problems: list[Problem] = []

    def bad(rule: str, detail: str) -> None:
        problems.append(Problem(s.id, rule, detail))

    if s.status not in ("active", "retired") or s.mode not in ("auto", "human"):
        bad("shape", "status は active か retired、mode は auto か human")
    if not s.title:
        bad("shape", "title が空")
    if not all(TICKET_PATTERN.match(t) for t in s.tickets):
        bad(
            "shape",
            f"tickets は issues/ の id の形 (M19-09・ART-01): {list(s.tickets)}",
        )
    if not all(LEGACY_PATTERN.match(f) for f in s.from_):
        bad("shape", f"from は受入の画面の id の形: {list(s.from_)}")

    kws = [kw for kw, _ in s.steps]
    if (
        not kws
        or any(kw not in KEYWORDS for kw in kws)
        or kws[0] not in ("前提", "もし")
        or "ならば" not in kws
    ):
        bad(
            "gherkin",
            f"steps は 前提 か もし で始め、ならば を持つ ({'・'.join(KEYWORDS)}): {kws}",
        )

    if s.mode == "human":
        if s.when not in WHENS or not s.minutes or s.minutes <= 0 or not s.judge:
            bad(
                "shape",
                "human は when (round か deploy)・minutes (正の数)・judge を持つ",
            )
    elif s.has_human_keys:
        bad("shape", "auto は when・minutes・links・judge を持たない")
    for link in s.links:
        if not link.path.startswith("/") or link.path.startswith("//"):
            bad("link", f"links の path は / で始まる画面の根からの道: {link.path!r}")
        elif "player=" in link.path:
            bad(
                "link",
                f"人の確かめに player= を使わない (複数の見守り手は自動に任せる): {link.path}",
            )

    if s.status == "active" and s.retired is not None:
        bad("retired", "active の行は retired を持たない")
    elif s.status == "retired":
        if s.retired is None or not s.retired.on or not s.retired.reason:
            bad("retired", "retired の行は retired {on, reason, replaced_by} を持つ")
        elif any(r not in ids for r in s.retired.replaced_by):
            bad(
                "retired",
                f"replaced_by に無い id がある: {list(s.retired.replaced_by)}",
            )
    return problems


def lens_names(read: Callable[[str], str | None]) -> frozenset[str]:
    """tests/e2e/lens.ts の LENSES の名前。ファイルか LENSES が無ければ空"""
    m = LENSES_PATTERN.search(read(LENS_FILE) or "")
    return frozenset(LENS_NAME_PATTERN.findall(m["body"])) if m else frozenset()


def _check_marks(s: Scenario, lenses: frozenset[str]) -> list[Problem]:
    """札の付いた手順は、checks か judge を持つ。checks の lens は lens.ts の名前、judge は llm か human"""
    if s.status != "active":
        return []
    problems: list[Problem] = []

    def bad(step: str, detail: str) -> None:
        problems.append(Problem(s.id, "step-checks", f"「{step[:24]}」{detail}"))

    for (kw, text), mark in zip(s.steps, s.marks, strict=True):
        step = f"{kw} {text}"
        if mark is None or not (mark.checks or mark.judge is not None):
            if TAG_PATTERN.match(text):
                bad(step, "は札が付いているのに checks も judge も無い")
            continue
        for c in mark.checks:
            if c.lens not in lenses:
                known = "・".join(sorted(lenses)) or "無い"
                bad(
                    step,
                    f"の lens {c.lens!r} が {LENS_FILE} の LENSES に無い (ある: {known})",
                )
            if not c.target.strip():
                bad(step, f"の checks の target が空 (lens {c.lens!r})")
        if mark.judge is not None and mark.judge not in STEP_JUDGES:
            bad(step, f"の judge は {' か '.join(STEP_JUDGES)}: {mark.judge!r}")
    return problems


def _check_coverage(
    s: Scenario,
    read: Callable[[str], str | None],
    ticket_status: Callable[[str], str | None],
) -> list[Problem]:
    if s.status != "active":
        return []
    problems: list[Problem] = []

    def bad(detail: str) -> None:
        problems.append(Problem(s.id, "cover", detail))

    exists_today = 0
    for c in s.covered_by:
        if not c.file or not c.title:
            bad(f"covered_by は file と title を持つ: {c}")
            continue
        text = read(c.file)
        if c.planned is None:
            if text is None:
                bad(f"{c.file} が無い")
            elif c.title not in text:
                bad(
                    f"{c.file} に「{c.title}」が無い (試験の題名を変えたなら正本も直す)"
                )
            else:
                exists_today += 1
            continue
        status = ticket_status(c.planned)
        if status is None:
            bad(f"planned のチケット {c.planned} が issues/ に無い")
        elif text is not None and c.title in text:
            bad(f"{c.file} に「{c.title}」ができた。planned を外す")
        elif status == "done":
            bad(f"{c.planned} は done なのに {c.file} に「{c.title}」が無い")
    if s.mode == "auto" and exists_today == 0:
        bad("auto の行は今ある試験を 1 つ以上 covered_by に持つ")
    return problems


def _check_budget(sot: Sot) -> list[Problem]:
    problems: list[Problem] = []
    for when in WHENS:
        total = sum(
            s.minutes or 0
            for s in sot.scenarios
            if s.status == "active" and s.mode == "human" and s.when == when
        )
        if total > ROUND_MINUTES:
            problems.append(
                Problem(
                    when,
                    "budget",
                    f"人の確かめの 1 回が {total:g} 分。{ROUND_MINUTES} 分以内 (待ちを含む) に収める",
                )
            )
    return problems


def check_sot(
    sot: Sot,
    read: Callable[[str], str | None],
    ticket_status: Callable[[str], str | None],
) -> list[Problem]:
    """正本の約束を全部かける。read(file) は repo の中の試験のファイルの中身 (無ければ None)、
    ticket_status(id) は issues/ のチケットの status (無ければ None)"""
    ids = {s.id for s in sot.scenarios}
    lenses = lens_names(read)
    problems = _check_ids(sot)
    for s in sot.scenarios:
        problems += _check_shape(s, ids)
        problems += _check_marks(s, lenses)
        problems += _check_coverage(s, read, ticket_status)
    return problems + _check_budget(sot)


def check_results(sot: Sot, results: Mapping[str, object]) -> list[Problem]:
    """results.json の鍵が、どれかの行の id か from に当たること (結果を宙に浮かせない)"""
    known = {s.id for s in sot.scenarios} | {f for s in sot.scenarios for f in s.from_}
    return [
        Problem(key, "results", "どの行の id にも from にも当たらない")
        for key in results
        if key not in known
    ]


def shots_of(names: Iterable[str]) -> dict[str, tuple[str, ...]]:
    """shots/ のファイル名から、id ごとの画の道 (受入の画面からの相対、番号の順)。形の違う名前は数えない"""
    found: dict[str, list[tuple[int, str]]] = {}
    for name in names:
        if m := SHOT_PATTERN.match(name):
            found.setdefault(m["id"], []).append((int(m["n"]), f"{SHOTS_DIR}/{name}"))
    return {id_: tuple(path for _, path in sorted(rows)) for id_, rows in found.items()}


def check_shots(sot: Sot, shots: Mapping[str, Sequence[str]]) -> list[Problem]:
    """画はどれも active の human の行のもの (題名の打ち違いや古い画を黙って並べない・落とさない)"""
    human = {
        s.id
        for s in sot.scenarios
        if s.status == "active"
        and (s.mode == "human" or any(m and m.judge == "llm" for m in s.marks))
    }
    return [
        Problem(
            id_,
            "shots",
            f"active の human か、judge が llm の手順を持つ行が無い: {'・'.join(paths)}",
        )
        for id_, paths in sorted(shots.items())
        if id_ not in human
    ]


def next_id(sot: Sot, code: str) -> str:
    """領域の次の id。退役した行の番号も使ったものとして数える"""
    nums = [
        int(m["num"])
        for s in sot.scenarios
        if (m := ID_PATTERN.match(s.id)) and m["code"] == code
    ]
    return f"{code}-{max(nums, default=0) + 1:03d}"


def base_of(when: str, wrangler: Mapping[str, object], env: Mapping[str, str]) -> str:
    """画面の origin。手で書かない。round は受入のビルド (wrangler dev)、deploy は配った workers.dev"""
    if when == "round":
        dev = wrangler.get("dev")
        port = (
            dev.get("port", WRANGLER_DEV_PORT)
            if isinstance(dev, dict)
            else WRANGLER_DEV_PORT
        )
        return f"http://localhost:{port}"
    subdomain = env.get("CLOUDFLARE_WORKERS_SUBDOMAIN", WORKERS_SUBDOMAIN)
    return f"https://{wrangler['name']}.{subdomain}.workers.dev"


def marks_of(s: Scenario) -> list[dict[str, object]]:
    """手順ごとの checks と judge (持つ手順だけ)。受入の画面が「機械が見た」「LLM が見た」「人が見る」を並べる"""
    return [
        {
            "step": f"{kw} {text}",
            "checks": [{"lens": c.lens, "target": c.target} for c in mark.checks],
            "judge": mark.judge,
        }
        for (kw, text), mark in zip(s.steps, s.marks, strict=True)
        if mark is not None
    ]


def page_of(
    sot: Sot,
    *,
    when: str,
    base: str,
    round_label: str,
    results: Mapping[str, Mapping[str, object]],
    # 項目ごとの画 (shots_of)。items.json の項目の shots になる
    shots: Mapping[str, Sequence[str]],
) -> dict[str, object]:
    """受入の画面の items.json。index.html の読む形 {title, round, base, prep, groups} に、
    項目ごとの judge・history (from の旧 id の結果) と、任せたものの一覧 delegated を足す。
    results は読むだけ"""
    rows = [
        s
        for s in sot.scenarios
        if s.status == "active" and s.mode == "human" and s.when == when
    ]
    groups = []
    prep: list[str] = []
    for c in sot.codes:
        mine = [s for s in rows if s.code == c.code]
        if not mine:
            continue
        prep += [b for b in c.background if b not in prep]
        groups.append(
            {
                "name": c.name,
                "items": [
                    {
                        "id": s.id,
                        "ticket": "・".join(s.tickets),
                        "title": s.title,
                        "links": [
                            {"label": link.label, "path": link.path} for link in s.links
                        ],
                        "steps": [f"{kw} {text}" for kw, text in s.steps],
                        "marks": marks_of(s),
                        "judge": s.judge,
                        "history": [
                            {"id": f, **results[f]} for f in s.from_ if f in results
                        ],
                        "shots": list(shots.get(s.id, ())),
                    }
                    for s in mine
                ],
            }
        )
    delegated = [
        {
            "id": s.id,
            "title": s.title,
            "tests": [
                f"{c.file} — {c.title}" for c in s.covered_by if c.planned is None
            ],
            "marks": marks_of(s),
        }
        for s in sot.scenarios
        if s.status == "active" and s.mode == "auto"
    ]
    title = "受入の確かめ" if when == "round" else "受入の確かめ (配ったあとの本番)"
    return {
        "title": title,
        "round": round_label,
        "base": base,
        "prep": prep,
        "groups": groups,
        "delegated": delegated,
    }


def render_feature(sot: Sot) -> str:
    """Gherkin の文 (# language: ja) で読む。retired は出さない"""
    out = ["# language: ja"]
    for c in sot.codes:
        mine = [s for s in sot.scenarios if s.code == c.code and s.status == "active"]
        if not mine:
            continue
        out += ["", f"機能: {c.name}"]
        if c.background:
            out += ["", "  背景:"]
            out += [
                f"    {'前提' if i == 0 else 'かつ'} {b}"
                for i, b in enumerate(c.background)
            ]
        for s in mine:
            out += ["", f"  @{s.mode}" + "".join(f" @{t}" for t in s.tickets)]
            out.append(f"  シナリオ: [{s.id}] {s.title}")
            out += [f"    {kw} {text}" for kw, text in s.steps]
    return "\n".join(out) + "\n"


def _reader(root: Path) -> Callable[[str], str | None]:
    def read(rel: str) -> str | None:
        path = root / rel
        return path.read_text(encoding="utf-8") if path.is_file() else None

    return read


def _ticket_status(root: Path) -> Callable[[str], str | None]:
    def status(ticket: str) -> str | None:
        for path in sorted((root / "issues").glob(f"{ticket}-*.md")):
            m = re.search(
                r"^status:\s*(\S+)", path.read_text(encoding="utf-8"), re.MULTILINE
            )
            return m[1] if m else ""
        return None

    return status


def check_repo(root: Path) -> list[Problem]:
    """pnpm run check の入口 (test_acceptance.py の RepoSotTest)。results.json は見ない (git の外)"""
    sot, problems = load((root / SOT).read_text(encoding="utf-8"))
    return problems + check_sot(sot, _reader(root), _ticket_status(root))


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=True
    ).stdout.strip()


def acceptance_dir(root: Path, env: Mapping[str, str]) -> Path:
    """受入の画面の置き場。既定は元の checkout の .claude/acceptance (worktree からも同じ所)"""
    if "ACCEPTANCE_DIR" in env:
        return Path(env["ACCEPTANCE_DIR"])
    common = Path(_git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return common.parent / ".claude" / "acceptance"


def _probe(base: str) -> str | None:
    try:
        with urllib.request.urlopen(base + "/", timeout=5) as res:
            return None if res.status == 200 else f"HTTP {res.status}"
    except (urllib.error.URLError, OSError) as e:
        return str(e)


def _print(problems: Sequence[Problem]) -> None:
    for p in problems:
        print(f"{p.where}: [{p.rule}] {p.detail}", file=sys.stderr)


def main(argv: Sequence[str] | None = None, root: Path | None = None) -> int:
    root = root or Path.cwd()
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    page = sub.add_parser("page")
    page.add_argument("--when", choices=WHENS, default="round")
    page.add_argument(
        "--no-probe", action="store_true", help="書く前に画面の origin を GET しない"
    )
    sub.add_parser("feature")
    sub.add_parser("dir")
    nxt = sub.add_parser("next")
    nxt.add_argument("code")
    args = parser.parse_args(argv)

    problems = check_repo(root)
    if problems:
        _print(problems)
        return 1
    sot, _ = load((root / SOT).read_text(encoding="utf-8"))
    if args.cmd == "check":
        print(f"ok: {len(sot.scenarios)} scenarios")
    elif args.cmd == "feature":
        sys.stdout.write(render_feature(sot))
    elif args.cmd == "next":
        print(next_id(sot, args.code))
    elif args.cmd == "dir":
        print(acceptance_dir(root, os.environ))
    else:
        out_dir = acceptance_dir(root, os.environ)
        results_path = out_dir / "results.json"
        results = (
            json.loads(results_path.read_text(encoding="utf-8"))
            if results_path.is_file()
            else {}
        )
        shots_dir = out_dir / SHOTS_DIR
        shots = shots_of(
            p.name for p in (shots_dir.iterdir() if shots_dir.is_dir() else ())
        )
        problems = check_results(sot, results) + check_shots(sot, shots)
        if problems:
            _print(problems)
            return 1
        wrangler = parse_jsonc((root / "wrangler.jsonc").read_text(encoding="utf-8"))
        base = base_of(args.when, wrangler, os.environ)
        if not args.no_probe and (err := _probe(base)):
            print(
                f"{base} が答えない ({err})。受入のビルドを立ててから書く",
                file=sys.stderr,
            )
            return 1
        label = "{} {} ({})".format(
            datetime.datetime.now().astimezone().date().isoformat(),
            _git(root, "branch", "--show-current"),
            _git(root, "rev-parse", "--short", "HEAD"),
        )
        page_json = page_of(
            sot,
            when=args.when,
            base=base,
            round_label=label,
            results=results,
            shots=shots,
        )
        target = out_dir / "items.json"
        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(page_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.replace(tmp, target)
        print(f"wrote {target} ({base})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
