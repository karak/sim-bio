---
id: M26-01
title: HUD のグラフの描く高さを上げる (68 px → 120 px 前後)
status: open
milestone: M26
plan: null
depends_on: [M25-11]
evidence: []
---

# HUD のグラフの描く高さを上げる

優先度: Should

## What to build

M25-11 で字は読める大きさになったが、描く領域が低い (2026-10-02 の計測: 100 px の板に 68 px の plot。`src/ui/hud.css` の `#local-graph` は 80 px)。ユーザーの決定: 120 px 前後に上げる。

やること:
1. 今の高さを計る (`#local-graph` の CSS、`src/ui/graph.ts` の `renderGraph` の DPR と余白)。作業ログに数字を
2. plot が 120 px 前後になるよう `#local-graph` と余白を変える。字の大きさ (11px/12px) は保つ
3. HUD の下の板の並び (他の札・港の札・#cell-info) に覆いが出ないこと。`tests/e2e/uncovered.spec.ts` と lens (`pnpm run shots`) で確かめる
4. 基準画が変わるなら `pnpm run shots:update` で回を出す (承認はユーザー待ち。審査台の共有ファイルは変えない)

## Blocked by

- なし

## Acceptance criteria

- [ ] plot の高さが 110〜130 px (作業ログに前後の数字)
- [ ] `tests/e2e/uncovered.spec.ts`・shots を含む E2E・`pnpm run check` が通る
- [ ] 前後の画が `.claude/localreview/` の回に出ている

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 3)。
