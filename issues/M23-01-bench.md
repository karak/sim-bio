---
id: M23-01
title: 計測の台(6 画の内訳と fps)
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: []
evidence: []
---

# 計測の台(6 画の内訳と fps)

## What to build

観察画面の試作ページを Playwright で開き、寄せ先の 6 画(集落・船台・群れ・林・狼・海岸、空の舟 25 年目、朝、時間を止める)を回って `__observeStats`(三角形・draw call・fps)と `__observeBreakdown()`(区分ごとの内訳)を JSON に書く。軽量化の各チケットの前後の比較に使う。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

なし

## Acceptance criteria

- [ ] `npm run bench:observe`(仮)で 6 画の JSON が書かれる(ファイルは scratchpad かコミットしない場所)
- [ ] 同じ条件で 2 回走らせて三角形と draw call が一致する(fps は幅を残す)
- [ ] 前後の 2 つの JSON を並べて差を出す小さな表示(表で可)
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
