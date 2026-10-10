# 配備の手順書(端末の状態に左右されない形)

この Mac は、いくつもの repo で wrangler を使う。`wrangler login` の OAuth は機械に 1 つだけで(`~/.wrangler` に置かれ、どの repo からも同じものが使われる)、今はこのゲームとは別の Cloudflare アカウントのものになっている。そのため、手元で `wrangler` をそのまま打つ配備は、そのときの端末の状態で結果が変わる。

この手順書は、端末の OAuth を一度も使わずに配る 2 つの道を書く。

- **主の道**: GitHub Actions の `.github/workflows/deploy.yml`。端末の状態にまったく依らない。ふだんはこちら。
- **控えの道**: 手元の `scripts/deploy.py`(`pnpm run deploy`)。この repo 専用の API トークンを macOS の Keychain から読み、wrangler の子プロセスにだけ環境変数で渡す。Actions が使えないときに使う。

人(H)と AI(A)の分け方、番号(H6・H7・A7〜A9)は docs/operations/cloudflare-deploy.md と同じ。トークンの権限の型は docs/operations/cloudflare-api-token.md。

## 最初に: 資格情報の照合

どの手順の前にも、まず今の端末の状態を照らす。端末がどうなっていても、この手順書の道は変わらない。照合はそれを確かめ、どの道を使うかを言う。

```bash
pnpm run cf:auth              # uv run scripts/cf_auth.py
pnpm run cf:auth --no-whoami  # wrangler whoami を打たない
```

人の端末で `!` を付けて打つ(Keychain を読むと、初回は macOS が許可を聞く)。出すもの:

1. **端末の wrangler の OAuth**(照らすだけで、使わない): ログインしているか、期限、どのアカウントか、sim-bio に要る 6 つのスコープ(`account:read user:read workers_scripts:write workers_tail:read d1:write challenge-widgets.write`、cloudflare-deploy.md の H3)がそろっているか。sim-bio の account が無ければ「sim-bio の account ではない」と出る。どちらでも、この repo のスクリプトは端末の OAuth を使わない。
   - ファイル(macOS では `~/Library/Preferences/.wrangler/config/default.toml`。`~/.wrangler` の dir があればそちら、`XDG_CONFIG_HOME` があれば `$XDG_CONFIG_HOME/.wrangler`)からは `scopes` と `expiration_time` だけを読む。`oauth_token`・`refresh_token` の値は読まず、出さない。
   - アカウントは `wrangler whoami --json` で見る(環境の `CLOUDFLARE_*` を外して打つので、端末の OAuth のアカウントが出る)。whoami は期限の切れた OAuth を延ばし、そのファイルを書き換える(ログインし直しはしない)。whoami が答えないとき(網の失敗など)は、ログインしていないとは言わず「whoami が答えない」と出す。避けたいときは `--no-whoami`。
2. **Keychain のトークン** `sim-bio-local-deploy`(account は `$USER`): 項目が有るか(値を読まずに見る)。有れば値を読み、Cloudflare の API(`GET /accounts/14c725d39e9cf53743be403ab146174f/d1/database`)で、トークンが sim-bio に届き、`biotope-harbor` の id が `wrangler.jsonc` の `4b9db893-5306-4a01-9eb9-4926c2b34d17` と同じかを確かめる。トークンは出さない。
3. **使う道**: 使えるときは「使う道: Keychain のトークン (sim-bio-local-deploy) を CLOUDFLARE_API_TOKEN として wrangler の子プロセスにだけ渡す。端末の OAuth は使わない」と出て、終了 0。使えないときは「使う道: 無い。止める」と訳(項目が無い → H11・H12。API が断ったときは、返したコード(7403 など)と「別のアカウントのトークンか、権限が足りない」)を出して、終了 1。`wrangler login` では直さない。

`scripts/deploy.py`(3 の控えの道)と `scripts/mod.py --remote` は、同じ照合を最初に行う(どちらも whoami は打たない)。deploy.py はここで Keychain の項目の有る無しだけを見て、値を読むのは `pnpm run check` の後の token の段。mod.py --remote は値を読んで照合し、通ったときだけ wrangler を起こす(照合する D1 は wrangler.jsonc のものなので、--remote には `--config` を付けられない)。主の道(GitHub Actions)は端末に依らないので、照合は要らない。

## 0. 前提の値(どれも秘密ではない)

