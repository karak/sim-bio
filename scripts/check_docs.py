# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""日付つきの文書の superseded のポインタと、今の決定事項の数を検める柵 (M27-06)。

日付つきの設計書 (docs/specs/2026-09-19-…・docs/design/2026-09-26-…) は当時のまま残し、
今の決定は docs/specs/2026-10-18-decisions-current.md に置く (ユーザーの決定 2026-10-18)。
古い文書から今の文書へのポインタが切れていないか、今の文書の数が今のコードと合うかを見る。

    pnpm run check:docs

見るもの
1. docs/ の中の `superseded by: <path>#<anchor>` と `supersedes: <path>#<anchor>` の行
   (箇条の `- ` が前に付いてよい)。path はリポジトリの根からの markdown で、anchor はその
   文書の見出しに解決できる。`superseded by` と書いた行がこの形でなければ落とす
2. REQUIRED_POINTERS の文書に、決まった先へのポインタが決まった数だけある
3. docs/design/2026-09-26-cloudflare-architecture.md の制約の表 (C8 の行) と「C6 の注」の間に、
   版 3 つ (VERSION_NAMES) と ADR 0002 を指す段落がある
4. 今の文書の印 `<!-- check: <名>=<値> -->` の値が、今のコードから読んだ数 (FACTS) と合う。
   印は 1 行に何個でも置ける。値は同じ行の印の外の文にも書く (数は 2,000 のように桁の区切りが
   あってもよい)。FACTS に無い名は落とし、REQUIRED_CHECKS の名が無いのも落とす
