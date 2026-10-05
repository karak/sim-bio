# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""端末の wrangler login に依らない、手元からの配備 (docs/operations/deploy-runbook.md の控えの道)。

この Mac の wrangler の OAuth は別のアカウントのものなので使わない。この repo 専用の API トークンを
macOS の Keychain から読み、wrangler の子プロセスの環境 (CLOUDFLARE_API_TOKEN) にだけ渡す。
トークンはコマンドの引数・画面の出力・例外の文に出さない。

    pnpm run deploy -- --dry-run      # 設定と手順を出すだけ (Keychain・wrangler・ネットワークに触れない)
    pnpm run deploy                   # 配る
    pnpm run deploy -- --check        # 配る前に pnpm run check も回す
    pnpm run deploy -- --allow-branch # HEAD の木が origin/<branch> と違っても配る

repo ごとの値はすべて repo の根の deploy.config.json に置く。wrangler.jsonc の account_id・name・D1 の id と食い違えば止まる。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from check_free_tier import parse_jsonc

WRANGLER = ("pnpm", "exec", "wrangler")
CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"
LFS_POINTER = b"version https://git-lfs"
RUNBOOK = "docs/operations/deploy-runbook.md"

# 継いだ環境から外す資格情報の接頭辞。どの子プロセスにも、手元に残った別アカウントの値を渡さない
SCRUBBED_PREFIXES = ("CLOUDFLARE_", "CF_", "WRANGLER_")

CONFIG_KEYS = frozenset(
    {
        "account_id",
        "worker",
        "d1_databases",
        "keychain_service",
        "keychain_account",
        "build",
        "checks",
        "smoke",
        "branch",
        "remote",
        "untracked_ok",
        "lfs_dirs",
        "lfs_suffixes",
        "wrangler_config",
    }
)
SMOKE_EXPECTS = frozenset({"ok", "json"})


class ConfigError(Exception):
    pass


class DeployError(Exception):
    pass


class Secret:
    """値を str・repr・f-string に出さない入れ物。値は reveal() でだけ取り出す。"""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not value:
            raise DeployError("トークンが空")
        self._value = value

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "Secret(***)"

    __str__ = __repr__


def redact(text: str, secret: Secret | None) -> str:
    return text.replace(secret.reveal(), "***") if secret else text


@dataclass(frozen=True)
class Smoke:
    url: str
    expect: str


@dataclass(frozen=True)
class Config:
    account_id: str
    worker: str
    d1: Mapping[str, str]
    keychain_service: str
    keychain_account: str | None
    build_script: str
    build_env: Mapping[str, str]
    checks: tuple[str, ...]
    smoke: tuple[Smoke, ...]
    branch: str
    remote: str = "origin"
    untracked_ok: tuple[str, ...] = (".claude/",)
    lfs_dirs: tuple[str, ...] = ("assets/",)
    lfs_suffixes: tuple[str, ...] = (".glb", ".png")
    wrangler_config: str = "wrangler.jsonc"


def _str(raw: Mapping[str, object], key: str, *, default: str | None = None) -> str:
    value = raw.get(key, default)
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{key} は空でない文字列にする")
    return value


def _strs(
    raw: Mapping[str, object], key: str, default: Sequence[str]
) -> tuple[str, ...]:
    value = raw.get(key, list(default))
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise ConfigError(f"{key} は空でない文字列の list にする")
    return tuple(value)


