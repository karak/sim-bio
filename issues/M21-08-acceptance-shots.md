---
id: M21-08
title: 人が見る画を E2E で撮り、受入の画面に並べる
status: review
milestone: M21
plan: docs/design/2026-09-29-acceptance-redesign.md
depends_on: [M21-06]
evidence: ["491f0e1 tests/e2e/shots.spec.ts scripts/acceptance.py scripts/test_acceptance.py docs/acceptance/scenarios.jsonl package.json src/render/cellHighlight.ts src/render/SceneView.ts tests/unit/render.cellHighlight.test.ts"]
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

- [x] 撮るもの: 港の知らせと板の文(閉港・出港のリンク・回避率の行)、漂着の目印と浜のセルの密度、確かめの板(新しい島・枠の上書き・判定の出た島を離れる)、選んだセル(遠いカメラ・寄ったカメラ・丘に隠れたセル)
- [x] 撮る前に、画に写すものが見えていることを内容で確かめる(文は toHaveText、目印は HUD の中の文)。見えないまま撮った画を人に見せない
- [x] `ACCEPTANCE_DIR` が無いと skip になり、`pnpm run test:e2e` の数と時間を変えない
- [ ] `pnpm run shots && pnpm run acceptance:page` の後、受入の画面に画が並ぶ。人の 1 周の分が減ったら TUR の行の steps と minutes を直す

## 作業ログ

- 2026-09-29: 基点は feat/m19 702a38b。実装は 491f0e1
- 撮るもの (正本に足した human の行、各 1 分、人の 1 周の human の和は 9 → 13 分):
  - HBR-006 (5 枚): 回避率の行 (判定の板と石板)・出港の文と訪問のリンク・積荷を港に流した知らせ・閉港の出港 (判定の板)・判定の後に開き直した港の口 (閉港の文と判定の出た島)
  - CRG-005 (2 枚): 受け取った港の口の文・HUD のグラフの「漂着 (狼・鹿)」とセルの詳細の密度
  - CNF-002 (3 枚): 新しい島・枠の上書き・判定の出た島を離れる
  - SEL-003 (3 枚): 遠い既定のカメラ・寄ったカメラ・丘に隠れたセル (低く倒したカメラで、セルの面は隠れ、ピンの頭は見える)
- 撮る前の確かめ: 文は toHaveText、グラフの目印は canvas の fillText を拾って #graph の内に書いたこと、3D は __sceneSelection の view (hiddenFrom で地形に隠れるか、印の頭が画面の内か)。どの画も写すものが toBeInViewport({ ratio: 1 }) で、真ん中が覆われていない (uncovered.ts)。落ちた行の画は afterEach で消す (CRG-005 を時間切れで落として、その行の画だけ消えるのを見た)
- 丘に隠れたセルは、倒したカメラで __sceneCell を全セルにかけて探し、寄ったカメラに戻して押し、倒し直す。ドラッグを離した所のセルが canvas の click で選ばれるので、倒すドラッグは空 (画面の上の縁) で離す
- 確かめた数: `pnpm run check` は vitest 1087 (+3、hiddenFrom)・worker 66・scripts 73 (+6、shots_of・check_shots・page・dir)。`pnpm run shots` は 4 passed (1.8 分、13 枚)。ACCEPTANCE_DIR を scratchpad にして `pnpm run acceptance:page --no-probe` の items.json で、HBR-006・CRG-005・CNF-002・SEL-003 の項目に shots が番号の順に入る
- `pnpm run test:e2e` (ACCEPTANCE_DIR なし) は 83 件 = 前の 79 件 + shots の 4 件 skip。負荷の高い機械 (load 20〜30) で 2 回とも 3 件ずつ落ちた (confirm・scenarioSave・harbor の別々の 3 件、ダイアログの押しの待ちと時間切れ)。落ちたファイルだけ回し直すと全部通った (38 passed・21 passed)
- codex はトークンの期限切れで使えなかった (`codex login` のやり直しが要る)。代わりに別のモデル (fable) の agent にレビューさせ、指摘 4 つ (dir が落ちても shots が 0 で通る・落ちた行の古い画が残る・切れた文でも通る・格子の大きさの決め打ち) を直して、再レビューで残りなし

## 分かっている限り

- 受入の画面の index.html (git の外) は `.imgs` の CSS だけで、項目の shots を描かない。描く行を足すまで、items.json に画があっても画面には並ばない
- 人の 1 周の TUR-001・TUR-002 の steps と minutes はまだ直していない (直しの案はユーザーの判断待ち)
- 開発の板 (?dev=1) は HUD の「新しい島」を覆う (Playwright の押しが開発の板に取られた)。開発のときだけ
- 島をドラッグで回すと、離した所のセルが選ばれる (canvas の click)。選んだセルが回すたびに動く
