---
id: M23-05
title: 草の遠距離版
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-02]
evidence: []
---

# 草の遠距離版

## What to build

草は 30 m より先が 84%。30 m から先は 1 房 36 三角形の代わりに 2 三角形の板(房の絵を焼いた板、または縦の十字 2 枚)にし、さらに遠くは地面の色に溶かして描かない。切り替わりは房ごとの乱数でずらし、境目の輪が見えないようにする。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

M23-02

## Acceptance criteria

- [ ] 集落の画の草の三角形が M23-02 の後からさらに 6 割以上減る
- [ ] 切り替わりの境目が見えない(カメラを前後に動かした比較)
- [ ] 兎が草の上に見える(試作 2 の判断)
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
