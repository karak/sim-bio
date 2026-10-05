---
id: M21-05
title: UI 部品 (ウィジェット) を単体で試せる作りにする (ドラッグを含む)
status: review
milestone: M21
depends_on: [M19-18]
evidence: ["0182196 src/ui/movable.ts tests/unit/ui.movable.test.ts", "eb2d528 tests/unit/ui.movable.dom.test.ts package.json", "afee59f tests/e2e/uncovered.ts tests/e2e/uncovered.spec.ts tests/e2e/observeEntry.spec.ts tests/e2e/confirm.spec.ts"]
---

# UI 部品 (ウィジェット) を単体で試せる作りにする (ドラッグを含む)

優先度: Should

## What to build

2026-09-27 のユーザーの問い:「いわゆるウィジェットやコンポーネントと呼ばれる独立したUI部品について、しかもドラッグという比較的複雑度の高いDOM操作のテストができるような設計になっているか」。答えは「なっていない」。

今の作り (feat/m19 250e90a):
- vitest は `environment: 'node'` で、jsdom・happy-dom・Testing Library が無い。`tests/unit/ui.*.test.ts` は文字列を作る関数 (formatCiv など) だけを試し、部品を組み立てて試すものは無い。
- src/ui の部品 (Tablet・Hud・Harbor・HarborVisit) は、innerHTML の文字列で組み、id で引き当てる工場関数。部品の外 (innerWidth・sessionStorage・getBoundingClientRect) を直に読み、差し替えの口が無い。
- src/ui/movable.ts は clampOffset だけが純粋関数で単体試験 3 件。ドラッグの状態 (pointerdown → move → up/cancel・pointerId の照合・矢印キー・位置の覚え) は閉包とリスナーの中にあり、tests/e2e/verdict.spec.ts の実ブラウザでしか試せない。
- 置き場所 (重なり) の契約を持つ部品が無い。M19-18 (「3D で見る」が石板に覆われた) は、別々の CSS (entry.ts と hud.css) の絶対位置の衝突だった。

## Acceptance criteria

- [x] ドラッグを純粋な状態遷移 (状態 + 出来事 → 次の状態) に分け、画面の大きさ・位置の置き場は引数で渡す。pointerId の照合・キャンセル・矢印キー (Shift で大きく)・画面の内への寄せ・覚えの読み書きを単体試験で確かめる
  - 0182196 src/ui/movable.ts: `moveStep(state, input, frame): { state, save, handled }`。frame は「今の位置で描いた取っ手の矩形 (描かれていなければ null) と画面の大きさ」。覚えは `readOffset(store, key)` / `writeOffset(store, key, at)` で置き場 (`Pick<Storage, 'getItem' | 'setItem'>`) を引数に取る。`makeMovable(board, grip, key, env?)` の env (`{ view(), store }`) は省略すると innerWidth/innerHeight と sessionStorage
  - tests/unit/ui.movable.test.ts (node のまま) に 16 件足した
    - pointerId: 「ほかの指 (pointerId が違う) の動き・離し・キャンセルは何もしない」「押していないときの動き・離しは何もしない」「押した指の動きだけ、押した点からのずれの分だけ動く」
    - キャンセル: 「キャンセル (pointercancel) も離しと同じく、そこまで動いた位置で終えて覚える」
    - 矢印キー: 「矢印キーで 16 px、Shift で 64 px 動き、そのたびに覚えに書く」「矢印でないキーは受けない (既定の動きを止めない)」
    - 寄せ: 「動いた先で取っ手が画面の外へ出るなら、画面の内へ寄せる (左上・右下)」「取っ手の矩形は今の位置で描いたものとして、動かした先へずらしてから寄せる」「取っ手が描かれていない (板を隠している) ときは寄せない」「見せ直す (show) と、覚えた位置を今の画面の内へ寄せ直す。覚えには書かない」
    - 覚え: readOffset / writeOffset の 4 件 (JSON の中身 `{"x":244,"y":56}`、壊れた・数でない中身は (0, 0)、余計な項目を落とす、投げる置き場でも投げない)
