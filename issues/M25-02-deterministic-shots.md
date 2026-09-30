---
id: M25-02
title: 撮る状態を毎回同じにする (reducedMotion・tick で止める口・グラフの年ごとの点・時計・ピンの ID 描き)
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-09]
evidence:
  - "AC1: shots を 2 回撮って比べた (tools は scratchpad の cmp3.py。YIQ threshold 0.2 の閾値越えの画素を数える)。28fdf5f に feat/m19 626f179 を merge した木で 13 枚 (CNF-002 3・CRG-005 2・HBR-006 5・SEL-003 3) のうち 12 枚は差が 0 画素、SEL-003-3 は 180 画素 (0.0195%) で閾値越え 0。15a6d7a (M25-01 で HBR-006 が auto になり画を保存しない) を merge した木で 8 枚 (CNF-002 3・CRG-005 2・SEL-003 3) のうち 7 枚は差 0、SEL-003-3 は 8 画素 (0.0009%) で閾値越え 0。DOM の板の画は差 0"
  - "AC2: tests/e2e/sceneIdle.spec.ts 通る。tests/e2e/shotState.spec.ts「呼んだ後も止めた島を描き直さない」が pinMask の後の 30 フレームで draw 0 を見る"
  - "AC3: tests/unit/runner.test.ts「年ごとの拾い」(1x・1000x・ぶつ切りのフレームで onYear の tick の列が同じ [360, 720, 1080])、tests/e2e/shotState.spec.ts「グラフの点は年ごとに 1 つ」(3 年進めて aria-label が Y0 から Y3、4 点)"
  - "AC4: pnpm run check 通る (vitest 122 files 1212 passed、worker 66、scripts 73)。E2E 96 passed (CI=1 E2E_PORT=5455、ACCEPTANCE_DIR 付きで shots を含む)"
  - "AC5: tests/unit/build.devtools.test.ts (MARKERS に advanceTo を足した。本番は空、受入のビルドは MARKERS と一致)"
---

# 撮る状態を毎回同じにする (reducedMotion・tick で止める口・グラフの年ごとの点・時計・ピンの ID 描き)

優先度: Must

## What to build

ADR 0001 の段 2。shots を 2 回撮ると 3 つの元で画がずれる (ADR の付録 B の 3):
- ピンの上下が `performance.now()` で動く (src/render/SceneView.ts:237)
- CNF-002 は 100x で「Year 0 でなくなるまで」回すので止まる tick が違う (tests/e2e/shots.spec.ts:190-192)
- HUD のグラフはフレームごとに年の変わり目を拾う (src/ui/Hud.ts:497-499)

作るもの:
- shots.spec.ts を `reducedMotion: 'reduce'` の文脈で撮る
- 開発の板 (src/dev) に「tick N まで進める」を足し、shots は速さの札と待ちではなくこれで止める
- HUD のグラフを本体の年ごとに点を積む形にする。目印は canvas の外にも文で出す (aria の説明)。shots.spec.ts の fillText の差し替え (129-139 行) を消す
- ピンの上下 (markerBob) と観察画面の `t` (src/observe/view.ts:941-951) に時計を渡せるようにする。既定は今のまま
- ピンだけを 1 色で描き、地形の深さで隠れる所は描かない描き方を probe (M25-09 の `inspect()`) から呼べるようにする。M21-10 の「止めた島は描き直さない」を壊さない (呼ばれたときだけ 1 回描く)

## Blocked by

- M25-09 (口を probe に移す)

## Acceptance criteria

- [ ] `pnpm run shots` を 2 回撮り、13 組の画がどれも `threshold 0.2`・`maxDiffPixelRatio 0.02` の内 (比べる道具は tools/acceptance-probe/cmp2.py)。DOM の板の画は閾値を越える画素 0
- [ ] tests/e2e/sceneIdle.spec.ts が通る (ピンの ID 描きを足しても止めた島を描き直さない)
- [ ] グラフの点の数が、1x と 1000x で同じ年数を回したときに同じ (vitest か E2E)
- [ ] tests/unit/scenario.determinism.test.ts と E2E が全部通る
- [ ] 本番の bundle に新しい口が入らない (tests/unit/build.devtools.test.ts)

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 2)
- 2026-10-01: 実装 (feat/m25-02)。
  - `Runner` に `onYear`・`ticksPerYear`・`advance(n)` を足し、年の境目ちょうどで止めて点を拾う。HUD は `recordYear` で年ごとに 1 点積み、update は同じ年を重ねない。判定 (速度 0) が出た年の境目でそのフレームの残りを進めない。グラフの目印は canvas の aria-label に文で出す (src/ui/graphDescription.ts)。shots.spec.ts の fillText の差し替えは消した (字の実寸は M25-11 の ui.graph.test.ts、読みやすさは M25-01 の lens が見る)。
  - 開発の板: `?paused=1` (最初のフレームの前に ⏸)、`?clock=<ms>` (ピンの上下と観察画面の t の時計を固定)、`__probe.advanceTo(tick)`。いずれも src/dev にあり、本番の bundle に入らない。
  - SceneView は `now` の引数を受け (既定は performance.now())、`inspect().pinMask()` でピンだけを 1 色 (#FF00FF) で別の scene・WebGLRenderTarget に描き、地形は深さだけ書く。canvas に描かず、止めた島を描き直さない。
  - shots.spec.ts は `reducedMotion: 'reduce'` と `?paused=1` と `advanceTo` で撮る。CRG-005 は放流後 4 tick (狼 0.40・鹿 0.24)、CNF-002 は tick 400 と 760。
  - 読むだけの別モデルのレビュー (codex は認証切れ)。直した: onYear は tick が境目のときだけ呼ぶ、shotState の「進まない」は Day で見る、MARKERS に advanceTo。直さない: 観察画面に `?clock=` を固定して渡すと stats と知らせの帯の時間も止まる (t は撮影で止めたい値なので意図どおり。stats を読む試験は clock を渡さない)、pinMask は地形以外 (集落・塔) の遮蔽を見ない (票の文言は地形の深さ)。
  - 地形に隠れたピンの mask の E2E は書いていない (隠れた角度へ倒す手順が shots.spec.ts の中にあり、共通にしていない。M25-04 の driver の後で足す)。
