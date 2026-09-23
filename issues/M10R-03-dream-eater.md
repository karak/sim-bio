---
id: M10R-03
title: 夢喰い(M17-02 の前倒し、状態機械の影)
status: done
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#33-夢喰い生物m17-02-の前倒しm10r-03
depends_on: [M10R-02]
evidence: ["5ee76c1 tests/unit/dreamEater.test.ts", "5ee76c1 tests/unit/world.dreamEater.test.ts", "5ee76c1 tests/unit/render.dreamEaterShade.test.ts", "5ee76c1 tests/unit/scenario.judge.test.ts", "5ee76c1 tests/unit/ui.hud.test.ts"]
---

# 夢喰い(M17-02 の前倒し、状態機械の影)

## What to build

LD §3.3。上限 < 0.3 かつ段階 ≥ 歌で集落に影が現れ、毎年支え半径内の民を 20% 減らし進みを止める。上限 ≥ 0.5 で去る。
ログ `sim.civ.dream_eater`、年表・HUD の行、SceneView の影、保存、判定条件 `dream_eater`。M17-02 は種としての本体に残す。

## Blocked by

M10R-02

## Acceptance criteria

- [x] 純粋関数(出現/捕食/退去)が単体テストで確かめられる。World で出現中は民が減り progress が進まない。save/restore で往復
- [x] 判定条件 dream_eater が judge で使え、dead の理由文に「夢喰い」が出る
- [x] HUD・石板・SceneView に出る(内容検証のテスト)。E2E が通る
- [x] npm run check と単体・E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 2026-09-23 00:59: sonnet の worktree で実装(5ee76c1)。影は World の別状態(ship/towers と同じ)。出現した年は進みが乗り翌年から凍結。単体 502・E2E 21 通過。
