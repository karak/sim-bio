---
id: M25-02
title: 撮る状態を毎回同じにする (reducedMotion・tick で止める口・グラフの年ごとの点・時計・ピンの ID 描き)
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-09]
evidence: []
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
