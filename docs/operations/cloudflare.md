# Cloudflare への配備と運用

README の「Cloudflare へ配る」から移した (2026-10-06、運用の手順は README でなく docs/operations/ に置く)。端末のログインに依らない配備の手順は [deploy-runbook.md](deploy-runbook.md)、初回の配備の記録は [cloudflare-deploy.md](cloudflare-deploy.md)。


設計は `docs/design/2026-09-26-cloudflare-architecture.md`(§3・§4.2)。Worker 1 本(`wrangler.jsonc`)で、静的アセット(`dist/`)とログの受け口(`/api/v1/logs`、`worker/src/index.ts`)を出す。

- 静的アセットは Worker を起こさずに配る(無料・無制限)。`run_worker_first: ["/api/*"]` なので、Worker が動くのは `/api/*` だけ。知らない道には `index.html` を返す。
- 配らないもの(`.blend`・コンセプト画・デザインボード・Blender に焼く前の絵)は `assets/.assetsignore` に書く。vite がこれを `dist/.assetsignore` へ写し、wrangler がそれを読む。
- 受け口は `LogBatch`(`src/core/log/batch.ts`、クライアントと同じファイル)を検証し、1 件ずつ JSON 1 行で Workers Logs に書く。Workers Free の Workers Logs は 1 日 200,000 件・3 日保持([pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs))。D1 は使わない。自分の Origin 以外からの POST は 403、形が違えば 400、64 KiB を超えれば 413。
- Origin の確認は、よそのページからブラウザで送りつけられるのを断るためのもので、認証ではない(curl なら Origin は自由に付けられる)。枠を守る本当の栓は、M19-08 の日次上限。

## 港の API(M19-08)

同じ Worker が `/api/v1/*` で港の帳簿(D1、`worker/migrations/0001_harbor.sql`)を出す。道・header・本文の形は `src/harbor/wire.ts`(クライアントと同じファイル)。

| 道 | 中身 | 人間確認 | 回数制限(送り手ごと) |
|---|---|---|---|
| `POST /api/v1/chronicles` | 出港。取り下げ鍵は手元で作って `Authorization: Bearer` で添える。同じ年代記は 1 件(2 回目は 200 で同じ id) | 要 | 書き 10/分 |
| `GET /api/v1/chronicles?scenario=&before=` | 一覧(新しい順に 24 件ずつ) | | 読み 120/分 |
| `GET /api/v1/chronicles/:id` | 訪問(年代記とカード) | | 読み |
| `POST /api/v1/chronicles/:id/confirm` | 照合(確認・不一致を数える) | | 書き |
| `POST /api/v1/chronicles/:id/report` | 通報。別の 3 人で自動で隠れる | 要 | 書き |
| `DELETE /api/v1/chronicles/:id` | 取り下げ(出港の鍵で) | | 書き |
| `POST /api/v1/cargo`・`GET /api/v1/cargo` | 積荷を流す・漂着をランダムに 1 件引く | | 書き・読み |
| `POST /api/v1/outcomes`・`GET /api/v1/outcomes/:scenario` | 結末の報告・回避率(越えた数と終えた数) | | 書き・読み |

- 断りは `{"error": ...}` の JSON で返す。形の誤り 400、本文の大きすぎ 413、人間確認の失敗と要約の食い違い 422、回数制限 429、閉港 503(`reason` は `budget`・`full`・`d1_read_limit`・`d1_write_limit`・`d1_storage`・`unavailable`)。クライアントは `readRefusal` で読み、港の形でない返事(1027 の画面など)も閉港として扱う。
- 日次予算(`worker/src/policy.ts`)は道ごとの上限と、その日の合計で閉じる段を持つ。捨てる順は ログ > 確認 > 一覧 > 積荷 > 出港 > 訪問 で、共有リンクの訪問を最後まで守る。ログと確認は越えた分を 204 で黙って捨てる。D1 の大きさが 400 MB を越えたら出港だけを閉じる。
- IP は保存しない。送り手は「secret と UTC の日付」を鍵にした HMAC(日替わり)で数えるだけ。D1 に置くのは通報の重複の判定の 1 日分だけで、Cron が翌日に消す。取り下げ鍵は SHA-256 だけを置く。
- Cron は毎日 00:10 UTC に 1 本。昨日までの通報の送り手、7 日より古い積荷と予算の行、隠して 30 日たった年代記を消し、保存量を `harbor_stats` に書く。

