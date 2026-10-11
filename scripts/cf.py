# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""手元から wrangler を、端末の OAuth ではなく Keychain のトークンで打つ (M26-12、deploy-runbook.md)。

    pnpm run cf tail biotope-island --format pretty
    pnpm run cf d1 execute biotope-harbor --remote --command "SELECT count(*) FROM chronicles"
    pnpm run cf deployments list
    pnpm run cf rollback <version-id> --message "<戻す訳>"
    pnpm run cf secret put TURNSTILE_SECRET_KEY

最初に mod.py --remote と同じ照合 (トークンが account に届き D1 の id が合う) を行い、通ったときだけ
トークンを CLOUDFLARE_API_TOKEN として wrangler の子プロセスにだけ渡す。入出力は wrangler にそのままつなぐ。
login・logout は端末の OAuth (ほかの repo と共有) を書き換えるので打たない。
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence

from cf_auth import RUNBOOK, AuthError
from deploy import ConfigError
from mod import REPO, WRANGLER
from mod import remote_env as mod_remote_env

Wrangler = Callable[[Sequence[str], Mapping[str, str]], int]
REFUSED = ("login", "logout")
USAGE = "使い方: pnpm run cf <wrangler の引数> (例: pnpm run cf deployments list)"


def run_wrangler(argv: Sequence[str], env: Mapping[str, str]) -> int:
    try:
        return subprocess.run(argv, env=env, cwd=REPO, check=False).returncode
    except KeyboardInterrupt:
        return 130


def _say_err(text: str) -> None:
    print(text, file=sys.stderr)


def main(
    argv: list[str] | None = None,
    wrangler: Wrangler = run_wrangler,
    remote_env: Callable[[Callable[[str], None]], Mapping[str, str]] = mod_remote_env,
) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["--"]:
        args = args[1:]
    if not args:
        print(USAGE, file=sys.stderr)
        return 2
    if args[0] in REFUSED:
        print(
            f"wrangler {args[0]} は打たない (端末の OAuth はほかの repo と共有。{RUNBOOK} の 1)",
            file=sys.stderr,
        )
        return 2
    try:
        env = remote_env(_say_err)
    except (AuthError, ConfigError) as error:
        print(f"wrangler を止めた: {error}", file=sys.stderr)
        return 1
    return wrangler([str(WRANGLER), *args], env)


if __name__ == "__main__":
    sys.exit(main())
