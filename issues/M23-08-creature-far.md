---
id: M23-08
title: 動物の遠距離版
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-02]
evidence: []
---

# 動物の遠距離版

## What to build

群れの遠い段(VAT、月鹿 約 900 三角形)の先に、2 桁少ない段(約 60〜100 三角形)を足す。集落の画では動物は画面の中で 8 千と小さいので、群れが大きい画(群れの寄りの引き)で効くかを M23-01 で確かめてから進める。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

M23-02

## Acceptance criteria

- [ ] 群れの画で動物の三角形が半分以下
- [ ] 遠目の歩き・食むの動きが読める
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
