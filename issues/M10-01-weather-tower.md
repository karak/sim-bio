---
id: M10-01
title: 気象塔
status: in_progress
milestone: M10
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M8-05, M9-03]
evidence: []
---

# 気象塔

## What to build

段階「塔」以上で信仰が足りる文明の島に、見守り手が気象塔を建てられる。輝石と星の力を払い、半径内の雨と気温を局所で変える。維持費が毎年かかり、払えなければ止まる。

## Blocked by

M8-05, M9-03

## Acceptance criteria

- [x] コマンド build_tower { cell, rainScale?, tempOffset? }。段階 < 塔 または 信仰 < 0.6 または 輝石不足なら拒否(単体テスト、cmd.rejected の理由つき)
- [x] 塔の半径内だけ気候が変わり、外は変わらない(単体テスト)。塔は snapshot・保存に含まれる
- [x] 塔の維持費が星の力から毎年引かれ、尽きたら塔が止まる(単体テスト)
- [x] SceneView に塔が立ち、HUD の災害列に「気象塔」チップ、セル詳細に塔の効果(E2E: 建てると年表に出る)
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 2026-09-22: 実装。`src/simulation/weatherTower.ts` を新設し、build_tower/tower_power コマンド、局所気候 (rainFactor/tempFactor)、維持費の自動停止・再開、HUD チップ・セル詳細・SceneView の目印・石板の年表を配線。シナリオ `test-tower` を追加。npm run check(373 テスト)、E2E(19 テスト)通過。設計書 §4.22/§6 に反映。
