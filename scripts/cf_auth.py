# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Cloudflare の資格情報の部品 (deploy.py と mod.py --remote で使い回す、M26-16)。

この Mac の wrangler の OAuth は機械に 1 つで、別のアカウントのものになりうるので使わない。
この repo 専用の API トークンを macOS の Keychain から読み、wrangler の子プロセスの環境
(CLOUDFLARE_API_TOKEN) にだけ渡す。トークンはコマンドの引数・画面の出力・例外の文に出さない。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"
RUNBOOK = "docs/operations/deploy-runbook.md"

# 継いだ環境から外す資格情報の接頭辞。どの子プロセスにも、手元に残った別アカウントの値を渡さない
SCRUBBED_PREFIXES = ("CLOUDFLARE_", "CF_", "WRANGLER_")
# Cloudflare の API トークンの形。これに合わない値は、header に載せる前に (値を出さずに) 断る
TOKEN_SHAPE = re.compile(r"[A-Za-z0-9_-]{30,}")
SUBPROCESS_TIMEOUT_S = 900
KEYCHAIN_NOT_FOUND = 44  # errSecItemNotFound


class AuthError(Exception):
    pass


class Secret:
    """値を str・repr・f-string に出さない入れ物。値は reveal() でだけ取り出す。"""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not value:
            raise AuthError("トークンが空")
        self._value = value

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "Secret(***)"

    __str__ = __repr__


def redact(text: str, secret: Secret | None) -> str:
    """値そのものと、repr・URL の形に化けた値を伏せる。"""
    if not secret:
        return text
    value = secret.reveal()
    for form in {value, repr(value)[1:-1], urllib.parse.quote(value, safe="")}:
        text = text.replace(form, "***")
    return text


def scrub_env(env: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in env.items() if not k.startswith(SCRUBBED_PREFIXES)}


def wrangler_env(
    env: Mapping[str, str], token: Secret, account_id: str
) -> dict[str, str]:
    return {
        **scrub_env(env),
        "CLOUDFLARE_API_TOKEN": token.reveal(),
        "CLOUDFLARE_ACCOUNT_ID": account_id,
        "WRANGLER_SEND_METRICS": "false",
        # repo の .env が API の宛先を変えても、トークンを Cloudflare の外へ送らない
        "CLOUDFLARE_API_BASE_URL": CLOUDFLARE_API,
    }


@dataclass(frozen=True)
class Result:
    returncode: int
    stdout: str
    stderr: str


Runner = Callable[[Sequence[str], Mapping[str, str], Path], Result]
HttpGet = Callable[[str, Mapping[str, str]], tuple[int, bytes]]


def _keychain_where(service: str, account: str) -> str:
    return f"Keychain の service {service} / account {account}"


def read_keychain_token(
    service: str, account: str, run: Runner, env: Mapping[str, str], cwd: Path
) -> Secret:
    argv = ("security", "find-generic-password", "-s", service, "-a", account, "-w")
    result = run(argv, scrub_env(env), cwd)
    where = _keychain_where(service, account)
    if result.returncode == KEYCHAIN_NOT_FOUND:
        raise AuthError(f"{where} の項目が無い (人が一度だけ置く: {RUNBOOK} の H12)")
    if result.returncode != 0:
        raise AuthError(
            f"{where} を読めない (security の終了 {result.returncode}。許可の問いを断った・Keychain が閉じているなど)"
        )
    value = result.stdout.strip()
    if not TOKEN_SHAPE.fullmatch(value):
        raise AuthError(
            f"{where} の値が API トークンの形 (英数字・_・- で 30 字以上) でない。値は出さない。"
            f" 入れ直す: {RUNBOOK} の 4"
        )
    return Secret(value)


