# 生態系シミュレーション 設計書

- 作成日: 2026-09-19
- 状態: M1〜M5 実装完了(2026-09-19)
- 対象: M1(地形 + 植物 + 季節 + グラフ)と M2(3 階層 + 種を放つ)

## 1. コンセプト

ブラウザで動く 3D の生態系シミュレーション。
プレイヤーは神視点で島を眺め、種を放つ・気候をいじる・災害を起こすといった軽い介入をしながら、植物・草食獣・肉食獣の増減と気候の変化を見守る。
勝敗はない。中心体験は「気づく」こと。グラフの波、分布の移動、セルの数値がその材料になる。

## 2. 決定事項

| # | 項目 | 決定 | 理由の要点 |
|---|---|---|---|
| 1 | 関わり方 | 神視点で軽く介入。勝敗なし | 介入があると因果が見える。目標は後からシナリオとして被せられる |
| 2 | 世界 | 平面の島。グリッド 256×256 を暫定上限 | 球面グリッドの難所を避ける。グリッドを抽象化しておけば後で球体に載せ替え可能 |
| 3 | 生物表現 | セル密度で計算し、描画時に個体をばらまく | 決定論的で高速。数値で性質テストできる |
| 4 | 階層 | 植物 → 草食獣 → 肉食獣。各階層に複数種を持てる | 捕食の振動が出る。種が複数あると気候介入で分布が入れ替わる |
| 5 | 環境レイヤー | 標高・気温・降水(水分)。日照は緯度で代用。土壌は持たない | 最小で気候の多様性を作れる |
| 5 | 季節 | あり。気温と降水を年周期で揺らす | 無介入でも画面が動く |
| 6 | 気候フィードバック | 「植生 → 降水」のみ有効。植生→気温、CO2→気温、氷→気温は係数 0 のスロットとして定義だけ持つ | 局所的で因果が目で追える。正のフィードバックの暴走を避ける |
| 7 | 介入 | 時間操作、種を放つ、気候スライダー、災害 4 種(隕石・火山・山火事・疫病)。地形変更は第二段階 | 実装済みの仕組みの面白さを引き出す最短経路 |
| 8 | 技術 | Three.js + TypeScript + Vite + ESLint + Vitest。デプロイは Cloudflare 静的配信想定、当面ローカル | 大量の数値をバッファに書く処理に React は向かない |
| 9 | 地形 | シード付き手続き生成 | 再現性とリプレイ性 |
| 10 | 実行場所 | メインスレッド。型付き配列 + コマンド境界で Worker 化に備える | COOP/COEP の設定を初期から抱えない |
| 11 | 観察 UI | 3D + HUD + 時系列グラフ + レイヤー切替 + セル詳細 | 密度モデルは可視化がないと因果が読めない |
| 12 | 保存 | JSON ファイルの書き出し/読み込みのみ | テストフィクスチャに流用できる。自動保存は後回し |
| 13 | マイルストーン | M1 = 地形 + 植物 + 季節 + グラフ。M2 = 3 階層 + 種を放つ | 縦の配線を先に通し、気候調整を植物だけで行う |
| 14 | 見た目 | セミリアルに拡張できる設計。初期素材は識別優先の単色ローファイ | 種 ID → アセット対応表で後から glTF に差し替える |
| 15 | 時間 | 1 ティック = 1 日、1 年 = 360 ティック。ティック長は定数 | 季節が滑らか。細かいほど数値的に安定 |
| 16 | カメラ | オービット。パン範囲を島の外周で制限 | セルクリックのレイキャストと相性が良い |
| 17 | テスト | 単体 + 固定シード性質テスト必須。E2E はスモーク 1 本 | 決定論的モデルは性質テストの費用対効果が最も高い |
| 18 | ログ | 固定スキーマの JSON を console に 1 行 1 イベント。chrome-devtools MCP で読める | 可観測性を初期設計に組み込む |
| 19 | ログ送出 | `LogSink` ポートを定義し console 実装のみ。HTTP 実装は Cloudflare Worker を用意する時に追加 | 2 つ目の実装(memory)がテストで必要なので継ぎ目は本物 |

