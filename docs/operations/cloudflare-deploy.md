# Cloudflare への配備の手順(人の作業と AI の作業)

wrangler を前提にした、初回の配備と配ったあとの確かめの手順。設計は docs/design/2026-09-26-cloudflare-architecture.md、ふだんの運用は README の「Cloudflare へ配る」「課金にしない」「運用」。

- **人(H)**: 本人のアカウント・支払い・秘密の値・ブラウザでのログインが要る作業。AI は代われない。
- **AI(A)**: 端末で打てる作業。どれもユーザーの許可を得てから行う。リモートに触れる(Cloudflare・GitHub に書く)ものは特に、その都度許可を得る。

どのコマンドも、このリポジトリでまだ実際に打ってはいない(配備の許可が出ていないため)。形は wrangler・gh の docs と `--help` に合わせた。コマンドはすべて repo の根(feat/m19 か、それを取り込んだ main の checkout)で打つ。`pnpm install --frozen-lockfile` 済みとする。

## 0. 前提の値

| 名前 | 値 | 決める人 |
|---|---|---|
| Worker の名前 | `biotope-island`(`wrangler.jsonc` の `name`) | 決まっている |
| D1 の名前 | `biotope-harbor`(binding は `HARBOR`) | 決まっている |
| workers.dev のサブドメイン | `<sub>`(配った画面は `https://biotope-island.<sub>.workers.dev`) | H |
| GitHub の repo | `karak/sim-bio` | 決まっている |

## 1. アカウントとログイン(人)

| # | 誰 | 作業 | コマンド・画面 |
|---|---|---|---|
| H1 | 人 | このゲーム専用の Cloudflare アカウントを作る。**支払い方法は登録しない**(無料枠を使い切った日に課金されず止まるため) | https://dash.cloudflare.com/sign-up |
| H2 | 人 | workers.dev のサブドメイン `<sub>` を決める | ダッシュボード → Workers & Pages → Account details の Subdomain |
| H3 | 人 | 手元の wrangler をこのアカウントでログインする(ブラウザで OAuth) | `! pnpm exec wrangler login` |
| A1 | AI | ログインしたアカウントを確かめる。account_id を控える(秘密ではない) | `pnpm exec wrangler whoami` |

## 2. 港の D1(AI)

| # | 誰 | 作業 | コマンド |
|---|---|---|---|
| A2 | AI | 本番の D1 を作る。出てきた `database_id` を控える | `pnpm exec wrangler d1 create biotope-harbor` |
| A3 | AI | `wrangler.jsonc` の `d1_databases[0].database_id` の仮の値(`00000000-0000-0000-0000-000000000000`)を A2 の id に置き換え、型を作り直して commit する | `pnpm run types:worker && pnpm run check` |
| A4 | AI | 本番の D1 にマイグレーションを当てる(当て済みは飛ばす)。当たったことを確かめる | `pnpm exec wrangler d1 migrations apply biotope-harbor --remote` → `pnpm exec wrangler d1 migrations list biotope-harbor --remote` |

## 3. Turnstile と secret

| # | 誰 | 作業 | コマンド・画面 |
|---|---|---|---|
| H4 | 人 | Turnstile の widget を 1 つ作る。Hostname に `biotope-island.<sub>.workers.dev`、Widget Mode は Managed。**site key**(公開してよい)と **secret key**(秘密)が出る | ダッシュボード → Turnstile → Add widget |
| H5 | 人 | Turnstile の secret key を Worker に置く。値は対話の入力で渡し、チャットにもファイルにも書かない | `! pnpm exec wrangler secret put TURNSTILE_SECRET_KEY` |
| A5 | AI | 送り手の HMAC の鍵(乱数)を作って Worker に置く。値は画面にも出さずパイプで渡す | `openssl rand -base64 32 \| pnpm exec wrangler secret put SENDER_SECRET` |
| A6 | AI | 2 つの secret の名前が置かれたことを確かめる(値は出ない) | `pnpm exec wrangler secret list` |

secret は Worker が一度も配られていないと置けないことがある。そのときは A5・A6 と H5 を、7 の最初の配備のあとに回す(配ってから置いても、置いた時点で効く)。

## 4. 配備に使う API トークン(人)

| # | 誰 | 作業 | 画面 |
|---|---|---|---|
| H6 | 人 | Account API token を作る。テンプレート **Edit Cloudflare Workers** をもとに、**D1 の Edit** の権限を足す(配備の前に `d1 migrations apply --remote` が D1 に問い合わせるため。Worker を配るだけなら D1 の権限は要らない)。Account Resources はこのアカウントだけに絞る | ダッシュボード → Manage Account → Account API Tokens → Create Token |