| 名前 | 値 |
|---|---|
| Cloudflare のアカウント | sim-bio、account id `14c725d39e9cf53743be403ab146174f` |
| Worker | `biotope-island` |
| D1 | `biotope-harbor`(binding `HARBOR`) |
| Turnstile の site key | `0x4AAAAAAFFM5qcR0ciWH4Br` |
| 配った画面 | https://biotope-island.dev-sim-bio.workers.dev |
| GitHub の repo | `karak/sim-bio` |

`wrangler.jsonc` に `account_id` を書いて、アカウントを留める。ほかのアカウントの資格情報で wrangler を動かすと、黙って別のアカウントに Worker を作るのではなく、7403 などで大きく落ちる。

## 1. 2026-10-05 の 7403 はなぜ起きたか

手元で `pnpm exec wrangler d1 migrations apply biotope-harbor --remote` を打ったところ、`code: 7403`(The given account is not valid or is not authorized to access this service)で止まった。

- 環境変数 `CLOUDFLARE_API_TOKEN` が無いと、wrangler は `wrangler login` の OAuth を使う。
- その OAuth は、別の repo のために別のアカウントでログインし直されていた。
- そのアカウントの資格情報で、sim-bio の D1(`wrangler.jsonc` の `database_id`)を開こうとしたので、権限が無いと言われた。

wrangler は `CLOUDFLARE_API_TOKEN` が環境にあれば OAuth を見ない。控えの道はこれを使う。

### 別のアカウントの資格情報で動いているときの見え方

- `code: 7403`(アカウントに権限が無い)、`code: 10000`(Authentication error)、`code: 9109`(トークンが無効)
- アカウントを選ばせる問いが出る(資格情報が複数のアカウントに届き、`account_id` が渡っていない)
- `wrangler whoami` が sim-bio 以外のアカウント・メールを出す
- `wrangler d1 list` に `biotope-harbor` が無い、または `database_id` が `4b9db893-5306-4a01-9eb9-4926c2b34d17` でない

どれかが出たら、その場で止める。`wrangler login` でログインし直して進めない(ほかの repo の資格情報を壊す)。

## 2. 主の道: GitHub Actions

### 2.1 一度だけの準備

| # | 誰 | 作業 | コマンド・画面 |
|---|---|---|---|
| A7 | AI(許可を得て) | Environment `production` を作り、配れる branch を `main` だけにする | `gh api -X PUT repos/karak/sim-bio/environments/production -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'` → `gh api -X POST repos/karak/sim-bio/environments/production/deployment-branch-policies -f name=main -f type=branch` |
| H6 | 人 | CI 用の API トークン `sim-bio-ci-deploy` を作る(型は cloudflare-api-token.md: Workers Editor を `biotope-island` だけに、D1 Edit、Account は sim-bio だけ、TTL 付き) | ダッシュボード → Manage Account → Account API Tokens → Create Custom Token |
| H7 | 人 | トークンを Environment secret に置く。値は対話の入力で渡し、チャット・ファイル・引数に書かない | `! gh secret set CLOUDFLARE_API_TOKEN --env production --repo karak/sim-bio` |
| A8 | AI(許可を得て) | account id を Environment secret に置く | `gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo karak/sim-bio --body 14c725d39e9cf53743be403ab146174f` |
| A9 | AI(許可を得て) | Turnstile の site key を Environment variable に置く | `gh variable set TURNSTILE_SITEKEY --env production --repo karak/sim-bio --body 0x4AAAAAAFFM5qcR0ciWH4Br` |
| A10 | AI | 置いたものを確かめる(値は出ない) | `gh api repos/karak/sim-bio/environments/production --jq '.name, .deployment_branch_policy'` と `gh secret list --env production --repo karak/sim-bio` と `gh variable list --env production --repo karak/sim-bio` |

`production` が無いままワークフローを起こすと、GitHub が空の Environment を自動で作り、secret が無いので wrangler の段で落ちる(配られはしない)。先に A7 を済ませる。

### 2.2 配る

配るものは main に入っていること(ワークフローは main 以外では動かない)。

```bash
gh workflow run deploy.yml --ref main --repo karak/sim-bio
sleep 5  # 起こした run が一覧に出るまで
gh run watch "$(gh run list --workflow deploy.yml --repo karak/sim-bio --limit 1 --json databaseId --jq '.[0].databaseId')" --repo karak/sim-bio --exit-status
```

