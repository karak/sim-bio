# 受入の確かめの再設計: jsonl の正本・人の 1 周を 2 行に・残りはロジックの試験へ (M21-06〜08)

2026-09-29。ユーザーの依頼:
- 「いまある全ての受入試験の手順書の正本を適切なjsonl形式でSoT化。Gherkin形式。IDを固有のアルファベットコードつきで採番して管理」
- 「今後、手動のE2Eではなく、ビジネスロジックを抽出して自動化することをタスクとして起票」
- 「正直な話、待機時間も含めても手間がかかりすぎます。複数人ケースやバリエーションのあるものなどはロジックテストに任せる方向で再設計してください」

## 1. 何が重かったか

受入の手順は `.claude/acceptance/items.json`(git の外、手書き)にあり、回ごとに id を付け直していた(`a-*`・`r2-*`)。`base` を説明文で上書きして全部のリンクが壊れた。1 回目は 10 件のうち 7 件が保留で、理由の多くは手順そのものの重さだった: 3 つのタブと `player=` で見守り手を分ける、積荷に 2 つの島、DevTools で閉港を作る、100x で判定や成功まで待つ。

一方で、ほぼ全部の手順に CI で通る E2E か単体の対がもうあった。人は CI が見ていることを、手で、ゆっくり繰り返していた。人にしか判じられないのは見た目・読みやすさ・手触りと、本番にしか無いもの(本物の Turnstile・Cloudflare の Observability)だけ。

## 2. 形

| もの | 場所 |
|---|---|
| 正本 | `docs/acceptance/scenarios.jsonl` |
| 道具 | `scripts/acceptance.py`(check・page・feature・next)、`scripts/test_acceptance.py` |
| 受入の画面 | `.claude/acceptance/`(git の外、実行の場所)。`items.json` は生成物、`results.json` はユーザーの判定 |
| 起票 | issues/M21-06(正本と道具)・M21-07(ロジックの抽出)・M21-08(画を撮る、Could) |

### 2.1 正本の行

1 行 1 JSON。知らない鍵は誤り。

- `{"kind": "code", "code": "HBR", "name": "港", "background": [...]}`: 領域。`name` が Gherkin の 機能、`background` は受入の画面の「始める前に」になる。
- `{"kind": "scenario", ...}`: Gherkin の 1 シナリオ。
  - `id`: `<領域 3 字>-<3 桁>`。領域ごとに 001 から穴なく詰める。行は消さず `status: retired` と `retired {on, reason, replaced_by}` にする。行を消すと穴が空いて check が落ちる(一度付けた id を使い回さない)。新しい番号は `next <領域>`。
  - `mode`: `human`(人が判じる)か `auto`(covered_by の自動の試験に任せる)。確かめ方は id に入れない(人から自動へ移しても id と履歴が続く)。
  - `steps`: `[["前提", 文], ["もし", 文], ["ならば", 文], ...]`。キーワードは 前提・もし・ならば・かつ・しかし。前提 か もし で始め、ならば を持つ。`feature` で `# language: ja` の Gherkin の文として読める。
  - `covered_by`: `[{file, title, planned?}]`。title はそのファイルの試験の題名(の一部)。check が実在を見る。`planned` はまだ無い試験を約束するチケットで、試験ができたら外す(check が言う)。active の auto は今ある試験を 1 つ以上持つ。
  - `from`: 再設計の前の手順書の id(results.json の鍵)。1 つの旧 id を複数の行が引いてよい(見た目は人の行、論理は auto の行)。
  - human だけ: `when`(`round` = 人の 1 周、`deploy` = 配ったあとの本番)、`minutes`、`links`(`/` で始まる根からの道。`player=` は使わない)、`judge`(人が判じる範囲)。1 回の minutes の和は 15 分まで(check)。

### 2.2 受入の画面

`pnpm run acceptance:page`(`-- --when deploy` で本番の回)が正本から `items.json` を書く。

- `base` は環境から: round は wrangler dev(wrangler.jsonc の `dev.port`、無ければ 8787)、deploy は `https://<name>.<サブドメイン>.workers.dev`。書く前に GET し、答えなければ書かない。手で書く口は無い。
- `round` は日付・枝・短い SHA(git から)。`prep` は出す行の領域の background。
- 項目は active の human の行だけ。項目ごとに `judge` と、`from` の旧 id の判定とメモ(`history`)を添える。
- `delegated` に任せた行と試験の一覧を添える(判定の札は無い)。
- results.json は読むだけ。新しい判定は新しい id で同じファイルに書かれ、旧い鍵は残る。どの行にも当たらない鍵があれば書かずに落ちる。

## 3. 振り分け(旧い 27 件 → 正本の 39 行)

`*` は人の行。ほかは auto(`(退役)` は retired)。人の行は 4 つ、auto は 34、退役 1。

