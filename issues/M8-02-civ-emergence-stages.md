---
id: M8-02
title: 文明の発生と段階
status: todo
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-01]
evidence: []
---

# 文明の発生と段階

## What to build

config で知性種を指定した島で、その種が安定して餌に余剰があると集落が生まれ(巣)、集落の周りの輝石を掘って段階が上がる。輝石が尽きれば上がらない。snapshot に文明の状態が入り、発生・段階変化がログに出る。

## Blocked by

M8-01

## Acceptance criteria

- [ ] stepCivilization(純粋関数): 振幅比 < 0.15 かつ集落候補の植生 > 0.4 で stage 1。振動している種では発生しない(単体)
- [ ] 掘った輝石の分だけ progress が増え、NEED を超えると stage +1。輝石 0 なら止まる(単体)
- [ ] World: config.civilization があるときだけ動く。既定の世界とテストの世界では文明なし(既存テストが変わらない)
- [ ] ログ sim.civ.emerged / sim.civ.stage。tick.summary に civStage
- [ ] シナリオの start.civilization で初期段階と集落を上書きできる

## 作業ログ