5. 目録 docs/README.md の表 `| path | 箱 | 凍結 | 今の正本 | ハッシュ |` (spec 棚卸しの F2)。
   表が無い・列が違う・箱が A / B / C の外・凍結の日が YYYY-MM-DD の形でない・ハッシュが
   16 桁の 16 進でない・凍結の日とハッシュの片方だけ埋まっている・今の正本が解決しない
   (path#anchor、1 と同じ解決) を落とす。docs/ の .md と .html と issues/README.md で目録に
   無いもの、目録にあって木に無いもの、名に YYYY-MM-DD があるのに箱が B のもの (例外は
   DATED_B_ALLOWED) も落とす。目録が無ければ「無い」で落とす。表が無い・列が違うときは、
   その 1 件だけを出す
6. 凍結の書き換え (spec 棚卸しの F1)。頭の行は、最初の見出し (題) の直下 (間に空行を挟んで
   よい) の `> 凍結:` で始まる 1 行だけ。目録で凍結の日がある文書は、本文のハッシュ (body_hash:
   頭の行 1 行だけを除いた残りの sha256 の先頭 16 桁) が目録の値と同じで、頭の行があり、その
   日が目録の凍結の日と同じ。頭の行は次の 2 つの形に限る。形 1 の path#anchor は 1 と同じ解決。
   頭の行の外で `> 凍結:` で始まる行 (コードの塊の中も、2 行目の頭の行も) は、凍結の日の有無に
   関わらずどの文書でも落とす (本文に数える)。頭の行があるのに目録の行に凍結の日が無いのも
   落とす。body_hash は `uv run scripts/check_docs.py --hash <path>` で出る
   - `> 凍結: YYYY-MM-DD。今の正本: <path>#<anchor>`
   - `> 凍結: YYYY-MM-DD。失効: <理由 1 句>`

アンカーの決まり (GitHub の見出しの id に合わせる): 見出しの文を小文字にし、英数字・かな漢字・
`_`・`-`・空白の外の字を消し、空白を 1 つずつ `-` にする。`## D1 の書きの予算` は
`d1-の書きの予算`、`## 6. 運用` は `6-運用`。同じ見出しが 2 つ目からは `-1`・`-2` を付ける。
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

CURRENT_DOC = "docs/specs/2026-10-18-decisions-current.md"

CATALOG = "docs/README.md"
CATALOG_COLUMNS = ("path", "箱", "凍結", "今の正本", "ハッシュ")
BOXES = frozenset({"A", "B", "C"})
# 名に日付があっても箱 B (保守する) でよい文書。名の日付は起こした日と読む
DATED_B_ALLOWED: frozenset[str] = frozenset({CURRENT_DOC})
# docs/ の外で目録に載せる文書
ISSUES_README = "issues/README.md"

# 古い文書 → (ポインタの先, 数)。今の文書へ移した決定の印。足すときはここに足す
REQUIRED_POINTERS: Mapping[str, Mapping[str, int]] = {
    "docs/specs/2026-09-19-ecosystem-sim-design.md": {
        f"{CURRENT_DOC}#決定事項": 1,
    },
    "docs/design/2026-09-26-cloudflare-architecture.md": {
        f"{CURRENT_DOC}#d1-の書きの予算": 2,
    },
    "docs/design/2026-10-28-level-design-intercept-2.md": {
        f"{CURRENT_DOC}#迎撃の塔-m21-03": 1,
    },
}

VERSION_DOC = "docs/design/2026-09-26-cloudflare-architecture.md"
VERSION_NAMES = ("SaveData.version", "SIM_VERSION", "RUNNER_STATE_VERSION")
ADR_0002 = "docs/decisions/0002-architecture-fence.md"

# 今の文書に必ず置く印の名
REQUIRED_CHECKS: frozenset[str] = frozenset(
    {
        "e2e_specs",
        "command_types",
        "trophic_decomposer",
        "slots",
        "autosave_ticks",
        "cap_publish",
        "cap_cast_cargo",
        "cap_report",
        "cap_confirm",
        "cap_report_outcome",
        "cap_withdraw",
        "shed_max",
        "policy_worst_rows",
    }
)

TYPES_TS = "src/simulation/types.ts"
SLOTS_TS = "src/persist/slots.ts"
AUTOSAVE_TS = "src/persist/autosave.ts"
POLICY_TS = "worker/src/policy.ts"
FACT_SOURCES = (TYPES_TS, SLOTS_TS, AUTOSAVE_TS, POLICY_TS)
E2E_SPEC = re.compile(r"^tests/e2e/[^/]+\.spec\.ts$")

_POINTER = re.compile(
    r"^\s*(?:[-*]\s+)?(superseded by|supersedes):\s*(\S+?)#(\S+)(?:\s|$)"
)
_POINTER_WORD = re.compile(r"superseded by|supersedes:", re.IGNORECASE)
_HEADING = re.compile(r"^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_MARK = re.compile(r"<!--\s*check:\s*([A-Za-z0-9_]+)=([^\s>]+)\s*-->")
_COMMENT = re.compile(r"<!--.*?-->")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_DIGEST = re.compile(r"[0-9a-f]{16}")
_TABLE_RULE = re.compile(r"^\|(?:\s*:?-{3,}:?\s*\|)+$")
# 凍結した文書の頭の行の前置き。頭の行は題の直下の 1 行だけで、body_hash はその行だけを除く
_FROZEN_WORD = "> 凍結:"
_FROZEN_CURRENT = re.compile(r"^> 凍結: (\d{4}-\d{2}-\d{2})。今の正本: (\S+)$")
_FROZEN_EXPIRED = re.compile(r"^> 凍結: (\d{4}-\d{2}-\d{2})。失効: \S.*$")


def _prose_lines(text: str) -> list[tuple[int, str]]:
    """コードの塊の外の行 (行番号つき)"""
    out: list[tuple[int, str]] = []
    fence: str | None = None
    for number, line in enumerate(text.splitlines(), start=1):
        opener = _FENCE.match(line)
        if fence is None and opener:
            fence = opener.group(1)
        elif fence and opener:
            mark = opener.group(1)
            if mark[0] == fence[0] and len(mark) >= len(fence):
                fence = None
        elif fence is None:
            out.append((number, line))
    return out


def slug(heading: str) -> str:
    text = re.sub(r"`|\*\*|__", "", heading).strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def anchors_of(text: str) -> frozenset[str]:
    seen: Counter[str] = Counter()
    anchors: set[str] = set()
    for _, line in _prose_lines(text):
        found = _HEADING.match(line)
        if not found:
            continue
        base = slug(found.group(1))
        anchors.add(base if seen[base] == 0 else f"{base}-{seen[base]}")
        seen[base] += 1
    return frozenset(anchors)


def pointers_of(text: str) -> tuple[list[tuple[int, str, str]], list[tuple[int, str]]]:
    """(行, path, anchor) の一覧と、形の崩れた行"""
    found: list[tuple[int, str, str]] = []
    broken: list[tuple[int, str]] = []
    for number, line in _prose_lines(text):
        if not _POINTER_WORD.search(line):
            continue
        matched = _POINTER.match(line)
        if matched:
            found.append((number, matched.group(2).strip("`"), matched.group(3)))
        else:
            broken.append((number, line.strip()))
    return found, broken


def check_pointers(docs: Mapping[str, str]) -> list[str]:
    errors: list[str] = []
    for name, text in sorted(docs.items()):
        found, broken = pointers_of(text)
        for number, line in broken:
            errors.append(
                f"{name}:{number}: ポインタの形でない「{line}」。"
                "`superseded by: <path>#<anchor>` の形にする"
            )
        for number, path, anchor in found:
            target = docs.get(path)
            if target is None:
                errors.append(
                    f"{name}:{number}: ポインタの先 {path} が docs/ の markdown に無い"
                )
            elif anchor not in anchors_of(target):
                errors.append(
                    f"{name}:{number}: ポインタの先 {path} に見出し #{anchor} が無い"
                    " (アンカーの決まりは scripts/check_docs.py の docstring)"
                )
        wanted = REQUIRED_POINTERS.get(name, {})
        have = Counter(f"{path}#{anchor}" for _, path, anchor in found)
        for target, count in sorted(wanted.items()):
            if have[target] < count:
                errors.append(
                    f"{name}: `superseded by: {target}` が {have[target]} 個"
                    f" (要るのは {count} 個)。今の決定へのポインタを足す"
                )
    return errors


def check_version_paragraph(text: str) -> list[str]:
    lines = text.splitlines()
    start = next((i for i, x in enumerate(lines) if x.startswith("| C8 |")), None)
    end = next((i for i, x in enumerate(lines) if x.startswith("C6 の注")), None)
    if start is None or end is None or end <= start:
        return [f"{VERSION_DOC}: 制約の表の C8 の行か「C6 の注」が見つからない"]
    between = "\n".join(lines[start + 1 : end])
    missing = [n for n in (*VERSION_NAMES, ADR_0002) if n not in between]
    if missing:
        message = (
            f"{VERSION_DOC}:{start + 1}: C8 の行と「C6 の注」の間に版 3 つと ADR 0002 を"
            f"指す段落が無い (足りない: {', '.join(missing)})"
        )
        return [message]
    return []


def count_command_types(types_ts: str) -> int:
    """`export type Command =` の union の枝の数 (注の中は数えない)"""
    code = re.sub(r"/\*.*?\*/|//[^\n]*", "", types_ts, flags=re.DOTALL)
    start = code.index("export type Command =")
    depth = 0
    for end in range(start, len(code)):
        char = code[end]
        depth += {"{": 1, "}": -1}.get(char, 0)
        if char == ";" and depth == 0:
            break
    return len(re.findall(r"[=|]\s*\{\s*type:\s*'[a-z_]+'", code[start:end]))


def trophic_has_decomposer(types_ts: str) -> bool:
    found = re.search(r"export type Trophic\s*=([^;]+);", types_ts)
    return bool(found) and "'decomposer'" in found.group(1)


def count_slots(slots_ts: str) -> int:
    manual = re.search(r"MANUAL_SLOTS\s*=\s*\[([^\]]*)\]", slots_ts)
    slots = re.search(r"\bSLOTS\s*:[^=]*=\s*\[([^\]]*)\]", slots_ts)
    if not manual or not slots:
        raise ValueError("slots.ts に MANUAL_SLOTS か SLOTS が無い")
    literal = len(re.findall(r"'[^']*'", slots.group(1)))
    spread = len(re.findall(r"'[^']*'", manual.group(1)))
    return literal + (spread if "...MANUAL_SLOTS" in slots.group(1) else 0)


def autosave_ticks(autosave_ts: str) -> int:
    found = re.search(r"AUTOSAVE_TICKS\s*=\s*([\d_]+)", autosave_ts)
    if not found:
        raise ValueError("autosave.ts に AUTOSAVE_TICKS が無い")
    return int(found.group(1).replace("_", ""))


def budgets_of(policy_ts: str) -> dict[str, dict[str, int]]:
    block = re.search(
        r"export const BUDGETS[^=]*=\s*\{(.*?)\n\};", policy_ts, re.DOTALL
    )
    if not block:
        raise ValueError("policy.ts に BUDGETS が無い")
    return {
        name: {"cap": int(cap.replace("_", "")), "shedAt": int(shed.replace("_", ""))}
        for name, cap, shed in re.findall(
            r"(\w+):\s*\{\s*cap:\s*([\d_]+),\s*shedAt:\s*([\d_]+)", block.group(1)
        )
    }


def policy_worst_rows(policy_ts: str) -> int:
    found = re.search(r"=\s*([\d,]+)\s*行。無料枠", policy_ts)
    if not found:
        raise ValueError("policy.ts の注に最悪の行数 (= N 行。無料枠) が無い")
    return int(found.group(1).replace(",", ""))


def facts_of(files: Mapping[str, str]) -> dict[str, str]:
    types_ts = files[TYPES_TS]
    budgets = budgets_of(files[POLICY_TS])
    facts = {
        "e2e_specs": len([p for p in files if E2E_SPEC.match(p)]),
        "command_types": count_command_types(types_ts),
        "trophic_decomposer": "decomposer" if trophic_has_decomposer(types_ts) else "",
        "slots": count_slots(files[SLOTS_TS]),
        "autosave_ticks": autosave_ticks(files[AUTOSAVE_TS]),
        "shed_max": max(b["shedAt"] for b in budgets.values()),
        "policy_worst_rows": policy_worst_rows(files[POLICY_TS]),
    }
    for name, budget in budgets.items():
        facts[f"cap_{name}"] = budget["cap"]
    return {k: str(v) for k, v in facts.items()}


def _shown(value: str, prose: str) -> bool:
    if value.isdigit():
        number = int(value)
        return bool(re.search(rf"(?<![\d,])({number}|{number:,})(?![\d,])", prose))
    return value in prose


def check_marks(text: str, facts: Mapping[str, str]) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for number, line in _prose_lines(text):
        prose = _COMMENT.sub("", line)
        for name, value in _MARK.findall(line):
            seen.add(name)
            where = f"{CURRENT_DOC}:{number}"
            if name not in facts:
                errors.append(f"{where}: 知らない印 {name} (FACTS に足すか消す)")
                continue
            if value != facts[name]:
                errors.append(
                    f"{where}: {name} は文書で {value}、コードで {facts[name] or '無い'}"
                    "。決定を変えたなら文書の行と「改訂」を書き直す"
                )
            if not _shown(value, prose):
                errors.append(f"{where}: 印 {name}={value} の値が同じ行の文に無い")
    for name in sorted(REQUIRED_CHECKS - seen):
        errors.append(f"{CURRENT_DOC}: 印 <!-- check: {name}=… --> が無い")
    return errors


@dataclass(frozen=True)
class CatalogRow:
    """目録の 1 行。空の欄は空の文字"""

    line: int
    path: str
    box: str
    frozen: str
    current: str
    digest: str


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def read_catalog(text: str) -> tuple[list[CatalogRow], list[str]]:
    """目録の表を行に読む (行と、表の形の崩れ)。path と今の正本の backtick は剥がす"""
    lines = _prose_lines(text)
    head = next(
        (
            i
            for i, (_, line) in enumerate(lines[:-1])
            if line.startswith("|")
            and "path" in _cells(line)
            and _TABLE_RULE.match(lines[i + 1][1].strip())
        ),
        None,
    )
    columns = " | ".join(CATALOG_COLUMNS)
    if head is None:
        return [], [f"{CATALOG}: 目録の表が無い (列は | {columns} |)"]
    number, header = lines[head]
    if tuple(_cells(header)) != CATALOG_COLUMNS:
        return [], [f"{CATALOG}:{number}: 目録の表の列が違う (列は | {columns} |)"]
    rows: list[CatalogRow] = []
    errors: list[str] = []
    for number, line in lines[head + 2 :]:
        if not line.startswith("|"):
            break
        cells = _cells(line)
        where = f"{CATALOG}:{number}"
        if len(cells) != len(CATALOG_COLUMNS):
            errors.append(f"{where}: 欄の数が {len(cells)} (要るのは 5)")
            continue
        path, box, frozen, current, digest = cells
        row = CatalogRow(
            number, path.strip("`"), box, frozen, current.strip("`"), digest
        )
        if row.box not in BOXES:
            errors.append(f"{where}: 箱が「{row.box}」。A・B・C のどれか 1 字にする")
        if row.frozen and not _DATE.fullmatch(row.frozen):
            errors.append(f"{where}: 凍結の日が「{row.frozen}」。YYYY-MM-DD か空にする")
        if row.digest and not _DIGEST.fullmatch(row.digest):
            errors.append(
                f"{where}: ハッシュが「{row.digest}」。sha256 の先頭 16 桁 (小文字の"
                " 16 進) か空にする"
            )
        if bool(row.frozen) != bool(row.digest):
            errors.append(
                f"{where}: 凍結の日とハッシュの片方だけが埋まっている。凍結したなら"
                " 両方、凍結していなければ両方とも空にする"
            )
        rows.append(row)
    return rows, errors


def _catalogued(path: str) -> bool:
    """目録に載せる文書か (docs/ の .md と .html)"""
    return path.startswith("docs/") and path.endswith((".md", ".html"))


def _must_list(path: str) -> bool:
    """目録に行が要る文書か (docs/ の .md と .html と、docs/ の外の issues/README.md)"""
    return _catalogued(path) or path == ISSUES_README


def _unresolved(docs: Mapping[str, str], target: str) -> str | None:
    """`<path>#<anchor>` が docs の markdown の見出しに解決しなければ、その訳"""
    path, sep, anchor = target.partition("#")
    if not sep or not anchor:
        return f"{target} が <path>#<anchor> の形でない"
    if path not in docs:
        return f"{path} が docs/ の markdown に無い"
    if anchor not in anchors_of(docs[path]):
        return f"{path} に見出し #{anchor} が無い"
    return None


def check_catalog(files: Mapping[str, str]) -> list[str]:
    text = files.get(CATALOG)
    if text is None:
        return [f"{CATALOG} が無い (目録)"]
    docs = {p: t for p, t in files.items() if _catalogued(p) and p.endswith(".md")}
    rows, errors = read_catalog(text)
    if not rows and errors:
        # 表が無い・列が違う。文書ごとの「行が無い」を並べず、その 1 件だけを出す
        return errors
    listed = Counter(row.path for row in rows)
    for row in rows:
        where = f"{CATALOG}:{row.line}"
        if listed[row.path] > 1:
            errors.append(f"{where}: {row.path} の行が {listed[row.path]} 個ある")
        if not row.path.endswith((".md", ".html")):
            errors.append(f"{where}: {row.path} は .md でも .html でもない")
        elif row.path not in files:
            errors.append(f"{where}: {row.path} が木に無い (消したなら目録の行も消す)")
        dated = _DATE.search(PurePosixPath(row.path).name)
        if row.box == "B" and dated and row.path not in DATED_B_ALLOWED:
            errors.append(
                f"{where}: {row.path} は名に日付があるのに箱が B。日付つきの文書は A か C"
            )
        if row.current and (why := _unresolved(docs, row.current)):
            errors.append(f"{where}: 今の正本が解決しない ({why})")
    for path in sorted(p for p in files if _must_list(p) and p not in listed):
        errors.append(f"{path}: 目録 {CATALOG} に行が無い (箱を決めて行を足す)")
    return errors


def head_line(text: str) -> int | None:
    """頭の行の位置 (0 から)。最初の見出し (題) の直下の、空行を飛ばした次の行が
    `> 凍結:` で始まるときだけ。無ければ None"""
    title = next((n for n, line in _prose_lines(text) if _HEADING.match(line)), None)
    if title is None:
        return None
    lines = text.splitlines()
    index = title
    while index < len(lines) and not lines[index].strip():
        index += 1
    if index < len(lines) and lines[index].startswith(_FROZEN_WORD):
        return index
    return None


def body_hash(text: str) -> str:
    """頭の行 (題の直下の `> 凍結:` の 1 行、改行ごと) だけを除いた残りの sha256 の先頭 16 桁"""
    head = head_line(text)
    body = "".join(
        line
        for index, line in enumerate(text.splitlines(keepends=True))
        if index != head
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _head_match(line: str) -> re.Match[str] | None:
    return _FROZEN_CURRENT.match(line) or _FROZEN_EXPIRED.match(line)


def check_frozen(files: Mapping[str, str]) -> list[str]:
    docs = {p: t for p, t in files.items() if _catalogued(p) and p.endswith(".md")}
    rows = read_catalog(files[CATALOG])[0] if CATALOG in files else []
    frozen_on = {row.path: row.frozen for row in rows}
    errors: list[str] = []
    for name in sorted(p for p in files if _must_list(p)):
        head = head_line(files[name])
        for index, line in enumerate(files[name].splitlines()):
            if not line.startswith(_FROZEN_WORD):
                continue
            where = f"{name}:{index + 1}"
            if index != head:
                errors.append(
                    f"{where}: 凍結の行「{line.strip()}」が頭 (題の直下の 1 行) の外に"
                    "ある。凍結の行は題の直下に 1 行だけ置く"
                )
                continue
            if not _head_match(line):
                errors.append(
                    f"{where}: 凍結の行の形でない「{line.strip()}」。"
                    "`> 凍結: YYYY-MM-DD。今の正本: <path>#<anchor>` か"
                    " `> 凍結: YYYY-MM-DD。失効: <理由 1 句>` にする"
                )
                continue
            current = _FROZEN_CURRENT.match(line)
            if current and (why := _unresolved(docs, current.group(2))):
                errors.append(f"{where}: 頭の行の今の正本が解決しない ({why})")
            if name in frozen_on and not frozen_on[name]:
                errors.append(
                    f"{where}: 頭の行があるのに、目録 {CATALOG} の行に凍結の日が無い"
                )
    for row in rows:
        text = files.get(row.path)
        if not row.frozen or text is None:
            continue
        where = f"{CATALOG}:{row.line}"
        head = head_line(text)
        matched = None if head is None else _head_match(text.splitlines()[head])
        if matched is None:
            errors.append(
                f"{row.path}: 目録で {row.frozen} に凍結したのに、頭の行"
                " (題の直下の `> 凍結: …`) が無い"
            )
        elif matched.group(1) != row.frozen:
            errors.append(
                f"{row.path}:{head + 1}: 頭の行の日 {matched.group(1)} が目録の凍結の日"
                f" {row.frozen} と違う ({where})"
            )
        digest = body_hash(text)
        if digest != row.digest:
            errors.append(
                f"{where}: {row.path} の本文のハッシュが {digest} で、目録の値"
                f" ({row.digest or '空'}) と違う。凍結した本文は書き換えない"
            )
    return errors


def check_files(files: Mapping[str, str]) -> list[str]:
    docs = {
        p: t for p, t in files.items() if p.startswith("docs/") and p.endswith(".md")
    }
    errors = check_pointers(docs)
    if VERSION_DOC in docs:
        errors += check_version_paragraph(docs[VERSION_DOC])
    else:
        errors.append(f"{VERSION_DOC} が無い")
    if CURRENT_DOC in docs:
        errors += check_marks(docs[CURRENT_DOC], facts_of(files))
    else:
        errors.append(f"{CURRENT_DOC} が無い (今の決定事項の文書)")
    errors += check_catalog(files)
    errors += check_frozen(files)
    return errors


def load_repo(root: Path) -> dict[str, str]:
    files = {
        p.relative_to(root).as_posix(): p.read_text(encoding="utf-8")
        for p in sorted((root / "docs").rglob("*.md"))
    }
    for p in sorted((root / "docs").rglob("*.html")):
        files[p.relative_to(root).as_posix()] = p.read_text(encoding="utf-8")
    if (root / ISSUES_README).is_file():
        files[ISSUES_README] = (root / ISSUES_README).read_text(encoding="utf-8")
    for p in sorted((root / "tests" / "e2e").glob("*.spec.ts")):
        files[p.relative_to(root).as_posix()] = ""
    for name in FACT_SOURCES:
        files[name] = (root / name).read_text(encoding="utf-8")
    return files


def load_with(read: Callable[[str], str], names: list[str]) -> dict[str, str]:
    """git の版など、ファイルの読み方を差し替えて集める (試験で使う)"""
    wanted = [
        n
        for n in names
        if _catalogued(n)
        or n == ISSUES_README
        or E2E_SPEC.match(n)
        or n in FACT_SOURCES
    ]
    return {n: "" if E2E_SPEC.match(n) else read(n) for n in wanted}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    parser.add_argument(
        "--hash",
        metavar="PATH",
        help="リポジトリの根からの PATH の body_hash を出して終わる (目録を埋めるとき)",
    )
    args = parser.parse_args(argv)
    if args.hash:
        print(body_hash((args.root / args.hash).read_text(encoding="utf-8")))
        return 0
    errors = check_files(load_repo(args.root))
    for e in errors:
        print(f"NG {e}", file=sys.stderr)
    if errors:
        print(f"文書の柵: {len(errors)} 件の違反 (M27-06)", file=sys.stderr)
        return 1
    print("文書の柵: 違反なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
