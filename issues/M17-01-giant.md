---
id: M17-01
title: 巨人
status: todo
milestone: M17
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M13-01, M9-01]
evidence: []
---

# 巨人

## What to build

高地の霊脈上に巨人が眠る。地震(予定命令)で目覚め、島を横切って道の森を倒す。信仰が高いと眠り続ける。

## Blocked by

M13-01, M9-01

## Acceptance criteria

- [ ] 巨人は特殊枠の実体(セル位置と状態)。地震コマンドで信仰 < 閾値なら目覚め、年ごとに N セル進み、通った道の森を 0 にして枯死に積む。反対岸に着くと眠る(単体テスト)
- [ ] 信仰 ≥ 閾値なら地震でも目覚めない(単体テスト)
- [ ] SceneView に巨人、年表に「巨人が目覚めた/眠った」、保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

