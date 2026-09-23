---
id: M23-06
title: 木の遠距離版(インポスター)
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-04]
evidence: []
---

# 木の遠距離版(インポスター)

## What to build

鐘樹と森の木に、60 m より先の段として 2 桁少ない形(数方向から焼いた板のインポスター、8〜20 三角形)を足す。鐘の灯り(夜)と葉の色の揺らぎが遠目で変わらないこと。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

M23-04

## Acceptance criteria

- [ ] 林の画の鐘樹の三角形が試算(−95 千)の 8 割以上減る
- [ ] 遠景の林の見た目が変わらない(前後の比較画、朝・夕・夜)
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
