---
id: M19-09
title: 港のクライアントと、出港・一覧・訪問・照合の UI
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-08, M19-05]
evidence:
  - "d25ea5a feat(persist): 港の outbox と取り下げ鍵の置き場 harborStore"
  - "f18f9f0 feat(harbor): 港のクライアント createHarbor と、訪問の 1 クリック visitHref・出港の 1 クリック publishClick"
  - "3960272 feat(chronicle): 訪問の再生 createPlayback"
  - "ea02097 feat(ui): 港の画面(港の口・一覧・判定の板の出港・訪問の板と照合)"
  - "3ac8b9d test(harbor): wrangler dev とローカルの D1 の本物の港と通しで、出港 → 一覧 → 訪問"
  - "84b8097 refactor(harbor): レビュー対応"
  - "tests: tests/unit/harbor.client.test.ts, tests/unit/persist.harborStore.test.ts, tests/unit/chronicle.playback.test.ts, tests/unit/harbor.names.test.ts, tests/unit/ui.harborText.test.ts, tests/e2e/harbor.spec.ts, tests/e2e-cloudflare/harbor.spec.ts, tests/fixtures/fakeHarbor.ts"
---

# 港のクライアントと、出港・一覧・訪問・照合の UI

優先度: Should(設計書のドライバの優先度)

## What to build

設計書 §5.2。`createHarbor`(例外を投げず kind で返す。人間確認・閉港の読み替え・outbox・再送・取り下げ鍵の保管を裏に隠す。baseUrl が無ければ常に閉港)。UI は `src/ui/clicks.ts` に入口を足す(台本と UI が同じ入口)。訪問は 3D 観察画面へ。版違いの年代記は要約だけを見せる。島の名前は seed から作り、ひとことは碑文のカタログから選ぶ。

## Blocked by

M19-08, M19-05

## Acceptance criteria

- [x] page.route() で API を決定論的にモックし、出港 → リンク → 訪問 → 照合の E2E
  - `tests/e2e/harbor.spec.ts`「M19-09: 出港 → リンク → 訪問 (3D 観察画面) → 照合 (年表を読む) の一連」。ea02097・84b8097
  - 港の API は `page.route()` が港の写し `tests/fixtures/fakeHarbor.ts` で答える。要求は本物の Worker と同じ `readRequest` で読み、返事は `writeResponse`・`writeRefusal` で書く。Turnstile の script も `page.route()` で手元の偽物に替え、テストの sitekey と同じダミーの札を返す。`page.route()` はどれも `goto` の前に置く
  - 確かめていること: 判定の板に碑文 6 つが並ぶ → 「雨は来た」を選んで出港 → 港に届いた要求に人間確認の札と `Bearer` の取り下げ鍵(43 文字)→ 港の帳簿に石板・碑文・判定・年 → リンクの値が `/?scenario=test-civ&visit=<id>` → 一覧に 1 件(呼び名・「雨は来た」・「文明の試し読みを 5 年、生き延びた」・「まだ誰もたどっていない」・「あなたが出港した島」・取り下げの札)→ 「訪れる」で訪問の板と 3D 観察画面(10 倍速)→ 「年表を読む」で進みの棒 → 「読み終えた。港の記録と同じ結末になった」→ 港の写しが hash を比べて確認 1、板に「1 人がたどって確かめた」
  - 中断: 同じファイル「M19-09: 照合は「やめる」で止まり、もう一度読める」(止めたら確認を送らない)
  - 本物の港と通しでも 1 本: `tests/e2e-cloudflare/harbor.spec.ts`「本物の港と通しで: 判定のあとに出港 → 一覧に並ぶ → リンクで訪れると、港から引いた年代記の島になる (M19-09)」。wrangler dev とローカルの D1。Turnstile の script だけ手元で答え、札は Worker がテストの secret で siteverify に問う(網に出る。下の作業ログ)。3ac8b9d
- [x] API を全部閉じた状態で 1 シナリオ遊べ、出港が outbox に入り、開いたら同じ id で再送される(E2E)
  - `tests/e2e/harbor.spec.ts`「M19-09: 港を全部閉じても 1 シナリオ遊べ、出港は outbox に入る。港が開いてから開き直すと、同じ id・同じ鍵で送り直す」
  - 港の道をすべて網の失敗(`route.abort`)にして `test-quick` を判定(滅びた)まで遊ぶ → 出港は「港は今日は閉まっている。年代記は手元に預けた。…」、港の口に「預け 1」→ 一覧は「港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる」→ 港を開いて開き直すと、知らせの札「預けていた年代記 1 件を港へ出した」。送り直しの要求の年代記の id(Node で `chronicleId` を計算)と `Authorization` が、閉じていたときの要求と同じ。港の帳簿はその 1 件だけ
  - 単体: `tests/unit/harbor.client.test.ts`「閉港 (%s) は queued に読み替え、outbox に入れる。開いたら同じ id・同じ鍵で送り直す」を 4 通り(503 の閉港・1027 の画面・網の失敗・港の形でない 200 の index.html)
