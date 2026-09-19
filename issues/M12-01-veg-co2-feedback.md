---
id: M12-01
title: 植生→気温・CO2→気温
status: todo
milestone: M12
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# 植生→気温・CO2→気温

## What to build

設計書のスロット(vegetationToTemp, co2ToTemp)に係数を入れ、森が多いと気温が下がり、CO2 が増えると上がる。既定の係数では今の振動と 5 本のシナリオが変わらない。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 係数 > 0 で森の総量が多い年ほど平均気温が下がる。co2 が増えると上がる(単体テスト)
- [ ] 既定の係数(小さい値)で振動テストと通し実行が変わらない
- [ ] 設計書 §2 の決定に追記
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

