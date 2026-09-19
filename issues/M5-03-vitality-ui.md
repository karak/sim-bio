---
id: M5-03
title: 生気の表示と保存
status: todo
milestone: M5
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M5-01]
evidence: []
---

# 生気の表示と保存

## What to build

レイヤー切替に「生気」を追加(暗→光る青緑)。セル詳細に生気と枯死を表示。胞子苔の描画アセット(平たい円盤)。

## Blocked by

M5-01

## Acceptance criteria

- [ ] tests/unit/render.layerToColors.test.ts: vitality レイヤーが size²×3 を返し、生気が高いほど明るい
- [ ] E2E: 生気レイヤーのチップを押すと on になる

## 作業ログ

