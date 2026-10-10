---
id: M26-17
title: 手順書とスクリプトの最初に、資格情報の照合 (端末の OAuth を照らし、使う道を言う) を入れる
status: review
milestone: M26
plan: docs/operations/deploy-runbook.md
depends_on: [M26-16]
evidence:
  - "88b63cb feat(cf_auth): 資格情報の照合 (pnpm run cf:auth、scripts/cf_auth.py の check_auth)"
  - "scripts/test_cf_auth.py の 20 本 (修正前に赤を確認: ImportError、REQUIRED_OAUTH_SCOPES などが無い)"
  - "b8cd90e feat(deploy): 最初の段で資格情報を照合する (test_deploy.py の新しい 2 本、修正前に赤を確認)"
  - "docs/operations/deploy-runbook.md の「最初に: 資格情報の照合」、cloudflare-deploy.md の冒頭の 1 段と A1a の行"
  - "この Mac で pnpm run cf:auth → OAuth はログイン済みで別のアカウント (0c931a90…)、スコープはそろう、Keychain の項目が無いので「使う道: 無い。止める」で終了 1"
---

# 資格情報の照合を最初に入れる

優先度: Should

## What to build

ユーザーの言葉 (2026-10-10):「環境依存でないrunbookにすべき。最初にログイン済みかどうかとoauth範囲の照合を入れて自動化スクリプトにも反映して」

手順書は、端末の状態 (誰の OAuth でログインしているか) に結果が左右されないようにする。最初の手順で今の状態を照らし、sim-bio に要るものと突き合わせる。同じ照合をスクリプトにも入れる。

照合 (`pnpm run cf:auth` = `uv run scripts/cf_auth.py`) が出すもの:
1. 端末の wrangler の OAuth: ログインしているか、どのアカウントか、要る 6 つのスコープ (`account:read user:read workers_scripts:write workers_tail:read d1:write challenge-widgets.write`) がそろうか。照らすだけで、アカウントが違えば「使わない」と書く
2. Keychain のトークン `sim-bio-local-deploy` が有るか、account `14c725d39e9cf53743be403ab146174f` に届き、D1 の id が wrangler.jsonc と合うか
3. どの道を使うか。トークンの道が使えなければ、はっきり言って止める

## Acceptance criteria

- [x] OAuth のファイルからは `scopes`・`expiration_time` だけを読み、`oauth_token`・`refresh_token` の値は出さない (test_cf_auth.py `test_reads_only_scopes_and_expiry`・`test_oauth_file_tokens_never_reach_the_report`)
- [x] whoami は `--whoami` を付けたときだけ打つ (test_cf_auth.py `test_main_does_not_run_whoami_unless_asked`・`test_main_runs_whoami_when_asked`)
- [x] whoami は環境の `CLOUDFLARE_*` を外して打つ (`test_whoami_sees_only_the_machine_oauth`)。アカウントが違えば「sim-bio の account ではない」、スコープが欠ければその名を出す
- [x] Keychain の項目が無ければ、値を読まずに止め、H11・H12 を指す (`test_missing_keychain_item_stops_without_reading_a_secret`)
- [x] トークンが別のアカウントのものなら止める (`test_token_for_another_account_stops`)
- [x] deploy.py の最初の段と mod.py --remote の最初で同じ関数 (`check_auth`) を呼ぶ。どちらも whoami は打たない
- [x] deploy-runbook.md の最初の手順にし、cloudflare-deploy.md から指す
- [ ] (人) Keychain にトークンを置いてから `! pnpm run cf:auth` が「使う道: Keychain のトークン」で終了 0 になるのを見る

## 作業ログ

- 2026-10-10: 起票 (ユーザーの決定 B)。
- 2026-10-10: 実装。OAuth のファイルは、macOS では `~/Library/Preferences/.wrangler/config/default.toml` (`~/.wrangler` の dir があればそちら。wrangler 4.141 の getGlobalConfigPath と同じ)。`wrangler whoami --json` は期限の切れた OAuth を延ばしてファイルを書き換える (この Mac で expiration_time が変わるのを見た) ので、cf:auth でだけ打つ (`--no-whoami` で外せる)。deploy.py は最初の段で Keychain の項目の有る無しだけを見て、値を読むのは今までどおり `pnpm run check` の後。手順書の「0. 前提の値」の番号は変えず、その前に「最初に」の節を足した。
- 2026-10-10: ユーザーの決定。cf:auth も既定では whoami を打たない (別のアカウントの OAuth のファイルを延ばして書き換えるため)。`--whoami` を付けたときだけ打つ。既定はファイルの scopes・期限だけを読み、アカウントは「分からない」と出す。`--no-whoami` は外した (1 日だけの旗で、既定と同じになったため)。
