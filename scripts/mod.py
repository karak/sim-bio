# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""港の運用 (設計書 docs/design/2026-09-26-cloudflare-architecture.md Q4・§6、M19-12)。

年代記を隠す・戻す・消す、日次予算を見る。中身は wrangler d1 execute。

    uv run scripts/mod.py --remote hide <年代記の id>
    uv run scripts/mod.py --remote restore <年代記の id>
    uv run scripts/mod.py --remote delete <年代記の id> --yes
    uv run scripts/mod.py --remote budget [--days 7]

--remote は配った港の D1 に書く (要 wrangler login)。--local は wrangler dev のローカルの D1。

表と列は M19-08 のマイグレーションの前の仮の形 (設計書 §5・§6 から置いた)。M19-08 で本物に合わせる:
  chronicles(id TEXT PRIMARY KEY  -- 正規化した年代記の SHA-256 の 16 進 64 文字,
             report_count INTEGER,  -- 通報の数。3 で Worker が自動で隠す
             hidden_at TEXT)        -- 隠した時刻。NULL なら見える
  daily_budget(day TEXT PRIMARY KEY  -- UTC の YYYY-MM-DD,
               publish INTEGER, cargo INTEGER, report INTEGER)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WRANGLER = REPO / "node_modules" / ".bin" / "wrangler"

# D1 の binding の名前。M19-08 が wrangler.jsonc の d1_databases に同じ名前で置く
DATABASE = "HARBOR"

# 日次予算の上限 (設計書 §6.1 の仮の値)。M19-08 の Worker の値と合わせる
BUDGET_CAPS = {
    "publish": ("出港", 2_000),
    "cargo": ("積荷", 5_000),
    "report": ("通報", 1_000),
}

Run = Callable[..., subprocess.CompletedProcess[str]]


class D1Error(Exception):
    pass


@dataclass(frozen=True)
class Target:
    remote: bool
    config: Path | None = None
    persist_to: Path | None = None


def parse_chronicle_id(text: str) -> str:
    """SQL の文字列に埋めるので、16 進 64 文字だけを通す (wrangler d1 execute は bind できない)。"""
    lowered = text.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", lowered):
        raise argparse.ArgumentTypeError(
            f"年代記の id は SHA-256 の 16 進 64 文字: {text!r}"
        )
    return lowered


def wrangler_argv(target: Target, sql: str) -> list[str]:
    argv = [
        str(WRANGLER),
        "d1",
        "execute",
        DATABASE,
        "--remote" if target.remote else "--local",
    ]
    if target.config:
        argv += ["--config", str(target.config)]
    if target.persist_to:
        argv += ["--persist-to", str(target.persist_to)]
    return [*argv, "--json", "--command", sql]


def execute(
    target: Target, sql: str, run: Run = subprocess.run
) -> list[dict[str, object]]:
    """sql を流し、最後の文の行を返す。"""
    done = run(wrangler_argv(target, sql), cwd=REPO, capture_output=True, text=True)
    try:
        payload = json.loads(done.stdout)
    except json.JSONDecodeError:
        payload = None
    if done.returncode != 0 or not isinstance(payload, list):
        reported = (
            payload.get("error", {}).get("text") if isinstance(payload, dict) else None
        )
        raise D1Error(
            reported
            or done.stderr.strip()
            or done.stdout.strip()
            or f"wrangler が {done.returncode} で終わった"
        )
    return payload[-1]["results"]


def hide_sql(chronicle_id: str) -> str:
    return (
        "UPDATE chronicles SET hidden_at = COALESCE(hidden_at, datetime('now')) "
        f"WHERE id = '{chronicle_id}' RETURNING id, hidden_at"
    )


def restore_sql(chronicle_id: str) -> str:
    return f"UPDATE chronicles SET hidden_at = NULL, report_count = 0 WHERE id = '{chronicle_id}' RETURNING id"


def delete_sql(chronicle_id: str) -> str:
    return f"DELETE FROM chronicles WHERE id = '{chronicle_id}' RETURNING id"


ROW_OPS: dict[str, tuple[Callable[[str], str], str]] = {
    "hide": (hide_sql, "隠した"),
    "restore": (restore_sql, "戻した"),
    "delete": (delete_sql, "消した"),
}


def budget_sql(days: int) -> str:
    return f"SELECT day, publish, cargo, report FROM daily_budget ORDER BY day DESC LIMIT {days}"


def format_budget(rows: list[dict[str, object]]) -> list[str]:
    if not rows:
        return ["daily_budget に行が無い (まだ誰も出港していない)"]
    lines = []
    for row in rows:
        cells = [
            f"{label} {row[key]:,}/{cap:,} ({row[key] / cap:.0%})"
            for key, (label, cap) in BUDGET_CAPS.items()
        ]
        lines.append(f"{row['day']}  " + "  ".join(cells))
    return lines


def days_arg(text: str) -> int:
    days = int(text)
    if not 1 <= days <= 90:
        raise argparse.ArgumentTypeError("--days は 1〜90")
    return days


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--remote", action="store_true", help="配った港の D1")
    where.add_argument(
        "--local", action="store_true", help="wrangler dev のローカルの D1"
    )
    parser.add_argument(
        "--config",
        type=Path,
        help="wrangler の設定 (既定はリポジトリの wrangler.jsonc)",
    )
    parser.add_argument(
        "--persist-to", type=Path, help="ローカルの D1 の置き場 (--local のときだけ)"
    )
    ops = parser.add_subparsers(dest="op", required=True)
    for name, help_text in [
        ("hide", "年代記を一覧と訪問から隠す"),
        ("restore", "隠した年代記を戻し、通報の数を 0 に戻す"),
    ]:
        ops.add_parser(name, help=help_text).add_argument("id", type=parse_chronicle_id)
    delete = ops.add_parser("delete", help="年代記を消す (戻せない)")
    delete.add_argument("id", type=parse_chronicle_id)
    delete.add_argument("--yes", action="store_true", help="戻せないことを承知で消す")
    ops.add_parser("budget", help="日次予算の消費を新しい日から見る").add_argument(
        "--days", type=days_arg, default=7
    )
    return parser


def main(argv: list[str] | None = None, run: Run = subprocess.run) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.persist_to and args.remote:
        parser.error("--persist-to は --local のときだけ")
    if args.op == "delete" and not args.yes:
        print(f"消すと戻せない。消すなら --yes を付ける: {args.id}", file=sys.stderr)
        return 2
    target = Target(remote=args.remote, config=args.config, persist_to=args.persist_to)
    try:
        if args.op == "budget":
            print("\n".join(format_budget(execute(target, budget_sql(args.days), run))))
            return 0
        to_sql, done = ROW_OPS[args.op]
        rows = execute(target, to_sql(args.id), run)
    except D1Error as error:
        print(f"D1 がエラーを返した: {error}", file=sys.stderr)
        return 1
    if not rows:
        print(f"見つからない: {args.id}", file=sys.stderr)
        return 1
    since = f" ({rows[0]['hidden_at']} から)" if args.op == "hide" else ""
    print(f"{done}: {args.id}{since}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