def verify_d1(
    account_id: str, d1: Mapping[str, str], token: Secret, http_get: HttpGet
) -> None:
    """wrangler を起こす前に、トークンが account_id に届き、D1 の id が合うかを Cloudflare の API で確かめる。"""
    headers = {"Authorization": f"Bearer {token.reveal()}", "User-Agent": "deploy.py"}
    for name, expected in d1.items():
        query = urllib.parse.urlencode({"name": name})
        url = f"{CLOUDFLARE_API}/accounts/{account_id}/d1/database?{query}"
        status, body = http_get(url, headers)
        try:
            payload = json.loads(body)
        except ValueError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        if status != 200 or not payload.get("success"):
            errors = payload.get("errors") or []
            codes = ", ".join(
                f"{e.get('code')} {e.get('message', '')}".strip()
                for e in errors
                if isinstance(e, Mapping)
            )
            raise AuthError(
                redact(
                    f"トークンで account {account_id} の D1 を読めない (HTTP {status}"
                    f"{', ' + codes if codes else ''})。別のアカウントのトークンか、権限が足りない。"
                    f" wrangler は起こしていない ({RUNBOOK} の 1)",
                    token,
                )
            )
        found = [
            d.get("uuid")
            for d in payload.get("result") or []
            if isinstance(d, Mapping) and d.get("name") == name
        ]
        if expected not in found:
            raise AuthError(
                f"account {account_id} の D1 {name} の id が {found or '無し'} で、"
                f"wrangler.jsonc の {expected} と違う。配る先のアカウントを確かめる"
            )


def subprocess_run(argv: Sequence[str], env: Mapping[str, str], cwd: Path) -> Result:
    p = subprocess.run(
        list(argv),
        env=dict(env),
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
        timeout=SUBPROCESS_TIMEOUT_S,
    )
    return Result(p.returncode, p.stdout, p.stderr)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Authorization を載せた要求が、よその host へ転送されないようにする。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url, code, "redirect は辿らない", headers, fp
        )


_OPENER = urllib.request.build_opener(_NoRedirect)


