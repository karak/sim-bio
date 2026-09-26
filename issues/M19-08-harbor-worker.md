---
id: M19-08
title: 港の Worker と D1(ルート・日次予算・閉港の返事・Cron)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-07, M19-02]
evidence:
  - "bb9db3c feat(harbor): 港の Worker と D1(ルート・日次予算と捨てる順・保存の栓・閉港の返事・Cron)"
  - "0495831 refactor(harbor): レビュー対応(予算の表を 1 つに、Retry-After を断りから、通報の数えを 1 つのトランザクションに、読めない行を残す、断りの status を表 1 つに)"
  - "4c83f75 test(harbor): wrangler dev の E2E で港の道をローカルの D1 に当てる"
  - "tests: worker/test/harbor.test.ts, worker/test/budget.test.ts, worker/test/cron.test.ts, worker/test/logs.test.ts, worker/test/harbor.contract.test.ts, tests/unit/harbor.wire.test.ts, tests/e2e-cloudflare/harbor.spec.ts, scripts/test_mod.py"
---

# 港の Worker と D1(ルート・日次予算・閉港の返事・Cron)

優先度: Should(設計書のドライバの優先度)

## What to build

設計書 §3・§6。Worker 1 本(静的アセットと同梱、`/api/v1/*` だけ fetch handler)。ルート: 出港・一覧・1 件・照合・通報・取り下げ・積荷・回避率・ログ。D1 のマイグレーション(年代記・通報・積荷・回避の集計・日次予算)。Turnstile の siteverify(出港と通報)、Rate Limiting binding(無料プランで使えなければ D1 の日次予算だけで締める)、日次予算と捨てる順(ログ > 確認 > 一覧 > 積荷 > 出港 > 訪問)、保存 400 MB の内部の栓、取り下げ鍵(D1 にはハッシュ)、通報 3 件で自動で隠す、IP は日替わりの salt の HMAC で数えるだけ。Cron 1 本で掃除と保存量の集計。

## Blocked by

M19-07, M19-02

## Acceptance criteria

