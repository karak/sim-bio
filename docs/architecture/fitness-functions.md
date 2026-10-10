# 適応度関数の一覧

アーキテクチャの性質を、文書でなく機械で守っている検査の一覧。ドライバの ID はレビュー `docs/design/2026-10-10-architecture-review.md` §2、方針は ADR `docs/decisions/0002-architecture-fence.md`。
新しい柵を足したら、この表にも 1 行足す(目的・測定対象・指標・合格基準・実行・置き場)。閾値を変えるときは置き場の値と表の値を一緒に変える。

「実行」の列: **check** = `pnpm run check`(push と PR の CI でも走る)、**CI** = ci.yml の check の後の段、**手動** = 人が回す。

## 1. 構造(層の向き・循環・大きさ)

| ID | 目的(守るドライバ) | 測定対象 | 指標 | 合格基準 | 実行 | 置き場 |
|---|---|---|---|---|---|---|
| FF-01 | 層の向きを一方向に保つ(設計書 09-19 §4、G1・G2) | `src/<層>/**` と `worker/src/**` の静的な import | 読んではいけない層への相対 import の数(表 `FORBIDDEN`、深さ 1〜3) | 0 件 | check(lint) | `layering.config.mjs`、`eslint.config.js` の `no-restricted-imports` |
| FF-02 | 同上を、eslint が見ない動的 import と深い相対パスにも当てる | `src/**`・`worker/src/**` の全 import(TypeScript の AST。`import type` は除く) | `FORBIDDEN` に当たる辺の数 | 0 件 | check(unit) | `tests/unit/architecture.test.ts` 「層の向きは動的 import と深い相対パスでも守る」 |
| FF-03 | 周辺モジュールの循環を再発させない(R1) | src の層の間の値の import(型だけの辺と、entry・dev からの辺は除く) | 閉路の数 | 0 本 | check(unit) | 同上 「src の層の間に、値の import の循環が無い」 |
| FF-04 | 描画ライブラリを本体・UI・保存・港に入れない(G1) | `three` / `three/*` を import する層 | 層の集合 | `{observe, render}` と一致 | check(unit)+ lint | 同上 「three.js を読むのは render と observe だけ」、`eslint.config.js` の simulation の塊 |
| FF-05 | 本体の依存を最小に保つ(G1、設計書 §2 #8) | `src/simulation/**` が読む外部パッケージ | パッケージの集合 | `{simplex-noise}` と一致 | check(unit) | 同上 「simulation が読む外部パッケージは simplex-noise だけ」 |
| FF-06 | Worker に本体・UI・保存を持ち込まない(C2、Q9) | `worker/src/**` が読む `src/` の層 | 層の集合 | `{chronicle, core, harbor}` と一致 | check(unit) | 同上 「worker が src から読むのは…」 |
| FF-07 | main.ts を配線だけに保つ(設計書 §4、R2) | `src/main.ts` | 行数(改行の数) | ≤ 265 | check(unit) | 同上 `FILE_LINES['src/main.ts']` |
| FF-08 | ファイルの肥大を止める(R2、Development) | `src/**`・`worker/src/**` の各ファイル | 行数 | 既定 ≤ 700。例外は表 `FILE_LINES` の今の値以下(`observe/view.ts` 1074、`simulation/World.ts` 985) | check(unit) | 同上 「ファイルは上限の内」 |
| FF-09 | 関数の肥大を止める(R2) | 全関数の本体(宣言・式・アロー・メソッド) | 本体の行数 | 既定 ≤ 150。例外は表 `LONG_FUNCTIONS` の今の値以下(`boot` 225、`createObservationView` 836 ほか 11 件) | check(unit) | 同上 「本体 150 行を超える関数は表のものだけ」 |

## 2. 本番の形(開発の口・配布物・費用)

| ID | 目的(守るドライバ) | 測定対象 | 指標 | 合格基準 | 実行 | 置き場 |
|---|---|---|---|---|---|---|
| FF-10 | 本番の bundle に試験・開発の口を入れない(C11、F9) | `vite build`(production、`VITE_DEVTOOLS` 無し)の出力 JS | 印 7 つ(`__probe`・`advanceTo`・`x-dev-sender`・`biotope-dev-snapshot` ほか)と旧名 2 つの出現 | 0 個。受入のビルド(`VITE_DEVTOOLS=1`)では 7 つ全部ある(空振りでないこと) | check(unit) | `tests/unit/build.devtools.test.ts` |
| FF-11 | 課金になる構成を入れない(Q1・B7・C1・C3) | `wrangler.jsonc`、`assets/.assetsignore`、`dist/` | 許可リスト外の key、`usage_model`、R2/KV/Queues/AE/AI/DO 等の binding、`*.blend`・`textures/concept/**` の配布、dist のファイル数と 1 ファイルの大きさ | 違反 0 件。dist ≤ 20,000 ファイル、1 ファイル ≤ 25 MiB | CI(check の後)、deploy | `scripts/check_free_tier.py`、`ci.yml`・`deploy.yml` |
| FF-12 | 配るもの・配らないもの・知らない道の扱い(B1、Q2) | `wrangler dev` の静的配信 | `.assetsignore` の対象が 404、SPA の fallback が index.html、`/api/*` だけ Worker | 期待どおり | CI(`test:e2e:cloudflare`) | `tests/e2e-cloudflare/harbor.spec.ts` 「配るもの・配らないもの・知らない道」 |
| FF-13 | README に運用の手順を書かない(B10、check_readme) | `README.md` | 見出しの集合、運用の印(コマンド・鍵・URL の形)、行数 | 見出しは `ALLOWED_HEADINGS` の内、印 0 件、≤ 200 行 | check | `scripts/check_readme.py` |

## 3. 決定論

| ID | 目的(守るドライバ) | 測定対象 | 指標 | 合格基準 | 実行 | 置き場 |
|---|---|---|---|---|---|---|
| FF-14 | 結末が速度とフレーム間隔に依らない(Q3、C6) | 同じ seed・同じ介入を 1x/10x/100x/1000x とフレーム間隔 4 通りで回した結末 | 台本(年の境目ごとの update)の結末との一致 | 4 通り全部一致。年の途中のクリックも記録 tick の再生で一致 | check(unit) | `tests/unit/scenario.determinism.test.ts` 「決定論の刻み (M19-04)」 |
| FF-15 | 本体の規則を変えたら版を上げる(G5、C5) | 固定の年代記を再生した結末の Digest | SHA-256 が `GOLDEN[SIM_VERSION]` と一致。版ごとの hash がすべて違う | 一致(違えば `SIM_VERSION` を上げて golden を足す) | check(unit) | 同上 「golden replay (M19-04)」 |
| FF-16 | 訪問者のブラウザの再生が同じ結末になる(B4、Q8) | Chromium の Web Worker で再生した Digest | golden の hash との一致 | 一致 | CI(E2E) | `tests/e2e/chronicle.spec.ts` |

## 4. 劣化の非対称と無料枠の内側(港)

| ID | 目的(守るドライバ) | 測定対象 | 指標 | 合格基準 | 実行 | 置き場 |
|---|---|---|---|---|---|---|
| FF-17 | 港が閉まっても遊ぶ・保存するは止まらない(Q2) | 港の API を全部閉じた状態の 1 シナリオ | 判定まで遊べること、出港が outbox に入ること、開港後に同じ id・同じ鍵で再送されること | 全部成り立つ | CI(E2E) | `tests/e2e/harbor.spec.ts` 「M19-09: 港を全部閉じても 1 シナリオ遊べ…」。E2E 全体が `createHarbor` の既定(baseUrl 無し = 常に閉港)で走る |
| FF-18 | D1 の無料枠の内で自分から閉まる(Q1、§6.1) | Worker の日次予算(ローカル D1) | 出港 2,000 件で 503 `budget`、`Retry-After` は UTC 0 時まで、捨てる順(logs > confirm > browse > cargo > publish > visit) | 期待どおり。訪問は最後まで開く | check(`test:worker`) | `worker/test/budget.test.ts` |
| FF-19 | 日次の掃除で保存量を内側に保つ(Q4) | Cron の `sweep` | 昨日までの通報の送り手・7 日より古い積荷と予算・隠して 30 日の年代記が消え、見える年代記は残る | 期待どおり | check(`test:worker`) | `worker/test/cron.test.ts` |

## 5. 読みやすさ・見た目(受入の機械化)

| ID | 目的(守るドライバ) | 測定対象 | 指標 | 合格基準 | 実行 | 置き場 |
|---|---|---|---|---|---|---|
| FF-20 | 文が読める(G6、ADR 0001) | 正本で `checks: legible` の付いた画面の文字の箱 | 覆われていない(箱の 5 点)、画面の内、横に切れていない(許す欄の表を除く)、コントラスト比(背景は文字を透明にした画から)、画面の上の字の大きさ(canvas は `font × clientWidth / width`) | 覆い 0、はみ出し 0、コントラスト ≥ 4.5、字 ≥ 11px | CI(E2E) | `tests/e2e/lens.ts`(`MIN_CONTRAST`・`MIN_FONT_PX`) |
| FF-21 | 板と札のずれと文の変わりを見る(G4) | 要素ごとの画(clip)と基準画 | 色の差(YIQ、`threshold` 0.2)を越える画素の割合 | ≤ 0.02。字が大半の細い板 4 要素は ≤ 0.12 | 手動(Mac、`pnpm run shots`。更新は `shots:update` と審査台の承認) | `tests/e2e/baseline.ts`、`tests/e2e/baselines/` |
| FF-22 | 受入の正本が指す試験が実在する(P2) | `docs/acceptance/scenarios.jsonl` の `covered_by`・`checks`・`judge` | 題名の一致するテストがあるか、札の付いた手順に checks か judge があるか | 不一致 0 件 | check(`test:scripts`) | `scripts/acceptance.py check`(`scripts/test_acceptance.py` から) |

## 6. 手動で回すもの(数は票の作業ログに残す)

| ID | 目的(守るドライバ) | 測定対象 | 指標 | 合格基準 | 実行 | 置き場 |
|---|---|---|---|---|---|---|
| FF-23 | 観察画面の性能予算(Q8) | 寄せ先 6 画(集落・船台・群れ・林・狼・海岸) | 三角形・draw call・fps(`__probe.observe.stats()`) | draw call ≤ 200、三角形 ≤ 1.5M、60 fps(M23 の計測 303k 三角形) | 手動(`pnpm run bench:observe`、前後比較は `bench:observe:compare`) | `tools/bench-observe.ts`、`docs/design/2026-09-24-observe-perf.md` |
| FF-24 | 石板が「体験として」成立する(P1、B9) | 各石板の通し実行(放置・素朴な手・配分の手。UI と同じ手: 環 1・0.5・力 4) | 判定 | 放置 dead・素朴 dead・配分 alive | 手動(`pnpm run test:slow`、15〜20 分、CI に入れない) | `tests/slow/scenarios.playthrough.test.ts` |

## 足し方

1. 守りたい性質をドライバの ID で言う(無ければレビュー §2 に足す)。
2. いちばん強い仕組みを選ぶ(型で表せない状態 → lint → 試験 → 実行時の検査の順)。
3. 閾値は「今の値」で置き、下げる方向にだけ書き換える(ラチェット)。
4. 柵が本物かを確かめる: わざと違反を置いて落ちるのを見てから消す(M27-01 の作業ログの形)。
5. この表に 1 行足す。
