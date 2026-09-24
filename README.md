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

```bash
npm install
npm run dev        # 開発サーバ起動。http://localhost:5173
npm run build       # 本番ビルド
npm run preview     # ビルド結果をローカルで確認
npm run test        # 単体テスト(vitest)
npm run test:slow   # 通し(放置/校正)テスト。約 15〜20 分、CI では走らせない(下記)
npm run check       # typecheck + lint + test
```

E2E(Playwright)は初回だけブラウザのセットアップが要る。

```bash
npx playwright install   # 初回のみ(Chromium 等をダウンロード)
npx playwright test
```

3D モデル・Blender ファイル・PNG は Git LFS で管理している。クローン前に `git lfs install` を済ませておくこと(LFS が無いとポインタファイルだけが落ちてくる)。

CI(GitHub Actions、`.github/workflows/ci.yml`)は push と PR ごとに `npm run check` と Playwright の E2E を走らせる。`npm run test:slow` は 1 件あたり数分かかる通し実行なので CI には含めず、シナリオを触ったときに手元で回す(放置中の Mac ではバックグラウンド実行が極端に遅くなるので、`caffeinate` を付けて前面で回すか `-t` で分割する)。

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
| `tests/slow/` | 通し（放置/校正）テスト。`npm run test:slow` で実行、CI では走らせない |
| `tools/` | チケット一覧・状態更新・コンセプト画生成などのスクリプト |
| `tools/blender/` | 3D モデル生成・検証用の Blender Python スクリプト |
| `issues/` | チケット(Markdown + frontmatter で状態管理、レベルデザインの進め方も記載) |

## 設計方針（暫定）

- `src/simulation/` は描画ライブラリに依存させない。ヘッドレスで高速にテストできるようにする。
- 種やバイオームの定義はコードではなく `assets/data/` のデータとして持ち、バランス調整をデータ変更だけで行えるようにする。
