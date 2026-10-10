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

--remote は配った港の D1 に書く (トークンは Keychain の sim-bio-local-deploy から環境で wrangler に渡す。deploy-runbook.md)。--local は wrangler dev のローカルの D1。

表と列は M19-08 のマイグレーションの前の仮の形 (設計書 §5・§6 から置いた)。M19-08 で本物に合わせる:
  chronicles(id TEXT PRIMARY KEY  -- 正規化した年代記の SHA-256 の 16 進 64 文字,
             report_count INTEGER,  -- 通報の数。3 で Worker が自動で隠す
             hidden_at TEXT)        -- 隠した時刻。NULL なら見える
  daily_budget(day TEXT PRIMARY KEY  -- UTC の YYYY-MM-DD,
               publish INTEGER, cargo INTEGER, report INTEGER)

M19-08 で、マイグレーション (worker/migrations/0001_harbor.sql) の本物の表と列に合わせた (上の仮の形は M19-12 の記録):
  chronicles(id TEXT PRIMARY KEY  -- 正規化した年代記の SHA-256 の 16 進 64 文字,
             reports INTEGER,       -- 通報の数。3 で Worker が自動で隠す
             hidden_at INTEGER)     -- 隠した時刻 (epoch ms)。NULL なら見える
  reports(chronicle_id, day, sender)  -- 通報の送り手 (その日だけ。chronicles を消すと一緒に消える)
  daily_budget(day TEXT  -- UTC の YYYY-MM-DD, bucket TEXT  -- 道の種類, used INTEGER)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from cf_auth import (
    AuthError,
    AuthTarget,
    HttpGet,
    OAuthFile,
    Runner,
    Secret,
    check_auth,
    default_oauth_file,
    redact,
    subprocess_run,
    urllib_get,
    wrangler_env,
)
from deploy import ConfigError, load_config

REPO = Path(__file__).resolve().parent.parent
WRANGLER = REPO / "node_modules" / ".bin" / "wrangler"

# D1 の binding の名前。M19-08 が wrangler.jsonc の d1_databases に同じ名前で置く
DATABASE = "HARBOR"

# 日次予算の上限 (設計書 §6.1 の仮の値)。M19-08 の Worker の値と合わせる
# M19-08: 道ごと (bucket) の上限にした。worker/src/policy.ts の BUDGETS の cap と同じ値 (test_mod.py が食い違いを落とす)
BUDGET_CAPS = {
    "logs": ("ログ", 10_000),
    "confirm": ("確認", 5_000),
    "report_outcome": ("結末", 5_000),
    "browse": ("一覧", 20_000),
    "avoidance": ("回避率", 10_000),
    "cast_cargo": ("積荷", 5_000),
    "draw_cargo": ("漂着", 10_000),
    "publish": ("出港", 2_000),
    "report": ("通報", 1_000),
    "withdraw": ("取り下げ", 1_000),
    "visit": ("訪問", 40_000),
}
# 日の合計でいちばん後ろの段 (訪問の shedAt)。これに達すると港の道はすべて閉じる
DAY_TOTAL_CAP = 45_000

Run = Callable[..., subprocess.CompletedProcess[str]]


class D1Error(Exception):
    pass


@dataclass(frozen=True)
class Target:
    remote: bool
    config: Path | None = None
    persist_to: Path | None = None


def parse_chronicle_id(text: str) -> str:
    """SQL の文字列に埋めるので、16 進 64 文字だけを通す (wrangler d1 execute は bind できない)。

    港の契約 src/harbor/contract.ts の parseChronicleId と同じ形 (小文字だけ)。
    """
    if not re.fullmatch(r"[0-9a-f]{64}", text):
        raise argparse.ArgumentTypeError(
            f"年代記の id は SHA-256 の 16 進 64 文字 (小文字): {text!r}"
        )
    return text


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
    target: Target,
    sql: str,
    run: Run = subprocess.run,
    env: Mapping[str, str] | None = None,
) -> list[dict[str, object]]:
    """sql を流し、最後の文の行を返す。"""
    done = run(
        wrangler_argv(target, sql), cwd=REPO, capture_output=True, text=True, env=env
    )
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


NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"
HIDDEN_SINCE = "strftime('%Y-%m-%dT%H:%M:%SZ', hidden_at / 1000, 'unixepoch')"


def hide_sql(chronicle_id: str) -> str:
    return (
        f"UPDATE chronicles SET hidden_at = COALESCE(hidden_at, {NOW_MS}) "
        f"WHERE id = '{chronicle_id}' RETURNING id, {HIDDEN_SINCE} AS hidden_at"
    )


