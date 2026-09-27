---
id: M19-11
title: 予言ごとの回避率
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-08]
evidence: []
---

# 予言ごとの回避率

優先度: Could(設計書のドライバの優先度)

## What to build

B6。シナリオを終えたら 1 回数え(D1 の集計の加算)、予言ごとの回避率を石板に見せる。検証できない数なので順位は作らない。

## Blocked by

M19-08

## Acceptance criteria

- [ ] 報告と取得の単体テスト、日次予算の内で数える
- [ ] 石板に「この予言を越えた見守り手は N%」(閉港時は出さない)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