- [x] @cloudflare/vitest-pool-workers とローカル D1 で、各ルートの正常・不正な形(400/422)・予算切れ(503)・回数制限(429)を単体テスト
  - 名前は `@cloudflare/vitest-plugin`(M19-02 で改名を確かめた、1.2.8)。本番と同じ `worker/migrations` を `worker/test/setup.ts` がローカルの D1(miniflare)に当て、テストごとに表を空にする。Rate Limiting binding も miniflare の模擬で本物の binding を通す。bb9db3c・0495831
  - `worker/test/harbor.test.ts`(27 件)
    - 正常: 「出港すると 201 で id (Worker が chronicleId で計算した値) を返し、D1 には取り下げ鍵の SHA-256 だけを置く」「新しい順に 1 頁ずつ返し、next で続きを引く。石板で絞れる」「訪問は、出港した年代記とカードを返す。無い id は 404」「結末が合えば確認、違えば不一致を数え、カードに出る。どちらも 204」「別の 3 人の通報で自動で隠れ、一覧にも訪問にも出なくなる。同じ人の 2 度目は数えない」「出港の鍵なら 204 で消え、通報の行も消える。違う鍵は 403、無い id は 404」「流した積荷のどれかが漂着として引ける。1 件も無ければ drawn は null」「結末を石板ごとに数え、越えた数 (alive と escaped) と終えた数を返す」
    - 400: 「形の誤り (カタログに無い石板) は 400 で場所を返し、人間確認に問い合わせず、何も置かない」「人間確認の札が無ければ 400、取り下げ鍵が無ければ 400」「頁の札が壊れていれば 400」「カタログに無い種は 400」「碑文は assets/data/inscriptions.json のカタログにあるものだけを受ける」
    - 422: 「要約の hash が中身と合わなければ 422 (mismatch)」「人間確認に落ちれば 422 (not_human) で、何も置かない」「人間確認に落ちた通報は 422 で数えない。無い年代記は 404」
    - 413・403・404: 「申告の Content-Length が MAX_BODY_BYTES を越えれば、読まずに 413」「よその Origin からの出港は 403 で、人間確認にも問い合わせない」「GET /api/v1/nowhere・PUT /api/v1/chronicles・… は 404」
    - 429: 「同じ送り手の書き込みは 1 分に 10 回まで。11 回目は 429 と Retry-After。別の送り手は通る」「送り手の数えは IP をそのまま使わない (ログにも出さない)」
    - 503: 「siteverify に届かなければ 503 で閉港 (unavailable)。人のせいにはしない」
    - 読めない行: 「今のカタログで読めない行 (石板を外した) は、一覧にも訪問にも出さず、黙らずに 1 行残す」
  - `worker/test/budget.test.ts`(12 件): 「出港の予算 (2,000 件) を使い切ると 503 で閉港 (budget)。Retry-After は UTC の 0 時まで」「使った分だけ数える。形の誤り・人間確認の失敗では数えない」「捨てる順: 日の合計が一覧の段を越えると、ログ・確認・一覧は閉じ、積荷・出港・訪問は開いている」「捨てる順: 日の合計が出港の段を越えても、訪問 (共有リンク) は最後まで開いている」「段は下から ログ < 確認 < 一覧 < 積荷 < 出港 < 訪問 の順に閉じる」「前の日の使用は今日の予算に数えない」「D1 の大きさが栓を越えたら、出港だけを 503 (full) で閉じ、訪問は開いている」
  - `worker/test/cron.test.ts`(3 件): 「昨日までの通報の送り手・7 日より古い積荷と予算の行・隠して 30 日たった年代記を消し、見える年代記と通報の数は残す」「保存量を harbor_stats に書き、Workers Logs にも 1 行残す」「D1 が落ちていても例外を投げず、失敗を 1 行残す」
  - Turnstile は `worker/test/helpers.ts` の `stubSiteverify` が siteverify への fetch を止め、テストの secret(`1x0000000000000000000000000000000AA`)とダミーの札(`XXXX.DUMMY.TOKEN.XXXX`)のふるまいを手元で返す。ほかの宛先への fetch はテストを落とす
  - テストが欠陥を捕まえることを変異で確かめた(scratchpad の使い捨ての脚本、コミットしていない): 日の合計の段・INSERT OR IGNORE・通報 3 件・同じ送り手の 2 度目・通報の数えの changes()・取り下げの鍵・照合の数え・隠れたものを一覧と訪問に出さない・Cron の今日の通報・D1 の読みの上限の文言・回避の判定・要約の検算・人間確認・siteverify の答え・回数制限・Retry-After・保存の栓・鍵のハッシュ・確認を黙って捨てる・ログの予算・捨てる順の段・読めない行の記録、の 23 か所を 1 つずつ壊すと、23 とも worker のテストが落ちる
- [x] D1 の上限エラーと 1027 を、クライアントが closed に読み替えられる一貫した返事にする
  - 港の断りは `src/harbor/wire.ts` の `Refusal`(`{"error": ...}` の JSON)と、error → status の表 1 つ(`REFUSALS`)。Worker は `writeRefusal`、クライアント(M19-09)は `readRefusal(status, text)` で読む。閉港はどれも 503 `{"error":"closed","reason":...}` と `Retry-After`(日次の枠は UTC の 0 時まで、一時の失敗は 60 秒)。bb9db3c・0495831
  - D1 の誤り: `worker/src/ledger.ts` の `closedReasonOf` が docs の文言(下の「docs で確かめたこと」)で `d1_read_limit`・`d1_write_limit`・`d1_storage`、ほかを `unavailable` に読む。`worker/test/budget.test.ts`「(4 つの文言) → 503 closed (…)」「D1 が上限でも、ログの受け口は D1 に頼らず受ける (予算の数えを飛ばす)」
  - 1027: Worker は動かないので返事を書けない。`readRefusal` は、港の形でない返事(1027 の HTML・Worker の外の 5xx・壊れた本文・error と status の食い違い・知らない理由)をどれも `{ error: 'closed', reason: 'unknown' }` に読む。`tests/unit/harbor.wire.test.ts`「読めない返事 (1027 の画面 (Cloudflare の HTML) など 6 通り) は、閉港 (理由 unknown) に読み替える」「(10 通りの断り) は (status) で書き、同じ断りに読み戻す」
  - 1027 の返事の status は docs に書かれていない(fail closed で「1027 error page」とだけある)。配った先で実物を 1 度見るのは、配備がユーザーの許可待ち