- [x] 部品の試験用に DOM の環境 (happy-dom か jsdom) と Testing Library (user-event) を入れ、部品の試験のファイルだけで使う (既存の node の試験は変えない)
  - eb2d528: devDependencies に happy-dom 20.14.5・@testing-library/dom 10.4.2・@testing-library/user-event 14.6.7。vite.config.ts の `environment: 'node'` は変えず、部品の試験のファイルの 1 行目の `// @vitest-environment happy-dom` で切り替える (いまは tests/unit/ui.movable.dom.test.ts だけ)
- [x] makeMovable と判定の板を部品として組み、user-event の pointer でドラッグ・キーで動かし、translate と覚えの中身を内容で確かめる
  - eb2d528 tests/unit/ui.movable.dom.test.ts (7 件)
    - makeMovable: 「取っ手を押して動かして離すと、ずれの分だけ translate が動き、離したときに覚えへ書く」(`260px 120px`・`{"x":260,"y":120}`)、「矢印キーで 16 px、Shift で 64 px 動き、そのたびに覚えへ書く」、「取っ手は画面の外へ出ない …」(`-100px -10px`)、「覚えた位置から始まり、画面の外なら寄せて出す」(`700px 30px`)、「ほかの指の動き・離しは今のドラッグを動かさず終えない。キャンセルでも、そこまでの位置を覚える」(PointerEvent を直に送る。user-event のマウスは pointerId 1 だけ)
    - 判定の板 (createTablet → showVerdict): 「判定の板は取っ手の pointer のドラッグとキーで動き、動かした位置をタブの間 (sessionStorage) 覚える」(verdict.spec.ts と同じ 260/120 → 244/56)、「開き直した (もう一度) 判定の板は、覚えた位置に出る」
    - 取っ手は `getByRole('button', { name: /^判定の板を動かす/ })` で引く
- [x] 実の配置 (重なり・覆い) は Playwright に残し、部品ごとの「覆われない」試験の型を 1 つにまとめる (M19-18 の observeEntry.spec.ts を土台に)
  - afee59f tests/e2e/uncovered.ts: `topmostAtCenter(locator)` (真ん中の点で一番上の要素が部品自身かその中なら 'self'、ほかは覆った要素の `tag#id.class`) と `expectUncovered({ 名前: locator, … })` (どれも見えていて覆われない。覆われた部品は差分に覆った要素が出る)
  - tests/e2e/uncovered.spec.ts: 「M21-05: 自由モード (/) の時間の箱・石板・下の行の札は、どれも覆われない」「M21-05: 判定の板が出ているとき、板の取っ手・札と、板の外の「3D で見る」・枠へ保存は、どれも覆われない。板を動かしても変わらない」
  - observeEntry.spec.ts (M19-18) の topmostAtCenter と confirm.spec.ts (M21-04) の枠へ保存の覆いの確かめは、この型を使うよう差し替えた (コメントは残した)
  - 型が覆いを見つけることの確かめ: `.verdict { pointer-events: none; }` を auto に戻して回すと、判定の板の試験が `"3D で見る": "div#verdict.verdict dead"`・`"枠へ保存": "div#verdict.verdict dead"` の差分で落ちた (戻して通ることも確かめた)
- [x] ほかの部品 (Tablet・Hud・Harbor) を同じ型へ移す範囲と順を決める (この票では移さない)
  - 下の「ほかの部品を移す順」

## ほかの部品を移す順 (M21-05 で決めた。この票では移さない)

どの部品も同じ 3 段で移す: (1) 部品の中の状態の移りを純粋な関数に分け、node の単体試験で確かめる。(2) 部品の外 (画面の大きさ・置き場・時計・網・Worker) を引数の env で渡し、`// @vitest-environment happy-dom` のファイルで組んで user-event で押し、中身を内容で確かめる。(3) 置き場所は tests/e2e/uncovered.spec.ts の表に部品を足す。

