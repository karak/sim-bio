---
id: M10-04
title: 手動受入プレイテスト(M10)
status: done
milestone: M10
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M10-01, M10-02, M10-03]
evidence: ["2e22bc7 docs/specs/plans/2026-09-22-m10-playtest.md", "2e22bc7 tests/unit/scenario.warnings.test.ts tests/e2e/smoke.spec.ts", "2e22bc7 docs/design/2026-09-19-proposal.html docs/specs/2026-09-19-ecosystem-sim-design.md#6"]
---

# 手動受入プレイテスト(M10)

## What to build

「迎撃の塔」「空の舟」を 3 回遊んで記録する。

## Blocked by

M10-01, M10-02, M10-03

## Acceptance criteria

- [x] プレイ記録 3 回分(うち 1 回以上 dead)
- [x] 表示の問題を直し E2E が通る
- [x] 設計書 §6 と企画書に反映
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-09-22: 3 回遊んだ(迎撃の塔 alive、空の舟 森だけ dead、空の舟 鐘樹 escaped)。直した表示: 舟の行を逃がす石板だけに、[hidden] を display より優先(勅令・迎撃・舟の行が見えたままだった)、舟の警告 2 つ。単体 442、E2E 21(2e22bc7)。
