# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""「課金にしない」の構成検査 (設計書 docs/design/2026-09-26-cloudflare-architecture.md §3.3、M19-12)。

wrangler.jsonc と、build の後の配る dist を見て、無料枠の外へ出る構成なら落とす。

    pnpm run build:cloudflare && pnpm run check:free-tier
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

# Workers Free の静的アセットの上限 (https://developers.cloudflare.com/workers/platform/limits/#static-assets)
MAX_FILES = 20_000
MAX_FILE_BYTES = 25 * 1024 * 1024

# 許す key の表。ここに無い key は、binding でも設定でも落とす。新しい製品が増えても黙って通さないため
ALLOWED_KEYS: Mapping[str, str] = {
    "$schema": "設定の型",
    "name": "Worker の名前",
    "main": "Worker の入口",
    "compatibility_date": "実行環境の版",
    "compatibility_flags": "実行環境の版",
    "assets": "静的アセット。リクエストは無料・無制限",
    "observability": "Workers Logs。無料プランに含む (1 日 200,000 件・3 日保持)",
    "vars": "平文の設定 (Turnstile の site key など)",
    "triggers": "Cron。無料は 5 本/アカウント、設計は 1 本",
    "d1_databases": "D1。無料枠を超えるとクエリが失敗するだけで、課金にならない (M19-08)",
    "ratelimits": "Rate Limiting binding (M19-08)",
    "secrets": "secret の名前だけ (値は wrangler secret put)。型の生成と手元の警告に使う (M19-08)",
    "env": "環境ごとの設定。中身も同じ表で見る",
}

# 表に無い key のうち、なぜ落とすかを言える key。言えない key は「表に無い」とだけ言う
REJECTED_KEYS: Mapping[str, tuple[str, str]] = {
    "usage_model": (
        "usage_model",
        "Workers Paid の旧い課金方式 (bundled / unbound)。無料プランでは使わない",
    ),
    "limits": (
        "limits",
        "cpu_ms・subrequests の上限を上げるのは Workers Paid だけ。無料は 10 ms・50 本のまま",
    ),
    "r2_buckets": (
        "binding",
        "R2 は無料枠を超えると課金になる (止まらない)。設計書 C3・§5.3",
    ),
    "queues": ("binding", "Queues は設計の外"),
    "analytics_engine_datasets": (
        "binding",
        "Analytics Engine は無料での枠を確かめていない。設計書 §3.1",
    ),
    "browser": ("binding", "Browser Run は設計の外"),
    "ai": (
        "binding",
        "Workers AI は手元の開発でも遠隔で動き、使った分を数える。設計の外",
    ),
    "vectorize": ("binding", "Vectorize は設計の外"),
    "kv_namespaces": ("binding", "KV は設計書 §3.1 で落とした (D1 1 つで足りる)"),
    "durable_objects": ("binding", "Durable Objects は設計書 §3.1 で落とした"),
    "hyperdrive": ("binding", "Hyperdrive は設計の外"),
    "logpush": ("binding", "Logpush は有料。設計書 §3.1"),
}

# .assetsignore が配らずにおくべきもの。パターンの文字面ではなく、見本の道が無視されるかで見る
REQUIRED_IGNORES: Mapping[str, tuple[str, ...]] = {
    "*.blend": ("deer.blend", "models/deer.blend"),
    "textures/concept/**": (
        "textures/concept/a.png",
        "textures/concept/rejected/a.png",
    ),
}


# wrangler が .assetsignore の前に足す行 (wrangler の createAssetsIgnoreFunction)。数えも同じにする
WRANGLER_IGNORES = "/.assetsignore\n/_redirects\n/_headers\n"


@dataclass(frozen=True)
class Violation:
    rule: str
    where: str
    why: str


def parse_jsonc(text: str) -> object:
    """コメントと末尾のカンマを外して JSON として読む。文字列の中は触らない。"""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        if text[i] == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i : j + 1])
            i = j + 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end < 0:
                raise ValueError("閉じていない /* コメント")
            i = end + 2
        else:
            if text[i] in "}]":
                while out and out[-1].isspace():
                    out.pop()
                if out and out[-1] == ",":
                    out.pop()
            out.append(text[i])
            i += 1
    return json.loads("".join(out))


def check_config(config: Mapping[str, object], prefix: str = "") -> list[Violation]:
    violations: list[Violation] = []
    for key, value in config.items():
        where = prefix + key
        if key == "env" and not prefix and isinstance(value, Mapping):
            for name, env in value.items():
                violations += check_config(env, f"env.{name}.")
        elif key in REJECTED_KEYS:
            rule, why = REJECTED_KEYS[key]
            violations.append(Violation(rule, where, why))
        elif key not in ALLOWED_KEYS:
            why = "許す key の表に無い。設計書 §3.3 に照らして、無料枠の内なら scripts/check_free_tier.py の ALLOWED_KEYS に足す"
            violations.append(Violation("unknown_key", where, why))
    return violations


