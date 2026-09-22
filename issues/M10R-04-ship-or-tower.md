---
id: M10R-04
title: 舟か塔か(材の天秤)と乗せる民
status: todo
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#34-舟か塔か舞台装置の改訂m10r-04
depends_on: [M10R-01]
evidence: []
---

# 舟か塔か(材の天秤)と乗せる民

## What to build

LD §3.4。年の順序を「舟が先に伐り、塔はその残りから燃料を取る」に変える。完成時に乗せる民
`populationFor(LOAD_RADIUS[帆]) ≥ SHIP_CREW`(初期 0.6)を要し、足りなければ待つ(警告 ship_waiting に理由を足す)。
空の舟の薪の蓄えを 0 にするのは M10R-05 の校正で。

## Blocked by

M10R-01

## Acceptance criteria

- [ ] 舟の伐採の後に燃料を取ることが単体テストで確かめられる(同じ木で舟が進むと塔の燃料が減る)
- [ ] 民が足りない完成済みの舟は飛ばず、ログと警告に「民が足りない」が出る。増えれば飛ぶ
- [ ] HUD・石板の文言(内容検証のテスト)。E2E が通る
- [ ] npm run check と単体・E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