## 手元で確かめる(アカウントは要らない)

```bash
pnpm run dev:cloudflare        # VITE_LOG_URL=/api/v1/logs でビルドし、wrangler dev で配る。http://localhost:8787
pnpm run test:e2e:cloudflare   # 同じビルドを wrangler dev で立て、画面のログが受け口に 1 バッチ届くことを Playwright で確かめる
```

`pnpm run dev:cloudflare` で画面を開き、速度を 100 倍にすると、10 秒ほどで端末に `{"event":"harbor.logs.record","record":{...}}` の行が出る。

`wrangler.jsonc` を変えたら `pnpm run types:worker` で `worker/worker-configuration.d.ts` を作り直す(`pnpm run typecheck` が古さを検査する)。

港の道を `wrangler dev` で試すときは、ローカルの D1 にマイグレーションを当て、secret をテストの値で `.dev.vars` に置く(`.dev.vars` はリポジトリに入らない)。Turnstile のテストの secret は、ダミーの札 `XXXX.DUMMY.TOKEN.XXXX` だけを通す([Testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/))。

```bash
pnpm exec wrangler d1 migrations apply biotope-harbor --local
printf 'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\nSENDER_SECRET=local-only\n' > .dev.vars
```

港の単体テスト(`pnpm run test:worker`)は、同じマイグレーションを miniflare のローカルの D1 に当て、siteverify への fetch を止めて回す。外へは通信しない。

## 配備(人が行う)

配備は GitHub Actions の `Deploy (Cloudflare)`(`.github/workflows/deploy.yml`)で行う。起動は Actions の画面の「Run workflow」だけで、main への push では走らない。出せるのは main だけ。中身は、`lfs: true` の checkout → `pnpm install --frozen-lockfile` → `pnpm run check` → `pnpm run build:cloudflare` → `wrangler deploy`。M19-08 から、`wrangler deploy` の前に港の D1 のマイグレーション(`wrangler d1 migrations apply biotope-harbor --remote`、当て済みは飛ばす)を当てる。

初回だけ、次を人が行う。

1. **このゲーム専用の Cloudflare アカウントを作る。** Workers と D1 の無料枠はアカウント単位なので、ほかの Worker と枠を食い合わないようにする(設計書 C8)。
2. **支払い方法を登録しない。** Workers Paid に上げる操作は、この設計の外で人が決める(設計書 §3.3)。無料枠を使い切った日は、課金されずに港(`/api/*`)が止まる。
3. ダッシュボードの **Workers & Pages** で、`workers.dev` のサブドメインを決める。配った画面は `https://biotope-island.<サブドメイン>.workers.dev` になる。
4. **Account API tokens** で、テンプレート **Edit Cloudflare Workers** のトークンを作り、このアカウントだけに絞る。
5. GitHub の Settings → Environments で `production` を作り、Deployment branches and tags を `main` だけにする。その Environment secrets に、`CLOUDFLARE_API_TOKEN`(4 のトークン)と `CLOUDFLARE_ACCOUNT_ID`(アカウント ID)を置く。値はリポジトリに書かない。
6. **港の D1 を作り、id を書く(M19-08)。** `pnpm exec wrangler login` のあと `pnpm exec wrangler d1 create biotope-harbor` で作り、出てきた `database_id` を `wrangler.jsonc` の `d1_databases` の仮の値(`00000000-0000-0000-0000-000000000000`)と置き換えて main に入れる。仮の値のままでは配備が落ちる。
7. **Turnstile の widget を作る(M19-08)。** ダッシュボードの Turnstile で、hostname に `biotope-island.<サブドメイン>.workers.dev` を入れた widget を 1 つ作る。site key は画面(M19-09)に、secret key は次の 8 で Worker に置く。
8. **Worker の secret を置く(M19-08)。** 値はリポジトリにもコマンドの引数にも書かず、対話の入力で渡す。`pnpm exec wrangler secret put TURNSTILE_SECRET_KEY`(7 の secret key)と `pnpm exec wrangler secret put SENDER_SECRET`(送り手の HMAC の鍵。`openssl rand -base64 32` などで作った乱数)。`wrangler.jsonc` の `secrets.required` に名前だけを書いてある。
9. Actions の `Deploy (Cloudflare)` を、branch に `main` を選んで「Run workflow」で起こす。ほかの branch を選ぶと、job は飛ばされる。