| 順 | 部品 | 外への依存 (いま直に読むもの) | 範囲 | 理由 |
|---|---|---|---|---|
| 1 | Tablet (石板の残り) と confirm.ts | setTimeout (flash)・URL.createObjectURL (持ち出しの保存) | update の文 (祈り・節目・警告のチップ・年表・力)、警告のチップの委譲 (onShowSpecies)、選びを選んだ直後に今の舞台へ戻す (M21-04)、判定の札 (もう一度・自由モードへ)・持ち出しの保存の出し分け。確かめのダイアログの focus・Esc・Tab の回り | 判定の板の試験で createTablet をもう happy-dom に組めている。外は時計と Blob だけで、vi.useFakeTimers と happy-dom で足りる。いちばん安く、型の手本になる |
| 2 | Hud | URL.createObjectURL・document.createElement('a') (保存のファイル)・canvas (graph.ts の個体数の推移) | 速さ・層・密度/住みやすさの札の on の移り、気温・降水の slider の値と表示、枠の選びと枠の文 (slotLabel)、勅令・迎撃・舟の札の出し分け | 手は HudHandlers で既に差し込める。canvas の描きは happy-dom に無いので、描く口を env に分けてから (描きそのものは試さない)。576 行で一番大きいが、外は少ない |
| 3 | Harbor・HarborVisit | indexedDB (openHarborStore)・fetch('/data/inscriptions.json')・location.origin・Turnstile・setTimeout / setInterval (知らせと送り直し)・replayInWorker (Worker) | 港の板の開閉・知らせの出し消し・出港/取り下げ (guard.ask)・訪問の板の理由の文 | 外への依存が一番多い。HarborUiDeps に置き場の開き方・碑文の読み方・Turnstile・時計・再生を足してから。網と置き場の試験は harbor.client / persist.harborStore / fakeHarbor に既にあるので、部品の試験は画面の移りに絞る |

## 作業ログ

- 2026-09-28: 基点は feat/m19 2cd444f、枝 m21-05。
- ドラッグの状態遷移 (0182196): 前の makeMovable は、動かす先の translate を書いてから取っ手の矩形を測って寄せていた。moveStep は「今の位置で測った矩形」を動かす先へずらしてから寄せる (translate はただずらすだけなので同じ値になる)。makeMovable は出来事のたびに今の位置のまま測り、moveStep を呼び、translate を書き、save なら覚えへ書く。キーは handled のときだけ既定の動きを止める (前と同じ)。二本目の指の押下は前と同じく今のドラッグを奪う
- 試験を先に書いて落ちることを見てから実装した (moveStep・readOffset・writeOffset が無く 16 件落ちた)。部品の試験は makeMovable の env を足した後に書いたので、落ちることは変異で見た: 覚えへ書くのを止めると 7 件のうち 5 件が落ちる
- 確かめた数 (2026-09-28、afee59f の上): pnpm run check は vitest 112 files・1084 tests、worker 5 files・66 tests、scripts 42 tests。E2E は CI=1・1 worker・E2E_PORT=5441 で 3 回に分けた: uncovered 2・verdict 2 (4 件、1.4 分)、observeEntry 3・confirm 6・smoke 24 (33 件、3.7 分)、harbor 15 (15 件、4.7 分)。計 52 件すべて通る

## 分かっている限り

- happy-dom には配置が無い (getBoundingClientRect は 0)。makeMovable の部品の試験は取っ手の矩形を translate から作る (vi.spyOn)。判定の板の部品の試験は createTablet が env を出していないので、既定の innerWidth と happy-dom の sessionStorage を使い、矩形は 0 (寄せない道) を通る。判定の板の寄せは tests/e2e/verdict.spec.ts の 2 件目で見る
- user-event のマウスは pointerId 1 だけなので、ほかの指は PointerEvent を直に送って試す
- 覆いの型は部品の真ん中の 1 点だけを見る。端だけ覆われるのは見つけない。窓は Playwright の既定 1280×720 だけ
- observeEntry.spec.ts の topmostAtCenter は、ボタンの中の要素に当たっても 'self' とするようになった (「3D で見る」は中に要素を持たないので同じ)
- ほかの部品 (Tablet の残り・Hud・Harbor) は移していない (上の順)
