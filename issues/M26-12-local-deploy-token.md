---
id: M26-12
title: 手元からの配備 (Keychain のトークンで scripts/deploy.py) を使えるようにする
status: review
milestone: M26
plan: docs/operations/deploy-runbook.md
depends_on: []
evidence: []
---

# 手元からの配備を使えるようにする (保留)

優先度: Could

## What to build

2026-10-05、手元の wrangler の OAuth が別のプロジェクトのアカウントで、D1 のマイグレーションが 7403 で止まった。端末に依らない配備として、主の道 (GitHub Actions の deploy.yml) と予備の道 (`scripts/deploy.py`、Keychain のトークンを環境で wrangler に渡す) を docs/operations/deploy-runbook.md に書いた。

ユーザーの決定 (2026-10-06): 主の道を先に整える。**手元からの配備は保留で積む。**

再開するときにやること:
1. (人) H11: 手元用のトークン `sim-bio-local-deploy` をダッシュボードで作る (docs/operations/cloudflare-api-token.md の型)
2. (人) H12: `! security add-generic-password -s sim-bio-local-deploy -a "$USER" -w` で Keychain に置く
3. (人) `! pnpm run deploy --dry-run` → `! pnpm run deploy` を 1 回通す。Workers Editor (biotope-island だけ) + D1 Edit で `wrangler deploy` が通るかを確かめる (未確認)
4. 端末の OAuth に頼る他の道 (`scripts/mod.py --remote`・`wrangler tail`・`wrangler d1 execute --remote`・`wrangler secret put`) を同じ Keychain の道にするか決める (deploy.py の部品を使い回せる)

## Acceptance criteria

- [x] 手元から 1 回配り、版の id と smoke (`/` 200、`/api/v1/chronicles` JSON) を作業ログに書く
- [ ] 端末の OAuth に頼る他の道の扱いが決まっている

## Blocked by

- ユーザーの判断 (2026-10-06「保留で積む」)

## 作業ログ

- 2026-10-06: 起票 (保留)。
- 2026-10-10: 4 の決定。`scripts/mod.py --remote` は Keychain の道にした (M26-16)。手順書とスクリプトの最初に資格情報の照合 `pnpm run cf:auth` を入れた (M26-17)。
- 2026-10-11: ユーザーの決定「保留のままでいい」。H11・H12 (Keychain の sim-bio-local-deploy) は作らない。配備は GitHub Actions の deploy.yml だけ。手元の `pnpm run cf:auth`・`pnpm run deploy`・`mod.py --remote` はトークンが無いので落ちる (承知の上)
- 2026-10-11: H11・H12 をユーザーが済ませた (Keychain の sim-bio-local-deploy)。`pnpm run cf:auth` 通過 (account 14c725d3… に届き、D1 biotope-harbor の id が合う。使う道: Keychain のトークン)。保留を解く
- 2026-10-11: ユーザーの許可で main (8052830、PR #8 まで) を手元から配った (AI の端末からは auto mode が止めたので、ユーザーが `! pnpm run deploy`)。Keychain のトークンで照合 → build → 無料枠の検査 違反なし → マイグレーション 無し → deploy。版 ad1e5e74-8d3a-4b48-b51f-7a270cde7136 (前は f8ee7c1a)。smoke: `/` ok・`/api/v1/chronicles` JSON、すべて通った。残りは「端末の OAuth に頼る他の道の扱い」
