---
id: M8-04
title: 文明の表示
status: in_progress
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-02]
evidence: []
---

# 文明の表示

## What to build

集落に段階の数だけ箱が積まれて見え、HUD に段階・進み・民が出て、石板の年表に段階の上下が並ぶ。

## Blocked by

M8-02

## Acceptance criteria

- [ ] SceneView: 集落の InstancedMesh、段階で高さが変わる(スナップショットから描く。文明なしでは何も出ない)
- [ ] HUD: 「文明 塔(6)・進み 40%・民 12」。文明なしでは行が出ない
- [ ] 年表: sim.civ.stage を runner の timeline に積む(段階の上下)
- [ ] E2E: start.civilization 付きの試し読みシナリオで HUD に文明の行が出る

## 作業ログ

