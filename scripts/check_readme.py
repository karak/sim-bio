# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""README に運用の手順が戻らないための柵 (M26-13)。

運用の手順が README に置かれ、docs/operations/ へ移すことが 2 回起きた (679e222・85294e0)。
README の見出し・本文・長さを見て、運用の手順の置き違えを落とす。

    pnpm run check:readme

見るもの
1. `##`・`###` の見出しが ALLOWED_HEADINGS にあるか
2. 本文 (表・コードの塊を含む) に運用の印 (OPERATIONAL_MARKERS) が無いか。docs/operations/ へのリンクを含む行は許す
3. 行数が MAX_LINES 以下か
4. (警告のみ) issues/ の open の票が、受入の基準で README を運用の置き場にしていないか
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Mapping
from pathlib import Path

# README の `##`・`###` に置いてよい見出し。節を足すときはここに足す (レビューで見える)
ALLOWED_HEADINGS: frozenset[str] = frozenset(
    {
        "概要",
        "スクリーンショット",
        "動かし方",
        "Cloudflare へ配る",
        "遊び方",
        "設計と資料への導線",
        "開発の流れ",
        "3D モデルとコンセプト画",
        "ライセンス",
        "フォルダ構成",
        "設計方針（暫定）",
    }
)

MAX_LINES = 200

# 運用の手順の印 (人が本番へ対して行う操作)。手元の開発 (wrangler dev など) は含めない
OPERATIONAL_MARKERS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"wrangler\s+(\S+\s+)?(deploy|login|secret|tail|rollback)",
        r"pnpm (run )?deploy\b",
        r"scripts/deploy\.py",
        r"gh (secret|variable|workflow run|api -X)",
        r"scripts/mod\.py",
        r"--remote",
        r"security (add|find)-generic-password",
    )
)

# docs/operations/ へ案内するリンク (`](…docs/operations/…)`) を含む行
OPERATIONS_LINK = re.compile(r"\]\([^)]*docs/operations/")

# 票の警告。open の票の受入の基準が、README を運用の置き場にしていないか
OPEN_STATUSES = frozenset({"todo", "in_progress", "blocked"})
# issues/README (票の決まりの置き場) は、リポジトリの README ではない
README_MENTION = re.compile(r"(?<!issues/)(?<!\w)README")
OPERATIONS_WORDS = re.compile(r"配備|運用|手順|課金")

PLACEMENT = "運用の手順は docs/operations/、設計は docs/design/ へ"

_HEADING = re.compile(r"^ {0,3}#{2,3}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$")
_SETEXT = re.compile(r"^ {0,3}(-{2,}|={2,})[ \t]*$")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_STATUS = re.compile(r"^status:\s*(\S+)", re.MULTILINE)
_ACCEPTANCE = re.compile(r"^##\s+Acceptance criteria\s*$", re.IGNORECASE)


def _closes(opening: str, candidate: str) -> bool:
    return candidate[0] == opening[0] and len(candidate) >= len(opening)


def _heading_title(line: str, previous: str) -> str | None:
    atx = _HEADING.match(line)
    if atx:
        return atx.group(1)
    # setext の `---` は、直前が本文の行のときだけ h2 (空行の後の `---` は水平線)
    if _SETEXT.match(line) and line.lstrip().startswith("-"):
        text = previous.strip()
        if text and not text.startswith(("#", "-", "*", ">", "|", "`")):
            return text
    return None


def check_readme(
    text: str,
    allowed_headings: frozenset[str] = ALLOWED_HEADINGS,
    max_lines: int = MAX_LINES,
) -> list[str]:
    errors: list[str] = []
    lines = text.splitlines()
    fence: str | None = None
    previous = ""
    for number, line in enumerate(lines, start=1):
        opener = _FENCE.match(line)
        if fence is None and opener:
            fence = opener.group(1)
        elif fence and opener and _closes(fence, opener.group(1)):
            fence = None
        elif fence is None:
            title = _heading_title(line, previous)
            if title is not None and title not in allowed_headings:
                errors.append(
                    f"README:{number}: 許可表にない見出し「{title}」。"
                    f"{PLACEMENT}。README に節を足すなら "
                    "scripts/check_readme.py の ALLOWED_HEADINGS に足す"
                )
        previous = line
        if fence is None and OPERATIONS_LINK.search(line):
            continue
        for marker in OPERATIONAL_MARKERS:
            found = marker.search(line)
            if found:
                errors.append(
                    f"README:{number}: 運用の手順の印「{found.group(0)}」。"
                    f"{PLACEMENT}書き、README からはリンクで案内する"
                )
                break
    if len(lines) > max_lines:
        errors.append(
            f"README: {len(lines)} 行 (上限 {max_lines})。節を docs/ へ分けてリンクで案内する。"
            f"{PLACEMENT}"
        )
    return errors


def warn_tickets(tickets: Mapping[str, str]) -> list[str]:
    warnings: list[str] = []
    for name, text in sorted(tickets.items()):
        frontmatter = text.split("\n---", 1)[0] if text.startswith("---") else ""
        status = _STATUS.search(frontmatter)
        if not status or status.group(1).strip("\"'") not in OPEN_STATUSES:
            continue
        in_acceptance = False
        for line in text.splitlines():
            if line.startswith("## "):
                in_acceptance = bool(_ACCEPTANCE.match(line))
            elif (
                in_acceptance
                and README_MENTION.search(line)
                and OPERATIONS_WORDS.search(line)
                and "docs/operations/" not in line
            ):
                warnings.append(
                    f"{name}: 受入の基準が README を運用の置き場にしている「{line.strip()}」。"
                    f"{PLACEMENT}書く票にする (issues/README.md の決まり)"
                )
    return warnings


def check_repo(root: Path) -> tuple[list[str], list[str]]:
    errors = check_readme((root / "README.md").read_text(encoding="utf-8"))
    tickets = {
        f"issues/{p.name}": p.read_text(encoding="utf-8")
        for p in sorted((root / "issues").glob("*.md"))
        if p.name != "README.md"
    }
    return errors, warn_tickets(tickets)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    args = parser.parse_args(argv)
    errors, warnings = check_repo(args.root)
    for w in warnings:
        print(f"警告 {w}", file=sys.stderr)
    for e in errors:
        print(f"NG {e}", file=sys.stderr)
    if errors:
        print(f"README の柵: {len(errors)} 件の違反 (M26-13)", file=sys.stderr)
        return 1
    print(f"README の柵: 違反なし (警告 {len(warnings)} 件)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