## 3. 用語

- **モジュール**: インターフェースと実装を持つもの。
- **インターフェース**: 呼び出し側が正しく使うために知るべき全て。型だけでなく不変条件・順序制約・エラーモードを含む。
- **継ぎ目**: 実装を差し替えられる場所。インターフェースが置かれる位置。
- **ポート / アダプタ**: 継ぎ目のインターフェースと、それを満たす具体物。

## 4. モジュール構成

```
main.ts ── 配線のみ(JSON 読み込み、モジュール生成、handlers の接続)
   │
   ├─ World        (src/simulation)  生態系の全ロジック
   ├─ Runner       (src/core)        rAF と速度倍率
   ├─ SceneView    (src/render)      Three.js を完全に隠す
   ├─ Hud          (src/ui)          DOM・グラフ・ファイル入出力
   └─ LogSink      (src/core/log)    ポート。console 実装 / memory 実装
```

依存の向きは一方向。
`SceneView` と `Hud` は `World.snapshot()` を読むだけで、`World` への書き込みは `Command` 経由のみ。
`World` は Three.js も DOM も fetch も知らない。

### 4.1 World

生態系の中核。インターフェースは 5 つ。

```ts
World.create(config: WorldConfig, deps: WorldDeps): World
world.dispatch(cmd: Command): void
world.step(ticks?: number): void
world.snapshot(): WorldSnapshot
world.serialize(): SaveData
World.restore(save: SaveData, deps: WorldDeps): World

type WorldDeps = { log: LogSink; now?: () => Date };  // now は ts 付与用。省略時は Date
```

**不変条件と契約**

- `create` は `config.seed` から地形と初期状態を決定論的に生成する。同じ `config` なら同じ状態。
- `step(n)` は n ティック進める。省略時は 1。ティック中に例外を投げない。NaN/Infinity を生成しない。
- `dispatch` はコマンドをキューに積み、次の `step` の先頭で適用する。即時適用しない(Worker 化時の順序保証のため)。
- `snapshot()` は内部バッファの読み取り専用ビューを返す。コピーしない。次の `step` で内容が変わる。呼び出し側は書き込んではならない。
- `serialize()` → `restore()` の往復で `snapshot()` が完全一致する。
- ログは `deps.log.write` にのみ出す。console に直接書かない。

**型**

```ts
type WorldConfig = {
  seed: number;
  size: number;                    // 一辺のセル数。256 まで
  ticksPerYear: number;            // 360
  species: SpeciesDef[];
  climate: {
    seasonAmplitudeTemp: number;   // 気温の年較差
    seasonAmplitudeRain: number;
    tempOffset: number;            // set_climate で変更
    rainScale: number;             // set_climate で変更
  };
  feedback: {
    vegetationToRain: number;      // M1 で有効
    vegetationToTemp: number;      // 0
    co2ToTemp: number;             // 0
    iceAlbedo: number;             // 0
  };
};

type SpeciesDef = {
  id: string;
  trophic: 'plant' | 'herbivore' | 'carnivore';
  growthRate: number;
  mortality: number;
  tempRange: [number, number];     // 生存に適した気温帯
  moistureRange: [number, number];
  diffusion: number;               // 隣接セルへの拡散率
  eats?: string[];                 // 被食者の種 ID(動物のみ)
  assetId: string;                 // SceneView の AssetTable のキー
};

type Command =
  | { type: 'spawn_species'; speciesId: string; cell: number; amount: number }
  | { type: 'set_climate'; tempOffset?: number; rainScale?: number }
  | { type: 'disaster'; kind: 'meteor' | 'volcano' | 'wildfire' | 'plague'; cell: number; radius: number };

type WorldSnapshot = {
  tick: number; year: number; dayOfYear: number; size: number;
  layers: {
    elevation: Float32Array;       // [0,1]。0.3 未満は海
    temperature: Float32Array;     // ℃
    moisture: Float32Array;        // [0,1]
    vegetation: Float32Array;      // [0,1]。植物種の合計
    populations: Record<string, Float32Array>;  // 種 ID → 密度
  };
  totals: Record<string, number>;  // 種 ID → 全セル合計
  meanTemperature: number;
  co2: number;                     // M1 では定数
};
```

