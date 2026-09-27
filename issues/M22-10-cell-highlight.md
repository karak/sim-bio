---
id: M22-10
title: 選んだセルを操作画面の 3D の島で示す(境界線の強調と浮かぶ印)
status: todo
milestone: M22
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: []
---

# 選んだセルを操作画面の 3D の島で示す(境界線の強調と浮かぶ印)

優先度: Could

## What to build

受入試験(2026-09-27、a-free-resume)のユーザーのメモ原文(スコープ外、登録の依頼):「マウスでセルを選択したときに、3D画面上でどこを選択したかわかるようにしてほしい。例えば、対象セルの境界線をハイライトし、その上部に矢印・ピンなど浮かせておく。」

ユーザーの判断(2026-09-28): 示すのは観察画面ではなく、**クリックする操作画面**(`src/render/SceneView.ts` の透視の島。`pickCell` でセルを選び、`selected` は `src/main.ts` にある)。

(もとの案: 2D の地図で選んだセル(selected)を、3D の観察画面でも示す。観察画面の予算(draw call ≤200 など)と世界観(動物側の意匠)に合わせる。→ 上の判断で置き換え)

操作画面で選んだセル(selected)の境界を、地形の高さに沿った線で強調する(地形に埋もれず、z-fighting しない)。その上に矢印かピンを浮かせる(ゆっくり上下してよい。動かすなら prefers-reduced-motion を守る)。

- 選びを解く(新しい島・読み込みで `selected = null`)と消え、別のセルを選ぶと移る
- 地形の変化(地図は毎フレーム更新)と、種・重ね図の切り替えに付いていく
- SceneView の色(HUD の色)に合わせる。安く作る(draw call は数個。毎フレームの geometry の作り直しをせず、位置をその場で書き換える)
- セルの番号 → 輪郭の頂点・印の位置は、snapshot の格子と標高から求める純粋な関数にし、単体テストを書く

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 操作画面でクリックして選んだセルが、3D の島の上で境界の強調と浮かぶ印で分かる。別のセルを選ぶと移り、選びを解くと消える(比較画を審査台に載せる)
- [ ] 輪郭の頂点と印の位置を求める純粋な関数と単体テスト
- [ ] E2E: 操作画面でセルを押すと強調がそのセルに出て、別のセルで移り、解くと消える
- [ ] 予算: 操作画面の draw call の増え(renderer.info の前後)が数個の内。毎フレーム geometry を作り直さない
- [ ] pnpm run check・E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
