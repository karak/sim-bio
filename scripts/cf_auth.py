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

import json
import re
import subprocess
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
