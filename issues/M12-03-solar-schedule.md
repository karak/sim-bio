---
id: M12-03
title: 日射の時間変化
status: todo
milestone: M12
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M12-01]
evidence: []
---

# 日射の時間変化

## What to build

シナリオの予定命令で太陽が暗く/明るくなり、基準気温が年ごとに変わる。石板の節目と警告に出る。

## Blocked by

M12-01

## Acceptance criteria

- [ ] コマンド set_solar { offset } と、毎年少しずつ変える予定(everyYears)で基準気温が単調に動く(単体テスト)
- [ ] tick.summary に solarOffset。警告 temperature_extreme(平均気温が閾値外)
- [ ] 保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

