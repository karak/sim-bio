---
id: M2-03
title: 肉食獣 1 種(狼)を追加
status: done
milestone: M2
plan: docs/specs/2026-09-19-ecosystem-sim-design.md#m2-3-階層--種を放つ
depends_on: [M2-02]
evidence: ["25aecac", "tests/unit/world.trophic.test.ts"]
---

# 肉食獣 1 種(狼)を追加

## What to build

狼が鹿を食べる。グラフに植物・草食獣・肉食獣の位相のずれた 3 本の波が出る。

## Blocked by

M2-02

## Acceptance criteria

- [ ] 性質テスト: 狼を放つと鹿の総量が減る方向に動く
- [ ] 性質テスト: 動物種が絶滅したとき sim.species.extinct が 1 回だけ出る
- [ ] ブラウザで狼が表示され、グラフに 3 本目の線が出る

## 作業ログ

