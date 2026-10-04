---
id: M19-15
title: 受入試験(2026-09-27)で見つかった港まわりの不具合
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: ["d9b94c3 36a0204 1faae08 src/harbor/turnstile.ts src/ui/Harbor.ts src/ui/harbor.css src/ui/Tablet.ts src/ui/movable.ts src/ui/hud.css src/ui/graph.ts src/main.ts tests/e2e/harbor.spec.ts tests/e2e/verdict.spec.ts tests/unit/ui.graph.test.ts tests/unit/ui.movable.test.ts"]
---

# 受入試験(2026-09-27)で見つかった港まわりの不具合

優先度: Must

## What to build

2026-09-27 の受入試験(手元の受入の画面、.claude/acceptance/results.json)で見つかった不具合。ユーザーのメモは原文。

1. 閉港の知らせが出ない(a-closed 不合格): 「2はOK。平行の知らせは見えない。単に「出港する」ボタンがdisabledになっただけ。」— DevTools の Network request blocking で `*/api/*` を止めて出港すると、「港は今日は閉まっている…」の知らせが出ず、「出港する」が押せなくなるだけ。E2E(`page.route()` で閉じる)は通っているので、閉じ方(fetch の失敗の種類・Turnstile の読み込み)で道が分かれていないかを調べる。
2. 判定のあとに閉じた島をあとから出港できない(a-late-publish 不合格): 「ならない。2の開き直すの定義にもよるが、/?scenario=test-quickでも/でも一からやり直しになる」— 判定の出た石板を開き直すと一からやり直しになるのは仕様どおりだが、判定の出た島を港の口から出港できない。
3. 3D の観察画面に行けない(a-publish-visit 保留): 「3Dの観察画面にゆけないため保留。「自由モード」のウィンドウが上にかぶさる。暫定対策おとしてウィンドウを上部をドラッグして移動できるようにすること。 / 年表を読むはOK。」— 判定の板(「自由モード」の窓)が観察画面の入口を覆う。暫定対策として、窓を上部でドラッグして動かせるようにする。
4. 漂着の目印が見えない(a-cargo 保留): 「3で受け取るを試した。ダイアログで数値は出たが、HUDの漂着の目印は見えず、種数のグラフ上の変化も気づけなかった（量の問題の可能性もある）。 / 」— 受け取ったのに HUD の「漂着」の目印が見えず、個体数のグラフの変化にも気づけない。目印の出方と、量(総数の 1/100、上限 10)が見えるほどかを確かめる。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 1〜4 のそれぞれについて、原因と直し方を作業ログに書き、再現する E2E(または単体テスト)を先に書いて落ちることを確かめてから直す
  - 下の作業ログ「原因と直し方」。直す前の落ち方も同じ所に書いた
- [x] 閉港は DevTools の request blocking と同じ閉じ方(網の失敗)でも知らせが出る
  - `tests/e2e/harbor.spec.ts`「M19-15 (1): DevTools の request blocking と同じ閉じ方 (ERR_BLOCKED_BY_CLIENT) で、DevTools を開いた高さでも、判定の板と港の板の出港で閉港の知らせが読める」(1200×420、`route.abort('blockedbyclient')`)
  - 同じファイル「M19-15 (1): Turnstile の script が返ってこない (待ち続ける) ときも、出港は閉港として預け、知らせを出す」
  - d9b94c3(src/ui/harbor.css・src/harbor/turnstile.ts)
- [x] 判定の出た島を、開き直したあと港の口から出港できる(E2E)
  - `tests/e2e/harbor.spec.ts`「M19-15 (2): 受入の手順 (判定まで進め、出港せずに閉じ、開き直して次の挑戦を少し進める) のあと、DevTools を開いた高さでも港の口から判定の出た島を出港できる。自由モードの港の口にも並ぶ」
  - d9b94c3・36a0204(src/ui/Harbor.ts・src/ui/harbor.css)
- [x] 判定の板を上部のドラッグで動かせ、観察画面の入口を押せる(E2E)
  - `tests/e2e/verdict.spec.ts`「M19-15 (3): 判定の板は上の取っ手のドラッグとキーボードで動き、下の観察画面の入口を押せる。動かした位置はそのタブの間だけ覚える」「M19-15 (3): 判定の板は画面の外へは出ない (取っ手が画面に残る)」
  - 単体: `tests/unit/ui.movable.test.ts`(clampOffset 3 件)
  - d9b94c3・1faae08(src/ui/movable.ts・src/ui/Tablet.ts・src/ui/hud.css)
