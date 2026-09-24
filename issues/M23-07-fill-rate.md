---
id: M23-07
title: 塗りの負荷の計測と調整
status: todo
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-01]
evidence: []
---

# 塗りの負荷の計測と調整

## What to build

三角形とは別に、画素の負荷(ピクセル比 2 まで、4× MSAA の半精度の描画先、空気の光線を全画素で進める)を GPU の時間で測る(EXT_disjoint_timer_query_webgl2 が使えれば)。効くものから、光線の半分の解像度・MSAA の段・ピクセル比の上限・動的な解像度を比べる。

別の worktree で進め、終わったら feat/m21 へ取り込む(ユーザーの指示「一連の軽量化は worktree を分けて実施」)。

## Blocked by

M23-01

## Acceptance criteria

- [ ] GPU の時間の内訳(本の描画・影・空気・色調)を記録する
- [ ] 60 fps を下回る環境の想定(ピクセル比 2 の画面)で 60 fps を保つ設定が決まる
- [ ] 見た目の差は比較画で確かめる
- [ ] M23-01 の台で 6 画の三角形・draw call・fps の前後を作業ログに残す

## 作業ログ
- 2026-09-24 (M23-06 の作業で見つかった前からの不具合) `observe.html?shadow=0` は空気の層(air)が有効だと真っ黒になる(`air=0` なら描ける)。atmosphere.ts が影の地図を前提にしている。塗りの負荷を測るときに影なしの計測が要るなら、ここで直す
