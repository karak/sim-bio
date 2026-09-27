---
id: M3-04
title: セル・地域の時系列グラフ
status: done
milestone: M3
plan: references/games/stage-design-ideas.md
depends_on: []
evidence: ["c9033cf", "tests/unit/ui.timeSeries.test.ts", "tests/e2e/smoke.spec.ts"]
---

# セル・地域の時系列グラフ

## What to build

島全体の合計だけでなく、クリックしたセルの周辺(半径 3)の種密度を時系列で表示する。合計では相殺される局所の波を見えるようにする。サンプリングは 10 tick ごと、直近 5 年分。

## Blocked by

なし(すぐ着手可)

## Acceptance criteria

- [ ] tests/unit/ui.timeSeries.test.ts: tick 単位のサンプリングと容量が正しい(既存 TimeSeries を流用)
- [ ] セルをクリックすると 2 本目のグラフに周辺密度の時系列が出て、選択解除で消える
- [ ] E2E: セルをクリックすると #local-graph が表示される

## 作業ログ