- [x] 同じ年代記の出港が 2 回で 1 件(INSERT OR IGNORE)
  - `worker/src/ledger.ts` の `insertChronicle`(`INSERT OR IGNORE INTO chronicles`)。id は Worker が `chronicleId(req.chronicle)` で自分で計算する(`worker/src/harbor.ts`)。bb9db3c
  - `worker/test/harbor.test.ts`「同じ年代記の出港は 2 回で 1 件 (INSERT OR IGNORE)。2 回目は 200 で同じ id を返し、鍵は最初のものだけが効く」。`INSERT OR REPLACE` に変えると落ちる(変異)
- [x] CPU 10 ms の内に収まることを計測して記す
  - 手元の目安(Node 24 の V8、M 系の Mac。Worker の CPU は D1 と siteverify の待ちを数えないので、純粋な計算の部分だけを測った。scratchpad の使い捨ての計測、コミットしていない)。0495831 のコード
    - 出港(最大の年代記 16,592 B の本文・命令 136 件: readRequest・要約の検算・chronicleId・正規化・鍵の SHA-256・送り手の HMAC): 1 回 0.63 ms(JIT のあと、500 回の平均)。プロセスの最初の 1 回は 7.6 ms(Node の WebCrypto の初期化と JIT 前を含む)
    - 一覧(25 行の parseCard と 24 枚の応答の JSON と送り手の HMAC): 0.034 ms。最初の 1 回 0.25 ms
    - 訪問(16 KB の年代記の JSON.parse・parseChronicle・応答の JSON と HMAC): 0.10 ms。最初の 1 回 0.44 ms
  - いちばん重い出港でも、温まれば 10 ms の 1/15。冷えた最初の 1 回の 7.6 ms は Node の数で、workerd の WebCrypto は C++ の組み込み。配った先の CPU 時間(Observability の CPU Time)で確かめるのは、配備がユーザーの許可待ち
- [x] Rate Limiting binding が無料プランで使えるかを確かめて記す
  - docs(下)には、無料プランで使えないとも使えるとも書かれていない。pricing のページにも Rate Limiting binding の行は無い(課金の対象として載っていない)。GA は 2025-09-19
  - miniflare は `ratelimits` を模擬し、ローカルのテストでは 11 回目が `success: false` になる(上の 429 のテスト)
  - 使えなくても成り立つ作りにした: `worker/src/guard.ts` の `rateOf` は、binding の呼び出しが落ちたら `unavailable` を返し、`worker/src/harbor.ts` は `harbor.rate.unavailable` を 1 行残して通す。締めの最後の砦は D1 の日次予算(道ごとの cap と日の合計の段)。無料のアカウントで配備が binding を断るなら、`wrangler.jsonc` の `ratelimits` を外せばよい(コードは binding が無くても `unavailable` で通る)
  - 本物の無料のアカウントで binding が効くかは、配備がユーザーの許可待ち
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - `pnpm run check`(0495831。typecheck: root と worker の tsc と `wrangler types --check`、eslint、ruff、vitest、worker のテスト、scripts の unittest)が通る。vitest の通し 93 ファイル 891 件、worker 5 ファイル 64 件、scripts 42 件
  - E2E: `pnpm exec playwright test`(E2E_PORT=5217)は 37 件すべて通る(0495831)。`pnpm run test:e2e:cloudflare`(E2E_PORT=8817、wrangler dev の上)は、1 回目(0495831)に M19-02 の「配るもの・配らないもの・知らない道」が落ちた。`GET /api/v1/chronicles` を「まだ無い道なので 404」と確かめていたが、M19-08 で一覧の道になり、マイグレーションの無いローカルの D1 で 503(閉港)を返したため。4c83f75 で、E2E の wrangler dev を使い捨てのローカルの D1(本番と同じマイグレーションを当てる)とテストの secret で立て、知らない道の確かめを `/api/v1/nowhere` に替え、港の道の E2E「港の道がローカルの D1 に届く: 結末を報告すると回避率に数えられ、一覧は空で返る (M19-08)」を足した。4 件すべて通る(`tests/e2e-cloudflare/harbor.spec.ts`)
  - 構成検査: `pnpm run build:cloudflare && pnpm run check:free-tier` が「違反なし」(D1・ratelimits・triggers・secrets の名前を足した wrangler.jsonc と、ビルドした dist)
  - 既存コメントの削除なし: `git diff feat/m19...HEAD -U0 | grep -E '^-\s*(//|\*|/\*|#)'` が出すのは、wrangler が生成する `worker/worker-configuration.d.ts` の 1 行目(`// Generated by Wrangler ... (hash: ...)`、設定の hash が変わると書き換わる)だけ。人が書いたコメントは消していない

