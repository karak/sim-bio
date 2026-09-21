---
id: M9-01
title: 信仰の値
status: done
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M8-02]
evidence: ["40bd5c0 tests/unit/faith.test.ts", "40bd5c0 tests/unit/world.civilization.faith.test.ts", "40bd5c0 tests/unit/ui.hud.test.ts", "40bd5c0 tests/unit/scenario.budget.test.ts", "40bd5c0 tests/unit/ui.tablet.test.ts", "40bd5c0 tests/e2e/smoke.spec.ts"]
---

# 信仰の値

## What to build

文明を持つ種が信仰を持つ。同じ種類の介入を繰り返す(予測可能)と上がり、種類がばらつく介入や災害で下がり、何もしなければゆっくり減衰する。値が HUD に出て、大きく動いた年は年表に並ぶ。

## Blocked by

M8-02

## Acceptance criteria

- [x] 純粋関数で信仰を更新する。同じ種類のコマンドが 10 年内に 3 回続くと上がり、直近 10 年で 3 種類以上のコマンドが混ざると下がる。災害は必ず下げる(単体テスト、境界値つき)
- [x] 介入がなければ年ごとに一定率で減衰し 0 未満・1 超にならない(性質テスト)
- [x] 文明のない世界では信仰の値も表示も存在しない(既存テストが変わらない)
- [x] HUD の文明の行に「信仰 0.62」が出る。snapshot と保存データに含まれ、serialize→restore で一致する
- [x] ログ sim.civ.faith を年 1 回、年表に ±0.1 以上動いた年だけ出す
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 純粋関数 `src/simulation/faith.ts`(`commandKey`/`updateFaith`)に係数を切り出し、`CivState.faith?: number` を追加(既存セーブ・テストと互換)。
- `World` が `dispatch` で civ ありのときだけコマンドキーを年次配列に積み、`stepCivYearly` で直近 10 年分の履歴から `updateFaith` を呼ぶ。stage ≥ 1 になった最初の年は `FAITH_INITIAL` で生まれ、年 1 回 `sim.civ.faith`({ year, faith, delta })を出す。
- `ScenarioRunner` が前年との |Δ| ≥ 0.1 で `civ_faith` を年表に積み、`Tablet.describeEvent` と `Hud.formatCiv` が「信仰 0.62」の形で表示する。
- TDD: `faith.test.ts`(純粋関数・境界値・性質テスト)→ `world.civilization.faith.test.ts`(配線)→ `scenario.budget.test.ts`/`ui.tablet.test.ts`/`ui.hud.test.ts`(年表・表示)→ `smoke.spec.ts`(E2E)の順に赤→緑で実装した。