`gh run watch` に run の id を渡さないと、端末で run を選ばせる問いが出る。上の形は最新の run を名指しする。

ワークフローは check → site key の有無 → build → 課金にしない検査 → D1 のマイグレーション → `wrangler deploy` の順に回る。終わったら 5 の確かめをする。

## 3. 控えの道: 手元の `scripts/deploy.py`

端末の OAuth は使わない。`wrangler login` も `wrangler whoami` も打たない。

### 3.1 一度だけの準備(人)

| # | 誰 | 作業 | コマンド・画面 |
|---|---|---|---|
| H11 | 人 | 手元用の API トークン `sim-bio-local-deploy` を作る。型は H6 と同じ(cloudflare-api-token.md)。CI のトークンとは別にして、片方を止めても片方が残るようにする | ダッシュボード → Manage Account → Account API Tokens → Create Custom Token |
| H12 | 人 | トークンを Keychain に置く。service の名前は `deploy.config.json` の `keychain_service`、account は `$USER`(`keychain_account` が null のとき)。`-w` の後に値を書かないと対話で 2 回聞かれる。値はチャット・ファイル・引数に書かない | `! security add-generic-password -s sim-bio-local-deploy -a "$USER" -w` |

### 3.2 配る

```bash
pnpm run cf:auth           # 最初に: 資格情報の照合。「使う道: Keychain のトークン」が出てから進む
pnpm run deploy --dry-run  # 設定と手順を出すだけ。Keychain・wrangler・ネットワークに触れない
pnpm run deploy            # 本番に配る
pnpm run deploy --check    # 配る前に pnpm run check も回す
```

人の端末で `!` を付けて打つ(Keychain を読むと、初回は macOS が許可を聞く)。repo の根で `pnpm install --frozen-lockfile` 済み、`uv` が入っていること(`pnpm run deploy` は `uv run scripts/deploy.py`)。`--allow-branch` は、HEAD の木が `origin/main` と違っても配る(ふだんは使わない)。

スクリプトの手順:

0. 資格情報の照合(「最初に」と同じ。whoami は打たず、Keychain は項目の有る無しだけを見る)。項目が無ければ、ほかに何もせずに止まる。
1. 前の確かめ: 作業の木が綺麗か(未追跡は `deploy.config.json` の `untracked_ok` の下だけ許す)、`git fetch origin main` の後、HEAD の木が `origin/main` の木と同じか(違えば止まる。`--allow-branch` で外せる)、追跡している glb・png(repo の全体)が git LFS のポインタのままでないか。
2. `--check` のときは `pnpm run check`。
3. Keychain からトークンを読み、Cloudflare の API(`GET /accounts/<id>/d1/database`)で、トークンが sim-bio に届き、`biotope-harbor` の id が `wrangler.jsonc` と同じかを確かめる。違えば wrangler を一度も起こさずに止まる。
4. `pnpm run build:cloudflare`(`VITE_TURNSTILE_SITEKEY` を付けて)→ `pnpm run check:free-tier`。
5. `wrangler d1 migrations list biotope-harbor --remote` を出してから `wrangler d1 migrations apply biotope-harbor --remote`。
6. `wrangler deploy`。
7. `wrangler deployments list --json` から版の id を出し、画面(`/` が 200)と港(`/api/v1/chronicles` が JSON)を確かめる。

トークンは wrangler の子プロセスの環境(`CLOUDFLARE_API_TOKEN`)と、3 の API の要求の header にだけ渡る。コマンドの引数・画面の出力・例外の文には出さない(子プロセスの出力に混じっても伏せ字にする)。継いだ環境にある `CLOUDFLARE_*`・`CF_*`・`WRANGLER_*` は、どの子プロセスからも外す。wrangler には `CLOUDFLARE_API_BASE_URL` も明示して渡すので、repo の `.env` が宛先を書き換えてもトークンは Cloudflare の外へ出ない。Keychain の値が API トークンの形(英数字・`_`・`-` で 30 字以上)でなければ、値を出さずに止まる。マイグレーションを当てた後で止まったときは、6 の戻し方を指す。

## 4. トークンの差し替え

CI 用と手元用は別に差し替える。

