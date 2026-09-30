---
id: M25-03
title: 要素ごとの基準画と閾値、審査台で承認する更新の手順。画の 3 行を auto に移す
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-02]
evidence: []
---

# 要素ごとの基準画と閾値、審査台で承認する更新の手順。画の 3 行を auto に移す

優先度: Must

## What to build

ADR 0001 の段 3。画で見る CRG-005・CNF-002・SEL-003 を、基準画との比べに移す。

作るもの:
- shots の各画を要素ごとの画 (clip) でも撮り、Playwright の `toHaveScreenshot` で基準画と比べる。3D の canvas の範囲と DOM の板は別の画にする
- 閾値は `threshold: 0.2`・`maxDiffPixelRatio: 0.02` (ADR の「基準画の閾値」と付録 B の 2)
- 基準画に撮った Chromium の版 (今は chromium-1243) と macOS の版を添える
- 更新の手順: `pnpm run shots -- --update` で前後の画と差の画を審査台 (.claude/localreview) に並べ、人が承認した画だけ基準画を書き換える
- 基準画は手元の Mac だけに置く (2026-10-01 のユーザーの判断 1)。`*.png` は LFS
- 正本の CRG-005・CNF-002・SEL-003 を auto に移し、covered_by を基準画の試験にする

## Blocked by

- M25-02

## Acceptance criteria

- [ ] `.confirm-box` を 2px ずらすと落ち、`* { text-rendering: geometricPrecision }` を足しても落ちない (作業ログに数を写す)
- [ ] 審査台に前後と差の画が出て、承認すると基準画が書き換わり、承認しないと変わらない
- [ ] 続けて 2 回回して 2 回目が通る
- [ ] CI (ubuntu) では基準画の比べが回らない (`pnpm run test:e2e` の数と時間が変わらない)
- [ ] `uv run scripts/acceptance.py check` が通り、round の human の行の minutes の和が 9 になる

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 3)
