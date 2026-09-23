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
