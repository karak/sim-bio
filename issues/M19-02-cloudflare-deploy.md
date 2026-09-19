---
id: M19-02
title: Cloudflare 配信
status: todo
milestone: M19
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# Cloudflare 配信

## What to build

静的ビルドを Cloudflare に配信し、ログの受け口(Worker)が JSON を受けて保管する。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] wrangler の設定と配信スクリプト。ビルド成果物がそのまま配信される
- [ ] ログ受け口の Worker が POST を受けて保存し、不正な形を 400 で返す(単体テスト)
- [ ] 配信手順を README に
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

