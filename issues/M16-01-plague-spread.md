---
id: M16-01
title: 密度依存の疫病伝播
status: todo
milestone: M16
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# 密度依存の疫病伝播

## What to build

災害「疫病」が一点から始まり、動物の密度が高いほど、湿潤なほど速く隣へ広がる。密度を下げれば止まる。既存の半径一括の疫病は残す。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 疫病層(感染度)が隣接へ伝播し、密度 × 湿度に比例して強くなる。密度が閾値未満のセルでは消える(単体テスト)
- [ ] 感染セルの動物が減る。既存の plague コマンドは変えず、新コマンド outbreak { cell } を足す(既存テストが通る)
- [ ] レイヤーで疫病が見える。tick.summary に infected
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

