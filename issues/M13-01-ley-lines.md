---
id: M13-01
title: 霊脈の線
status: todo
milestone: M13
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M8-01]
evidence: []
---

# 霊脈の線

## What to build

地形生成で島の下に数本の霊脈が走る。線上のセルは生気の減衰が遅く、輝石は線の交点に眠る(M8 の塊を置き換える)。レイヤー「霊脈」で見える。

## Blocked by

M8-01

## Acceptance criteria

- [ ] 同じ seed で同じ線。線は 2〜4 本、陸を横切り、交点が 1 つ以上ある(性質テスト)
- [ ] 線上のセルは漏出が半分(単体テスト)。輝石は交点の周りにだけ置かれ、M8 の塊の生成は削除。M8 のテストと塔の重さの通し実行が通る(輝石の総量は同程度に校正)
- [ ] LayerKind leyline の着色テスト、E2E でチップ、保存で一致
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

