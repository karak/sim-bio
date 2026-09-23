---
id: M22-03
title: 観察区域の地形・海岸・植生
status: todo
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-02]
evidence: []
---

# 観察区域の地形・海岸・植生

## What to build

区域(半径 8)の高解像度の地面(セルの標高を補間 + 起伏)、地面の質感(草地・土・岩・砂・浅瀬)、海と沈む海岸、草・月草・苔・森の木・鐘樹を密度から配置する。区域外は遠景。

## Blocked by

M22-02

## Acceptance criteria

- [ ] 地面・海岸・植生が基準画(sheet-terrain / sheet-flora / sheet-belltree)との比較画で合格
- [ ] 沈降で海岸線が動き、植えた鐘樹が芽吹く(本体の密度に従う)
- [ ] 予算内で 60fps

## 作業ログ

## 作業ログ(2026-09-24)

- 植物のアセット: `flora.glb` に `forest_tree` 1,740 / `forest_tree_lod1` 579 / `moongrass_tuft_seed` 52 / `fern` 80 / `flower_patch` 67 三角形を足した。鐘樹の鐘を裾の開いた暗い青銅 + 明るい口に直した(成木 3,952、lod1 1,112)。
- 比較画: `docs/design/qa/observe/{flora2,flora2_small,belltree,shipyard}.png`、記録は `docs/design/qa/observe/keyitems.md`。地形・海岸・配置は未着手。