def parse_config(raw: Mapping[str, object], wrangler: Mapping[str, object]) -> Config:
    """deploy.config.json の中身を確かめ、wrangler.jsonc と食い違わないかも見る。"""
    unknown = sorted(set(raw) - CONFIG_KEYS)
    if unknown:
        raise ConfigError(f"知らない key: {', '.join(unknown)}")
    for key in (
        "account_id",
        "worker",
        "d1_databases",
        "keychain_service",
        "build",
        "smoke",
        "branch",
    ):
        if key not in raw:
            raise ConfigError(f"{key} が無い")

    account_id = _str(raw, "account_id")
    if not re.fullmatch(r"[0-9a-f]{32}", account_id):
        raise ConfigError("account_id は 32 桁の 16 進にする")
    worker = _str(raw, "worker")
    names = _strs(raw, "d1_databases", ())

    build = raw["build"]
    if not isinstance(build, Mapping):
        raise ConfigError("build は {script, env} にする")
    build_script = _str(build, "script")
    build_env = build.get("env", {})
    if not isinstance(build_env, Mapping) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in build_env.items()
    ):
        raise ConfigError("build.env は 文字列 → 文字列 にする")

    smoke_raw = raw["smoke"]
    if not isinstance(smoke_raw, list) or not smoke_raw:
        raise ConfigError("smoke は 1 つ以上の {url, expect} にする")
    smoke: list[Smoke] = []
    for item in smoke_raw:
        if not isinstance(item, Mapping):
            raise ConfigError("smoke の各要素は {url, expect} にする")
        url, expect = _str(item, "url"), _str(item, "expect")
        if not url.startswith("https://"):
            raise ConfigError(f"smoke の url は https にする: {url}")
        if expect not in SMOKE_EXPECTS:
            raise ConfigError(
                f"smoke の expect は {sorted(SMOKE_EXPECTS)} のどれか: {expect}"
            )
        smoke.append(Smoke(url, expect))

    keychain_account = raw.get("keychain_account")
    if keychain_account is not None and (
        not isinstance(keychain_account, str) or not keychain_account
    ):
        raise ConfigError("keychain_account は空でない文字列か null (null は $USER)")

    if wrangler.get("account_id") != account_id:
        raise ConfigError(
            f"wrangler.jsonc の account_id ({wrangler.get('account_id')}) が deploy.config.json ({account_id}) と違う。"
            " wrangler.jsonc に account_id を書いて留める"
        )
    if wrangler.get("name") != worker:
        raise ConfigError(
            f"wrangler.jsonc の name ({wrangler.get('name')}) が worker ({worker}) と違う"
        )
    declared = {
        d.get("database_name"): d.get("database_id")
        for d in wrangler.get("d1_databases", [])  # type: ignore[union-attr]
        if isinstance(d, Mapping)
    }
    d1: dict[str, str] = {}
    for name in names:
        db_id = declared.get(name)
        if not isinstance(db_id, str):
            raise ConfigError(f"D1 {name} が wrangler.jsonc の d1_databases に無い")
        d1[name] = db_id

    return Config(
        account_id=account_id,
        worker=worker,
        d1=d1,
        keychain_service=_str(raw, "keychain_service"),
        keychain_account=keychain_account,
        build_script=build_script,
        build_env=dict(build_env),
        checks=_strs(raw, "checks", ()),
        smoke=tuple(smoke),
        branch=_str(raw, "branch"),
        remote=_str(raw, "remote", default="origin"),
        untracked_ok=_strs(raw, "untracked_ok", (".claude/",)),
        lfs_dirs=_strs(raw, "lfs_dirs", ("assets/",)),
        lfs_suffixes=_strs(raw, "lfs_suffixes", (".glb", ".png")),
        wrangler_config=_str(raw, "wrangler_config", default="wrangler.jsonc"),
    )


def load_config(path: Path, root: Path) -> Config:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ConfigError(f"{path} の一番外が object でない")
    wrangler_path = root / raw.get("wrangler_config", "wrangler.jsonc")
    wrangler = parse_jsonc(wrangler_path.read_text(encoding="utf-8"))
    if not isinstance(wrangler, dict):
        raise ConfigError(f"{wrangler_path} の一番外が object でない")
    return parse_config(raw, wrangler)


def is_lfs_pointer(head: bytes) -> bool:
    return head.startswith(LFS_POINTER)


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
    }


@dataclass(frozen=True)
class Result:
    returncode: int
    stdout: str
    stderr: str


Runner = Callable[[Sequence[str], Mapping[str, str], Path], Result]
HttpGet = Callable[[str, Mapping[str, str]], tuple[int, bytes]]


