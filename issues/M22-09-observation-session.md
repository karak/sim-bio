---
id: M22-09
title: 観察セッション(手動受入)
status: todo
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-03, M22-05, M22-06, M22-07, M22-08]
evidence: []
---

# 観察セッション(手動受入)

## What to build

実際の空の舟を 1 回通して観察し、4 つの場面が出ることと「10 分見ていられるか」を確かめる。

## Blocked by

M22-03, M22-05, M22-06, M22-07, M22-08

## Acceptance criteria

- [ ] 4 場面(舟が育つ・飛び立ち・種を放ったあと・滅び)が実プレイで出た記録
- [ ] 10 分の観察の所感と直した点
- [ ] デスクトップ Chrome で 60fps の計測

## 作業ログ
- 2026-09-24 4 場面の引き金を実プレイで確認(自動): `tests/slow/observe.scenes.test.ts`(SLOW=1、95 秒)。想定解 1 で 舟の 6 段(keel→done)・飛び立ち・芽吹き・霧・結末 escaped、放置で 沈む・結末 dead。画としての確認と 10 分の観察の所感は手動(ユーザー)。