- [x] 漂着を受け取ると HUD に目印が見え、個体数の変化が読み取れる(量が小さすぎるなら見直す)
  - `tests/e2e/harbor.spec.ts`「M19-15 (4): 漂着を受け取ると、積荷の着いた浜のセルを選んで見せ、放たれた種の密度がそのセルで読める」
  - 単体: `tests/unit/ui.graph.test.ts`「drawGraph の目印 (M19-15: 漂着の目印が見えない)」3 件
  - 量は変えていない(理由は作業ログ)。d9b94c3(src/main.ts・src/ui/graph.ts)
- [x] pnpm run check・E2E・Cloudflare の E2E が通り、evidence に commit SHA とテストファイルを記す
  - `pnpm run check`(d9b94c3): typecheck・eslint・ruff・vitest 104 ファイル 1002 件・worker 5 ファイル 64 件・scripts 42 件、すべて通る
  - E2E: `pnpm exec playwright test --workers=1`(E2E_PORT=5415、1faae08)55 件のうち 54 件が通る。落ちた 1 件「M19-09: 照合は「やめる」で止まり…」は、単独で回し直して通る(読み終わりが「やめる」を押すより先に来ると札が隠れる、既存のテストの競り合い)。並列の通し(36a0204)では 52 件が通り、落ちた 3 件は機械の負荷による揺れ(下の作業ログ)で、どれも 1 worker の通しでは通る。M19-15 の 7 件はどちらの通しでも通る
  - `pnpm run test:e2e:cloudflare`(E2E_PORT=8845、1faae08)5 件すべて通る
  - 既存コメントの削除なし: `git diff feat/m19...HEAD -U0 | grep -E '^-\s*(//|\*|/\*)'` は空
  - 画面の撮影(コミットしていない): scratchpad の `m19-15/shots/`(13 閉港・DevTools の高さの判定の板、14 同じく港の板、15 開き直した後の出港、16 漂着の着いた浜のセル、17 動かした判定の板。repro-* は直す前の再現)

## 作業ログ

### 2026-09-27(M19-15 の担当、基点は feat/m19 の 76bc022)

#### 再現(scratchpad の `m19-15/shots/repro-*`、使い捨ての spec はコミットしていない)

- 本物の Turnstile の script(網に出る)と `route.abort('blockedbyclient')`(DevTools の request blocking と同じ `ERR_BLOCKED_BY_CLIENT`)で、1280×800 と 1200×520 を回した。どちらも判定の板の出港は 3〜5 秒で「港は今日は閉まっている…」になった。fetch の失敗の種類では道は分かれていない(どれも `TypeError: Failed to fetch` で `closed`)
- 分かれていたのは画面の高さ。1200×420(DevTools を下に開いた窓)で、判定の後に開き直して港の口を開くと、港の板の「判定の出た島」の出港札と閉港の知らせが板の下に切れ、押せない・読めない(`locator.click` が 5 秒で切れる)

#### 1. 閉港の知らせが出ない

- 原因: 港の板(`.harbor-drawer`)は `max-height: calc(100% - 24px)` で、巻けるのは一覧(`.harbor-list`)だけだった。M19-10 の浜の漂着と M19-14 の直しの「判定の出た島」(出港の板まるごと)が一覧の上に足され、低い画面では、その下の閉港の知らせ(`#harbor-state`)と出港の結果の行が板の外(clip-path の外)に出ていた。ユーザーのメモ「2 は OK。閉港の知らせは見えない。単に「出港する」がdisabled になっただけ」は、手順 3(港の口の一覧)で、判定の出た島の出港札を押して結果の行が切れたものと読める
- 直し: 港の板を板ごと巻く(`overflow-y: auto`、一覧は巻かない)。src/ui/harbor.css
- もう 1 つの道: Turnstile の script の読み込みに上限が無く、網が要求を返さないまま止めると(`page.route` で答えない)、出港が「港へ運んでいる…」のまま終わらなかった。script の読み込みを 10 秒(`LOAD_WAIT_MS`)で打ち切り、読めないものとして閉港と同じに扱う(outbox に預ける)。src/harbor/turnstile.ts
- 直す前の落ち方: 前者は `expectReadableIn` が `Expected: <= 330, Received: 420.15625`(知らせの行の下端が板の下端より下)。後者は `Expected: "港は今日は閉まっている…" Received: "港へ運んでいる…"`

#### 2. 判定の出た島を開き直したあと港の口から出港できない

- 原因は 2 つ。(a) 1 と同じ板の高さで、低い画面では「判定の出た島」の出港札が板の外に切れて押せなかった。(b) 判定の出た島は `?scenario=<石板>` で開いたときだけ港の板に並べていた(`deps.scenarioId`)。ユーザーは `/`(自由モード)でも開き直しており、そこには入口が無かった
- 直し: (a) は 1 の直し。(b) 自由モードの港の口には、どの石板の判定の出た島も「『石板名』で最後に判定の出た島」として並べる。石板では今までどおりその石板の島だけ、訪問では並べない。並べる範囲を `finishedScope` 1 つで決め、`showFinished` を 1 つにした(36a0204)。src/ui/Harbor.ts
- 直す前の落ち方: `Expected substring: "『試し読み』で最後に判定の出た島" Received string: ""`

