---
id: M26-12
title: 手元からの配備 (Keychain のトークンで scripts/deploy.py) を使えるようにする
status: blocked
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

- [ ] 手元から 1 回配り、版の id と smoke (`/` 200、`/api/v1/chronicles` JSON) を作業ログに書く
- [ ] 端末の OAuth に頼る他の道の扱いが決まっている

## Blocked by

- ユーザーの判断 (2026-10-06「保留で積む」)

## 作業ログ

- 2026-10-06: 起票 (保留)。