def restore_sql(chronicle_id: str) -> str:
    return (
        f"DELETE FROM reports WHERE chronicle_id = '{chronicle_id}'; "
        f"UPDATE chronicles SET hidden_at = NULL, reports = 0 WHERE id = '{chronicle_id}' RETURNING id"
    )


def delete_sql(chronicle_id: str) -> str:
    return f"DELETE FROM chronicles WHERE id = '{chronicle_id}' RETURNING id"


ROW_OPS: dict[str, tuple[Callable[[str], str], str]] = {
    "hide": (hide_sql, "隠した"),
    "restore": (restore_sql, "戻した"),
    "delete": (delete_sql, "消した"),
}


def budget_sql(days: int) -> str:
    return (
        "SELECT day, bucket, used FROM daily_budget WHERE day IN "
        f"(SELECT DISTINCT day FROM daily_budget ORDER BY day DESC LIMIT {days}) "
        "ORDER BY day DESC"
    )


def format_budget(rows: list[dict[str, object]]) -> list[str]:
    if not rows:
        return ["daily_budget に行が無い (まだ誰も港を使っていない)"]
    days: dict[str, dict[str, int]] = {}
    for row in rows:
        days.setdefault(str(row["day"]), {})[str(row["bucket"])] = int(str(row["used"]))
    lines = []
    for day, used in days.items():
        total = sum(used.values())
        order = [b for b in BUDGET_CAPS if b in used] + sorted(
            set(used) - set(BUDGET_CAPS)
        )
        cells = [f"合計 {total:,}/{DAY_TOTAL_CAP:,} ({total / DAY_TOTAL_CAP:.0%})"]
        for bucket in order:
            label, cap = BUDGET_CAPS.get(bucket, (bucket, 0))
            share = f" ({used[bucket] / cap:.0%})" if cap else ""
            cells.append(f"{label} {used[bucket]:,}/{cap:,}{share}")
        lines.append(f"{day}  " + "  ".join(cells))
    return lines


def remote_env(
    say: Callable[[str], None],
    *,
    run: Runner = subprocess_run,
    http_get: HttpGet = urllib_get,
    base_env: Mapping[str, str] | None = None,
    oauth_file: Callable[[], tuple[Path, OAuthFile | None]] | None = None,
) -> dict[str, str]:
    """--remote の wrangler の環境。deploy.py と同じ道 (Keychain のトークン、端末の OAuth は使わない、M26-16)。

    資格情報を照合し (cf_auth.check_auth)、トークンが deploy.config.json の account に届き
    D1 の id が合うのを確かめてから、トークンを CLOUDFLARE_API_TOKEN に入れた環境を返す。
    """
    env = dict(os.environ) if base_env is None else base_env
    config = load_config(REPO / "deploy.config.json", REPO)
    report = check_auth(
        AuthTarget(
            config.account_id,
            config.d1,
            config.keychain_service,
            config.keychain_account,
        ),
        run=run,
        http_get=http_get,
        env=env,
        cwd=REPO,
        oauth_file=oauth_file or default_oauth_file(env),
        whoami=False,
        verify=True,
    )
    for line in report.lines:
        say(line)
    if not report.ready or report.token is None:
        raise AuthError(f"トークンの道がまだ使えない: {report.problem}")
    return wrangler_env(env, report.token, config.account_id)


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


def _say_err(text: str) -> None:
    print(text, file=sys.stderr)


def main(
    argv: list[str] | None = None,
    run: Run = subprocess.run,
    remote_env: Callable[[Callable[[str], None]], Mapping[str, str]] = remote_env,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.persist_to and args.remote:
        parser.error("--persist-to は --local のときだけ")
    if args.op == "delete" and not args.yes:
        print(f"消すと戻せない。消すなら --yes を付ける: {args.id}", file=sys.stderr)
        return 2
    target = Target(remote=args.remote, config=args.config, persist_to=args.persist_to)
    env: Mapping[str, str] | None = None
    if args.remote:
        try:
            env = remote_env(_say_err)
        except (AuthError, ConfigError) as error:
            print(f"--remote を止めた: {error}", file=sys.stderr)
            return 1
    token = Secret(env["CLOUDFLARE_API_TOKEN"]) if env else None
    try:
        if args.op == "budget":
            rows = execute(target, budget_sql(args.days), run, env)
            print("\n".join(format_budget(rows)))
            return 0
        to_sql, done = ROW_OPS[args.op]
        rows = execute(target, to_sql(args.id), run, env)
    except D1Error as error:
        print(redact(f"D1 がエラーを返した: {error}", token), file=sys.stderr)
        return 1
    if not rows:
        print(f"見つからない: {args.id}", file=sys.stderr)
        return 1
    since = f" ({rows[0]['hidden_at']} から)" if args.op == "hide" else ""
    print(f"{done}: {args.id}{since}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