@dataclass(frozen=True)
class Deps:
    run: Runner
    http_get: HttpGet
    read_head: Callable[[Path], bytes]
    print: Callable[[str], None]
    base_env: Mapping[str, str]
    cwd: Path


@dataclass(frozen=True)
class Step:
    name: str
    kind: str  # preflight | token | verify | run | deployments | smoke
    describe: str
    argv: tuple[str, ...] = ()
    wrangler: bool = False
    env: Mapping[str, str] = field(default_factory=dict)


def _run_step(
    name: str, argv: tuple[str, ...], env: Mapping[str, str] | None = None
) -> Step:
    return Step(name, "run", " ".join(argv), argv, False, env or {})


def _wrangler_step(name: str, *args: str, kind: str = "run") -> Step:
    argv = (*WRANGLER, *args)
    return Step(
        name, kind, " ".join(argv) + "  (CLOUDFLARE_API_TOKEN は環境で)", argv, True
    )


def plan(config: Config, *, check: bool) -> list[Step]:
    steps = [
        Step(
            "preflight",
            "preflight",
            f"作業の木が綺麗か・git fetch {config.remote} {config.branch} の後に HEAD の木が"
            f" {config.remote}/{config.branch} と同じか・{', '.join(config.lfs_dirs)} の"
            f" {', '.join(config.lfs_suffixes)} が LFS のポインタでないか",
        )
    ]
    if check:
        steps.append(_run_step("check", ("pnpm", "run", "check")))
    steps += [
        Step(
            "token",
            "token",
            f"Keychain の {config.keychain_service} からトークンを読む (出さない)",
        ),
        Step(
            "verify-account",
            "verify",
            f"GET {CLOUDFLARE_API}/accounts/{config.account_id}/d1/database で、トークンがこのアカウントに届き"
            " D1 の id が wrangler.jsonc と同じか",
        ),
        _run_step("build", ("pnpm", "run", config.build_script), config.build_env),
        *(_run_step(c, ("pnpm", "run", c)) for c in config.checks),
    ]
    for db in config.d1:
        steps.append(
            _wrangler_step(
                f"migrations-list:{db}", "d1", "migrations", "list", db, "--remote"
            )
        )
        steps.append(
            _wrangler_step(
                f"migrations-apply:{db}", "d1", "migrations", "apply", db, "--remote"
            )
        )
    steps += [
        _wrangler_step("deploy", "deploy"),
        _wrangler_step(
            "deployments", "deployments", "list", "--json", kind="deployments"
        ),
        Step(
            "smoke",
            "smoke",
            "GET " + " , ".join(f"{s.url} ({s.expect})" for s in config.smoke),
        ),
    ]
    return steps


def _keychain_account(config: Config, deps: Deps) -> str:
    account = config.keychain_account or deps.base_env.get("USER")
    if not account:
        raise DeployError(
            "Keychain の account が決まらない (keychain_account も $USER も無い)"
        )
    return account


def _git(deps: Deps, *args: str) -> str:
    result = deps.run(("git", *args), scrub_env(deps.base_env), deps.cwd)
    if result.returncode != 0:
        raise DeployError(
            f"git {' '.join(args)} が失敗 (終了 {result.returncode}): {result.stderr.strip()}"
        )
    return result.stdout


def preflight(config: Config, deps: Deps, *, allow_branch: bool) -> None:
    dirty = [
        line
        for line in _git(
            deps, "status", "--porcelain=v1", "--untracked-files=all"
        ).splitlines()
        if line
        and not (line.startswith("?? ") and line[3:].startswith(config.untracked_ok))
    ]
    if dirty:
        raise DeployError(
            "作業の木が綺麗でない (commit してから配る):\n" + "\n".join(dirty)
        )

    _git(deps, "fetch", config.remote, config.branch)
    upstream = f"{config.remote}/{config.branch}"
    head = _git(deps, "rev-parse", "HEAD^{tree}").strip()
    remote = _git(deps, "rev-parse", f"{upstream}^{{tree}}").strip()
    if head != remote:
        if not allow_branch:
            raise DeployError(
                f"HEAD の木 ({head}) が {upstream} の木 ({remote}) と違う。"
                f"{upstream} に入ったものだけを配る (外すなら --allow-branch)"
            )
        deps.print(f"警告: HEAD の木が {upstream} と違うが、--allow-branch で続ける")

    listed = _git(deps, "ls-files", "-z", "--", *config.lfs_dirs)
    pointers = [
        path
        for path in listed.split("\0")
        if path.endswith(config.lfs_suffixes)
        and is_lfs_pointer(deps.read_head(deps.cwd / path))
    ]
    if pointers:
        raise DeployError(
            "git LFS のポインタのままのファイルがある (git lfs pull してから配る):\n"
            + "\n".join(pointers)
        )


