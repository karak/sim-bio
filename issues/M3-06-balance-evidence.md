---
id: M3-06
title: M3 のバランス確定と証跡
status: todo
milestone: M3
plan: references/games/stage-design-ideas.md
depends_on: [M3-02, M3-03, M3-05]
evidence: []
---

# M3 のバランス確定と証跡

## What to build

species.json と world.default.json を M3 の最終値に固定し、シード 42 で 100 年共存かつ振動が出ることを確認する。設計書 §4/§6 に M3 の差分と証跡を追記する。

## Blocked by

M3-02, M3-03, M3-05

## Acceptance criteria

- [ ] data.test.ts: 100 年共存 + 鹿の年次総量に極大値 ≥ 3
- [ ] ブラウザで 100x で数十年眺めて波が見える
- [ ] 設計書に M3 の差分(handlingTime, grazed, 地形)と証跡 SHA

## 作業ログ