- [x] 不変条件: main.ts は静的アセット以外のネットワークに頼らずに起動する
  - `tests/e2e/harbor.spec.ts`「M19-09 不変条件: main.ts は静的アセット以外のネットワークに頼らずに起動し、遊べる (港の API と外の origin を全部断つ)」。外の origin と `/api/*` を全部断って、自由モードと石板の両方で起動し、100 倍速で年が進む。断った要求はログの送り(M19-02、失敗しても止まらない)だけで、港には起動で問い合わせない
  - 作り: 港の画面は起動を待たせない(`mountHarbor` は同期で返し、IndexedDB と碑文のカタログ(静的アセット)を裏で読む)。Turnstile の script は初めて確かめるときに読む(`src/harbor/turnstile.ts`)。訪問の道は石板を道に載せる(`visitHref`)ので、main.ts はその石板の島を普段どおりに組んでから港に問い合わせる
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - `pnpm run check`(84b8097): typecheck・eslint・ruff・vitest 98 ファイル 928 件・worker 5 ファイル 64 件・scripts 42 件、すべて通る
  - E2E: `pnpm exec playwright test`(E2E_PORT=5239、84b8097)41 件すべて通る。うち港は 4 件
  - `pnpm run test:e2e:cloudflare`(E2E_PORT=8839、84b8097)5 件すべて通る。`pnpm run check:free-tier` は「違反なし」
  - 既存コメントの削除なし: `git diff feat/m19...HEAD -U0 | grep -E '^-\s*(//|\*|/\*|#)'` は空

## 作業ログ

### 実装(2026-09-26、M19-09 の担当、worktree-agent-af3f8568607e08d21。基点は feat/m19 の 3e48254)

- **形**
  - `src/harbor/client.ts`: `createHarbor({ baseUrl, linkBase, store, catalog, turnstile, fetch?, newKey?, log? })`。`publish`・`flushOutbox`・`browse`・`visit`・`confirm`・`report`・`withdraw`・`ownIds`。港の答えは `Answer<T>`(読めた本文か断り)1 つにし、`ask`(本文のある道)と `tell`(本文の無い道、204 だけを受ける)で読む。閉港の読み替え: 1027 の画面・503・網の失敗・港の形でない返事(2xx で読めない本文、本文の無い道の 200)を、どれも `closed` にする
  - 出港の順: 港の契約と同じ `parsePublicChronicle`・`parseDigest`・`parseInscription` で先に断る → 取り下げ鍵を置く(`claimKey`、手元で作る。M19-08)→ outbox に入れる → 人間確認 → 送る。港へ届いたか契約で断られたら outbox から出す。閉港と「widget が読めない(網が無い)」は outbox に残して `queued`。`not_human`・`slow_down` は outbox から出す(もう一度押すと入れ直す)
  - 再送: 起動の後と 1 時間ごと(`src/ui/Harbor.ts`)。閉港が続けば 1 件目の `queued` でやめ、人間確認を何度も出さない。outbox の読めない行(カタログから石板が消えた等)は捨てて記録に残す。同時に呼ばれても 1 本にまとめる
  - 取り下げ: outbox に居れば出して再送を止め、手元の鍵で送る。港に無い(取り下げ済み)も ok にして鍵を忘れる。閉港なら鍵を残す(応答が失われて港に届いていた場合に、開いてから取り下げ直せる)
  - 訪問: 返事の `card.id` と `chronicleId(chronicle)` の一致を確かめる(M19-07 の申し送り)。食い違えば港の形でないので `closed`
  - `src/persist/harborStore.ts`: `outbox`・`keys` の store(`islandStore.ts` の `UPGRADES` の末尾に版 3)。島の置き場と同じ DB に、別の接続で開く(`openDb`・`requestDone`・`transactionDone` を export した)。IndexedDB が開けなければメモリ(そのタブの間だけ)
  - `src/chronicle/playback.ts`: 訪問の再生。フレームの刻みを命令の tick で切り、その tick で `runner.intervene` を打つ。照合の再生(`runChronicle`)と同じ順序の契約。速度 1x・100x とずれたフレーム間隔で、照合の再生と同じ hash になることを単体で示した
  - `src/ui/Harbor.ts`(港の口・一覧・判定の板の出港・知らせの札・人間確認の置き場)、`src/ui/HarborVisit.ts`(訪問の板と照合)、`src/ui/harborText.ts`(言葉、純粋な関数)、`src/ui/el.ts`、`src/ui/harbor.css`
  - `src/ui/clicks.ts`: `publishClick`(判定の瞬間の年代記と要約に、碑文を添える)と `visitHref`(`/?scenario=<石板>&visit=<id>`)。出港のリンク・一覧のカード・台本が同じ道を開く
  - `src/harbor/names.ts`: 島の呼び名とひとことの文。`src/harbor/turnstile.ts`: explicit render の widget
  - 設定: `VITE_HARBOR_URL`(`/` で同じ origin の `/api/v1/*`。空なら常に閉港)・`VITE_TURNSTILE_SITEKEY`(空ならテストの sitekey `1x00000000000000000000AA`)。`build:cloudflare` と playwright の dev サーバーに `VITE_HARBOR_URL=/` を足した
