---
id: M26-04
title: 開発の板 (?dev=1) が「新しい島」の口を覆う
status: open
milestone: M26
plan: null
depends_on: []
evidence: []
---

# 開発の板 (?dev=1) が「新しい島」の口を覆う

優先度: Should

## What to build

ADR 0001 の付録 B で見つけた欠陥。`?dev=1` の開発の板 (`src/dev/panel.ts`、右下 250 px・z-index 40) が HUD の「新しい島」(自由モード) の口を覆い、押せない。

やること:
1. 覆いを 5 点で見る試験を `tests/e2e/uncovered.spec.ts` に足して落ちるのを見る (`expectAllRowsUncoveredAtFivePoints` の流儀)。1280×720 と 1024×640 で
2. 直す: 板を畳める / 位置をずらす / 「新しい島」の列を避ける、のどれかをこの票で決める。製品 (dev 無し) の見た目は変えない
3. lens (`pnpm run shots`) の HBR-006・TUR-001 は `?dev=1` で撮っているので、基準画が変わるなら回を出す (承認はユーザー待ち)

## Blocked by

- なし

## Acceptance criteria

- [ ] uncovered.spec に「開発の板は『新しい島』を覆わない」があり通る
- [ ] `pnpm run check`・uncovered・shots を含む E2E が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 5)。
