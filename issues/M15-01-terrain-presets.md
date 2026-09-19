---
id: M15-01
title: 地形プリセット(双子島・火山島)
status: todo
milestone: M15
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# 地形プリセット(双子島・火山島)

## What to build

シナリオが地形の型を選べる。双子島は細い地峡でつながる 2 つの島、火山島は中央に高い火山。既定は今の島のまま。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] ScenarioDef.start.terrain に preset。双子島は陸の連結成分が 1 で、地峡の幅が N セル以下(性質テスト)。火山島は中央の標高が最大
- [ ] 既定(preset なし)は今と同じ地形(既存の決定論テストが通る)
- [ ] 石板のシナリオ選択で地形の説明が出る(E2E)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