**内部継ぎ目(公開しない)**

全て「型付き配列を受けて書く純粋関数」。`World` 自身のテストからのみ触る。

| 関数 | 役割 |
|---|---|
| `generateTerrain(seed, size)` | ノイズで標高を生成。海・海岸・平野・山 |
| `stepClimate(state, config, dayOfYear)` | 標高・緯度・季節から気温と降水を更新 |
| `applyFeedback(state, config)` | 植生 → 降水の補正。係数 0 なら無変更 |
| `stepVegetation(state, species)` | ロジスティック成長 + 環境適合度 + 拡散 |
| `stepPopulations(state, species)` | Lotka-Volterra 型の捕食・死亡・拡散(M2) |
| `applyDisaster(state, cmd)` | 一点 + 半径に効果を落とす |

**災害の効果(暫定値、[assets/data](../../assets/data) で調整)**

| 種類 | 効果 |
|---|---|
| meteor | 半径内の植生と全個体群を 0。中心セルの標高を下げる |
| volcano | 半径内の植生を 0。数年間そのセルの気温を上げる |
| wildfire | 中心セルの植生を 0。植生が閾値以上の隣接セルへ毎ティック延焼 |
| plague | 半径内の草食獣・肉食獣を大幅減。植物は無傷 |

**ログイベント**

| イベント名 | タイミング | 主な payload |
|---|---|---|
| `sim.world.created` | create / restore | seed, size, speciesCount |
| `sim.tick.summary` | 年 1 回(dayOfYear = 0) | totals, meanTemperature, co2, vegetationRatio |
| `sim.species.extinct` | 種の total が 0 になった最初のティック | speciesId |
| `sim.disaster` | applyDisaster 適用時 | kind, cell, radius |
| `cmd.received` | dispatch 時 | cmd |
| `cmd.rejected` | 不正なコマンド(範囲外セル、未知の種 ID) | cmd, reason |

**削除テスト**: World を消すと地形・気候・個体群の式が Hud と SceneView に散る。深さが効いている。

### 4.2 LogSink(ポート)

```ts
interface LogSink { write(record: LogRecord): void }

type LogRecord = {
  ts: string;                      // ISO 8601
  tick: number;
  year: number;
  level: 'info' | 'warn' | 'error';
  event: string;                   // ドット区切りの名前空間
  [key: string]: unknown;
};
```

- `consoleSink`: `console.log(JSON.stringify(record))`。1 行 1 レコード。chrome-devtools MCP の `list_console_messages` で読める。
- `memorySink`: 配列に溜める。テスト専用。
- HTTP sink は後日 3 つ目のアダプタとして追加する。バッチ化・送信先の環境変数・失敗時の挙動はその時点の ADR で決める。
- `ts` の付与は sink 側でなく `World` 側で行う。テストでは `WorldDeps.now` を差し替える。

### 4.3 SceneView

```ts
createSceneView(canvas: HTMLCanvasElement, opts: { assets: AssetTable }): SceneView
view.update(snapshot: WorldSnapshot): void
view.setLayer(layer: LayerKind): void
view.pickCell(clientX: number, clientY: number): number | null
view.dispose(): void

type LayerKind = 'terrain' | 'temperature' | 'moisture' | 'vegetation' | `species:${string}`;
type AssetTable = Record<string, { geometry: BufferGeometry; material: Material }>;
```

- 内部: 地形メッシュ(size×size の PlaneGeometry、頂点色)、種ごとの `InstancedMesh`、`OrbitControls`(target を島の外周で clamp)。
- `update` は毎フレーム呼ばれる。レイヤーの頂点色と個体インスタンスの行列を更新する。メッシュの再生成はしない。
- `AssetTable` が glTF 差し替えの継ぎ目。M1 はプリミティブ + `MeshLambertMaterial` 単色。
- 内部純粋関数 `layerToColors(snapshot, layer): Float32Array` と `scatterInstances(density, cellIndex, size, rng): Float32Array` は単体テスト対象。Three.js に触る部分は E2E のみ。

