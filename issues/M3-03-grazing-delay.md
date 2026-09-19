---
id: M3-03
title: 草の回復遅れ
status: todo
milestone: M3
plan: references/games/stage-design-ideas.md
depends_on: [M3-02]
evidence: []
---

# 草の回復遅れ

## What to build

食べられたセルの植物がすぐ回復しないようにする。摂食量を grazed レイヤーに積み、植物の成長率を grazed に応じて下げ、grazed は一定 tick で減衰する。NetLogo Wolf-Sheep の grass-regrowth-time に相当。

## Blocked by

M3-02

## Acceptance criteria

- [ ] tests/unit/vegetation.test.ts: 食べられた直後のセルは同条件の未被食セルより成長が遅く、R tick 後に同じ速度に戻る
- [ ] world.oscillation.test.ts が通り続け、振幅比が M3-02 時点より下がらない
- [ ] serialize/restore に grazed が含まれる(world.save.test.ts)

## 作業ログ