配ったあとのログは、ダッシュボードの Workers & Pages → `biotope-island` → Observability で読む。手元の端末からは `pnpm exec wrangler tail`(要 `pnpm exec wrangler login`)でも流れを見られる。

## 課金にしない

「止まるほうが良い、課金にしない」(設計書 Q1・§3.3)。次の 3 つの決まりで守る。

1. **このゲーム専用の Cloudflare アカウントを使う。** Workers と D1 の日次の枠はアカウント単位なので、ほかの Worker と枠を分ける(設計書 C8)。
2. **支払い方法を登録しない。** Workers Paid に上げる操作は、この設計の外で人が決める。支払い方法が無ければ、無料枠を使い切った日は課金されずに港(`/api/*`)が止まる。静的アセットは止まらない。
3. **構成検査を CI と配備で回す。** `scripts/check_free_tier.py` が `wrangler.jsonc` とビルドした `dist/` を見て、次のどれかがあれば落とす。CI(`ci.yml`)では E2E のあと、配備(`deploy.yml`)では `wrangler deploy` の直前に回すので、落ちれば配られない。
   - 許す key の表(`ALLOWED_KEYS`)に無い key。R2・Queues・Analytics Engine・Browser・Workers AI・Vectorize・KV・Durable Objects などの binding はここで落ちる。許すのは D1・Rate Limiting・Cron・vars と、配信・観測の設定だけ。`env` の下の環境も同じ表で見る
   - `usage_model`(Paid の旧い課金方式)と `limits`(CPU・subrequest の上限の書き換えは Paid だけ)
   - `dist/.assetsignore` が `*.blend` と `textures/concept/**` を配らずにおかないこと(否定の `!` で戻したものも落とす)
   - 配るファイル(`.assetsignore` で外したものを除く)が 20,000 を超える、または 1 ファイルが 25 MiB を超える(Workers Free の静的アセットの上限)

```bash
pnpm run build:cloudflare && pnpm run check:free-tier
```

新しい binding を足すときは、無料枠の内で止まる(超えても課金にならない)ことを Cloudflare の docs で確かめてから、`ALLOWED_KEYS` に理由と一緒に足す。

## 運用(`scripts/mod.py`)

荒らしの片づけと予算の確かめは `scripts/mod.py` 1 本で行う(設計書 Q4)。中身は `wrangler d1 execute`。配った港に当てるときは `--remote`(要 `pnpm exec wrangler login`)、`wrangler dev` のローカルの D1 には `--local` を付ける。どちらかを必ず選ぶ。

```bash
uv run scripts/mod.py --remote hide <年代記の id>          # 一覧と訪問から隠す。もう隠れていれば、隠した時刻はそのまま
uv run scripts/mod.py --remote restore <年代記の id>       # 戻し、通報の数を 0 にする
uv run scripts/mod.py --remote delete <年代記の id> --yes  # 消す。戻せないので --yes が要る
uv run scripts/mod.py --remote budget --days 7             # 日次予算の消費を、新しい日から道ごとの上限と日の合計の比で見る
```

年代記の id は SHA-256 の 16 進 64 文字だけを受ける(SQL に埋めるため)。無い id は「見つからない」で終了コード 1 になる。表と列(`chronicles`・`reports`・`daily_budget`)は、港の D1 のマイグレーション(`worker/migrations/0001_harbor.sql`、M19-08)に合わせてある。戻すは `hidden_at` を NULL に、通報の数 `reports` を 0 にし、その年代記の通報の行を消す。保存量は Cron が毎日 `harbor_stats` に書く(`pnpm exec wrangler d1 execute biotope-harbor --remote --command "SELECT * FROM harbor_stats ORDER BY day DESC LIMIT 7"`)。
