---
id: M17-03
title: 海の主
status: todo
milestone: M17
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M15-03, M17-00]
evidence: []
---

# 海の主

## What to build

海の主が海岸に養分を運び、沿岸の生気を上げる。海が温まりすぎると去り、去った年は津波の前兆になる。

## Blocked by

M15-03, M17-00

## Acceptance criteria

- [ ] 海の主の状態(いる/去った)。いる間は海岸セルの生気が毎年上がる。平均気温が閾値を超えると去る(単体テスト)
- [ ] 去った年に警告 sea_lord_left。「大津波の年」の予定津波の 5 年前に去るよう校正(通し実行が通る)
- [ ] 年表とログ、保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

