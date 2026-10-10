# CI 用の API トークンのテンプレート(最小の権限)

配備のワークフロー(`.github/workflows/deploy.yml`)が使う `CLOUDFLARE_API_TOKEN` を、必要な権限だけで作るための型。作るのは人(ダッシュボード)。値は、CI 用は GitHub の Environment `production` の secret に置く(docs/operations/cloudflare-deploy.md の H6・H7)。手元用 sim-bio-local-deploy は Keychain に置く(deploy-runbook.md の H11・H12)。

権限の根拠は 2026-09-27 に docs で確かめた。

- [Workers の roles と scope](https://developers.cloudflare.com/workers/authorization/workers/)
- [Wrangler の操作ごとに要る権限](https://developers.cloudflare.com/workers/authorization/)
- [Worker ごとの権限(2026-09-15)](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/)

## CI が行うことと、要る権限

| CI の手順 | 要る権限 | 根拠 |
|---|---|---|
| `wrangler deploy`(すでにある Worker) | Workers の **Editor**、scope は Worker `biotope-island` だけ | 「Deploy an existing Worker: Editor scoped to that Worker」 |
| `wrangler d1 migrations apply biotope-harbor --remote` | **D1 の Edit**(アカウント) | D1 を直に問い合わせる。Worker の権限では D1 に届かない(「Product-level Workers roles do not grant access to … D1」) |
| 静的アセットの配信 | Worker の配備に含まれる | — |

要らないもの:
- Zone の権限(workers.dev で配り、Route も Custom Domain も使わない)
- KV・R2・Queues・AI・Pages
- `wrangler whoami` 用の User の権限(CI と手元の deploy.py は `CLOUDFLARE_ACCOUNT_ID` を渡すので、アカウントを探さない)

**初めての配備はこのトークンではできない。** 新しい Worker を作るには、Workers の product scope の Admin が要る。また、まだ無い Worker は Worker ごとの scope で選べない。初回(2026-09-27)は手元の `wrangler login`(sim-bio だけを許した OAuth)で人の端末から配り、Worker `biotope-island` ができてからこのトークンを作った。

## ダッシュボードでの作り方(テンプレート)

Manage Account → **Account API Tokens** → Create Token → **Create Custom Token**(テンプレートの Edit Cloudflare Workers は Zone や KV まで含むので使わない)。

| 欄 | 値 |
|---|---|
| Token name | `sim-bio-ci-deploy` |
| Permissions 1 | **Workers** → Role **Editor** → Scope **Specified Workers** → `biotope-island` |
| Permissions 2 | **Account** → **D1** → **Edit** |
| Account Resources | Include → **sim-bio** だけ |
| Client IP Address Filtering | 付けない(GitHub の runner の IP は決まらない) |
| TTL | 終わりを付ける(例: 1 年後)。切れる前に作り直す |

作ったら、表示される値を一度だけ控え、すぐ GitHub に置く(`! gh secret set CLOUDFLARE_API_TOKEN --env production --repo karak/sim-bio`)。値はチャット・ファイル・コマンドの引数に書かない。

## API で作る場合(参考)

account-owned token は `POST /accounts/{account_id}/tokens` で作れる。ただし、先にダッシュボードで **Account API Tokens Edit** を持つトークンが要る。そのトークン自体の権限が強いので、この repo では使わない。

- permission group の id は `GET /accounts/{account_id}/tokens/permission_groups` で名前から引く。名前は変わりうるので、docs は id で書くよう勧めている。
- Worker ごとの scope(Specified Workers)の resource の書き方は、docs の API の例に無い。確かめられていないので、Worker ごとの権限はダッシュボードで作る。

## 手元のログイン(記録)

2026-09-27 は、sim-bio だけを許した OAuth で次のスコープに絞ってログインした。`wrangler login` は機械で 1 つの資格情報を共有するので、2026-10-05 の時点では別のアカウントのものになっている。配備・戻し・D1 の操作は、端末のログインに頼らず deploy-runbook.md の Keychain のトークンを環境で渡す。

```bash
pnpm exec wrangler login --scopes account:read user:read workers_scripts:write workers_tail:read d1:write challenge-widgets.write
```

`wrangler whoami` は、ほかのスコープ(workers:write・pages:write など)が無いと警告を出す。絞った結果なので問題はない。ほかの repo で広いスコープが要るときは、そのときにログインし直す(`wrangler login` は機械で 1 つの資格情報を共有する)。
