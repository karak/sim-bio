---
id: M19-02
title: Cloudflare 配信
status: review
milestone: M19
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M21-01, M21-02, M21-03, M19-03]
evidence:
  - "3a58e30 feat(cloudflare): Workers Static Assets・/api/v1/logs の受け口・.assetsignore・deploy.yml(workflow_dispatch)"
  - "d100687 fix(cloudflare): レビュー対応(件数の上限を 1 つに、parse の共通の形、配備は main だけ、wrangler を root へ、Workers Logs は 3 日保持)"
  - "b3c1485 fix(cloudflare): 再レビュー対応(コメントを原文に戻す、ログの固定の鍵を型で閉じる、テストの置き場と beacon の競合)"
  - "tests: worker/test/logs.test.ts, tests/unit/log.batch.test.ts, tests/unit/log.httpSink.test.ts, tests/e2e-cloudflare/harbor.spec.ts"
---

# Cloudflare 配信

## What to build

静的ビルドを Cloudflare に配信し、ログの受け口(Worker)が JSON を受けて保管する。

## Blocked by

M21-01, M21-02, M21-03, M19-03

## Acceptance criteria

- [x] wrangler の設定と配信スクリプト。ビルド成果物がそのまま配信される
  - 設定: `wrangler.jsonc`(assets.directory `./dist`、`not_found_handling: single-page-application`、`run_worker_first: ["/api/*"]`、`observability.enabled`、compatibility_date 2026-09-25)、`assets/.assetsignore`(vite が `dist/.assetsignore` へ写す)。3a58e30・d100687
  - 脚本: `npm run build:cloudflare`(`VITE_LOG_URL=/api/v1/logs vite build`)、`npm run dev:cloudflare`(wrangler dev)、`npm run test:e2e:cloudflare`。配備は `.github/workflows/deploy.yml`(workflow_dispatch のみ、main のみ、Environment `production`)
  - 手元の証跡: `tests/e2e-cloudflare/harbor.spec.ts` の「配るもの・配らないもの・知らない道」が、wrangler dev の上で `.glb`・`data/*.json` はそのまま、`.blend`・コンセプト画・デザインボード・`textures/observe`・`/models/*.glb`・`.gitkeep`・`.assetsignore` は SPA の fallback(index.html)になり、知らない `/api/*` は 404 になることを確かめる。`.assetsignore` の `*.blend` の行を外すと落ちることも確かめた。`wrangler deploy --dry-run` で設定が読めることも確かめた(アップロードはしていない)
  - **実際の配信は、配備がユーザーの許可待ち。** 配った先の URL で同じことを確かめるのは配備のあと
