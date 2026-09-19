---
id: M8-04
title: 文明の表示
status: done
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-02]
evidence: ["a942548 tests/unit/ui.tablet.test.ts tests/unit/render.settlement.test.ts tests/e2e/smoke.spec.ts"]
---

# 文明の表示

## What to build

集落に段階の数だけ箱が積まれて見え、HUD に段階・進み・民が出て、石板の年表に段階の上下が並ぶ。

## Blocked by

M8-02

## Acceptance criteria

- [x] SceneView: 集落の InstancedMesh、段階で高さが変わる(スナップショットから描く。文明なしでは何も出ない)
- [x] HUD: 「文明 塔(6)・進み 40%・民 12」。文明なしでは行が出ない
- [x] 年表: sim.civ.stage を runner の timeline に積む(段階の上下)
- [x] E2E: start.civilization 付きの試し読みシナリオで HUD に文明の行が出る

## 作業ログ

- 2026-09-20: 実装・検証完了。集落の箱は `src/render/settlement.ts` の純粋関数 `settlementInstances(civ, size)` で判定し `src/render/SceneView.ts` の InstancedMesh に反映。HUD は `src/ui/Hud.ts` の `formatCiv(civ)` と `#hud-civ`。年表は `src/scenario/ScenarioRunner.ts` の `TimelineEvent` に `civ_stage` を追加し、`src/ui/Tablet.ts` の `describeEvent` で文にした。隠しシナリオ `test-civ` (assets/data/scenarios.json) で E2E 確認。M8-02 (feat/m8 合流) の本実装に差し替え済み。typecheck/lint/vitest(165 件)/playwright(11 件) すべて green。commit a942548。