@dataclass(frozen=True)
class IgnoreRule:
    pattern: re.Pattern[str]
    negate: bool
    dir_only: bool


@dataclass(frozen=True)
class IgnoreRules:
    """.assetsignore (書式は .gitignore) のうち、このリポジトリが使う範囲。"""

    rules: tuple[IgnoreRule, ...]

    @staticmethod
    def parse(text: str) -> IgnoreRules:
        return IgnoreRules(
            tuple(
                _compile(line)
                for line in text.splitlines()
                if line.strip() and not line.startswith("#")
            )
        )

    def ignores(self, path: str) -> bool:
        parts = path.split("/")
        dirs = ["/".join(parts[:k]) for k in range(1, len(parts))]
        ignored = False
        for rule in self.rules:
            candidates = dirs if rule.dir_only else [*dirs, path]
            if any(rule.pattern.fullmatch(c) for c in candidates):
                ignored = not rule.negate
        return ignored


def _compile(line: str) -> IgnoreRule:
    pattern = line.strip()
    if re.search(r"[\[\\]", pattern):
        raise ValueError(
            f".assetsignore の {line!r} は、この検査が解釈できない書式 ([...] や \\)"
        )
    negate = pattern.startswith("!")
    pattern = pattern.removeprefix("!")
    dir_only = pattern.endswith("/")
    pattern = pattern.rstrip("/")
    anchored = "/" in pattern
    pattern = pattern.removeprefix("/")
    regex = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            regex += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            regex += ".*"
            i += 2
        elif pattern[i] == "*":
            regex += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            regex += "[^/]"
            i += 1
        else:
            regex += re.escape(pattern[i])
            i += 1
    if not anchored:
        regex = "(?:.*/)?" + regex
    return IgnoreRule(re.compile(regex), negate, dir_only)


def check_assetsignore(rules: IgnoreRules) -> list[Violation]:
    return [
        Violation(
            "assetsignore",
            pattern,
            f"{', '.join(probes)} が配られる。assets/.assetsignore に {pattern} を書く",
        )
        for pattern, probes in REQUIRED_IGNORES.items()
        if not all(rules.ignores(p) for p in probes)
    ]


def check_assets(
    entries: Iterable[tuple[str, int]], rules: IgnoreRules
) -> list[Violation]:
    """entries は配る dir からの相対の道 (区切りは /) と、バイト数。"""
    deployed = [(path, size) for path, size in entries if not rules.ignores(path)]
    violations = [
        Violation(
            "file_size",
            path,
            f"{size:,} バイト。1 ファイル {MAX_FILE_BYTES:,} バイト (25 MiB) まで",
        )
        for path, size in deployed
        if size > MAX_FILE_BYTES
    ]
    if len(deployed) > MAX_FILES:
        violations.append(
            Violation(
                "file_count",
                f"{len(deployed)} files",
                f"1 版 {MAX_FILES:,} ファイルまで",
            )
        )
    return violations


def check_repo(root: Path) -> list[Violation]:
    config = parse_jsonc((root / "wrangler.jsonc").read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise TypeError("wrangler.jsonc の一番外が object でない")
    directory = Path(config.get("assets", {}).get("directory", "./dist"))
    return [*check_config(config), *check_dist(root / directory, directory.as_posix())]


def check_dist(dist: Path, shown: str) -> list[Violation]:
    if not dist.is_dir():
        why = "配る dir が無い。先に pnpm run build:cloudflare を回す"
        return [Violation("dist", shown, why)]
    ignore_file = dist / ".assetsignore"
    if not ignore_file.is_file():
        why = "wrangler が読む .assetsignore が無い"
        return [Violation("assetsignore", f"{shown}/.assetsignore", why)]
    rules = IgnoreRules.parse(
        WRANGLER_IGNORES + ignore_file.read_text(encoding="utf-8")
    )
    entries = [
        (p.relative_to(dist).as_posix(), p.stat().st_size)
        for p in dist.rglob("*")
        if p.is_file()
    ]
    return [*check_assetsignore(rules), *check_assets(entries, rules)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    args = parser.parse_args(argv)
    violations = check_repo(args.root)
    for v in violations:
        print(f"NG [{v.rule}] {v.where}: {v.why}", file=sys.stderr)
    if violations:
        print(
            f"課金にしない構成検査: {len(violations)} 件の違反 (設計書 §3.3)",
            file=sys.stderr,
        )
        return 1
    print("課金にしない構成検査: 違反なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
