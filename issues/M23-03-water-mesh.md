---
id: M23-03
title: 海の分割の作り直し
status: review
milestone: M23
plan: docs/design/2026-09-24-observe-perf.md
depends_on: [M23-01]
evidence: ["ccb0b44 tests/unit/observe.water.test.ts"]
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

- 2026-09-24: 海を段つきの分割に作り直した(`src/observe/render/water.ts` の `buildWaterGeometry`)。地面の窓(半辺 125 m)は 1 辺 72 分割(3.47 m 目、10,368 三角形)、その外は正方形の輪 11 本で 3 km 四方の果てまで(輪の 1 辺は 72 → 36 → 18 分割に減らし、減らす所は内の 2 目を外の 1 目に 3 枚でつなぐ。頂点は共有し T 字の継ぎ目なし、3,384 三角形)。合計 13,752 三角形(前 115,200、−101,448)。泡の帯は頂点の色に焼かず、頂点の水深 `aDepth` を画素へ渡して同じ式で塗る(3.5 m 目でも泡が点線にならない)。setLevel は水深の色と `aDepth` を塗り直す。単体テスト `tests/unit/observe.water.test.ts`(7 件: 三角形 ≤ 15 千、内の辺はちょうど 2 枚が共有・1 枚の辺は果ての縁の 72 本だけ、頂点の重なりなし、全三角形が上向きで面積 3 km 四方、setLevel(3) で泡の帯が水際 x ≈ 48 m へ移り元の水際は水深 3 m の色)。6 画(`?time=0.12&freeze=1&ship=60&auto=0` のボタン、headless Chromium・Metal、1280 × 720。M23-01 の台はまだ無いので自前の Playwright で)の `__observeBreakdown().water.drawn` はどれも 115,200 → 13,752。`__observeStats` の三角形は 集落 1,397,152 → 1,295,704、船台 1,083,416 → 981,968、林 1,094,602 → 993,154、海岸 1,276,038 → 1,174,590(群れ・狼は群れの位置で画が変わり前後で比べられない: 979,021 → 1,064,405、1,094,802 → 1,011,277)。draw call は 集落 102・船台 103・林 104・海岸 87 で前後同じ。fps は前 49〜60・後 51〜55(他の worktree の作業と GPU を分け合っており差は測れない。M23-01 の台で測り直す)。比較画 `docs/design/qa/observe/water-before-after-{coast,coast-zoom,slip,sink,sink-coast,dusk-coast,dusk-slip}.png`: 水際の泡が前(12.5 m の頂点の色でほぼ見えない)より岸に沿った細い帯として見える。海岸の画では入江の口の浅瀬(水深 0.5 m 未満の砂州)にも泡の線が渡る(式は前と同じで、前は粗さで消えていた)。沈降 7 m の画は前後で同じ見え方。
