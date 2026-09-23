---
id: M10R-06
title: 手動受入プレイテスト(M10R)
status: done
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#4-ループ
depends_on: [M10R-05]
evidence: ["b5ae7b5 tests/slow/scenarios.playthrough.test.ts", "7eff673 レビュー修正", "docs/specs/plans/2026-09-23-m10r-playtest.md"]
---

# 手動受入プレイテスト(M10R)

## What to build

ビルド済みで祈りに応えるな・空の舟・迎撃の塔を 1 回ずつ遊び、docs/specs/plans に記録する(M9/M10 と同じ書式)。

## Blocked by

M10R-05

## Acceptance criteria

- [x] 3 本とも記録があり、少なくとも 1 回は負けて理由が石板の文言で分かる
- [x] 見つけた表示の不具合は直してテストを足す。evidence に commit SHA と記録のパスを記す

## 作業ログ
- 2026-09-23 11:25: 迎撃 1 回 alive、舟 2 回 dead(帆を失う。想定解は UI で再現不能 → M10R-08)。記録 docs/specs/plans/2026-09-23-m10r-playtest.md。