## 作業ログ

- 2026-09-26 M19-12 からの申し送り: 運用スクリプト `scripts/mod.py` は、この M19-08 のマイグレーションの前に、表と列を仮に置いた(設計書 §5・§6 から)。マイグレーションを書いたら、次を本物に合わせる。
  - D1 の binding の名前 `HARBOR`(`mod.py` の `DATABASE`)。`wrangler.jsonc` の `d1_databases` に同じ名前で置けば、`mod.py` はそのまま当たる
  - `chronicles(id, report_count, hidden_at)`。id は SHA-256 の 16 進 64 文字(`parse_chronicle_id`)。隠すは `hidden_at` に時刻、戻すは `hidden_at = NULL` と `report_count = 0`。通報を別の表に持つなら、戻す・消すの SQL をそれに合わせる
  - `daily_budget(day, publish, cargo, report)` と、上限 出港 2,000・積荷 5,000・通報 1,000(`mod.py` の `BUDGET_CAPS`)
  - `scripts/test_mod.py` の `PROVISIONAL_SCHEMA` を消し、`wrangler d1 migrations apply --local` に替える
  - D1 と Rate Limiting の binding は、構成検査 `scripts/check_free_tier.py` の `ALLOWED_KEYS` で許してある

### 実装(2026-09-26、M19-08 の担当、worktree-agent-ab9d33fe56afa4a09。基点は feat/m19 の 035bf05、途中で M19-12 の cf71619 を取り込み)