- [x] ログ受け口の Worker が POST を受けて保存し、不正な形を 400 で返す(単体テスト)
  - `worker/src/index.ts`。検証は `src/core/log/batch.ts` の `decodeLogBatch`(HTTP LogSink の `encodeLogBatch` と同じファイル)。「保存」は設計書の方針どおり Workers Logs(`console.*` に JSON 1 行)で、D1 は使わない
  - `worker/test/logs.test.ts`(20 件、`@cloudflare/vitest-plugin` で workerd の中): 「バッチの記録を 1 件ずつ JSON 1 行にして、level に合う console へ書き、204 を返す」「JSON でない本文は 400 で、理由を返す」「形が違えば 400 で、どこが違うかを返し、1 件も書かない」「上限を 1 バイト超える本文は 413」「申告の Content-Length が上限を超えていたら、中身が小さく正しくても読まずに 413」「Content-Length の無い本文 (stream) でも、読みながら上限で止めて 413」「別の Origin / Origin が無い からの POST は 403 で、中身を読まない」「Sec-Fetch-Site が cross-site / same-site なら 403」「POST 以外は 405 で、Allow を返す」「/api/* のほかは 404」など
  - `tests/unit/log.batch.test.ts`(24 件): 往復・境界値・拒否の場所。`tests/unit/log.httpSink.test.ts`「バッチは受け口の件数の上限を超えない」(2 件)
  - **配った先の Workers Logs に行が出ることは、配備がユーザーの許可待ち。** ローカルでは wrangler dev の出力に `harbor.logs.record` の行が出ることを E2E で確かめた
- [x] 配信手順を README に
  - `README.md` の「Cloudflare へ配る」(手元での確かめ方、配備の手順、専用の Cloudflare アカウント、支払い方法を登録しない、Environment `production` の Secrets の名前 `CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`、Workers Logs の枠)。3a58e30・d100687
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - `npm run check`(typecheck: root と worker の tsc と `wrangler types --check`、lint、vitest、worker のテスト)が通る。vitest の通し 88 ファイル 801 件、worker 20 件(b3c1485 で通し)。docs の commit のあとの `npm run check` では、`tests/unit/data.test.ts`(100 年の共存)と `tests/unit/firelizard.test.ts`(噴火の副作用)の 2 件が時間切れになった。2 件だけを回し直しても 1,961 秒かかって時間切れ。どちらも World と memorySink しか import せず、M19-02 の変更に触れない。放置中の Mac で背景の実行が遅くなる現象と見る(README の注意)。前面で回し直して確かめる
  - E2E: `npm run test:e2e:cloudflare` は 3 件すべて通る(b3c1485、wrangler dev の上。ログが 1 バッチ届く・sendBeacon が 204・配るものと配らないもの)
  - E2E: `npx playwright test`(E2E_PORT=5197)は 33 件のうち 32 件が通り、1 件が落ちる。落ちるのは `tests/e2e/smoke.spec.ts` の「warnings: 種 id 付きの警告 (狼の波) に「〜を見る」チップが出て、押すと狼レイヤーが開く (M21-02 D5)」。M19-02 の変更によるものではない
    - 同じ手順(`--repeat-each 3 --workers 1`)で、M19-04 を取り込む前の 540ef0e は 3 件とも通り、M19-04 を取り込んだ feat/m19 の 4c8e929 は 3 件とも落ちた。単発では 4c8e929 と d100687 で 1 回ずつ通ったので、負荷で揺れる
    - 落ち方: 100 倍速で、警告「狼の群れが北の谷に下りた」の文が見えたあと、「狼を見る」のチップが見つからないか、押す前に DOM から外れる。snapshot は 2〜3 年目。M19-04 の刻みの直し(stepByYear)で、警告が石板に残る間が短くなった疑い。M19-04 の持ち主に回す(M19-02 では runner と ScenarioRunner に触れない)
  - CI(`.github/workflows/ci.yml`)の check に worker のテストが入り、E2E のあとに `npm run test:e2e:cloudflare` を走らせる。push はしていないので、CI の上ではまだ動かしていない

## 作業ログ

- 2026-09-26 設計書(docs/design/2026-09-26-cloudflare-architecture.md)に合わせた方針: Workers Static Assets で配り、港の Worker と同じ 1 本に同梱する(`/api/*` だけ fetch handler、SPA の fallback は Worker を起こさない)。配備は GitHub Actions(lfs: true)から `wrangler deploy`。`.assetsignore` で `*.blend` と `textures/concept/**` を配らない。ログの受け口は Workers Logs に書く(「保管」は D1 ではなく Workers Logs の 7 日)。港の API は M19-08 以降、構成検査は M19-12。
- 2026-09-26 実装(agent、worktree-agent-acd469ea90874ba1e。基点は feat/m19 の 540ef0e、途中で 4c8e929 を取り込み)
  - **docs で確かめたこと**(Cloudflare docs の MCP、2026-09-26)
    - run_worker_first の配列と SPA: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ ・ https://developers.cloudflare.com/workers/static-assets/binding/
    - .assetsignore(assets のディレクトリの根に置く、.gitignore の書式): https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets
    - Workers Logs の有効化と枠: https://developers.cloudflare.com/workers/observability/logs/workers-logs/ 。無料は 1 日 200,000 件・**3 日保持**(7 日は Paid): https://developers.cloudflare.com/workers/platform/pricing/#workers-logs 。上の 2026-09-26 の方針と設計書 §3.1・§3.2・§4.2 の「7 日」は無料では 3 日。設計書は直していない(持ち主の判断)
    - Vitest の統合は `@cloudflare/vitest-pool-workers` から `@cloudflare/vitest-plugin` に改名(2026-08-19)、vitest ^4.1 が要る: https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/ ・ https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/
    - GitHub Actions からの配備(トークンは Edit Cloudflare Workers のテンプレート): https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
    - wrangler types と GlobalProps: https://developers.cloudflare.com/workers/languages/typescript/
  - **vitest の両立**: `@cloudflare/vitest-plugin` 1.2.8 は vitest 5.0.1 で起動しなかった(scratchpad の試作で、miniflare の proxy が `SyntaxError: Unexpected identifier 'file'`)。vitest 4.1.11 では通った。そこで `worker/` を npm workspace に分け、そこだけ vitest 4 を持つ。本体は vitest 5 のまま
  - **LogBatch の置き場**: `src/core/log/batch.ts`(型・上限・encode・decode)と `src/core/parse.ts`(`Parsed`・`ParseError`・`fail`・`isObject`)。ログは港の契約ではなく本体の観測の仕組みなので `src/harbor/` には置かない。M19-07 の `src/harbor/contract.ts` は `src/core/parse.ts` を import すれば、ログに依存せずに同じ拒否の形を使える
  - **上限**: 本文 64 KiB(Content-Length の申告と、読みながらの量の両方)、1 バッチ 20 件(HTTP LogSink の既定と上限を同じ値にした。超えると 400 で、LogSink は送り直さずに捨てるため)、ts 64 文字、event 128 文字
  - **Origin**: 書き込みは `Origin` がこの Worker と同じか、`Sec-Fetch-Site: same-origin` のときだけ。認証ではない(curl なら偽れる)。枠を守る本当の栓は M19-08 の日次上限
  - **レビュー**: codex は `codex exec` が「access token could not be refreshed」で動かなかった(`codex login` のやり直しが要る)。代わりに `pstack:thermo-nuclear-code-quality-review` の手順で別の agent に 3 回頼んだ
    - 1 回目(3a58e30): blocker 0、should 7。件数の上限が 2 か所(F1)、parse の部品が log の中(F2)、配備がどの branch からでも起こせる(C1)、root が宣言していない wrangler に頼る(C2)、Workers Logs の保持は無料で 3 日(D1)、Content-Length の事前確認を守るテストが無い(T1)、sendBeacon の道を本物の受け口に当てていない(T2)。すべて d100687 で直した
    - 2 回目(d100687): blocker 1。3a58e30 で書いたコメント 2 つを書き換えていた(既存コメントの削除禁止)。b3c1485 で原文に戻し、新しい文は後ろに足した。nit(固定の鍵を型で閉じる、テストの置き場と全バッチの検査、package.json の escape、beacon の競合)も直した
    - 3 回目(b3c1485): 承認
  - **見送り**: actions を SHA で固定する(別チケット)、SPA の fallback を `404-page` にするか(M19-09 の共有リンクの道が決まってから)、`httpSink.ts` の `export type { LogBatch }` とその上のコメント(呼び手は 0 件。消すにはユーザーが当該コメントを名指しする必要がある)
  - **配備の前にユーザーがすること**: README「Cloudflare へ配る」の手順 1〜6(専用アカウント、支払い方法を登録しない、workers.dev のサブドメイン、トークン、Environment `production` と Secrets、main で Run workflow)。そのあと、配った URL で画面が開き、Observability に `harbor.logs.record` が出ることを確かめる