def urllib_get(url: str, headers: Mapping[str, str]) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers=dict(headers), method="GET")
    try:
        with _OPENER.open(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise AuthError(f"{url.split('?')[0]} に届かない: {e.reason}") from None


# --- 資格情報の照合 (M26-17。deploy-runbook.md の「最初に: 資格情報の照合」) ---

# sim-bio の配備に要る OAuth のスコープ (cloudflare-deploy.md の H3)。端末の OAuth を使う道は無いので、照らすだけ
REQUIRED_OAUTH_SCOPES = (
    "account:read",
    "user:read",
    "workers_scripts:write",
    "workers_tail:read",
    "d1:write",
    "challenge-widgets.write",
)
WHOAMI = ("pnpm", "exec", "wrangler", "whoami", "--json")


@dataclass(frozen=True)
class AuthTarget:
    account_id: str
    d1: Mapping[str, str]
    keychain_service: str
    keychain_account: str | None


@dataclass(frozen=True)
class OAuthFile:
    """wrangler の資格情報のファイルから読んだ、秘密でない欄だけ。"""

    logged_in: bool
    scopes: tuple[str, ...]
    expires: str | None


@dataclass(frozen=True)
class Whoami:
    logged_in: bool
    accounts: tuple[tuple[str, str], ...]
    scopes: tuple[str, ...]


@dataclass(frozen=True)
class AuthReport:
    lines: tuple[str, ...]
    ready: bool
    token: Secret | None
    problem: str | None = None


def wrangler_auth_file(
    home: Path,
    env: Mapping[str, str],
    platform: str,
    *,
    is_dir: Callable[[Path], bool],
) -> Path:
    """wrangler が OAuth を置くファイル。~/.wrangler の dir があればそれ、無ければ OS の設定の場所。"""
    legacy = home / ".wrangler"
    if is_dir(legacy):
        base = legacy
    elif env.get("XDG_CONFIG_HOME"):
        base = Path(env["XDG_CONFIG_HOME"]) / ".wrangler"
    elif platform == "darwin":
        base = home / "Library" / "Preferences" / ".wrangler"
    else:
        base = Path(env.get("XDG_CONFIG_HOME") or home / ".config") / ".wrangler"
    return base / "config" / "default.toml"


def parse_oauth_file(text: str) -> OAuthFile:
    """scopes と expiration_time だけを拾う。oauth_token は有る無しだけを見て、値は読まない。"""
    logged_in = re.search(r"^oauth_token\s*=", text, re.MULTILINE) is not None
    scopes_m = re.search(r"^scopes\s*=\s*\[(.*?)\]", text, re.MULTILINE | re.DOTALL)
    scopes = tuple(re.findall(r'"([^"]*)"', scopes_m.group(1))) if scopes_m else ()
    expires_m = re.search(r'^expiration_time\s*=\s*"([^"]*)"', text, re.MULTILINE)
    return OAuthFile(logged_in, scopes, expires_m.group(1) if expires_m else None)


def read_oauth_file(path: Path) -> OAuthFile | None:
    try:
        return parse_oauth_file(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def parse_whoami(result: Result) -> Whoami:
    nobody = Whoami(False, (), ())
    if result.returncode != 0:
        return nobody
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        return nobody
    if not isinstance(payload, dict) or not payload.get("loggedIn"):
        return nobody
    accounts = tuple(
        (str(a.get("id")), str(a.get("name")))
        for a in payload.get("accounts") or []
        if isinstance(a, Mapping)
    )
    scopes = tuple(str(s) for s in payload.get("tokenPermissions") or [])
    return Whoami(True, accounts, scopes)


def _scope_line(scopes: Sequence[str]) -> str:
    missing = [s for s in REQUIRED_OAUTH_SCOPES if s not in scopes]
    if not missing:
        return f"  スコープ: 要る {len(REQUIRED_OAUTH_SCOPES)} つはそろっている"
    return f"  スコープ: 足りない {', '.join(missing)}"


def _oauth_lines(
    target: AuthTarget, path: Path, file: OAuthFile | None, seen: Whoami | None
) -> list[str]:
    lines = [f"端末の wrangler の OAuth ({path}):"]
    whoami_asked = seen is not None
    in_file = bool(file and file.logged_in)
    if seen is not None and not seen.logged_in and in_file:
        # whoami の失敗 (網・延ばしの失敗) を、ログインしていないとは言わない
        seen = None
        lines.append("  whoami が答えない (ファイルには OAuth が有る)")
    logged_in = seen.logged_in if seen else in_file
    if not logged_in:
        lines.append("  ログインしていない")
    else:
        expires = (
            f" (期限 {file.expires}。切れても wrangler が延ばす)"
            if file and file.expires
            else ""
        )
        lines.append(f"  ログイン: 済{expires}")
        if seen is None and whoami_asked:
            lines.append("  アカウント: 分からない")
        elif seen is None:
            lines.append(
                "  アカウント: 見ていない (whoami は端末の OAuth を延ばして書き換えるので、"
                "pnpm run cf:auth でだけ見る)"
            )
        else:
            for account_id, name in seen.accounts:
                lines.append(f"  アカウント: {account_id} ({name})")
            if any(a == target.account_id for a, _ in seen.accounts):
                lines.append(f"  → sim-bio の account に届く ({target.account_id})")
            else:
                lines.append(
                    f"  → sim-bio の account ではない ({target.account_id} が無い)"
                )
        scopes = seen.scopes if seen and seen.scopes else (file.scopes if file else ())
        lines.append(_scope_line(scopes))
    lines.append("  この repo のスクリプトは端末の OAuth を使わない (照らすだけ)")
    return lines


def _run_safely(
    run: Runner, argv: Sequence[str], env: Mapping[str, str], cwd: Path
) -> Result:
    """起こせない・時間切れも、例外ではなく失敗の Result にする (照合を traceback で終えない)。"""
    try:
        return run(argv, env, cwd)
    except (OSError, subprocess.SubprocessError) as e:
        return Result(-1, "", f"{argv[0]} を起こせない: {type(e).__name__}")


def _keychain_problem(found: Result, where: str) -> str | None:
    if found.returncode == KEYCHAIN_NOT_FOUND:
        return f"{where} の項目が無い。人が一度だけ作って置く ({RUNBOOK} の H11・H12)"
    if found.returncode != 0:
        detail = f"。{found.stderr}" if found.returncode < 0 else ""
        return f"{where} を見られない (security の終了 {found.returncode}{detail})"
    return None


def check_auth(
    target: AuthTarget,
    *,
    run: Runner,
    http_get: HttpGet,
    env: Mapping[str, str],
    cwd: Path,
    oauth_file: Callable[[], tuple[Path, OAuthFile | None]],
    whoami: bool,
    verify: bool,
) -> AuthReport:
    """端末の OAuth を照らし (使わない)、Keychain のトークンの道が使えるかを確かめる。

    whoami: wrangler whoami で OAuth のアカウントを見る (端末の OAuth を延ばして書き換える)。
    verify: Keychain からトークンを読み、Cloudflare の API で account と D1 の id を確かめる。
    False なら Keychain の項目の有る無しだけを見る (値を読まない)。
    """
    lines = ["== 資格情報の照合 (deploy-runbook.md の「最初に」)"]
    path, file = oauth_file()
    seen = None
    if whoami:
        who_env = {**scrub_env(env), "WRANGLER_SEND_METRICS": "false"}
        seen = parse_whoami(_run_safely(run, WHOAMI, who_env, cwd))
    lines += _oauth_lines(target, path, file, seen)
    if "CLOUDFLARE_API_TOKEN" in env:
        lines.append("環境の CLOUDFLARE_API_TOKEN は使わない (子プロセスから外す)")

    token: Secret | None = None
    problem: str | None = None
    account = target.keychain_account or env.get("USER")
    if not account:
        lines.append("Keychain のトークン:")
        problem = "Keychain の account が決まらない (keychain_account も $USER も無い)"
    else:
        where = _keychain_where(target.keychain_service, account)
        lines.append("Keychain のトークン:")
        found = _run_safely(
            run,
            (
                "security",
                "find-generic-password",
                "-s",
                target.keychain_service,
                "-a",
                account,
            ),
            scrub_env(env),
            cwd,
        )
        problem = _keychain_problem(found, where)
        if problem is None:
            lines.append("  項目: 有る")
        if problem is None and verify:
            try:
                token = read_keychain_token(
                    target.keychain_service, account, run, env, cwd
                )
                verify_d1(target.account_id, target.d1, token, http_get)
            except (AuthError, OSError, subprocess.SubprocessError) as e:
                problem = redact(str(e) or type(e).__name__, token)
                token = None
            else:
                ids = ", ".join(f"{n} {i}" for n, i in target.d1.items())
                lines.append(
                    f"  照合: account {target.account_id} に届き、D1 の id も合う ({ids})"
                )
        elif problem is None:
            lines.append(
                "  照合: この後の verify-account の段で行う (ここでは値を読まない)"
            )

    if problem is None:
        lines.append(
            f"使う道: Keychain のトークン ({target.keychain_service}) を CLOUDFLARE_API_TOKEN として"
            " wrangler の子プロセスにだけ渡す。端末の OAuth は使わない"
        )
        return AuthReport(tuple(lines), True, token)
    lines.append(f"  {problem}")
    lines.append(
        "使う道: 無い。止める (配備・D1 の wrangler は起こさない)。"
        f"wrangler login では直さない (ほかの repo の資格情報を壊す。{RUNBOOK} の 1)"
    )
    return AuthReport(tuple(lines), False, None, problem)


def default_oauth_file(
    env: Mapping[str, str],
) -> Callable[[], tuple[Path, OAuthFile | None]]:
    path = wrangler_auth_file(Path.home(), env, sys.platform, is_dir=Path.is_dir)
    return lambda: (path, read_oauth_file(path))


def main(
    argv: list[str] | None = None,
    *,
    run: Runner = subprocess_run,
    http_get: HttpGet = urllib_get,
    env: Mapping[str, str] | None = None,
    oauth_file: Callable[[], tuple[Path, OAuthFile | None]] | None = None,
) -> int:
    # deploy.py が cf_auth を読むので、設定の読み込みはここで遅れて import する
    from deploy import ConfigError, load_config

    parser = argparse.ArgumentParser(
        description="資格情報の照合 (pnpm run cf:auth、deploy-runbook.md の「最初に」)"
    )
    parser.add_argument(
        "--no-whoami",
        action="store_true",
        help="wrangler whoami を打たない (端末の OAuth を書き換えない)",
    )
    raw = sys.argv[1:] if argv is None else argv
    args = parser.parse_args(raw[1:] if raw[:1] == ["--"] else raw)
    root = Path(__file__).resolve().parent.parent
    env = dict(os.environ) if env is None else env
    try:
        config = load_config(root / "deploy.config.json", root)
    except ConfigError as e:
        print(f"照合を止めた: {e}", file=sys.stderr)
        return 1
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
        cwd=root,
        oauth_file=oauth_file or default_oauth_file(env),
        whoami=not args.no_whoami,
        verify=True,
    )
    print("\n".join(report.lines))
    return 0 if report.ready else 1


if __name__ == "__main__":
    sys.exit(main())