def read_token(config: Config, deps: Deps) -> Secret:
    account = _keychain_account(config, deps)
    argv = (
        "security",
        "find-generic-password",
        "-s",
        config.keychain_service,
        "-a",
        account,
        "-w",
    )
    result = deps.run(argv, scrub_env(deps.base_env), deps.cwd)
    if result.returncode != 0:
        raise DeployError(
            f"Keychain に service {config.keychain_service} / account {account} の項目が無い"
            f" (人が一度だけ置く: {RUNBOOK} の H12)"
        )
    return Secret(result.stdout.rstrip("\n"))


def verify_account(config: Config, token: Secret, http_get: HttpGet) -> None:
    """wrangler を起こす前に、トークンが config のアカウントに届くかを Cloudflare の API で確かめる。"""
    headers = {"Authorization": f"Bearer {token.reveal()}", "User-Agent": "deploy.py"}
    for name, expected in config.d1.items():
        url = f"{CLOUDFLARE_API}/accounts/{config.account_id}/d1/database?name={name}"
        status, body = http_get(url, headers)
        try:
            payload = json.loads(body)
        except ValueError:
            payload = {}
        if status != 200 or not payload.get("success"):
            errors = payload.get("errors") or []
            codes = ", ".join(
                f"{e.get('code')} {e.get('message', '')}".strip()
                for e in errors
                if isinstance(e, Mapping)
            )
            raise DeployError(
                redact(
                    f"トークンで account {config.account_id} の D1 を読めない (HTTP {status}"
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
            raise DeployError(
                f"account {config.account_id} の D1 {name} の id が {found or '無し'} で、"
                f"wrangler.jsonc の {expected} と違う。配る先のアカウントを確かめる"
            )


def smoke(config: Config, http_get: HttpGet) -> list[str]:
    failures: list[str] = []
    for s in config.smoke:
        try:
            status, body = http_get(s.url, {"User-Agent": "deploy.py"})
        except DeployError as e:
            failures.append(f"{s.url}: {e}")
            continue
        if status != 200:
            failures.append(f"{s.url}: HTTP {status}")
            continue
        if s.expect == "json":
            try:
                json.loads(body)
            except ValueError:
                failures.append(f"{s.url}: JSON でない")
    return failures


def latest_version(stdout: str) -> list[str] | None:
    try:
        deployments = json.loads(stdout)
        latest = max(deployments, key=lambda d: d["created_on"])
        return [v["version_id"] for v in latest["versions"]]
    except (ValueError, TypeError, KeyError):
        return None


def deploy(config: Config, deps: Deps, *, check: bool, allow_branch: bool) -> None:
    token: Secret | None = None

    def say(text: str) -> None:
        deps.print(redact(text, token))

    try:
        for step in plan(config, check=check):
            say(f"== {step.name}: {step.describe}")
            match step.kind:
                case "preflight":
                    preflight(config, deps, allow_branch=allow_branch)
                case "token":
                    token = read_token(config, deps)
                case "verify":
                    assert token is not None
                    verify_account(config, token, deps.http_get)
                    say(f"トークンは account {config.account_id} に届く")
                case "smoke":
                    failures = smoke(config, deps.http_get)
                    if failures:
                        raise DeployError(
                            "配ったあとの確かめが落ちた:\n" + "\n".join(failures)
                        )
                    say("確かめ: すべて通った")
                case "run" | "deployments":
                    if step.wrangler:
                        assert token is not None
                        env = wrangler_env(deps.base_env, token, config.account_id)
                    else:
                        env = {**scrub_env(deps.base_env), **step.env}
                    result = deps.run(step.argv, env, deps.cwd)
                    if step.kind == "deployments" and result.returncode == 0:
                        versions = latest_version(result.stdout)
                        if versions is None:
                            say(
                                "警告: deployments list の JSON を読めない。そのまま出す"
                            )
                            say(result.stdout)
                        else:
                            say(f"配った版: {', '.join(versions)}")
                    else:
                        say(result.stdout.rstrip("\n"))
                        if result.stderr:
                            say(result.stderr.rstrip("\n"))
                    if result.returncode != 0:
                        raise DeployError(
                            f"{step.name} が失敗 (終了 {result.returncode})"
                        )
    except DeployError as e:
        raise DeployError(redact(str(e), token)) from None
    except (
        OSError,
        ValueError,
        LookupError,
        TypeError,
        subprocess.SubprocessError,
    ) as e:
        # 子プロセス・ファイル・JSON の想定の外の失敗も、文を伏せてから上げる
        raise DeployError(redact(f"{type(e).__name__}: {e}", token)) from None


def dry_run(config: Config, deps: Deps, *, check: bool) -> None:
    deps.print("deploy.py --dry-run (Keychain・wrangler・ネットワークには触れない)")
    deps.print(f"account_id:       {config.account_id}")
    deps.print(f"worker:           {config.worker}")
    for name, db_id in config.d1.items():
        deps.print(f"d1:               {name} ({db_id})")
    try:
        account = _keychain_account(config, deps)
    except DeployError:
        account = "(未定: keychain_account も $USER も無い)"
    deps.print(
        f"keychain:         service {config.keychain_service} / account {account}"
    )
    deps.print(
        f"build:            pnpm run {config.build_script}  env {json.dumps(dict(config.build_env))}"
    )
    deps.print(f"branch:           {config.remote}/{config.branch}")
    deps.print(f"untracked_ok:     {', '.join(config.untracked_ok)}")
    deps.print("steps:")
    for n, step in enumerate(plan(config, check=check), 1):
        deps.print(f"  {n:2}. {step.name}: {step.describe}")


def _subprocess_run(argv: Sequence[str], env: Mapping[str, str], cwd: Path) -> Result:
    p = subprocess.run(
        list(argv),
        env=dict(env),
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
    )
    return Result(p.returncode, p.stdout, p.stderr)


def _urllib_get(url: str, headers: Mapping[str, str]) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers=dict(headers), method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise DeployError(f"{url.split('?')[0]} に届かない: {e.reason}") from None


def _read_head(path: Path) -> bytes:
    with path.open("rb") as f:
        return f.read(len(LFS_POINTER))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="設定と手順を出すだけ")
    parser.add_argument(
        "--check", action="store_true", help="配る前に pnpm run check を回す"
    )
    parser.add_argument(
        "--allow-branch",
        action="store_true",
        help="HEAD の木が origin/<branch> と違っても配る",
    )
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    parser.add_argument("--config", type=Path, help="既定は <root>/deploy.config.json")
    raw = sys.argv[1:] if argv is None else argv
    # pnpm run deploy -- --dry-run の形では pnpm が -- をそのまま渡すので、先頭の 1 つは外す
    args = parser.parse_args(raw[1:] if raw[:1] == ["--"] else raw)

    deps = Deps(
        run=_subprocess_run,
        http_get=_urllib_get,
        read_head=_read_head,
        print=print,
        base_env=dict(os.environ),
        cwd=args.root,
    )
    try:
        config = load_config(args.config or args.root / "deploy.config.json", args.root)
        if args.dry_run:
            dry_run(config, deps, check=args.check)
        else:
            deploy(config, deps, check=args.check, allow_branch=args.allow_branch)
    except (ConfigError, DeployError) as e:
        print(f"配備を止めた: {e}", file=sys.stderr)
        return 1
    if not args.dry_run:
        print("配備: 終わり")
    return 0


if __name__ == "__main__":
    sys.exit(main())
