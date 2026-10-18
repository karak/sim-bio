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

アンカーの決まり (GitHub の見出しの id に合わせる): 見出しの文を小文字にし、英数字・かな漢字・
`_`・`-`・空白の外の字を消し、空白を 1 つずつ `-` にする。`## D1 の書きの予算` は
`d1-の書きの予算`、`## 6. 運用` は `6-運用`。同じ見出しが 2 つ目からは `-1`・`-2` を付ける。
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from collections.abc import Callable, Mapping
from pathlib import Path

CURRENT_DOC = "docs/specs/2026-10-18-decisions-current.md"

# 古い文書 → (ポインタの先, 数)。今の文書へ移した決定の印。足すときはここに足す
REQUIRED_POINTERS: Mapping[str, Mapping[str, int]] = {
    "docs/specs/2026-09-19-ecosystem-sim-design.md": {
        f"{CURRENT_DOC}#決定事項": 1,
    },
    "docs/design/2026-09-26-cloudflare-architecture.md": {
        f"{CURRENT_DOC}#d1-の書きの予算": 2,
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
    return errors


def load_repo(root: Path) -> dict[str, str]:
    files = {
        p.relative_to(root).as_posix(): p.read_text(encoding="utf-8")
        for p in sorted((root / "docs").rglob("*.md"))
    }
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
        if (n.startswith("docs/") and n.endswith(".md"))
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
    args = parser.parse_args(argv)
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