- **docs で確かめたこと**(Cloudflare docs の MCP と WebFetch、2026-09-26)
  - D1 の上限の enforcement(2026-09-01 から。読みも含めて失敗し、UTC の 0 時まで戻らない)と誤りの文言: https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ ・ https://developers.cloudflare.com/d1/observability/debug-d1/#error-list(「Your account has exceeded D1's free tier daily row read limit. …」「… row write limit. …」「Exceeded maximum DB size.」)
  - D1 のマイグレーション(`migrations_dir`・`d1_migrations` の表・`wrangler d1 migrations apply`): https://developers.cloudflare.com/d1/reference/migrations/ 。テストでの当て方(`readD1Migrations`・`applyD1Migrations`・`setupFiles`): https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/
  - Rate Limiting binding(`ratelimits`・`namespace_id`・`simple.limit`・`period` は 10 か 60、`limit({ key })` は `{ success }`、場所ごとの数えで結果整合): https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ ・ GA: https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/ 。無料プランでの可否はどちらにも pricing(https://developers.cloudflare.com/workers/platform/pricing/)にも書かれていない
  - Turnstile の siteverify(JSON で `secret`・`response`、札は 2048 文字まで・300 秒・1 回きり): https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ 。テストの鍵(secret `1x0000000000000000000000000000000AA` はダミーの札 `XXXX.DUMMY.TOKEN.XXXX` だけを通す): https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  - Cron Triggers(`triggers.crons`、UTC、`scheduled(controller, env, ctx)`): https://developers.cloudflare.com/workers/configuration/cron-triggers/ 。無料は 5 本/アカウント・CPU 10 ms(HTTP も Cron も): https://developers.cloudflare.com/workers/platform/limits/
  - 1027(Workers の 100,000/日を越えると Worker が動かず、fail closed なら 1027 の画面): https://developers.cloudflare.com/workers/platform/limits/#daily-requests ・ https://developers.cloudflare.com/workers/observability/errors/
  - `secrets.required`(secret の名前だけを設定に書き、型の生成と手元の警告に使う): `node_modules/wrangler/config-schema.json`
- **素描の 2 案**(pstack:architect の考え方で、自分で)
  - A: 道ごとの決まりを表(予算・回数制限)に置き、SQL は帳簿のモジュール 1 つ(`ledger.ts`)に閉じ、道の処理は `kind` ごとの表(`OPERATIONS`)にする
  - B: ports and adapters(ChronicleRepo・BudgetRepo・HumanCheck・RateLimiter の interface を注入)
  - A を採った。テストは本物のローカルの D1 と Rate Limiting の模擬で回せるので、B の interface は間接の層を足すだけになる。外への通信は siteverify の 1 本だけで、テストは fetch を止めれば足りる
- **置き場**
  - `worker/src/index.ts`: HTTP の口(M19-02 のログの受け口・Origin の門・本文の上限・断りのログ)。港の道は ROUTES に足さず、ROUTES に無い道を `harbor` に渡す。`scheduled` も足した
  - `worker/src/harbor.ts`: 門の順(形 400/413 → 要約の検算 422 → 回数制限 429 → 人間確認 422 → 日次予算 503 か黙って 204 → 帳簿)と道ごとの処理。答えは `Outcome` で返し、index.ts が Response に書く
  - `worker/src/ledger.ts`: SQL と行の形。D1 から読んだ行も parse し直し、読めない行は `harbor.ledger.unreadable` を 1 行残して出さない
  - `worker/src/policy.ts`: 日次予算 `BUDGETS`・回数制限の binding `RATE_LIMITERS`・`HARBOR_CONFIG`(保存の栓 400 MB・通報 3 件・一頁 24 件・Cron の日数)
  - `worker/src/guard.ts`: 送り手の HMAC・siteverify・Rate Limiting
  - `src/harbor/wire.ts` に足した: 断りの返事(`Refusal`・`writeRefusal`・`readRefusal`・`CLOSED_REASONS`)、道ごとの本文の上限 `bodyLimitOf`(Worker は道の上限で本文を読み止める。照合なら 2 KB)
  - `src/chronicle/digest.ts` に `hashOfDigest`(`digestOf` と出港の検算が同じ関数を使う)
  - 碑文のカタログ `assets/data/inscriptions.json`(6 つ。M19-09 が画面で選ばせ、足す)。Worker は石板・種・碑文を `assets/data/*.json` から import する(バンドルに入る。石板の文を含めて 28 KB)
- **D1 の表**(`worker/migrations/0001_harbor.sql`。binding は `HARBOR`、database_name は `biotope-harbor`。`scripts/mod.py` はこれに合わせた)
  - `chronicles(id TEXT PRIMARY KEY, sim_version TEXT, scenario_id TEXT, seed INTEGER, inscription TEXT, verdict TEXT, year INTEGER, digest_hash TEXT, body TEXT, bytes INTEGER, published_at INTEGER, withdraw_hash TEXT, confirms INTEGER, mismatches INTEGER, reports INTEGER, hidden_at INTEGER)`。id は正規化した年代記の SHA-256、`body` は正規化した年代記の JSON、`withdraw_hash` は取り下げ鍵の SHA-256、時刻はどれも epoch ms、`hidden_at` が NULL なら見える。索引は見えるものだけの部分索引 2 つ(`published_at DESC, id DESC` と `scenario_id, published_at DESC, id DESC`)
  - `reports(chronicle_id → chronicles ON DELETE CASCADE, day TEXT, sender TEXT, PRIMARY KEY (chronicle_id, day, sender))`。sender は日替わりの HMAC。Cron が翌日に消す(数は `chronicles.reports` に残る)
  - `cargo(id TEXT UNIQUE, items TEXT, cast_at INTEGER)`。id は D1 の乱数 16 B の 16 進、items は積荷の JSON
  - `outcomes(scenario_id TEXT, verdict TEXT, count INTEGER, PRIMARY KEY (scenario_id, verdict))`。回避率は alive と escaped を「越えた」と数える(Worker の `AVOIDED`。M19-11 で変えるなら読む側だけでよい)
  - `daily_budget(day TEXT, bucket TEXT, used INTEGER, PRIMARY KEY (day, bucket))`。bucket は道の種類(`logs`・`confirm`・`report_outcome`・`browse`・`avoidance`・`cast_cargo`・`draw_cargo`・`publish`・`report`・`withdraw`・`visit`)
  - `harbor_stats(day TEXT PRIMARY KEY, stored_bytes INTEGER, chronicles INTEGER, hidden INTEGER, cargo INTEGER, measured_at INTEGER)`。Cron が毎日書く
- **決めたこと**
  - **取り下げ鍵は手元で作る(設計書 §5.2 からの変更)。** 出港に `Authorization: Bearer <鍵>` で添え、港は SHA-256 だけを置く。港が作って返すと、応答が失われたあとの outbox の再送(INSERT OR IGNORE で 1 件のまま)で鍵が手元に届かない。`HarborRequest.publish` に `key` を足し、`HarborResponses.publish` は `{ id }` だけにした(M19-07 の契約を変えた。`tests/unit/harbor.wire.test.ts` も合わせた)。よその島を写して出港し直しても、置かれるのは最初の鍵のハッシュだけなので取り下げられない。設計書は直していない(持ち主の判断)
  - **日次予算と捨てる順。** 1 文の upsert で「その道の cap の内」かつ「その日の全部の道の合計が、その道の段 (shedAt) の内」なら数えて通す。越えていれば何も書かない(断った呼び出しは D1 の書きを使わない)。段は ログ 20,000 < 確認・結末 25,000 < 一覧・回避率 30,000 < 積荷 35,000 < 出港・通報 40,000 < 取り下げ・訪問 45,000。閉じた道には UTC の 0 時までの Retry-After を返すので、クライアントがその日その道を呼ばなくなり、Workers の 100,000/日も後ろの道に残る。道ごとの cap は 設計書の出港 2,000・積荷 5,000・通報 1,000 に、ほかの道を足した(`worker/src/policy.ts`)。全部の道が上限まで使われても D1 の書きは約 88,000 行/日で、100,000 の内
  - ログと確認と結末の報告は、越えた分を 204 で黙って捨てる(善意の付加物)。ログは D1 が落ちていても数えずに受ける(ログは Workers Logs に書くので、D1 の上限に巻き込まない)
  - **保存の栓**は、予算の upsert の結果の `meta.size_after`(D1 の大きさ)で毎回見る。Cron の集計を待たずに効き、問い合わせも増えない。400 MB を越えたら出港だけを 503 `full` で閉じる
  - **送り手**は `HMAC-SHA256(key = SENDER_SECRET + UTC の日付, message = IP)` の頭 32 文字。日が替われば同じ IP でも別の値になる(日替わりの salt)。回数制限の鍵(道ごと)と、通報の重複の判定(その日だけ D1)に使う。IP はどこにも書かない(ログにも。テストで確かめた)
  - **通報**は、通報の行の INSERT と数の UPDATE を 1 つの batch(トランザクション)で書き、2 文目は `changes() = 1`(1 文目で新しい行が入ったとき)だけ数を足す。数だけ・行だけが残る半端な状態を作らない。3 件目で `hidden_at` に時刻が入る
  - **漂着**は `rowid >= abs(random() % MAX(rowid)) + 1` の索引で 1 行だけ読む。`ORDER BY RANDOM()` は全件を読むので、読みの枠を食う
  - **一覧の頁の札**は `published_at` の 36 進と id の頭 16 文字(`BrowseCursor` の 64 文字の内)。壊れた札は 400
  - 積荷を流すのは冪等でない(id は港の乱数)。outbox で再送されると同じ積荷が 2 つ流れうるが、上限 5,000/日の内で害は小さいので受け入れた
  - Cron は 00:10 UTC(日次の枠が戻った直後)。昨日までの通報の送り手、7 日より古い積荷と予算の行、隠して 30 日たった年代記を消し、保存量を `harbor_stats` に書く
- **M19-12 と合わせたこと**(`git merge feat/m19` で cf71619 を取り込んだあと)
  - `scripts/mod.py`: 表と列を上の本物に合わせた(隠すは epoch ms、戻すは `reports = 0` と通報の行の削除、消すは外部鍵で通報の行も消える、予算は道ごとの行を日ごとにまとめて、道の上限と日の合計 45,000 との比で出す)。`BUDGET_CAPS` を道ごとにし、`DAY_TOTAL_CAP` を足した
  - `scripts/test_mod.py`: 仮の表の代わりに `wrangler d1 migrations apply --local` で本物のマイグレーションを当てる。`worker/src/policy.ts` の cap・段と `mod.py` の表の食い違いを落とすテスト(`PolicySyncTest`)を足した
  - `scripts/check_free_tier.py`: `secrets`(secret の名前だけ)を `ALLOWED_KEYS` に足した
  - 仮の形を書いた既存のコメントと docstring は消さずに残し、その下に M19-08 で合わせた形を書き足した
- **レビュー**(`pstack:thermo-nuclear-code-quality-review` の手順で自分で、`git diff feat/m19...HEAD` に 2 回)
  - 1 回目(bb9db3c)で直した(0495831)
    - 予算の表(cap・段)と道の決まり(越えたら捨てるか閉じるか・回数制限)が 2 つの表に分かれ、同じ鍵を 2 度引いていた。越えたときの扱いを `BUDGETS` に入れ、残りを `RATE_LIMITERS` の 1 列の表にした
    - `Outcome` の断りに optional の `retryAfter` を持たせ、`closed()` に `now` を通していた。Retry-After は断りの種類から決まるので `retryAfterOf(refusal, now)` にし、optional と引数の受け渡しを消した
    - 通報の数えが 2 回の往復(行の INSERT のあとで UPDATE)で、2 つ目が落ちると行だけが残り、送り直しは「2 度目」になって数が失われた。1 つの batch と `changes()` にした
    - 読めない行(カタログから外した石板など)を、一覧・訪問・漂着で黙って落としていた。`harbor.ledger.unreadable` を 1 行残すようにし、テストを足した
    - 正規化した本文を harbor.ts が作って帳簿に渡していた(行の型に年代記と本文の 2 つの真実)。帳簿が作るようにした
    - index.ts の港の口が、断りの status を数字で直書きしていた。`Refusal` と `render` を通し、status は wire.ts の表 1 つから決まるようにした
    - 取り下げの消去の `meta.changes` が、外部鍵で一緒に消えた通報の行も数えていて、通報のある年代記を取り下げられなかった(テストが落として見つけた)。`RETURNING id` で見るようにした。Cron の数えも同じ
  - 2 回目(0495831): 新しい構造の後退・1,000 行を越えるファイル・場当たりの分岐は無し。残したもの: `Kind`・`Req<K>` の型の別名が wire.ts と harbor.ts に 1 つずつある(2 行で、契約から export する口を増やすほどではない)。港の HTTP の口を index.ts に置いた(M19-02 の `readBounded`・`isSameOrigin`・`reject` と、そのコメントを動かさずに使うため)
  - 大きさ: index.ts 151 行、harbor.ts 152 行、ledger.ts 220 行、policy.ts 74 行、guard.ts 54 行、wire.ts 369 行
- **M19-09・M19-10・M19-11 へ渡すこと**
  - 出港の前に手元で取り下げ鍵(乱数 32 B の base64url、43 文字)を作り、IndexedDB の `keys` に置いてから送る。outbox の再送も同じ鍵で送る
  - 返事は `readResponse`(2xx)と `readRefusal`(それ以外)で読む。`closed`(理由 `unknown` を含む)とネットワークの失敗は閉港。`slow_down`・`not_human`・`not_found`・`forbidden`・`mismatch`・`bad_request` はそれぞれ PublishResult などの kind に写す。Retry-After(秒)は header にある
  - 訪問の応答の `card.id` と `chronicleId(chronicle)` の一致はクライアントが確かめる(M19-07 のまま)
  - Turnstile の site key は画面側の設定(`vars` か build の env)。secret は Worker の `TURNSTILE_SECRET_KEY`
  - 碑文を足すときは `assets/data/inscriptions.json` に足す(Worker も同じファイルを読む)
- **配備の前にユーザーがすること**(README「配備(人が行う)」の 6〜8 に書いた。どれもユーザーの許可が要るので、していない)
  - `pnpm exec wrangler login` のあと `pnpm exec wrangler d1 create biotope-harbor` で DB を作り、`wrangler.jsonc` の `database_id` の仮の値(`00000000-0000-0000-0000-000000000000`)を本物に置き換える
  - Turnstile の widget を作り(hostname は `biotope-island.<サブドメイン>.workers.dev`)、`pnpm exec wrangler secret put TURNSTILE_SECRET_KEY` と `pnpm exec wrangler secret put SENDER_SECRET`(乱数)を対話で置く
  - 配備のワークフロー(`deploy.yml`)は、`wrangler deploy` の前に `wrangler d1 migrations apply biotope-harbor --remote` を当てる。配ったあと、Observability で CPU Time、Rate Limiting の 429、`harbor.cron.stats` の行を確かめる