- **決めたこと**
  - **訪問はページの道にする。** `?scenario=<石板>&visit=<id>` で開くと、main.ts はその石板の島を普段どおり組み(seed・大きさ・種の上書きは live と同じ組み立て)、港から年代記を引いてから 10 倍速で打ち直し、3D 観察画面に入る(文明の集落が無い石板は 2D のまま)。M19-06 が残した「石板から島を組む処理を src へ移す」は、この形で要らなくなった(照合の再生も main.ts が組んだ `{ def, config }` をそのまま使う)。main.ts の既存コメントを動かさずに済んだ
  - 訪問では recorder を作らず(年代記を書かない・判定の板に出港を出さない)、介入を受けず、介入と島の入れ替えの列をしまう。島の進め方は `scenarioStep` に持たせ、年代記が届くまで止める
  - **照合は「年表を読む」の明示の操作。** Web Worker(`replayInWorker`)で回し、進みの棒・「n / N 年を読んだ」・「やめる」を見せる。読み終えたら要約を `confirm` で送り、港の数え直しを引いて板の「n 人がたどって確かめた」を更新する。hash の比べは港がする。手元の文(同じ結末・違う結末)は判定と年で言う
  - **島の呼び名は年代記の id から作る(設計書の「seed から」からの変更)。** 今の石板はどれも seed 42 で、seed だけでは同じ石板の島がみな同じ名になる。id は seed と介入の正規化 JSON の SHA-256 なので、同じ島はどのブラウザでも同じ名になる。カタカナ 3〜4 音と「の島・の環・の洲」
  - **碑文は静的アセットの `/data/inscriptions.json` を実行時に読む。** Vite は publicDir(`assets/`)の JSON を import させない。読めなければ碑文の無いカタログになり、出港の札は押せない
  - 版違いの島は、一覧でも訪問の板でも要約(呼び名・ひとこと・結末・「別の版 (版 n) の島。…」)だけを見せ、訪れる札と照合を出さない
  - `PublishResult` の `queued` に id を足した(UI と送り直しの確かめに使う)。`report` は `not_human`・`slow_down` も返す(人間確認がある)。港に無い年代記の通報は ok
  - 積荷(M19-10)と回避率(M19-11)の口は、`Harbor` に足していない(そのチケットで足す)
