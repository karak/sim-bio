---
id: M22-06
title: 集落と舟(5 段階・飛び立ち)
status: todo
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-02]
evidence: []
---

# 集落と舟(5 段階・飛び立ち)

## What to build

遺構に手を入れた集落の部品と、舟の建造 5 段階(竜骨・肋・板・帆・完成)と飛び立ちを作る。進み 0〜120 に段階を対応させる。

## Blocked by

M22-02

## Acceptance criteria

- [ ] 比較画が合格
- [ ] 舟の進みで段階が変わり、完成と飛び立ち(launchedYear)で浮上して水平線へ去る
- [ ] 帆を失うと灯りが消え工事が止まる

## 作業ログ

## 作業ログ(2026-09-24)

- 舟のアセット: `tools/blender/observe_ship.py` → `assets/models/observe/ship.glb`。段ごとに 1 ノード(`ship_keel` 412 / `ship_ribs` 1,792 / `ship_planks` 1,968 / `ship_mast` 2,496 / `ship_sails` 3,928 / `ship_flying` 3,906 三角形)と `timber_pile` 516。
- 集落に `woven_screen` 360・`stone_wall_corner` 680 を足し、`lantern_post` の灯籠に格子(368 → 512)。
- 比較画: `docs/design/qa/observe/{ship,ship-stages,shipyard}.png`、記録は `docs/design/qa/observe/keyitems.md`。ゲーム側の段の切り替え・浮上・灯りが消える演出は未着手。