### 4.4 Runner

```ts
createRunner(world: World, opts: { onFrame: (snapshot: WorldSnapshot) => void }): Runner
runner.setSpeed(speed: 0 | 1 | 10 | 100): void
runner.start(): void
runner.stop(): void
```

- rAF ループ、経過時間の蓄積、1 フレームあたりの `step` 回数の決定を隠す。
- 速度 s のとき 1 秒で s 日進める。フレーム落ち時は 1 フレームの最大ティック数を上限で打ち切る(スパイラル防止)。
- 速度 0 でも `onFrame` は毎フレーム呼ぶ(カメラ操作が止まらないように)。

### 4.5 Hud

```ts
createHud(root: HTMLElement, handlers: {
  onCommand(cmd: Command): void;
  onSpeed(speed: 0 | 1 | 10 | 100): void;
  onLayer(layer: LayerKind): void;
  onSave(): SaveData;
  onLoad(save: SaveData): void;
}): Hud
hud.update(snapshot: WorldSnapshot): void
hud.showCell(cellIndex: number | null): void
```

- 内部: 年数と速度表示、気候スライダー、種パレット(M2)、災害ボタン、Canvas 2D 折れ線グラフ、セル詳細パネル、JSON ダウンロード/読み込み。
- グラフの `TimeSeries`(リングバッファ、年 1 点、上限 500 年)は純粋で単体テスト対象。
- Hud は World を直接持たない。コマンドは handlers 経由で `main.ts` が `world.dispatch` に流す。
- 素の DOM で書く。パネルが増えて辛くなったら UI 層だけに軽量ライブラリを入れる。

### 4.6 main.ts

- [assets/data](../../assets/data) の `world.default.json` と `species.json` を fetch。
- `AssetTable` を種定義から組み立てる(M1 はプリミティブ)。
- `World` / `Runner` / `SceneView` / `Hud` を生成し、handlers を接続。
- canvas クリック → `view.pickCell` → `hud.showCell`。

### 4.7 実装時の差分(M1)

