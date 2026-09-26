---
id: M19-02
title: Cloudflare 配信
status: todo
milestone: M19
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M21-01, M21-02, M21-03, M19-03]
evidence: []
---

# Cloudflare 配信

## What to build

静的ビルドを Cloudflare に配信し、ログの受け口(Worker)が JSON を受けて保管する。

## Blocked by

M21-01, M21-02, M21-03, M19-03

## Acceptance criteria

- [ ] wrangler の設定と配信スクリプト。ビルド成果物がそのまま配信される
- [ ] ログ受け口の Worker が POST を受けて保存し、不正な形を 400 で返す(単体テスト)
- [ ] 配信手順を README に
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 2026-09-26 設計書(docs/design/2026-09-26-cloudflare-architecture.md)に合わせた方針: Workers Static Assets で配り、港の Worker と同じ 1 本に同梱する(`/api/*` だけ fetch handler、SPA の fallback は Worker を起こさない)。配備は GitHub Actions(lfs: true)から `wrangler deploy`。`.assetsignore` で `*.blend` と `textures/concept/**` を配らない。ログの受け口は Workers Logs に書く(「保管」は D1 ではなく Workers Logs の 7 日)。港の API は M19-08 以降、構成検査は M19-12。
