---
id: M25-11
title: HUD のグラフの canvas の字が画面の上で 5px (軸) と 9px (目印) になる
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: []
evidence:
  - 'drawGraph の実寸の単体試験 (直す前に 5 < 11 で落ちるのを確認): tests/unit/ui.graph.test.ts (renderGraph の describe)'
  - 'CRG-005 の目印の確かめ (shownPx >= 12、線の内側): tests/e2e/shots.spec.ts'
  - 'commit: 本コミット (feat/m25-11)'
---

# HUD のグラフの canvas の字が画面の上で 5px (軸) と 9px (目印) になる

優先度: Must

## What to build

ADR 0001 の「この ADR の外で起こす票」。設計に依らない製品の欠陥。

HUD のグラフの canvas は 640×200 で (src/ui/Hud.ts:168)、CSS は 320×100 に描く (src/ui/hud.css:23)。
軸の字 `10px ui-monospace` と目印の字 `bold 18px system-ui` (src/ui/graph.ts:6-7) は、画面の上で 5px と 9px になる。
CRG-005 で人が読む「漂着 (狼・鹿)」の目印がこの 9px の字である。#local-graph (240×80) も同じ作り。

直し方はこの票で決める (字の大きさを縮尺で割る、canvas の大きさを devicePixelRatio で決める、など)。画面の上で軸は 11px 以上、目印は 12px 以上にする。

## Blocked by

- なし

## Acceptance criteria

- [ ] drawGraph の単体試験に、fillText の font の大きさ × (clientWidth / width) が軸 11px 以上・目印 12px 以上であることを足し、直す前に落ちるのを見る
- [ ] 直した後に通り、目印が線の内側に収まる (tests/e2e/shots.spec.ts の CRG-005 の確かめ)
- [ ] M25-01 が入っていれば `pnpm run shots` の字の大きさの赤が消える

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の外の票 外-3)
- 2026-10-01: 直した。renderGraph (src/ui/graph.ts) が canvas を clientWidth × max(2, DPR) で描き、CSS px の座標系で字を書く (軸 11px・目印 bold 12px)。余白は左 32・右 44・上 16。Hud.ts の 2 つのグラフが使う。局所グラフは畳んだ板で描くと 0 サイズなので、描かずに戻り、板を開いた後に描き直す (レビューの指摘)。前後の画は .claude/localreview/m25-11/。M25-01 は未取り込みなので shots の赤の確認は無し