- `SpeciesDef` に `name`(表示名)と `color`(#rrggbb)を追加。グラフ・レイヤー着色・パレットで使う。
- `WorldSnapshot` に `species: SpeciesDef[]` を追加。描画側と Hud が種一覧を得るため。
- `HudHandlers` に `onDisasterArm(kind | null)` を追加。災害ボタンは「次に島をクリックした場所に落とす」armed 状態を持つ。
- `WorldDeps` は `{ log: LogSink; now?: () => Date }`。
- 植生モデルの死亡項は `m·(2 − f)·p`(基礎死亡 + 不適合分)。適合時の平衡密度は `1 − m/r`。密度 `1e-4` 未満は 0 とみなし、全植物種の合計が 1 を超えたら比例縮小する。
- 山火事は `radius = 0` で一点着火し、延焼は `stepFire` が担う。他の災害は `radius = 4`。

### 4.8 実装時の差分(M2)

- 動物の更新は `stepPopulations`(Lotka-Volterra 型、摂食応答は線形)。`p' = p + growthRate·f·predation·food·p − mortality·(2 − f)·p`、餌は `predation·p` の割合で減る。草食獣 → 肉食獣の順に処理。
- `SpeciesDef` に `predation`(動物のみ)と `initialDensity`(create 時の初期密度)を追加。動物の `growthRate` は「摂取した餌密度あたりの増加係数」で 1 を超える値を取る。
- `HudHandlers` に `onSpawnArm(speciesId | null)` を追加。種パレットは災害と同じ armed 方式で、島クリック時に 3×3 セルへ `amount = 0.5` を放つ。
- `AssetTable` に `perCell`(1 セルあたりの最大表示数)を追加。植物 2、動物 10。
- デフォルト種: 草・森(植物)、鹿(湿潤、草と森を食べる)、ウサギ(乾燥、草だけ)、狼(鹿とウサギ)。バランスの経緯は `issues/M2-05-balance-coexist.md` を参照。

### 4.9 実装時の差分(M3: 振動と舞台)

調査メモ `references/science/predator-prey-models.md` と `references/games/stage-design-ideas.md` に基づく。

- 摂食応答を Holling II 型にした: `g = predation·food / (1 + predation·handlingTime·food)`。`SpeciesDef.handlingTime` を追加(省略時 0 = 線形)。線形応答では共存平衡が常に安定で振動が減衰していた。
- 被食による植物の回復遅れ `grazed` レイヤーを追加。草食獣が食べた量 × 3 を積み、植物の成長率に `(1 − grazed)` を掛ける。毎 tick 1/30 ずつ回復(NetLogo Wolf-Sheep の grass-regrowth-time に相当)。`SaveData.grazed` に含める。
- 振動判定の純粋関数 `countPeaks` / `amplitudeRatio` を追加し、性質テストで「後半の極大値 ≥ 3、振幅比 ≥ 0.2」を守る。
- 地形: 水分ノイズを周波数 6 倍・コントラスト 2.4 倍にして森・草原・乾燥地をパッチ状に分けた。陸の水分は 0.2〜0.9 に分布し、陸に囲まれた湖ができる。
- Hud: セルをクリックすると周辺(半径 3)の種密度の時系列(10 tick ごと、直近 5 年)を 2 本目のグラフに出す。合計で相殺される局所の波を見せるため。
- デフォルトの種パラメータ: 鹿 growthRate 3.5 / predation 0.05 / handlingTime 8、ウサギ handlingTime 8、狼 predation 0.6 / handlingTime 20。シード 42・7・3 で 100 年共存し、草・鹿・ウサギ・狼が周期 5〜8 年で振動する。

### 4.10 実装時の差分(M4: シナリオ層の基盤)

企画素材 `docs/design/2026-09-19-scenarios-and-world.md` の §5「最初の一歩」を実装した。

- `src/scenario/`: 予言の定義 `ScenarioDef`(開始状態、予定コマンド、年数、alive / dead 条件)、判定の純粋関数 `judgeScenario`、実行役 `ScenarioRunner`(予定コマンドの発火、年次判定、介入回数)。条件は `species_alive` / `species_extinct` / `land_ratio` / `vegetation_ratio` / `total_ratio_vs_start` / `year_reached` / `no_intervention` / `all` / `any`。
- `Command` に `sink`(島全体の標高を下げる)を追加。滅びの進行はすべて予定コマンドで表す。
- `dead` は省略可。省略時は予言の年に `alive` を満たすかだけで決まる。途中の絶滅を即死にしないのは、種を放つ力(再生)を使う遊びを許すため。
- 予定コマンドの `cell: -1` は島の中心、`radius` は `referenceSize`(既定 128)基準でグリッドサイズに比例させる。`baselineYear` で `total_ratio_vs_start` の基準年を遅らせられる。
- UI: 石板(`src/ui/Tablet.ts`)。`?scenario=<id>` で選ぶ。予言、残り年数、勝敗オーバーレイ。シナリオ中の読込は無効。
- `assets/data/scenarios.json` の 4 本(沈む欠片、星が落ちる夜、火の山の目覚め、豊かさの罠)+ テスト用 `test-quick`。
- 校正: `tests/slow/scenarios.playthrough.test.ts` で「放置 → 滅び」「台本介入 → 回避」を size 64 で固定(`npm run test:slow`、約 4 分)。

### 4.11 実装時の差分(M5: 生気層と分解者)

設計書 §2 決定 4 で見送った「分解者/土壌」を、企画素材の「生気」として実装した。物質循環が閉じる。

- 層を 2 つ追加: `litter`(枯死: 植物・動物の死亡分と山火事の灰)と `vitality`(生気)。`stepVitality` が枯死を `BASE_DECOMPOSITION + DECOMPOSER_BOOST × 分解者密度` の率で生気に変え、生気は 4 近傍へ拡散し `VITALITY_LEACH` で漏出する。
- 植物の成長は `vitalityFactor(v) = v / (v + 0.05)` を掛け、成長 1 単位につき `VITALITY_COST = 0.02` の生気を消費する。係数は「分解者がいれば生気は飽和し、いなければ 20 年で枯れて動物が飢える」ように決めた。
- 第 4 の階層 `decomposer`(胞子苔 `moss`)。枯死を餌にし(枯死は減らさない。分解は `stepVitality` の担当)、湿潤 [0.35, 1] で生き、山火事で植物と同じく 0 になる。
- 山火事は焼けた植生の半分を灰として枯死に積む。
- `WorldSnapshot.layers` に `vitality` / `litter`、`SaveData` にも追加。レイヤー切替に「生気」、セル詳細に生気/枯死。
- シナリオ条件 `vitality_ratio`、`ScenarioDef.start.species` で種の初期値を上書き可能。シナリオ「生気の飢饉」(苔のない島に胞子を運ぶ)を追加。
- 既存テストの世界には胞子苔を含めた。分解者のいない世界では生気が枯れて植物が痩せるため。
- 隕石・火山は苔も消すので、その後に草と獣だけ戻しても生気が尽きて飢える。「星が落ちる夜」「火の山の目覚め」の予言に「苔も戻せ」を足し、通し実行の台本も苔を放つ。狼は薄く放つと餌を食い尽くす前に消える紙一重(6 セルに 1 つ・0.3 で安定)。

## 5. データ

| ファイル | 内容 |
|---|---|
| `assets/data/world.default.json` | `WorldConfig` から `species` を除いたもの |
| `assets/data/species.json` | `SpeciesDef[]`。M1 は植物 2 種(草・森)、M2 で草食獣 2 種・肉食獣 1 種を追加 |

種の初期ラインナップと災害の効果値は M1 実装中にデータで調整する。設計書では固定しない。

## 6. マイルストーンと受入基準

証跡はテスト名とファイルパスで示す。sprint-qa-process に従い、各項目に commit SHA を後から追記する。

### M1: 地形 + 植物 + 季節 + グラフ

| 受入項目 | 証跡 |
|---|---|
| 固定シードで 100 年 step して NaN なし、植生が [0,1] 内 | `tests/unit/world.properties.test.ts` · 993ae8e |
| 同じ config で 2 回 create した snapshot が一致 | `tests/unit/world.determinism.test.ts` · 993ae8e |
| フィードバック係数 0 で年平均気温が年ごとに一致 | `tests/unit/world.properties.test.ts` · 993ae8e |
| `disaster` 後にそのセルの植生が下がる | `tests/unit/world.commands.test.ts` · 993ae8e |
| serialize → restore で snapshot が一致 | `tests/unit/world.save.test.ts` · 993ae8e |
| 年 1 回 `sim.tick.summary` が memorySink に出る | `tests/unit/world.log.test.ts` · 993ae8e |
| `layerToColors` が各レイヤーで長さ size²×3 を返す | `tests/unit/render.layerToColors.test.ts` · fe329b9 |
| `TimeSeries` が上限で古い点を捨てる | `tests/unit/ui.timeSeries.test.ts` · fe329b9 |
| ブラウザで島が表示され、1 年進めるとグラフに値が出る | `tests/e2e/smoke.spec.ts` · 3598752 |
| ESLint と `tsc --noEmit` が通る | `npm run check` · c7ebc5c(52 テスト通過を 3598752 時点で確認) |

### M5: 生気層と分解者

| 受入項目 | 証跡 |
|---|---|
| 枯死→生気の分解、分解者による加速、拡散と漏出、海は 0 | `tests/unit/vitality.test.ts` |
| 生気が薄いと成長が遅く、成長は生気を消費し、死亡は枯死を積む | `tests/unit/vegetation.test.ts` |
| 分解者は枯死で増え無いと減る。動物の死亡が枯死を積む。山火事は分解者も焼き灰を残す | `tests/unit/populations.test.ts`、`tests/unit/disaster.test.ts` |
| 生気レイヤーの着色、保存に vitality/litter | `tests/unit/render.layerToColors.test.ts`、`tests/unit/world.save.test.ts` |
| 100 年共存と振動が維持される | `tests/unit/data.test.ts`、`tests/unit/world.oscillation.test.ts` |
| 生気の飢饉: 放置で滅び、五年目に苔を放てば回避 | `tests/slow/scenarios.playthrough.test.ts` |
| 星が落ちる夜・火の山の目覚めは、苔も含めて放ち直せば回避できる(M4 の 4 本も引き続き通る) | `tests/slow/scenarios.playthrough.test.ts` |

### M4: シナリオ層の基盤

| 受入項目 | 証跡 |
|---|---|
| 判定条件が期待どおり真偽を返す | `tests/unit/scenario.judge.test.ts` |
| 予定コマンドが指定年に 1 回発火し、介入が数えられる | `tests/unit/scenario.runner.test.ts` |
| `sink` で陸地率が下がり、海になったセルの植物が 0 | `tests/unit/world.commands.test.ts` |
| 石板に予言が出て年が進む、勝敗オーバーレイが出て時計が止まる、自由モードでは予言が出ない | `tests/e2e/smoke.spec.ts` |
| 4 本とも放置で滅び、台本介入で回避できる。豊かさの罠は雨 1.9 倍で狼が絶滅する | `tests/slow/scenarios.playthrough.test.ts` |

### M3: 振動と舞台

| 受入項目 | 証跡 |
|---|---|
| 振動判定の純粋関数が合成波で正しく動く | `tests/unit/oscillation.test.ts` |
| handlingTime > 0 で摂食が飽和する | `tests/unit/populations.test.ts` |
| 固定シード 60 年で鹿の年次総量が後半に極大値 ≥ 3、振幅比 ≥ 0.2 | `tests/unit/world.oscillation.test.ts` |
| 被食セルの回復が遅れ、30 tick 後に戻る。grazed が保存される | `tests/unit/vegetation.test.ts`、`tests/unit/world.save.test.ts` |
| 陸の水分がモザイク(乾燥 ≥ 15%、湿潤 ≥ 15%)、湖がある | `tests/unit/terrain.test.ts` |
| デフォルト設定で 100 年共存かつ振動 | `tests/unit/data.test.ts` · af7628e |
| セルクリックで局所時系列が出る | `tests/e2e/smoke.spec.ts` |

### M2: 3 階層 + 種を放つ

| 受入項目 | 証跡 |
|---|---|
| 草食獣が植物を減らし、肉食獣が草食獣を減らす方向に動く | `tests/unit/world.trophic.test.ts` · 25aecac |
| 固定シードで 100 年回して 3 階層とも絶滅しない設定が 1 つ以上ある | `tests/unit/data.test.ts`(seed 42, size 64)· 25aecac |
| `spawn_species` 後に totals が増える | `tests/unit/world.commands.test.ts`(植物)、`tests/unit/world.trophic.test.ts`(動物)· 25aecac |
| 絶滅時に `sim.species.extinct` が 1 回だけ出る | `tests/unit/world.log.test.ts`(植物)、`tests/unit/world.trophic.test.ts`(動物)· 25aecac |
| 種パレットから放った種が画面に現れる | `tests/e2e/smoke.spec.ts` · 種パレット E2E |

## 7. スコープ外(今回やらない)

- 地形変更コマンド、球体マップ、個体ベースの動物 AI
- 植生→気温、CO2→気温、氷アルベドのフィードバックの有効化(スロットのみ)
- ブラウザ内自動保存
- HTTP ログ sink と Cloudflare Worker
- glTF モデルとテクスチャの制作
- Web Worker への移行
- UI ライブラリの導入

## 8. リスクと対策

| リスク | 対策 |
|---|---|
| 植生 → 降水のフィードバックが全面砂漠か全面森林に収束する | 係数を小さく始め、性質テストで「100 年後の植生率が 0.05〜0.95」を守る |
| 256×256 で 100x が重い | Runner の 1 フレーム最大ティック数で打ち切り。それでも足りなければ Worker 化(継ぎ目は用意済み) |
| snapshot の読み取り専用が守られない | `Object.freeze` は型付き配列に効かないため、レビューと E2E で担保。Worker 化で物理的に分離される |
| 3 階層のパラメータが安定しない | M1 で植物だけを先に安定させ、M2 で動物を 1 種ずつ足す |