| 旧 id | 正本の行 |
|---|---|
| a-free-resume | SAV-001・SAV-002・SAV-003 |
| a-scenario-resume | SAV-004・SAV-005(退役)・STG-006 |
| a-publish-visit | TUR-001*・HBR-001・OBS-001 |
| a-browse | HBR-002・HBR-003 |
| a-closed | HBR-004 |
| a-late-publish | HBR-005 |
| a-cargo | CRG-001・CRG-002・CRG-003 |
| a-avoidance | AVD-001・AVD-002 |
| a-logs | LOG-001 |
| a-determinism | DET-001 |
| r2-closed | HBR-004 |
| r2-late-publish | HBR-005 |
| r2-publish-visit | TUR-001*・HBR-001・BRD-001・OBS-001 |
| r2-browse | HBR-002・HBR-003・DEV-002 |
| r2-cargo | TUR-002*・CRG-001・CRG-002・CRG-004 |
| r2-avoidance | AVD-001・AVD-003 |
| r2-scenario-slot | SAV-006 |
| r2-cross-stage | STG-001 |
| r2-restart | STG-003 |
| r2-url | STG-002・STG-004・STG-005 |
| r2-snapshot | TUR-002*・DEV-001 |
| r2-cell-highlight | TUR-002*・SEL-001・SEL-002 |
| r2-confirm | TUR-002*・CNF-001 |
| r2-verdict-save | SAV-007 |
| r2-board-regress | TUR-001*・BRD-001 |
| H9 | OPS-001* |
| H10 | OPS-002* |

人から外したもの(どれも auto の行の covered_by の試験が見る): 複数の見守り手(HBR-002 は e2e-cloudflare の 3 人の通報と worker の試験)、2 つの島(CRG-001〜004)、DevTools の閉港(HBR-004)、成功までの待ち(AVD-001)、舞台 × 枠・URL の組(STG-*)、操作 × 状態の確かめ(CNF-001)。

## 4. 人の確かめ

| id | いつ | 見るもの | 分 |
|---|---|---|---|
| TUR-001 | 人の 1 周 | 帆の試し読み (`/?scenario=test-ship&dev=1`) を 1000x で判定まで通す。3D の絵、判定の板の手触り、回避率の行、出港 → 訪問 → 年表の読みやすさ | 5 |
| TUR-002 | 人の 1 周 | 自由モード (`/?dev=1`)。選んだセルの帯とピン、TUR-001 の積荷を受け取った目印、確かめの板の感じ、状態を送る | 4 |
| OPS-001 | 配ったあと | 本物の Turnstile で出港 → 訪問 → 年表、回避率の行 (H9) | 5 |
| OPS-002 | 配ったあと | Observability の CPU・429・cron の行 (H10) | 5 |

人の 1 周は 9 分(帆の試し読みは 1000x で 20 秒以内に判定)。2 つ目の島・タブ・DevTools は要らない。どの行の steps も【見た目】【読みやすさ】【手触り】の札の付いた所だけを判じ、数・順・保存は自動の試験に任せる。

## 5. ロジックの抽出 (M21-07)

E2E でしか見ていない判断は、main.ts の閉包と Harbor.ts の DOM の組み立ての中にある。これを純粋な関数に出し、操作 × 舞台の組を表の単体試験にする。

| 関数 | 置き場 | 出どころ |
|---|---|---|
| `planOp(op, at, titleOf): {ask, effects}` | `src/app/place.ts` | main.ts の `load`・`onNewIsland`・`onSlotSave`・`leaving`・`selectScenario`(askOf と planSlotLoad はそのまま使う) |
| `bootPlanOf`・`searchFor`・`slotControlsOf` | 同じ | main.ts の起動、Hud.ts の枠の札 |
| `afterVerdictOf`・`finishedScopeOf`・`cardActionsOf` | `src/harbor/dock.ts` | main.ts の `onVerdict`、Harbor.ts の `finishedScope`・`cardItem` |
| `planLanding` | `src/harbor/cargo.ts` | main.ts の `landCargo` |

試験の題名は正本の covered_by に `planned: "M21-07"` で先に書いてある。できたら planned を外す(check が言う)。

見つけたこと(未確かめ): `selectScenario` は `scenario` 以外の検索語を残すので、訪問の中で石板を選ぶと `visit=` が残り、違う石板の訪問として開き直すかもしれない。M21-07 で決めて作業ログに書く。

## 6. 選ばなかったもの

- **`.feature` のファイルを正本にし、jsonl を索引に**: 同じことを 2 か所に持つ。Gherkin の文の読み取りは stdlib で書くと大きい。
- **確かめ方を id に入れる(`CNF-H01` など)**: 人から自動へ移すと id が変わり、判定の履歴が切れる。
- **results.json を新しい id へ写す(1 対多に複写)**: ユーザーの判定を書き換え、同じ判定が別の挙動の行に重なる。読むだけにして、新しい項目の下に旧い判定を出す。
- **手動の 25 件を短くして残す**: 複数人と閉港は人の側で揃えられない(1 回目の保留の理由そのもの)。
- **受入の画面 (index.html・server.mjs) を repo へ移す**: 手で書いて壊れたのは items.json で、生成に替えた。画面を移すのは別の作業にする。

## 7. 決め方の記録

3 つの案 (opus・fable・sonnet) を並べて書かせ、別の審査 (fable) が採点した(fable 28・opus 27・sonnet 16)。形は fable の案(code の行、人の 1 周を通しの 2 行、`test:scripts` の中で検査、画面は少し足すだけ)。auto の行の中身と検査の規則(`player=`・根からの道・planned・base を GET)、M21-07 の中身は opus の案から。旧い 27 件の取りこぼしを試験で縛るのと、M21-07 の「この票で移さないもの」は sonnet の案から。sonnet の M23-01・M23-02 は既にある票の id と重なり、results.json の書き換えはユーザーのデータを変えるので採らなかった。