#### 3. 判定の板が観察画面の入口を覆う

- 直し(暫定): 判定の板の上に取っ手(`#verdict-grip`、「判定の板を動かす (ドラッグか矢印キー)」)を置いた。ドラッグ(pointer capture)と矢印キー(1 回 16 px、Shift で 64 px)で動く。取っ手は画面の外へ出さない(`clampOffset`、純粋な関数)。位置は sessionStorage に置くので、そのタブの間(「もう一度」で開き直しても)だけ覚え、タブを閉じれば忘れる。判定の板の外の覆い(`.verdict`)は押せるようにし(`pointer-events: none`、板だけ `auto`)、板を寄せれば石板・HUD・観察画面の入口を押せる。src/ui/movable.ts・src/ui/Tablet.ts・src/ui/hud.css
- 取っ手の見た目は港の板の継ぎ目と同じ青緑(#8FEADF)の粒の列。焦点の輪も港の札と同じ
- 直す前の落ち方: 取っ手が無く `getByRole('button', { name: /^判定の板を動かす/ })` を待って切れる

#### 4. 漂着の目印が見えず、個体数の変化にも気づけない

- 目印は出ていた(`hud.addMarker`)。見えなかった理由: グラフの canvas は 640×200 を 320×100 に縮めて描くので、10 px の文字は 5 px になる。さらに目印は今の年(横軸の右端)にあり、中央揃えの文の右半分が縁で切れていた
- 量: 積荷の量は放流の `amount` で、浜の 3×3(半径 1)の各セルの密度に足し、1 で頭打ちになる(World の `spawn_species`)。どの積荷でも、1 種で島の総数に足せるのは最大 9 ほど。受入の島(草 800・胞子苔 3,900 ほど)では 1% に満たず、個体数のグラフでは読めない(再現で 5 種受け取っても、1 年後の総数の差は周りの揺れと見分けられなかった)
- 量は変えなかった。理由: 設計書 B5 の漂着は「島間の渡り・外来種」で、少数が浜に着き、そこから広がるか絶えるかを見るもの。量を上げても 1 セル 1 の頭打ちで総数は動かず、半径を広げると外来種が島の一角をいきなり占める(渡りの趣旨から離れ、積荷で他人の島を壊す、の防ぎ(設計書 §6)も弱まる)。見えるべきは「どこに着き、そこで増えるか」
- 直し: 受け取ったら、着いた浜のセルを選んだ状態にする(セルの詳細と「周辺 (半径 3) の密度 · 直近 5 年」のグラフが出る)。放たれた種の密度がそのセルで 0 から 0.25〜0.4 ほどに跳ね、その後の広がりも追える。目印の文は線の内側へ寄せ(右半分なら右揃え)、太字 18 px(表示で 9 px)にした。src/main.ts(2 行)・src/ui/graph.ts
- 直す前の落ち方: E2E は `#cell-panel` が `Expected: visible Received: hidden`。単体は `expected { text: '漂着 (胞子苔・草・狼)', x: 596, … } to match object { align: 'right' }` と `expected 10 to be greater than or equal to 18`

#### main.ts の変更(M19-16 と重なりうる所)

- `landCargo` の `hud.addMarker(…漂着…)` の直後に 2 行(`selected = cell; hud.showCell(cell, s);`)と注記 1 行を足しただけ

#### レビュー(`pstack:thermo-nuclear-code-quality-review` を自分で `git diff feat/m19...HEAD` に当てた)

- 直したこと: 自由モードの並べ方を `showAllFinished` として別に足していた(石板の `showFinished` とほぼ同じ 2 本)。並べる範囲を `finishedScope`、見出しを `finishedLabel` にして 1 本にした(36a0204)
- 見て直さなかったこと: `makeMovable` は判定の板にしか使っていないが、DOM の配線(pointer とキー)と位置の置き場を Tablet.ts の外に出すため、別のファイルにした(Tablet.ts は 260 行ほど)。`readOffset` の型の読み替えは sessionStorage の境界の 1 か所

#### テストが落ちた・揺れたもの(直していない)

- 機械の負荷が高い(load average 40 前後、ほかの agent が同時に回している)間の並列の通しで、`persist.spec.ts`「M19-05: 手動の枠に保存し…」(速さの札が安定せず click が切れる)、`harbor.spec.ts`「M19-09: 港を全部閉じても…」(網の失敗が 2〜6 秒かかり、既定の 5 秒の expect を越える)が落ちた。後者は、この直しを外した turnstile.ts でも同じに落ちることを確かめた(負荷による揺れで、この直しの回帰ではない)。1 worker の通しは下