| 場面 | 誰 | 作業 |
|---|---|---|
| CI 用(`sim-bio-ci-deploy`) | 人 | ダッシュボードで同じ型のトークンを作る → `! gh secret set CLOUDFLARE_API_TOKEN --env production --repo karak/sim-bio` → 2.2 で一度配って通ることを見る → 古いトークンを Roll か Delete |
| 手元用(`sim-bio-local-deploy`) | 人 | 同じ型のトークンを作る → `! security add-generic-password -U -s sim-bio-local-deploy -a "$USER" -w`(`-U` で上書き)→ `pnpm run deploy` で配る(新しいトークンで verify-account が通ることを見る) → 古いトークンを Delete |
| 漏れたかもしれない | 人 | まずダッシュボードで該当のトークンを Delete。それから上の手順で作り直す |

TTL が切れると wrangler は認証の失敗(`code: 10000` など)で止まる。切れる前に作り直す。

## 5. 配ったあとの確かめ

`scripts/deploy.py` は 1・2 を自分で行う。Actions のあとは AI が打つ。

| # | 作業 | コマンド |
|---|---|---|
| 1 | 画面が 200 を返す | `curl -s -o /dev/null -w '%{http_code}\n' https://biotope-island.dev-sim-bio.workers.dev/` |
| 2 | 港が JSON を返す | `curl -s https://biotope-island.dev-sim-bio.workers.dev/api/v1/chronicles \| head -c 300` |
| 3 | 人が本物の Turnstile で出港 → リンク → 訪問 → 年表を通す | ブラウザで `https://biotope-island.dev-sim-bio.workers.dev/?scenario=test-quick` |

ほかの確かめ(ログ・D1 の行・Observability)は cloudflare-deploy.md の 8。

## 6. 戻し方

```bash
CLOUDFLARE_API_TOKEN="$(security find-generic-password -s sim-bio-local-deploy -a "$USER" -w)" \
CLOUDFLARE_ACCOUNT_ID=14c725d39e9cf53743be403ab146174f \
  pnpm exec wrangler deployments list
# 戻したい版の Version ID を選び
CLOUDFLARE_API_TOKEN="$(security find-generic-password -s sim-bio-local-deploy -a "$USER" -w)" \
CLOUDFLARE_ACCOUNT_ID=14c725d39e9cf53743be403ab146174f \
  pnpm exec wrangler rollback <version-id> --message "<戻す訳>"
```

`--message` を付けないと、wrangler が訳を問う。これも OAuth を使わないよう、トークンを環境変数で渡す(値は `$(...)` で直に渡り、画面にも履歴にも残らない)。人の端末で打つ(`!` を付けて)。

`wrangler rollback` が戻すのは Worker の版だけ。D1 のマイグレーションは前へしか進まないので、戻した Worker は新しい表の形の上で動く。列を足すだけのマイグレーションなら古い Worker でも動くが、列や表を消す・名前を変えるマイグレーションの後は戻さない(戻すと港が壊れる)。そういうマイグレーションは、Worker の 2 回の配備に分けて入れる(先に新旧どちらの形でも動く Worker、次にマイグレーション)。

## 7. ほかの repo で使うとき

`scripts/deploy.py` は repo ごとの値を持たない。`scripts/deploy.py` と `scripts/check_free_tier.py`(JSONC を読むのに使う)を写し、repo の根に `deploy.config.json` を書く。

| key | 意味 |
|---|---|
| `account_id` | 配るアカウント。`wrangler.jsonc` の `account_id` と同じでないと止まる |
| `worker` | Worker の名前。`wrangler.jsonc` の `name` と同じでないと止まる |
| `d1_databases` | マイグレーションを当てる D1 の名前の list。`wrangler.jsonc` の `d1_databases[].database_name` にあるもの |
| `keychain_service` / `keychain_account` | Keychain の項目。account が null なら `$USER` |
| `build.script` / `build.env` | build の pnpm script と、焼く公開の値(秘密は置かない) |
| `checks` | build の後、配る前に回す pnpm script |
| `smoke` | 配ったあとに GET する URL。`expect` は `ok`(200)か `json`(200 で JSON) |
| `branch` / `remote` | 配ってよい木。HEAD の木が `<remote>/<branch>` と同じでないと止まる |
| `untracked_ok` | 未追跡でも止めない道の接頭辞 |
| `lfs_dirs` / `lfs_suffixes` | LFS のポインタのままでないかを見るファイル |
| `wrangler_config` | wrangler の設定の道(既定 `wrangler.jsonc`) |
