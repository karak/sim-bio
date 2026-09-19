# game-demo — ブラウザで動く 3D 生態系シミュレーション

シムアース風の「生態系を見守る」ゲーム。ブラウザ上で 3D 表示する。

## フォルダ構成

| フォルダ | 役割 |
|---|---|
| `docs/` | 仕様書 |
| `docs/specs/` | 機能仕様・技術設計（承認済みの設計を置く） |
| `docs/design/` | ゲームデザイン文書（GDD、コンセプト、バランス表） |
| `docs/decisions/` | ADR（技術選定などの意思決定記録） |
| `assets/` | 素材 |
| `assets/models/` | 3D モデル（glTF/GLB） |
| `assets/textures/` | テクスチャ、ハイトマップ |
| `assets/audio/` | BGM・効果音 |
| `assets/shaders/` | GLSL シェーダー |
| `assets/data/` | 種・バイオーム・パラメータ定義（JSON/YAML） |
| `references/` | 参考資料 |
| `references/games/` | 類似ゲーム（SimEarth, Spore, Equilinox 等）の分析メモ |
| `references/science/` | 生態学・気候モデル・個体群動態の資料 |
| `references/tech/` | Three.js / WebGPU / ECS 等の技術資料 |
| `src/` | ソースコード |
| `src/core/` | ゲームループ、時間管理、イベントバス |
| `src/simulation/` | 生態系シミュレーション（描画に依存しない純粋ロジック） |
| `src/render/` | 3D 描画（Three.js 等） |
| `src/ui/` | HUD、パネル、グラフ表示 |
| `src/utils/` | 共通ユーティリティ |
| `tests/` | テスト |
| `tests/unit/` | 単体テスト（主に `src/simulation/`） |
| `tests/integration/` | シミュレーション + 描画の結合テスト |
| `tests/e2e/` | ブラウザ E2E テスト |
| `tools/` | チケット一覧・状態更新などのスクリプト |
| `issues/` | チケット(Markdown + frontmatter で状態管理) |

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # tsc + eslint + vitest
npm run test:e2e   # Playwright スモーク (初回は npx playwright install chromium)
```

チケットは `issues/` で管理する(`tools/issues.sh` で一覧)。設計書は `docs/specs/`、実装計画は `docs/specs/plans/`。

## 設計方針（暫定）

- `src/simulation/` は描画ライブラリに依存させない。ヘッドレスで高速にテストできるようにする。
- 種やバイオームの定義はコードではなく `assets/data/` のデータとして持ち、バランス調整をデータ変更だけで行えるようにする。
