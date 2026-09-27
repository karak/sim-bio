---
id: M22-10
title: 選んだセルを 3D の観察画面で示す(境界線の強調と浮かぶ印)
status: todo
milestone: M22
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: []
---

# 選んだセルを 3D の観察画面で示す(境界線の強調と浮かぶ印)

優先度: Could

## What to build

受入試験(2026-09-27、a-free-resume)のユーザーのメモ原文(スコープ外、登録の依頼):「マウスでセルを選択したときに、3D画面上でどこを選択したかわかるようにしてほしい。例えば、対象セルの境界線をハイライトし、その上部に矢印・ピンなど浮かせておく。」

2D の地図で選んだセル(selected)を、3D の観察画面でも示す。セルの境界を地形に沿った線で強調し、その上に矢印かピンを浮かせる。観察画面の予算(draw call ≤200 など)と世界観(動物側の意匠)に合わせる。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 2D で選んだセルが、3D の観察画面で境界の強調と浮かぶ印で分かる(比較画を審査台に載せる)
- [ ] 予算の内(M23-01 の台で前後を記す)
- [ ] pnpm run check・E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
