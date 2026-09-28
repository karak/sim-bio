---
id: M21-08
title: 人が見る画を E2E で撮り、受入の画面に並べる
status: todo
milestone: M21
plan: docs/design/2026-09-29-acceptance-redesign.md
depends_on: [M21-06]
evidence: []
---

# 人が見る画を E2E で撮り、受入の画面に並べる

優先度: Could

## What to build

人にしか判断できないのは「見て分かるか」(文が読めるか・目印が見えるか・帯とピンで場所が分かるか)。
いまの人の 1 周 (TUR-001・TUR-002) は、その画面に着くまでを人が触って作っている。
E2E はもうその画面に着いている(harbor.spec・cellHighlight.spec・confirm.spec)ので、同じ道で画を撮り、人は画だけを見る。
人の手では作りにくい画面(閉港の知らせ・判定の後の港の口・遠いカメラと丘に隠れたセル)も、ここで見られるようになる。

作るもの:
- `tests/e2e/shots.spec.ts`。題名は `<正本の ID>: …`。`ACCEPTANCE_DIR` があるときだけ回り(CI では skip)、`$ACCEPTANCE_DIR/shots/<ID>-<n>.png` に書く。港は tests/fixtures/fakeHarbor.ts、状態は 1000x と近道で作り、待たない
- `pnpm run shots`(`ACCEPTANCE_DIR` を渡して shots.spec だけを回す)
- 正本に画で見る human の行を足す(`next` で新しい番号を取る)。`scripts/acceptance.py` の page は `shots/<ID>-*.png` を項目の `shots[]` に入れ、受入の画面は並べる(index.html の `.imgs` の型はある)

## Blocked by

- M21-06

## Acceptance criteria

- [ ] 撮るもの: 港の知らせと板の文(閉港・出港のリンク・回避率の行)、漂着の目印と浜のセルの密度、確かめの板(新しい島・枠の上書き・判定の出た島を離れる)、選んだセル(遠いカメラ・寄ったカメラ・丘に隠れたセル)
- [ ] 撮る前に、画に写すものが見えていることを内容で確かめる(文は toHaveText、目印は HUD の中の文)。見えないまま撮った画を人に見せない
- [ ] `ACCEPTANCE_DIR` が無いと skip になり、`pnpm run test:e2e` の数と時間を変えない
- [ ] `pnpm run shots && pnpm run acceptance:page` の後、受入の画面に画が並ぶ。人の 1 周の分が減ったら TUR の行の steps と minutes を直す

## 作業ログ