- **見た目**(`frontend-design`・`frontend-aesthetics` の考え方で)
  - 観察画面の知らせの帯(ムーの巨石と月鹿の装甲板の石の銘板)と同じ石: 青緑がかった石の面(#33504E → #182827)に六角の刻みと粒、面取りの縁の明かり、上の継ぎ目の青緑の光(#8FEADF)。港の板は四隅を落とした石の板にした(帯は両端を尖らせる)
  - 島の呼び名とひとことは明朝の刻んだ文字、操作は HUD と同じ小さな札。光らせるのは継ぎ目と「出港する」「訪れる」「年表を読む」だけ。一覧の石碑は左の刻みの色が結末(生き延びた緑・滅びた橙・逃れた青、判定の板と同じ色)
  - 港の口は左の縁に立てた石の札「港」。預けた年代記があれば金の字で「預け n」を縦に刻む
  - 言葉は「何が起き、次に何をするか」: 閉港は誤りではなく「港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す」。結末は「沈む欠片を 100 年、生き延びた」のように文にし、中黒でつながない
  - 画面の撮影(E2E のスクリーンショット、コミットしていない): scratchpad の `m19-09/shots/`(01 出港の碑文選び・02 出港のリンク・03 一覧・04 訪問の 3D 観察画面・05 照合の読み終わり・06 閉港で預けた・07 閉港の一覧)
- **テストが欠陥を捕まえるか**(scratchpad の使い捨ての脚本 `m19-09/mutate.py`、コミットしていない): 本文の無い道の 200 を 204 と読む・閉港でも outbox から出す・閉港でも再送を続ける・訪問の年代記の id を確かめない・widget が読めないのを人のせいにする・鍵が無くても作って送る・取り下げても鍵を残す・鍵を毎回作り直す(IndexedDB とメモリ)・命令の tick で刻みを切らない・弾かれた命令で止まらない、の 11 か所を 1 つずつ壊すと、11 とも単体テストが落ちる(84b8097 で再確認)
- **Cloudflare の E2E が網に出ること**: Worker の siteverify はテストの secret で本物の `challenges.cloudflare.com` に問う(M19-08 の作り)。網が無い場所では、この 1 本は 503(閉港)で落ちる。画面側の Turnstile の script は `page.route()` で手元で答える
- **レビュー**(`pstack:thermo-nuclear-code-quality-review` の手順で自分で、`git diff feat/m19...HEAD` に 2 回)
  - 1 回目(ea02097・3ac8b9d)で直した(84b8097)
    - `src/ui/Harbor.ts` が 1 つの閉包に 5 つの面(口と一覧・石碑・出港・訪問の板・照合)を持ち、どこも `await ready` を引いていた。訪問の板と照合を `HarborVisit.ts` に分け、港のクライアントと碑文が揃った文脈 `HarborContext` を渡して組む形にした(360 行 → 250 行と 98 行)
    - 返事の読み分けが `isRefusal`(`error` の鍵があるかで型を推測する型ガード)に頼っていた。`Answer<T>` の判別共用体にし、`ask`・`tell` で読む
    - main.ts に訪問の分岐が 5 か所(介入・年代記の書き込み・島の進め方の入れ子の三項・判定の板・再生の開始)散っていた。訪問では recorder を作らないことにし(年代記の書き込みと出港の差し出しの分岐が消える)、島の進め方を `scenarioStep` の差し替えにした
    - 石碑の結末の色の表が恒等写像(alive → 'alive')だった。消して判定をそのまま class にした
    - 通報・取り下げの言葉が画面のコードに埋まっていた。`harborText.ts` へ移して単体で確かめる
    - 碑文の id の `as InscriptionId` を、カタログを読む境界(`parseInscriptions`)の 1 か所にした。Turnstile の widget の id を DOM の dataset に預けていたのを、局所の変数にした
  - 2 回目(84b8097): 新しい構造の後退・1,000 行を越えるファイル・場当たりの分岐は無し。残したもの: main.ts の介入の入口の `if (visitId) return false`(recorder が無いと自由モードの直の dispatch に落ちるので要る)。`publish` と送る直前の 2 か所で `claimKey` を呼ぶ(outbox の行はどれも鍵を持つ、という不変条件を入れる前に立てるため。2 回目は読むだけ)
  - 大きさ: client.ts 245 行、Harbor.ts 250 行、HarborVisit.ts 98 行、harborText.ts 113 行、harborStore.ts 93 行、turnstile.ts 87 行、playback.ts 45 行
- **M19-14(シナリオの続きから)と重なる所**(別の agent が同時に作っている。衝突しそうな所)
  - `src/persist/islandStore.ts` の `UPGRADES`: M19-14 も末尾に版 3(`scenarios`)を足している。合わせるときは両方を残し、どちらかを版 4 にする(まだ配っていないので、どちらが 3 でもよい)
  - `src/main.ts` の `saveChronicle`・`recorder = …` の行: M19-14 が `saveChronicle` を `scenarioAutosave?.flush()` に、`recorder = recordChronicle(` を `const scenarioRecorder = …` に書き換えている。こちらは `recorder = visitId ? null : recordChronicle(` に変えたので、同じ行で衝突する
  - 意味の衝突: 訪問のあいだは石板の自動保存(M19-14 の `createScenarioAutosave`)を作らないこと。作ると、訪れた他人の島が自分の石板の続きとして保存される。また M19-14 の続きからの復帰(`resumeScenario`)も、訪問の道では飛ばすこと
- **残したこと**
  - 訪問の再生で打てない命令(壊れた年代記)に着くと、島はそこで止まるが、板には出していない(照合の「年表を読む」が壊れた場所を言う)
  - 1 時間ごとの再送で人間確認が要ると、遊んでいる途中に確認の板が出る(Turnstile の managed は多くの場合操作なしで通る)。配った先で様子を見る
- 2026-09-27 直し(M19-10 と同じ worktree、fc03159・833a146): 訪問中の観察画面の下の帯が「0 年」のままに見えた。年は進んでいたが、観察画面は 10 倍速までで 1 年に実時間 36 秒かかり、年だけでは止まって見えた。帯を「N 年 · 季節」(`src/core/season.ts` の `observeYearText`、HUD と同じ区切り)にし、9 秒ごとに進みが見えるようにした。tests/unit/core.season.test.ts、tests/e2e/observe.spec.ts の 2 か所の形を合わせた。
