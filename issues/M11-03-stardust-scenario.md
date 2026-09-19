---
id: M11-03
title: 「星砂の毒」の校正
status: todo
milestone: M11
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M11-02]
evidence: []
---

# 「星砂の毒」の校正

## What to build

20 年ごとに隕石群が落ち、星砂が積もる。石喰いを根付かせて星砂を閾値未満に保ち、植生率を保つ。予算付きで判定行列を固定する。

## Blocked by

M11-02

## Acceptance criteria

- [ ] scenarios.json に星砂の毒(予定の隕石群、予算、節目、alive: 植生率 ≥ 、dead: 植生率 < 5%)
- [ ] tests/slow: 放置 dead、石喰いを最後に放つだけ dead、森を放つだけ dead、想定解 2 つ alive
- [ ] 設計書に係数と校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

