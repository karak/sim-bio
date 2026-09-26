# sim-bio(仮称)— ブラウザで動く 3D 生態系を見守るゲーム

[![CI](https://github.com/karak/sim-bio/actions/workflows/ci.yml/badge.svg)](https://github.com/karak/sim-bio/actions/workflows/ci.yml)

リポジトリ: https://github.com/karak/sim-bio

> **English summary**: A browser-based 3D ecosystem simulation in the spirit of *SimEarth*. You watch over a small island — plants, herbivores, carnivores, and a rising civilization — through a prophecy engraved on a stone tablet, spending a limited "power of the stars" to nudge climate and life so the island survives its foretold doom.

## 概要

シムアース風に、神視点で島の生態系(植物・草食獣・肉食獣・分解者)と気候を見守り、種を放つ・気候を動かす・災害を起こすといった軽い介入で変化を観察するブラウザ 3D シミュレーションである。かつて海に沈んだ大陸「ムー」の欠片が世界観で、島には必ず滅びを告げる**石板**の予言があり、プレイヤー(星の見守り手)は限られた**星の力**を使って予言どおりの滅びを回避する。本体(勝敗のない自由シミュレーション)の上に、滅びと回避を扱う「シナリオ」層が被さる構成になっている。

## スクリーンショット

![全体俯瞰のシミュレーション画面](docs/design/screenshots/01-overview.png)

*本体の全体俯瞰。空の舟 25 年目の島(集落・鐘樹・個体の分布)と、気候・介入・個体数の推移のパネル。*

以下は観察画面(島に降りて生き物と暮らしを眺める 3D の画面)。

| | |
|---|---|
| ![集落の朝](docs/design/screenshots/02-settlement.png)<br>集落の朝。小屋・灯り柱・鐘樹 | ![船台の空の舟](docs/design/screenshots/03-slipway.png)<br>船台で組み上がった空の舟 |
| ![空の舟の飛び立ち](docs/design/screenshots/04-departure.png)<br>空の舟の飛び立ち。夕暮れの外海へ去る | ![夜の集落](docs/design/screenshots/05-night.png)<br>夜の集落。灯り柱と鐘樹の鐘 |
| ![鹿の群れ](docs/design/screenshots/06-deer.png)<br>海辺の斜面の鹿の群れ | ![狼](docs/design/screenshots/07-wolf.png)<br>林の縁を歩く狼 |
| ![兎](docs/design/screenshots/08-rabbit.png)<br>草地の兎と、岩肌の斜面 | ![鐘樹の林](docs/design/screenshots/09-grove.png)<br>鐘樹の林と舟の肋材 |
| ![海岸](docs/design/screenshots/10-coast.png)<br>入り江の砂浜と浅瀬 | |

撮り直しは `node tools/readme-shots.ts --url <動いている Vite の URL>`。

## 動かし方

パッケージは pnpm(10.28.1、`package.json` の `packageManager`)で入れる。`scripts/` の Python(構成検査と運用スクリプト)は [uv](https://docs.astral.sh/uv/) で回すので、uv も入れておく(`pnpm run check` が使う)。`pnpm-workspace.yaml` が本体と `worker/` の 2 つを束ね、lockfile は `pnpm-lock.yaml` の 1 つだけ。

```bash
pnpm install --frozen-lockfile
pnpm run dev        # 開発サーバ起動。http://localhost:5173
pnpm run build       # 本番ビルド
pnpm run preview     # ビルド結果をローカルで確認
pnpm run test        # 単体テスト(vitest)
pnpm run test:slow   # 通し(放置/校正)テスト。約 15〜20 分、CI では走らせない(下記)
pnpm run check       # typecheck + lint + test
pnpm run test:worker # ログの受け口 (Worker) の単体テスト。workerd の中で回す。check にも入っている
pnpm run test:scripts # scripts/ の Python の単体テスト(unittest)。ローカルの D1 も使う。check にも入っている
```

`pnpm run <script>` に引数を渡すときは `--` を挟まない(`pnpm run dev --port 5180`)。pnpm は `--` もそのまま script へ渡すので、vite は後ろの `--port` を読まない。

git worktree で作業するときも、worktree ごとに `pnpm install --frozen-lockfile` を実行して自分の `node_modules` を持つ。ほかの checkout の `node_modules` へ symlink を張らない。pnpm は同じディスクの store からハードリンクで配るので、2 つ目からの install は速く、容量もほとんど増えない。store の場所は `pnpm store path` で見る。repo を置いたディスクに home が無いとき(外付けのディスクなど)は、pnpm はそのディスクの根に `.pnpm-store` を作るので、ハードリンクが効く。repo の設定では store の場所を決めない(CI やほかの機械で壊れるため)。

E2E(Playwright)は初回だけブラウザのセットアップが要る。

```bash
pnpm exec playwright install   # 初回のみ(Chromium 等をダウンロード)
pnpm exec playwright test
```

3D モデル・Blender ファイル・PNG は Git LFS で管理している。クローン前に `git lfs install` を済ませておくこと(LFS が無いとポインタファイルだけが落ちてくる)。

CI(GitHub Actions、`.github/workflows/ci.yml`)は push と PR ごとに `pnpm run check` と Playwright の E2E を走らせる。`pnpm run test:slow` は 1 件あたり数分かかる通し実行なので CI には含めず、シナリオを触ったときに手元で回す(放置中の Mac ではバックグラウンド実行が極端に遅くなるので、`caffeinate` を付けて前面で回すか `-t` で分割する)。

CI は続けて `pnpm run test:e2e:cloudflare`(ビルドを wrangler dev で配って、ログの受け口に当てる E2E)も走らせる。配備は CI ではなく、下の「Cloudflare へ配る」のワークフローで人が起こす。

## Cloudflare へ配る

設計は `docs/design/2026-09-26-cloudflare-architecture.md`(§3・§4.2)。Worker 1 本(`wrangler.jsonc`)で、静的アセット(`dist/`)とログの受け口(`/api/v1/logs`、`worker/src/index.ts`)を出す。

- 静的アセットは Worker を起こさずに配る(無料・無制限)。`run_worker_first: ["/api/*"]` なので、Worker が動くのは `/api/*` だけ。知らない道には `index.html` を返す。
- 配らないもの(`.blend`・コンセプト画・デザインボード・Blender に焼く前の絵)は `assets/.assetsignore` に書く。vite がこれを `dist/.assetsignore` へ写し、wrangler がそれを読む。
- 受け口は `LogBatch`(`src/core/log/batch.ts`、クライアントと同じファイル)を検証し、1 件ずつ JSON 1 行で Workers Logs に書く。Workers Free の Workers Logs は 1 日 200,000 件・3 日保持([pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs))。D1 は使わない。自分の Origin 以外からの POST は 403、形が違えば 400、64 KiB を超えれば 413。
- Origin の確認は、よそのページからブラウザで送りつけられるのを断るためのもので、認証ではない(curl なら Origin は自由に付けられる)。枠を守る本当の栓は、M19-08 の日次上限。

### 手元で確かめる(アカウントは要らない)

```bash
pnpm run dev:cloudflare        # VITE_LOG_URL=/api/v1/logs でビルドし、wrangler dev で配る。http://localhost:8787
pnpm run test:e2e:cloudflare   # 同じビルドを wrangler dev で立て、画面のログが受け口に 1 バッチ届くことを Playwright で確かめる
```

`pnpm run dev:cloudflare` で画面を開き、速度を 100 倍にすると、10 秒ほどで端末に `{"event":"harbor.logs.record","record":{...}}` の行が出る。

`wrangler.jsonc` を変えたら `pnpm run types:worker` で `worker/worker-configuration.d.ts` を作り直す(`pnpm run typecheck` が古さを検査する)。

### 配備(人が行う)

配備は GitHub Actions の `Deploy (Cloudflare)`(`.github/workflows/deploy.yml`)で行う。起動は Actions の画面の「Run workflow」だけで、main への push では走らない。出せるのは main だけ。中身は、`lfs: true` の checkout → `pnpm install --frozen-lockfile` → `pnpm run check` → `pnpm run build:cloudflare` → `wrangler deploy`。

初回だけ、次を人が行う。

1. **このゲーム専用の Cloudflare アカウントを作る。** Workers と D1 の無料枠はアカウント単位なので、ほかの Worker と枠を食い合わないようにする(設計書 C8)。
2. **支払い方法を登録しない。** Workers Paid に上げる操作は、この設計の外で人が決める(設計書 §3.3)。無料枠を使い切った日は、課金されずに港(`/api/*`)が止まる。
3. ダッシュボードの **Workers & Pages** で、`workers.dev` のサブドメインを決める。配った画面は `https://biotope-island.<サブドメイン>.workers.dev` になる。
4. **Account API tokens** で、テンプレート **Edit Cloudflare Workers** のトークンを作り、このアカウントだけに絞る。
5. GitHub の Settings → Environments で `production` を作り、Deployment branches and tags を `main` だけにする。その Environment secrets に、`CLOUDFLARE_API_TOKEN`(4 のトークン)と `CLOUDFLARE_ACCOUNT_ID`(アカウント ID)を置く。値はリポジトリに書かない。
6. Actions の `Deploy (Cloudflare)` を、branch に `main` を選んで「Run workflow」で起こす。ほかの branch を選ぶと、job は飛ばされる。

配ったあとのログは、ダッシュボードの Workers & Pages → `biotope-island` → Observability で読む。手元の端末からは `pnpm exec wrangler tail`(要 `pnpm exec wrangler login`)でも流れを見られる。

### 課金にしない

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

### 運用(`scripts/mod.py`)

荒らしの片づけと予算の確かめは `scripts/mod.py` 1 本で行う(設計書 Q4)。中身は `wrangler d1 execute`。配った港に当てるときは `--remote`(要 `pnpm exec wrangler login`)、`wrangler dev` のローカルの D1 には `--local` を付ける。どちらかを必ず選ぶ。

```bash
uv run scripts/mod.py --remote hide <年代記の id>          # 一覧と訪問から隠す。もう隠れていれば、隠した時刻はそのまま
uv run scripts/mod.py --remote restore <年代記の id>       # 戻し、通報の数を 0 にする
uv run scripts/mod.py --remote delete <年代記の id> --yes  # 消す。戻せないので --yes が要る
uv run scripts/mod.py --remote budget --days 7             # 日次予算(出港・積荷・通報)の消費を、新しい日から上限との比で見る
```

年代記の id は SHA-256 の 16 進 64 文字だけを受ける(SQL に埋めるため)。無い id は「見つからない」で終了コード 1 になる。表と列(`chronicles`・`daily_budget`)は、港の D1 のマイグレーション(M19-08)の前に設計書 §5・§6 から置いた仮の形で、M19-08 で本物に合わせる。

## 遊び方

URL に `?scenario=<id>` を付けると、その石板の予言を背負って始まる。省略すると勝敗のない自由モード。

| id | 石板の予言(要約) |
|---|---|
| `sinking` | 沈む欠片 — 百年かけて海に沈む島。高地に雨を呼んで凌ぐ |
| `falling-star` | 星が落ちる夜 — 六十年目に隕石が全てを焼く。落下後に命を戻せるか |
| `volcano` | 火の山の目覚め — 八十年目に噴火し緑を焼く。苔・草・森・獣を戻せるか |
| `enrichment` | 豊かさの罠 — 雨を増やしすぎると豊かさの反動で狼が絶える |
| `vitality-famine` | 生気の飢饉 — 分解者(苔)がいないと土の生気が百年で尽きる |
| `tower` | 塔の重さ — 文明の塔が森を伐り生気を吸う。森を保ったまま塔を支えられるか |

- **石板**: 画面上の UI に予言と、これまでの介入・警告・勝敗が刻まれた**年表**が表示される。
- **星の力**: 雨を降らせる・種を放つ・災害を鎮めるなどの介入には星の力(予算)を使う。力は陸地と生気から湧き、島が痩せるほど細る。
- **住みやすさレイヤー**: 表示レイヤーを切り替えると、各セルがどの種にとって住みやすいかを色で確認できる(密度レイヤーと併用)。

## 設計と資料への導線

- 設計書(本体の仕様・モジュール構成・マイルストーン受入基準): `docs/specs/2026-09-19-ecosystem-sim-design.md`
- 実装計画: `docs/specs/plans/`
- シナリオ層と世界観(石板・遺産・空想の生き物・文明仮説・シナリオ 30 本): `docs/design/2026-09-19-scenarios-and-world.md`
- 企画書(ピッチ): `docs/design/2026-09-19-proposal.html`
- 参考資料(類似ゲーム・生態学・技術調査): `references/`
- チケット(進捗・受入基準・作業ログ): `issues/`(一覧は `tools/issues.sh`)

## 開発の流れ

チケットは GitHub Issues ではなく `issues/` フォルダで Markdown + frontmatter により管理する(状態は `todo` → `in_progress` → `done`)。`tools/issues.sh` で一覧、`tools/issue-status.sh` で状態更新ができる。マイルストーンは M1〜M8 が完了(M8 は古代文明・輝石・「塔の重さ」)、M9 以降(信仰、文明拡張、公開作業の残り)は計画中である。GitHub の Issues/PR での提案も歓迎するが、進捗の正は `issues/` にある。

シナリオを伴うマイルストーンでは、校正の前に必ず**レベルデザイン**のチケットを置く(`docs/design/<date>-level-design-<scenario>.md`)。体験の芯とキーアイテムを決め → 縦切りで実装 → 感度・定着・副作用がヘッドレスで通ってから数値を校正 → 手動で 3 回遊んで受入、という順で進める。詳細は `issues/README.md` を参照。

## 3D モデルとコンセプト画

`assets/textures/concept/` のコンセプト画像は Gemini の画像生成 API(`tools/gen-concept-art.mjs`)で **AI 生成**したものである。利用には `GEMINI_API_KEY` が要る(`.env.example` を `.env` にコピーして設定)。

`assets/models/` のローポリ 3D モデル(rabbit / deer / wolf の `.blend` / `.glb`)は、上記の AI 生成コンセプト画を参照画像として Blender の Python スクリプト(`tools/blender/`)で組み立てたものである。Blender 本体は任意インストールのツールで、スクリプトの実行には `~/.claude/skills/blender` のヘルパー(`run_blender.sh` 等)を使う運用にしている。

これらの生成画像・3D モデルはリポジトリに含めて公開し、`.blend` / `.glb` は Git LFS で管理する(`.gitattributes` 参照)。いずれも AI 生成物または AI 生成物を参照して作成したものであることを明記する。

## ライセンス

このリポジトリのコードは [MIT License](./LICENSE)(Copyright (c) 2026 karak97)。

サードパーティ依存(確認したもののみ記載。詳細は各パッケージの `node_modules/*/package.json` を参照):

| パッケージ | 用途 | ライセンス |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | 3D 描画 | MIT |
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | 地形生成のノイズ | MIT |
| [vite](https://github.com/vitejs/vite) | 開発サーバ・ビルド | MIT |
| [vitest](https://github.com/vitest-dev/vitest) | 単体テスト | MIT |
| [eslint](https://github.com/eslint/eslint) / [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | Lint | MIT |
| [@playwright/test](https://github.com/microsoft/playwright) | E2E テスト | Apache-2.0 |
| [typescript](https://github.com/microsoft/TypeScript) | 型検査 | Apache-2.0 |
| [wrangler](https://github.com/cloudflare/workers-sdk) | Cloudflare Workers の配信・ローカル実行 | MIT OR Apache-2.0 |
| [@cloudflare/vitest-plugin](https://github.com/cloudflare/workers-sdk) | Worker の単体テスト(workerd の中で vitest を回す) | MIT |

`assets/textures/concept/` のコンセプト画像・`assets/models/` の 3D モデルは AI 生成(または AI 生成物を参照した作成物)であり、上記「3D モデルとコンセプト画」の節を参照。

## フォルダ構成

| フォルダ | 役割 |
|---|---|
| `docs/` | 仕様書 |
| `docs/specs/` | 機能仕様・技術設計（承認済みの設計を置く） |
| `docs/design/` | ゲームデザイン文書（GDD、コンセプト、バランス表、QA 資料） |
| `docs/decisions/` | ADR（技術選定などの意思決定記録） |
| `assets/` | 素材 |
| `assets/models/` | 3D モデル（glTF/GLB、Git LFS 管理） |
| `assets/textures/` | テクスチャ、ハイトマップ、AI 生成コンセプト画 |
| `assets/audio/` | BGM・効果音 |
| `assets/shaders/` | GLSL シェーダー |
| `assets/data/` | 種・バイオーム・シナリオ等のパラメータ定義（JSON/YAML） |
| `references/` | 参考資料 |
| `references/games/` | 類似ゲーム（SimEarth, Spore, Equilinox 等）の分析メモ |
| `references/science/` | 生態学・気候モデル・個体群動態の資料 |
| `references/tech/` | Three.js / WebGPU / ECS 等の技術資料 |
| `src/` | ソースコード |
| `src/core/` | ゲームループ、時間管理、イベントバス |
| `src/simulation/` | 生態系シミュレーション（描画に依存しない純粋ロジック） |
| `src/render/` | 3D 描画（Three.js 等） |
| `src/ui/` | HUD、パネル、グラフ表示 |
| `src/scenario/` | 石板・シナリオ判定・警告などのシナリオ層 |
| `src/utils/` | 共通ユーティリティ |
| `tests/` | テスト |
| `tests/unit/` | 単体テスト（主に `src/simulation/`） |
| `tests/integration/` | シミュレーション + 描画の結合テスト |
| `tests/e2e/` | ブラウザ E2E テスト |
| `tests/e2e-cloudflare/` | ビルドを wrangler dev で配って当てる E2E。`pnpm run test:e2e:cloudflare` |
| `tests/slow/` | 通し（放置/校正）テスト。`pnpm run test:slow` で実行、CI では走らせない |
| `worker/` | Cloudflare の Worker(港。今はログの受け口)。別の pnpm workspace の package で、テストは `@cloudflare/vitest-plugin`(vitest 4) |
| `scripts/` | 運用の Python(uv で回す)。課金にしない構成検査 `check_free_tier.py`、港の運用 `mod.py`、その単体テスト `test_*.py` |
| `tools/` | チケット一覧・状態更新・コンセプト画生成などのスクリプト |
| `tools/blender/` | 3D モデル生成・検証用の Blender Python スクリプト |
| `issues/` | チケット(Markdown + frontmatter で状態管理、レベルデザインの進め方も記載) |

## 設計方針（暫定）

- `src/simulation/` は描画ライブラリに依存させない。ヘッドレスで高速にテストできるようにする。
- 種やバイオームの定義はコードではなく `assets/data/` のデータとして持ち、バランス調整をデータ変更だけで行えるようにする。