権限の根拠: [Workers の権限](https://developers.cloudflare.com/workers/authorization/workers/)(bound resource への権限は、そのリソースを直に触るときだけ要る)。

## 5. GitHub の Environment

| # | 誰 | 作業 | コマンド |
|---|---|---|---|
| A7 | AI | Environment `production` を作り、配れる branch を `main` だけにする | `gh api -X PUT repos/karak/sim-bio/environments/production -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'` → `gh api -X POST repos/karak/sim-bio/environments/production/deployment-branch-policies -f name=main -f type=branch` |
| H7 | 人 | API トークンを Environment secret に置く(対話の入力) | `! gh secret set CLOUDFLARE_API_TOKEN --env production --repo karak/sim-bio` |
| A8 | AI | account_id(A1)を Environment secret に置く | `gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo karak/sim-bio --body <account_id>` |
| A9 | AI | Turnstile の site key(H4、公開してよい値)を Environment variable に置く。配備のワークフローがこれを焼き、無ければ配備を止める | `gh variable set TURNSTILE_SITEKEY --env production --repo karak/sim-bio --body <site key>` |
| A10 | AI | 置いたものを確かめる | `gh secret list --env production --repo karak/sim-bio` と `gh variable list --env production --repo karak/sim-bio` |

## 6. main へ入れる(AI、許可を得て)

push は許可を得てから行う。push の資格情報は ~/.gitconfig の helper が壊れているので、gh の実パスを指す。

| # | 誰 | 作業 | コマンド |
|---|---|---|---|
| A11 | AI | feat/m19 を push し、PR を作る。CI(check と E2E)が pnpm で通ることを確かめる | `GIT_TERMINAL_PROMPT=0 git -c 'credential.https://github.com.helper=' -c 'credential.https://github.com.helper=!/opt/homebrew/bin/gh auth git-credential' push origin feat/m19` → `gh pr create --base main --head feat/m19` → `gh pr checks --watch` |
| H8 | 人 | PR を見て、main へ入れるかを決める(レビュー・受入) | GitHub の PR の画面 |

feat/m21(観察画面)と合わせる順は別に決める。合わせるとき、親の checkout は npm から pnpm に入れ直す(`rm -rf node_modules worker/node_modules && pnpm install --frozen-lockfile`)。

## 7. 配備

| # | 誰 | 作業 | コマンド |
|---|---|---|---|
| A12 | AI | 配備のワークフローを main で起こし、終わりまで見る | `gh workflow run deploy.yml --ref main --repo karak/sim-bio` → `gh run watch --repo karak/sim-bio` |
| (代わり) | AI | 手元から配る場合(CI を通さない。初回の確かめに限る) | `VITE_TURNSTILE_SITEKEY=<site key> pnpm run build:cloudflare && pnpm run check:free-tier && pnpm exec wrangler d1 migrations apply biotope-harbor --remote && pnpm exec wrangler deploy` |

## 8. 配ったあとの確かめ

| # | 誰 | 作業 | コマンド・画面 |
|---|---|---|---|
| A13 | AI | 画面と港が答えるか | `curl -sI https://biotope-island.<sub>.workers.dev/` と `curl -s https://biotope-island.<sub>.workers.dev/api/v1/chronicles` |
| A14 | AI | ログが流れるか(画面を開いた人の操作に合わせて見る) | `pnpm exec wrangler tail biotope-island --format pretty` |
| A15 | AI | D1 に行が入るか(出港のあと) | `uv run scripts/mod.py --remote budget` と `pnpm exec wrangler d1 execute biotope-harbor --remote --command "SELECT COUNT(*) FROM chronicles"` |
| H9 | 人 | 本物の Turnstile で出港 → リンク → 訪問 → 年表を読む を通す。積荷と回避率も見る | ブラウザで `https://biotope-island.<sub>.workers.dev/?scenario=test-quick` |
| H10 | 人 | Observability で CPU Time(10 ms の内か)・429 が返るか(Rate Limiting が無料で効くか)・`harbor.cron.stats` の行(毎日 00:10 UTC)を見る | ダッシュボード → Workers & Pages → biotope-island → Observability |

## 9. 片づけと戻し方

| 場面 | 誰 | コマンド |
|---|---|---|
| 荒らしを隠す・戻す・消す | AI(許可を得て) | `uv run scripts/mod.py --remote hide <id>` / `--remote restore <id>` / `--remote delete <id> --yes` |
| 配った版を 1 つ戻す | AI(許可を得て) | `pnpm exec wrangler deployments list` → `pnpm exec wrangler rollback <version-id>` |
| 港を止めたい(静的アセットは残す) | 人 | ダッシュボードで Worker のルートを外すか、`wrangler.jsonc` の `run_worker_first` を空にして配り直す |
