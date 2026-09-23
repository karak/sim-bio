---
id: M23-03
title: 海の分割の作り直し
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-01]
evidence: []
---

# 海の分割の作り直し

## What to build

海は 3 km 四方を 240 × 240(1 目 12.5 m、115 千三角形)で割っている。区域の近く(水際の水深と泡の帯)は今より細かく、遠くは粗い格子(同心の輪か、近くの細かい格子 + 外の粗い輪)にする。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

M23-01

## Acceptance criteria

- [ ] 海の三角形が 15 千以下
- [ ] 水際の泡の帯・水深の色・沈降で上がる海面(setLevel)が今と同じか良い(前後の比較画)
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
