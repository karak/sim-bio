---
id: M8-03
title: 文明の負荷と崩壊
status: todo
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-02]
evidence: []
---

# 文明の負荷と崩壊

## What to build

段階が上がるほど集落の周りで森が伐られ生気が吸われる。民が段階の必要量を割るか生気が尽きると段階が下がり、巣を割れば崩壊する。

## Blocked by

M8-02

## Acceptance criteria

- [ ] 負荷: 集落半径内の森が減り枯死に積まれ、生気が減る。半径と量が段階で増える(単体)
- [ ] 衰退: population < POP_NEED または生気平均 < 0.1 で stage −1、stage 1 → 0 で sim.civ.collapsed(単体)
- [ ] 塔(stage 6)の島を 100 年放置すると森が開始の 3 割を割る(校正の当たり。数値は作業ログに)
- [ ] 他の 5 本のシナリオと振動テストが変わらない

## 作業ログ

