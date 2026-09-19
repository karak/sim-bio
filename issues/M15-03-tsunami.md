---
id: M15-03
title: 津波
status: todo
milestone: M15
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M15-01]
evidence: []
---

# 津波

## What to build

沿岸 N セルを洗う津波が予定命令で起きる。植物と動物が流され、枯死が積まれる。前兆(海の主が去る)は M17 で足す。

## Blocked by

M15-01

## Acceptance criteria

- [ ] コマンド disaster { kind: tsunami, reach } で海岸から reach セル以内の陸の種が 0 になり、枯死に積まれる(単体テスト)
- [ ] HUD の災害列に津波チップ。年表とログ
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

