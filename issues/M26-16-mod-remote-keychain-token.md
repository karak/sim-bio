---
id: M26-16
title: scripts/mod.py --remote を deploy.py と同じ Keychain のトークンの道にする
status: review
milestone: M26
plan: docs/operations/deploy-runbook.md
depends_on: [M26-12]
evidence:
  - "395779b refactor(deploy): トークン・環境・D1 の照合の部品を scripts/cf_auth.py に移す (test_deploy.py 45 本はそのまま通る)"
  - "b7957fe feat(mod): --remote を deploy.py と同じ Keychain の道にする (scripts/mod.py の remote_env)"
  - "scripts/test_mod.py RemoteAuthTest の 5 本 (修正前に赤を確認: main() got an unexpected keyword argument 'remote_env')"
  - "38fb78c scripts/mod.py:14 の docstring を Keychain の道に (ユーザーの承認 2026-10-10)"
  - "この Mac で uv run scripts/mod.py --remote budget → 照合を出し、Keychain の項目が無いので wrangler を起こさずに終了 1"
---

# mod.py --remote を Keychain のトークンの道にする

優先度: Should

## What to build

この Mac の `wrangler login` の OAuth は機械に 1 つで、今は別の Cloudflare アカウントのもの。`scripts/mod.py --remote` は wrangler をそのまま起こすので、端末の OAuth を使い 7403 で落ちる。

ユーザーの決定 (2026-10-10): `--remote` は deploy.py と同じ道にする。Keychain の `sim-bio-local-deploy` からトークンを読み、環境で wrangler にだけ渡す。先にアカウントを確かめる。端末の OAuth は使わない。deploy.py の部品を使い回す (共有のモジュールに出してよい)。`--local` は変えない。

## Acceptance criteria

- [x] `--remote` は wrangler を起こす前に、トークンが account `14c725d39e9cf53743be403ab146174f` に届き、D1 `biotope-harbor` の id が wrangler.jsonc と合うかを確かめる (test_mod.py `test_token_of_another_account_stops_before_wrangler`)
- [x] トークンは wrangler の子プロセスの環境 (`CLOUDFLARE_API_TOKEN`) にだけ渡り、引数・出力・エラーの文に出ない (`test_token_reaches_wrangler_only_through_the_env`・`test_wrangler_error_text_is_redacted`)
- [x] Keychain の項目が無ければ、値を読まず wrangler も起こさずに止まり、H11・H12 を指す (`test_missing_keychain_item_stops_before_wrangler`)
- [x] `--local` はトークンを読まない (`test_local_never_asks_for_a_token`)
- [x] deploy.py の試験はそのまま通る (部品は scripts/cf_auth.py)
- [ ] (人) Keychain にトークンを置いてから `! uv run scripts/mod.py --remote budget` を 1 回通す (M26-12 の H11・H12 の後)

## 作業ログ

- 2026-10-10: 起票 (ユーザーの決定 A)。
- 2026-10-10: 実装。deploy.py のトークン・環境・D1 の照合を scripts/cf_auth.py に移し、mod.py の `remote_env` が M26-17 の照合 (`check_auth`、whoami なし、値を読んで照合) を通ってから wrangler の環境を作る。account と D1 の id は deploy.config.json と wrangler.jsonc から読む (`--config` で別の wrangler の設定を渡しても、照合は deploy.config.json の値で行う)。
