# 生態系シミュレーション 設計書

- 作成日: 2026-09-19
- 状態: M1〜M6 実装完了(2026-09-19。M5 は 084f3b9、M6 は feat/m6 のマージコミット)
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

### 4.12 実装時の差分(M6: 沈む欠片をジレンマのあるゲームに)

計画 `docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md`。計測で「沈む欠片」は雨だけ・放流だけでも勝てた(介入が無限で無料)ので、希少性と判断材料を足した。

- **星の力**(`ScenarioDef.budget`): シナリオ層の数値で World には入れない。`intervene` がコマンドの値段を引き、足りなければ `{ok:false, reason:'budget'}` で流さない。年が変わるたび `incomePerYear × 陸地率 × 生気平均 − 維持費`(維持費 = `|rainScale−1|·k + |tempOffset|·k`)。負になれば 0 にして気候を既定に戻す(`scenario.power.exhausted`)。`budget` のないシナリオは無料のまま。
- `spawn_species` に `radius`。クリック 1 回の 3×3 放流を 1 コマンドにして値段を 1 回で引く。`WorldSnapshot.climate` を追加(維持費の計算用)。
- **住みやすさレイヤー** `suit:<id>`: 適合度 0 → 暗、1 → 種の色。レイヤー列に「密度 / 住みやすさ」のモードチップ。右側 HUD をレイヤー列とグラフの縦積みコンテナにした(列が折り返しても石板・グラフに重ならない)。
- **石板の警告**(`scenarioWarnings`、純粋関数): 種が基準の 25% 未満、陸が基準の半分未満、力が足りない、維持費が収入超え。alive 条件が参照する種だけに出す。年に 1 回評価、同じ key のログは初回だけ。**節目**(`milestones`)は未到達分を石板に出し到達で消す。**結果の内訳**(`Verdict.stats`: 介入回数・使った力・陸地率・総量)。
- **判定条件 `species_mean`**(直近 N 年の総量の平均 ≥ min): 高地の群れは年ごとに 5〜31 と振れるので瞬間値では判定できず、また最後の瞬間の放流で勝てるのを防ぐ。runner が年ごとの totals を履歴に積み `JudgeInput.history` で渡す。試した「最後の N 年連続で alive」(sustainYears)は振動の谷で必ず途切れるため捨てた。
- **沈む欠片の校正**(size 64、seed 42。size 128 では放置でも高地に鹿の群れが残る(10 年平均 40)ので校正が移らず、シナリオの `start.size: 64` で校正した世界を固定した。`species_mean.min` は `referenceSize` 基準で書き、面積比 `(size/referenceSize)²` で合わせる): 沈降 0.002 → **0.0015**(陸 25% → 6%。0.002 では雨があっても鹿が残らず、0.0015 で雨あり 7〜19・雨なし 4 前後の差が出る)。alive = 10 年平均で鹿 ≥ 6・兎 ≥ 3・狼 ≥ 2。予算 start 40 / incomePerYear 32(陸 25% で 8/年、6% で 2/年)/ spawn 4・disaster 12・climate 2 / 雨の維持費 20 per 1.0(1.5 倍 = 10/年、1.25 倍 = 5/年)/ 上限 120。species.json は動かしていない。

  | 台本 | 鹿の 10 年平均 | 結果 |
  |---|---|---|
  | 放置 | 3.4 | dead |
  | 雨 1.5 倍を 30 年目から入れっぱなし | 5.0(力が尽きて雨が止まる) | dead |
  | 5 年ごとに鹿を高地へ放つだけ | 3.5 | dead |
  | 狼に疫病だけ | 3.7 | dead |
  | 雨 1.25 倍 + 20 年ごとに鹿・兎 + 疫病(想定解 1) | 9.4(力は最後に 0) | alive |
  | 60 年目まで貯めて雨 1.4 倍 + 鹿の種まき + 疫病(想定解 2) | 14.1 | alive |
  | 同上を雨 1.5 倍で | 3.4(力が尽きる) | dead |

- **手動プレイ(M6-05)** で直したこと: 気候スライダーは世界の気候が変わったときだけ追従する(力が尽きて雨が止まったのが見える。差があるたびに戻すと一時停止中の操作と喧嘩する)。雨の刻み 0.05。凡例に種ごとの現在の総量を年次で表示。記録は `docs/specs/plans/2026-09-19-m6-playtest.md`。

### 4.13 実装時の差分(M7-01〜03: プレイテストの改善点)

- 警告 `power_capped`(上限に達して収入を捨てている)。`ScenarioDef.ignoreWarnings` で予言どおりの進行を警告にしない(沈む欠片は `land_low`)。
- `ScenarioRunner.timeline()`: 介入、単発の予定イベント、力切れ、警告の初回、勝敗を年付きで積む。毎年繰り返す進行(沈降)は積まない。石板の折りたたみ「年表」に直近 6 件。100 倍速で見逃した力切れを後から読める。

### 4.14 実装時の差分(M8-05: 判定条件と「塔の重さ」の校正)

計画 `docs/specs/plans/2026-09-19-m8-civilization-plan.md` §2.4。

- **判定条件 `civ_stage`**(`{ min?, max?, years? }`): `years` があれば `JudgeInput.civHistory`(`history` と並ぶ、年ごとの段階の配列)の直近 `years` 年の最小段階で判定。`snapshot.civ` が無ければ段階 0 扱い。`why` は `文明の段階 6(塔)` / `文明の段階が 5(帆) まで下がった` の形。
- **警告 `civ_declining`**: 前年の段階を `CivContext`(`{ prevStage }`)として渡したときだけ、下がった年に出す。`scenarioWarnings` は純粋なまま(`civ` 引数は省略可、省略時は評価しない)。
- **バグ修正**: `ScenarioRunner.intervene()` が予定コマンド(`fireDue`)と違って `resolve()`(`cell: -1` → 島の中心、`radius` の縮尺)を通さず生のコマンドを `world.dispatch` していた。既存の台本はすべて具体的なセル番号を渡していたため表面化していなかったが、「塔の重さ」の台本(集落 = 島の中心 = `cell: -1`)で発覚。プレイヤー操作にも `resolve()` を通すよう修正。
- **文明の負荷・衰退の校正**(実測: seed 42、size 64、鹿の文明を stage 6 で開始): 当初の `POP_NEED = [0,1,2,4,8,14,22,32]` は「島全体で数十」規模を想定していたが、実際の `populationAround`(集落半径内の密度の和)は鹿のように島に薄く広がる種では stage 6 でも 0.1〜0.3 程度にしかならず、毎年 population 理由で衰退し 7 年で崩壊した。
  - `POP_NEED` を実測に合わせて 2 桁小さいスケールへ(`[0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05]`)。
  - 人口・生気の判定半径を `HOME_RADIUS`(3、発生判定の集落そのものの広さ)と新設の `SUPPORT_RADIUS`(8、文明を支える地域の広さ。`populationAround` と decline 判定の生気平均に使う)に分離。3 のままだと集落 1 マス分の局所密度しか拾えず、鹿の分布のノイズで population がほぼ 0 になる瞬間があった。
  - `applyLoad` に人口ベースの負荷減衰を追加(`civPopulation` 省略可、既存呼び出し・テストは全力の負荷のまま)。`populationAround` が `POP_NEED[stage]` を下回る分だけ `logging`/`vitality drain` を按分で弱める(働き手が少なければ伐採・消費も減る)。「疫病で民を間引いて負荷を下げる」を機能させる変更だが、実測では集落半径(疫病の射程 4)が島全体からの流入に対して狭く、間引きの森への効果は小さかった(下表)。
  - 発見した罠: `rainScale` を 1.25 以上にすると集落周りの鹿が急増し、狩猟圧と塔自体の生気消費が重なって `VITALITY_FLOOR`(0.1)を割り、段階が 5(帆)まで下がる。間引き(疫病)を重ねても局所人口はすぐ島全体から補充されて防げなかった。1.2 が段階 6 を保てる上限に近い。
- **「塔の重さ」の校正結果**(`start.civilization: { speciesId: 'deer', stage: 6, home: -1 }`、referenceSize 64、`alive`: `forest ≥ 開始の 0.3 倍` かつ `civ_stage ≥ 6`(直近 10 年最小)、`dead`: `civ_stage ≤ 0`、予算は沈む欠片と同じ数値(start 40 / incomePerYear 32 / spawn 4・disaster 12・climate 2 / 雨 20・気温 4 / 上限 120)):

  | 戦略 | 操作 | forest(y100) | 開始比 | 段階(y100) | 判定 |
  |---|---|---|---|---|---|
  | 放置 | なし | 25.8 | 0.17 | 7(星) | dead(forest 比) |
  | 森の放流だけ | 10 年目から 5 年ごとに `forest` を集落へ放流(半径 1) | 25.8 | 0.17 | 7(星) | dead |
  | 疫病だけ | 10 年目から 10 年ごとに疫病(集落、半径 4) | 25.8 | 0.17 | 7(星) | dead |
  | 雨 + 放流(想定解 1) | 10 年目に `rainScale 1.2`、以後 10 年ごとに `forest` 放流 | 51.7 | 0.34 | 6(塔) | alive |
  | 疫病(間引き) + 放流(想定解 2) | 10 年目に `rainScale 1.15`、以後 15 年ごとに疫病・5 年ごとに `forest` 放流 | 50.5 | 0.33 | 6(塔) | alive |

  文明は開始直後(輝石の残りで stage 6→7 へ一時的に上がってしまう。M8-05 の作業ログに既知の挙動として記録)に森を急激に伐り、放置なら森は年 5〜10 のうちに開始の 17% まで落ちて以後横ばいになる。石板の節目は当初「30 年目: 森が痩せ始める」だったが実測に合わせて「10 年目: 森はすでに大きく痩せた」に修正した。

### 4.15 実装時の差分(M8-05 v2: 「塔の重さ」をキーアイテムで作り直す)

レベルデザイン `docs/design/2026-09-20-level-design-tower.md`。M8-06 の手動プレイで「森の総量は塔にも介入にも鈍感」と分かり、§4.14 の森の 3 割条件と森の放流前提を捨てた。塔は **燃料** で立ち、燃料の取り方(火の山の熱 / 鐘樹の材)の配分だけが生き延びる形に作り直した。M8-08〜10 でキーアイテム(燃料モデル・炎蜥蜴・鐘樹)を入れ、本チケットで判定行列(LD §5)をヘッドレスで分離させた。

- **燃料の蓄えと負債**(`civilizationFuel.ts` / `World.ts`): 噴火 1 回の熱をその年に使い切れず捨てていたので、余りを蓄え(上限 `FUEL_STOCK_YEARS = 4` 年分)に積む。上限は集める量にだけ掛け、開始時の蓄え 45(7 年分)は切り捨てない(切り捨てると 4 年で尽き、石板の「七年」と合わなかった)。年次で `collectFuel(..., room)` が蓄えの空き分まで集め、必要量 `FUEL_NEED[stage]` を蓄えから引く。不足分は負債 `debt` に累積し、足りた年は必要量分だけ返す。`debt ≥ need × FUEL_YEARS(3)` で段階が 1 下がる(理由 `fuel`、負債は 0 に戻す)。「3 年連続不足」判定だと細い供給(年 2.2)で塔が立ち続ける穴があったので負債の累積にした。`CivState.fuel = { last, need, shortYears, stock, debt }`、`start.civilization.fuelStock`(塔の重さは 45 = 7 年分の猶予)。HUD は「燃料 蓄え / 必要年」。
- **炎蜥蜴を熱の門で縛る**(`populations.ts` / `species.json`): 気温帯ではなく `SpeciesDef.minHeat` で門を掛ける。`heatGate = clamp(heat / minHeat, HEAT_FLOOR, 1)` を成長にだけ掛け(`fg = f × heatGate`、死亡は `mortality × (2 − fg)`)、熱のあるセルには `HEAT_SEED = 0.01` で自然に湧く(絶滅していても噴火で戻る。`heatSpecies` 条件で炎蜥蜴以外には掛けない)。`HEAT_FLOOR` は 0.25 だと島中に広がって鹿を全滅させたので 0 にし、代わりに死亡率 0.0015 で「熱が冷めても数年歩き回る」形にした。炎蜥蜴: `tempRange [-10, 80]`、`minHeat 1.0`、`growthRate 4`、`predation 0.6`、`diffusion 0.3`、`initialDensity 0`、`spawnable false`。噴火 1 回(size 128 の実測)で半径 3 の平均密度はピーク 0.05、半径 5 の鹿は 0.027 → 0.0014(95% 減)、熱が 1 を割ってからも門が 0.3 程度ある 4 年目まで居着き、8 年目に 0。
- **鐘樹の陰を弱め、広がりを遅くする**: `shade` 0.8 → 0.2(0.8 では 12 か所でも民の餌が尽きた)、`diffusion` 0.005 → 0.002。0.005 では植えた 12 か所から 100 年で島中(総量 106)に広がり、陰で島全体の鹿が半分(10 年平均 13.2)まで減って、火と樹をどう配分しても判定を割った。0.002 では総量 56 に留まり鹿は 19.6(陰の代償は残る)。0.001 では 25.5 で代償がほぼ消える。LD §3.3 の「広げるのは歌鳥(M17-04)の役目」に合う。
- **火口を暖かい低地に、集落の外に**(`start.volcanoCell = 3223`、集落 `home = 2847`、距離 10): 標高最大の火口は噴火後も 22.6℃ で炎蜥蜴が湧かない(気温門だった頃の名残)。島で最も暖かい低地を火口にし、集落は火口を徴収半径 12 に、鐘樹の育つ湿地を支え半径 8 に持つ 2847 に置いた。火口が集落から 5 セル(3167)だと噴火の焼け跡が支え半径と重なり、鹿の谷と重なった 1 回の噴火で民が 4 年続けて `POP_NEED` を割って衰退した(火が「時期を当てるゲーム」になる)。10 セル離すと焼け跡は支え半径の外で、炎蜥蜴だけが歩いてくる。HUD の火の山の案内も「島の印(火口)に打てば」に直した。
- **段階を上げる民の条件**: `POP_NEED = [0, 0.05, 0.1, 0.2, 0.3, 0.6, 1.2, 4.0]`。集落 2847 の自然な民(半径 8 の密度和)は 6 前後で、塔(1.2)は保て、星(4.0)には届かない(輝石の残りで星まで上がらない)。`stepMining` は `POP_NEED[stage+1]` を満たすときだけ進む。
- **火と樹を分ける予算**: `disaster 24`(噴火 1 回 = 2 年分の収入)。`HEAT_FUEL` 1.5 では噴火 1 回が 14 年分になり火だけで勝てたので 0.8 に。火だけは力が尽きて燃料切れになり、樹だけは材が間に合わない。
- **判定**: `alive = civ_stage ≥ 6(直近 10 年)かつ species_mean deer(10 年)≥ 13.8`、`dead = civ_stage ≤ 0 or species_extinct deer`。`ignoreWarnings: ['land_low']`。

  校正の行列(seed 42、size 64、`tests/slow/scenarios.playthrough.test.ts` の台本。植える場所は集落半径 8 の鐘樹適合度 > 0.75 のセルを 2.5 セル以上離して最大 12 か所、1 か所 0.5 半径 1。噴火は火口 3167 半径 4、力 24 以上のときだけ):

  | 戦略 | 操作 | 結果 |
  |---|---|---|
  | 放置 | なし | dead: 蓄えが 7 年で尽き、11 年目から段階が落ちる(11/14/17) |
  | 火だけ | 蓄えが 2 年分を割るたびに噴火 | dead: 力が続かず 29 年目から燃料切れで落ちる(噴火 6 回) |
  | 樹だけ | 4 年ごとに 5 か所 | dead: 材が間に合わず 19 年目から落ちる |
  | 火で凌いで樹を育てる(想定解 1) | 40 年目まで 2 年ごとに 3 か所、蓄えが 1 年分を割ったら噴火 | alive: 噴火 11 回、鹿の 10 年平均 19.7 |
  | 樹を先に(想定解 2) | 20 年目まで毎年 2 か所、蓄えが 1 年分を割ったら噴火 | alive: 噴火 11 回、鹿の 10 年平均 19.6 |

  炎蜥蜴の捕食を 0 にしても鹿の 10 年平均はほぼ変わらず(鐘樹の広がりが主因)、火の代償は噴火直後の局所(集落の民が数年減る)に効く。

  LD §5 の感度・定着・副作用は単体テスト(`tests/unit/civilizationFuel.test.ts`、`tests/unit/belltree.test.ts`、`tests/unit/firelizard.test.ts`)で確認。捨てた案は LD 文書 §7 に。

### 4.16 実装時の差分(M9-01: 信仰の値)

計画 `docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算`。文明を持つ種が信仰を持つ。同じ種類の介入を繰り返す(予測可能)と上がり、種類がばらつく介入や災害で下がり、放置すればゆっくり減衰する。

- **純粋関数として分離**(`src/simulation/faith.ts`、World には依存しない): `CivState.faith?: number` を追加(省略可。既存セーブ・テストとの互換を保つため、文明が stage ≥ 1 になった最初の年まで undefined のまま)。`commandKey(cmd)` がコマンドの「種類」のキーを返す(`spawn_species` → `spawn:<speciesId>`、`set_climate` → `climate`、`disaster` → `disaster:<kind>`、`sink` → `null` で数えない)。`updateFaith(prev, { recent, disasters })` が 1 年分の更新をする。`recent` は直近 `FAITH_HISTORY_YEARS`(10)年(今年を含む)に dispatch されたコマンドのキー、古い順。
- **係数**(すべて `faith.ts` 先頭の定数): `FAITH_INITIAL = 0.5`(生まれた年の初期値)、`FAITH_UP = 0.05`(同じ種類が続いたときに足す)、`FAITH_DOWN = 0.05`(種類がばらついたときに引く)、`FAITH_DISASTER = 0.1`(災害 1 回につき引く)、`FAITH_DECAY = 0.03`(毎年の減衰率)、`FAITH_STREAK_THRESHOLD = 3` / `FAITH_VARIETY_THRESHOLD = 3`(「同じ種類が続く」「種類がばらつく」の閾値)。
- **規則**: (a) recent の最後のキーと同じキーが recent に `FAITH_STREAK_THRESHOLD` 回以上あれば `+FAITH_UP`。(b) recent の異なるキーが `FAITH_VARIETY_THRESHOLD` 種類以上なら `−FAITH_DOWN`。(c) 今年の災害(disaster コマンド。プレイヤーも予定コマンドも)1 回につき `−FAITH_DISASTER`。(a)(b) は両方成り立てば両方掛かる。(d) 最後に `× (1 − FAITH_DECAY)` で減衰。(e) `[0,1]` にクランプ。災害の減点(0.1)は儀式の加点(0.05)より大きいので、儀式が 3 回そろっていても災害があれば正味は必ず下がる。
- **World の配線**(`World.ts`): `dispatch` で civ があるときだけ `commandKey` の結果を今年のキー配列に積み(`disaster` はさらに今年の災害回数も数える)、`stepCivYearly` で年ごとの配列を `FAITH_HISTORY_YEARS` 年分保持したのち `updateFaith` を呼ぶ(stage ≥ 1 のときだけ。civ.faith が undefined ならこの年が誕生年で `FAITH_INITIAL` を入れるだけ)。ログ `sim.civ.faith` を年 1 回 info で `{ year, faith, delta }` を出す。restore 後のキー履歴は空から始める(信仰の値そのものは `civ.faith` としてセーブに含まれ、そのまま往復する)。
- **ScenarioRunner**(`ScenarioRunner.ts`): 年次評価で `snapshot.civ?.faith` を見て、前年の値(定義されているとき)との差の絶対値が `FAITH_TIMELINE_THRESHOLD = 0.1` 以上なら `TimelineEvent { kind: 'civ_faith', from, to }` を年表に積む。誕生年(前年の値が無い)は積まない。
- **表示**: `Tablet.describeEvent` が `civ_faith` を「信仰が 0.62 → 0.48 に下がった」の形(小数 2 桁)で整形する(`civ_stage` の隣の書式に合わせた)。`Hud.formatCiv` が文明の行の末尾に ` · 信仰 0.62`(小数 2 桁)を足す。faith が undefined(stage 0 など)なら出さない。

### 4.17 実装時の差分(M9-00: 文明の自然発生を地域で測る)

レベルデザイン `docs/design/2026-09-21-level-design-faith.md` §1、§8。M8-02 で「既定の島(seed 42、size 64、全種)では鹿の文明が 400 年たっても発生しない」と記録した件。閾値(`EMERGE_VEGETATION` 0.4、`EMERGE_AMPLITUDE` 0.15)は据え置き、**測り方** を島全体から集落候補の地域に変えた。

- **実測(変更前、150 年放置)**: 島全体の鹿は 9 年周期で振動し続け振幅比 0.42〜0.53。集落候補(密度最大の陸セル)は年 2 から 2635 に固定され、その半径 3 の植生平均は 0.24〜0.26、半径 8 は 0.18 で頭打ち(密度最大点 = 採食圧最大点)。一方、候補の支え半径 8 の地域人口(3.8〜4.3)は振幅比 0.08〜0.11 で安定していた。条件は構造的に満たせないと分かった。
- **`checkEmergence(history, { candidateVegetation, islandVegetation, hasCrystal })`**: `history` は候補の支え半径 `SUPPORT_RADIUS`(8)内の年次総量。植生は候補の半径 8 の平均が `EMERGE_VEGETATION × 島の陸の植生平均` を超えること(相対値)。さらに候補の採掘半径 `MINE_RADIUS[1]`(2)以内に輝石があること(掘るものが無ければ知性は生まれない。世界観 §1.5)。
- **候補の追い方 `trackHomeCandidate`**: 密度最大の陸セルは輝石が近くにあるものに限る(`pickHomeCandidate`)。前年の候補があれば、その周り `EMERGE_CANDIDATE_MOVE`(= 8)で追い直した候補の地域人口が島で最大の候補の `EMERGE_STICKY`(0.5)倍以上なら群れに留まる。候補が前年から 8 セルより遠くへ移れば別の群れとして履歴を捨てる。留まりを入れる前の size 128 では密度最大セルが複数の群れの間を数年ごとに飛び(80 年で 32 回)、履歴が 10 年たまらなかった。
- **結果**: seed 42 / size 64 / 全種で鹿の文明が **22 年目** に集落 2635(地域人口 4.1)で発生する。草だけの世界(size 32)の既存テスト(10 年目に発生)は変わらない。既存の通し実行 20 件は段階を指定して始めるので影響なし(通過)。
- **既知の制約**: size 128(`world.default.json` の既定)では地域の群れ自体が振幅比 0.8〜0.9 で波打つ(3 → 19 → 3)ためどの地域も安定せず、80 年で発生しない。シナリオはすべて size 64 か段階指定で始めるので M9 では扱わず、通しの年表(M18)で size 128 の自然発生が要るときに戻る。

### 4.18 実装時の差分(M9-02: 祈り)

レベルデザイン `docs/design/2026-09-21-level-design-faith.md` §3.1、§4。集落の困りごとが石板に「祈り」として届き、期限内に対応する介入があれば信仰が上がり、無視すれば下がる。

- **純粋関数として分離**(`src/simulation/prayer.ts`、World には依存しない): `PrayerKind = 'rain' | 'wolves' | 'crystal'`、`PrayerState = { kind; issuedYear; deadlineYear }`。`CivState` に `prayer?`、`prayersAnswered?`、`prayersIgnored?`、`crystalStart?` を追加(既存セーブ・テストとの互換を保つため省略可)。`issuePrayer({ grassMean, predatorRatio, crystalRatio })` が今年出す祈りの種類 (`PrayerKind | null`) を返す。複数当てはまれば `crystal > wolves > rain` の優先。`isAnswer(kind, cmd, { home, size, rainScaleBefore })` がこの介入が応えかどうかを返す。
- **係数**(すべて `prayer.ts` 先頭の定数): `PRAYER_YEARS = 5`(期限)、`PRAYER_COOLDOWN = 3`(解決から次が出るまでの年数、同時に 1 つだけ)、`PRAYER_CRYSTAL_LOW = 0.1`(LD §3.1 の据え置き値)。`PRAYER_GRASS_LOW`・`PRAYER_PREDATOR_HIGH` は実測で決めた(下記)。
- **実測(閾値の校正)**: seed 42 / size 64 / 全種、`civilization: { speciesId: 'deer', start: { stage: 3, home: 2635 } }` で 100 年放置し、年ごとに支え半径 `SUPPORT_RADIUS`(8)の草 (`grass`) の密度平均・捕食者 (肉食トロフィック) の総量 / 民の総量を測った。草の密度平均は **0.074〜0.132(中央値 0.107)** で終始低く張り付き、捕食者比は **0.165〜1.924(中央値 0.301)** だった(参考: 輝石比は 0.621〜0.842 で `PRAYER_CRYSTAL_LOW` 0.1 には遠く、この実測レンジでは「星の砂を」は出ない)。`issuePrayer` を優先度どおりに 100 年通したとき「雨を」が 4〜12 回・「狼を減らして」が 1〜6 回になる組を探索し、`PRAYER_GRASS_LOW = 0.15`(中央値よりわずかに高い。草は常にこの近辺かそれ以下)、`PRAYER_PREDATOR_HIGH = 0.33`(中央値よりわずかに高い)を選んだ。この組では 100 年で「雨を」10 回・「狼を減らして」3 回(受入基準の範囲内)。使い捨ての計測スクリプトはコミットしていない。
- **World の配線**(`World.ts`): `dispatch` で civ に有効な祈りがあり `isAnswer` が真なら即座に解決する(`prayersAnswered++`、今年の answered 数に積む、ログ `sim.civ.prayer` phase `answered`)。`rainScaleBefore` は dispatch 前(コマンド適用前)の `config.climate.rainScale`。`stepCivYearly`(stage ≥ 1)で、まず `crystalStart`(stage ≥ 1 になった最初の年の `MINE_RADIUS[MAX_STAGE]` 内輝石総量)を記録し、次に期限切れの祈りを無視した扱いで解決し(`prayersIgnored++`)、空いていてクールダウンが明けていれば `issuePrayer` で新しい祈りを出す。信仰の更新 (`updateFaith`) に今年の `answered`/`ignored` を渡す。
- **faith.ts の追加**: `FAITH_ANSWER = 0.15`(応えた 1 件につき加点)、`FAITH_IGNORE = 0.15`(無視した 1 件につき減点)。`updateFaith` の規則 (c) の直後、減衰の前に `+answered × FAITH_ANSWER − ignored × FAITH_IGNORE` を掛ける(省略時 0、既存の呼び出し・テストは変わらない)。
- **開始時の祈り**(E2E の決定論のため): `CivilizationConfig.start.prayer?: PrayerKind` と `scenarios.json` の `start.civilization.prayer` を追加。指定があれば World 生成時に `{ kind, issuedYear: 0, deadlineYear: PRAYER_YEARS }` で有効にする。`test-civ` に `"prayer": "rain"` を足した。
- **ScenarioRunner**: `snapshot.civ` の `prayer`/`prayersAnswered`/`prayersIgnored` を前年の年次評価と比べ、`TimelineEvent { kind: 'prayer'; phase; prayer }` を積んで `opts.onPrayer?.()` を呼ぶ(前年と比べる作りは `civ_stage`/`civ_faith` と同じ設計)。`runner.prayer()` が現在の祈りと残り年数 (`deadlineYear − 現在年`) を毎フレーム返す(石板表示用)。
- **表示**: `Tablet` が `id="tablet-prayer"` の行に「祈り: 雨を(残り 3 年)」の形で出す(無ければ `hidden`)。`describeEvent` が `prayer` を「民が祈った: 雨を」「祈りに応えた: 雨を」「祈りを無視した: 雨を」の形で整形する(種類の文言: rain=「雨を」、wolves=「狼を減らして」、crystal=「星の砂を」)。`main.ts` の `onPrayer` が `scenario.prayer` を `{ scenario, phase, kind }` でログする(`onWarning` と同じ形)。

### 4.19 実装時の差分(M9-03: 信仰の効き — 勅令・内乱・霊脈)

レベルデザイン `docs/design/2026-09-21-level-design-faith.md` §3.2〜3.4、§5、§8.2。

- **勅令**(`edict.ts` / `Command { type: 'civ_edict', edict: 'stop_mining' | 'resume_mining' }`): 信仰 ≥ `EDICT_FAITH`(0.6)のときだけ民が従い、`CivState.miningStopped` を切り替える(止まっている間は `stepMining` を呼ばない。負荷 `applyLoad` は残る)。従わなくても `CivState.edict = { kind, year, obeyed, faith }` に残し、石板が「民は聞かなかった(信仰 0.45 < 0.6)」を出す。力は消費せず(`costOf` 0)、信仰の「同じ種類」にも数えない(`commandKey` null)。HUD に勅令の行(「採掘を止めよ / 再開せよ」)と文明の行の「· 採掘 止」。ログ `sim.civ.edict`。
- **内乱**(`unrest.ts`): 信仰 < `UNREST_FAITH`(0.3)の年が `UNREST_YEARS`(3)続くと、集落の支え半径の民を `UNREST_SURVIVORS`(0.5)倍にし段階 −1、信仰を `UNREST_FAITH_AFTER`(0.4)に戻す(3 年ごとに連鎖しないため)。ログ `sim.civ.unrest` と `sim.civ.stage`(reason `unrest`)。
- **霊脈**(`vein.ts`): 開始時の輝石(`crystal0`、seed から決定論。restore でも保存値で上書きしない)を 4 近傍で繋いだ連結成分を脈として番号付け(`labelVeins`)。民は **脈を辿って掘る**(`stepMining` に `veins` を渡すと、採掘半径に掛かる脈のセル全体から残量に比例して取り除く)。枯渇 `1 − 残り / 開始` は脈全体で共有し(`veinDepletion`)、脈から `VEIN_REACH`(8 歩)以内の陸は最寄りの脈の枯渇を `veinLoss` として受ける。`stepVitality` は生気の上限を `veinCap = 1 − VEIN_LOSS(1.0) × veinLoss` に抑える(霊脈は生気の器)。分解率の分解者項にも `veinFactor` を掛けるが、実測では効かない(下記)。輝石の無かった土地は枯渇 0 なので既存シナリオの平衡は変わらない。
  - 捨てた形(実測、seed 42 / size 64、集落 1770 = 脈 71 セル・輝石 29.7 の上、石 (4) で放置): (1) セルごとの枯渇 + 半径 3 の平均: 採掘半径 3 の輝石 1.05 は 4 年で尽きて採掘が止まり、半径 8 の脈は 5% しか減らず、生気 1.0 のまま。(2) 脈全体の共有 + 分解率の低下: 100 年で脈は 9% まで減ったが、集落の苔は密度 0.99 で分解率が漏出の 70 倍あり、分解者の効きを 1 割にしても生気 1.0 のまま。(3) 器(上限)にして初めて生気が動いた。
  - 結果(信仰 1.0 で始めて内乱を避けた放置): 脈 1.0 → 0.09、集落の生気 0.93 → 0.21、島全体の生気 0.97 → 0.61(100 年)。脈が 5 割の時点(53 年目)で「止めよ」→ 20 年後も生気 0.57。2 割の時点(88 年目)→ 0.31。苔だけ放っても落ち続ける(0.60 → 0.39 / 0.31 → 0.11)。
- **判定条件・警告**: `faith { min, max }`、`prayers_answered { min, max }`(「祈りに応えるな」の dead に `max: 0`)、`civ_vitality { min, max, years }`(集落の支え半径の生気平均。`JudgeInput.civVitalityHistory` で直近 years 年の平均)。警告 `faith_low`(信仰 < 0.4)。`start.civilization.faith` で開始時の信仰を指定できる(E2E の `test-civ` は 0.7)。
- **副作用の校正(塔の重さ v2 が滅びた)**: 祈りと内乱を入れた直後、塔の想定解 2 通りが 56 年目に段階 0 で滅びた。原因は 3 つあり、順に仕組みで直した。
  1. 塔の集落(2847)では狼/鹿の密度比が常に 1.5〜8.5 で、2635 で決めた絶対閾値(`PRAYER_PREDATOR_HIGH` 0.33)を恒常的に超え、「狼を減らして」が 8 年ごとに出て無視され続けた(−0.15 × 7)。→ 祈りの条件を **「いつもより」**(直近 `PRAYER_BASELINE_YEARS` 10 年の平均に対する比。草は `PRAYER_GRASS_DROP` 0.7 倍未満、捕食者比は `PRAYER_PREDATOR_RISE` 1.5 倍超。基準ができる `PRAYER_BASELINE_MIN` 3 年までは出ない)に変えた。輝石は開始比のまま。絶対値の定数は参照のため残した。
  2. 期限の前に困りごとが消えた祈りも「無視」になっていた。→ **取り下げ**(`prayerStillNeeded` が偽なら `prayersWithdrawn++`、信仰は動かない。基準が無い間は判断できないので残す)。年表「困りごとが消え、民は祈るのをやめた」。
  3. 集落から 10 セル離れた噴火まで信仰を削り(−0.1 × 11)、減衰 3%/年 が儀式で埋まらなかった。→ 災害は **集落そのもの(`HOME_RADIUS` + 半径)を襲ったときだけ** 数える(`disasterHitsHome`)、`FAITH_DECAY` 0.03 → 0.01(「ゆっくり減衰」: 0.5 → 0.3 に 51 年)。
  - 塔の台本は変えていない(儀式を足す案は、力 4 / 3 年 が噴火の予算を圧迫して燃料切れになり捨てた)。通し 20 件通過。
- **既知の制約**: size 128 の既定島は M9-00 と同じ理由で自然発生しない。祈りの基準は restore 後 3 年は無い。

### 4.20 実装時の差分(M9-04: 「祈りに応えるな」「霊脈枯れ」の校正)

レベルデザイン `docs/design/2026-09-21-level-design-faith.md` §4、§5、§8.3。予算は塔の重さと同じ(start 40 / 年収 12 / 放流 4・災害 24・気候 2 / 上限 120)。どちらも `schedule` で 6 年目から 12 年ごとに集落へ狼の群れ(`spawn_species wolf` 0.5、半径 3)が下り、民が「狼を減らして」と祈る(祈りは「いつもより」で出るので、圧はシナリオ側の舞台装置で作る)。

- **祈りに応えるな**(`no-answer`): 歌 (3) の鹿の文明、集落 2787(採掘半径に輝石が無く段階が進まない、燃料も要らない)、信仰 0.5。`alive = civ_stage ≥ 3(直近 10 年)かつ prayers_answered ≤ 0`、`dead = civ_stage ≤ 0 または prayers_answered ≥ 1`(応えた瞬間に「民は考えるのをやめた」)。当初の alive は段階 ≥ 1 だったが、放置が内乱 2 回で 巣 (1) に留まり alive になったので「一段でも退けば滅び」にした(歌のままでいることが民の自立)。
- **霊脈枯れ**(`vein-drain`): 石 (4) の鹿の文明、集落 1770(脈 71 セル・輝石 29.7 の上)、薪の蓄え 600(燃料を切り離す)、信仰 0.5。`alive = civ_stage ≥ 1(10 年)かつ civ_vitality ≥ 0.3(10 年平均)`、`dead = civ_stage ≤ 0`。
- **民が望んだ災害は数えない**: 「狼を減らして」への疫病は集落を襲うが裏切りではないので、信仰の災害(−0.1)に数えない。数えると応えの +0.15 がほぼ消え、応えて信仰を上げる道(想定解 1)が 100 年で 0.5 → 0.5 のまま成り立たなかった(実測: 応え 3 回、勅令ゼロ、集落の生気 11% で dead)。
- **先回り(想定解 2)の作り**: 狼が下りた年のうち(年末に祈りが出る前)に集落へ疫病を打つ。すでに祈りが出ている年に打てば応えになって滅びるので打たない。儀式は 1 年目から 2 年ごと(3 年ごとでは最初の狼 (6 年目) までに 3 回そろわず、8〜14 年目に信仰 0.30 で止まって 15 年目に内乱)。テスト側は `playTower(def, script, after)` の `after`(年次評価の後に呼ぶ台本)で同じ年の中の操作を表す。

  校正の行列(seed 42、size 64、`tests/slow/scenarios.playthrough.test.ts`):

  | シナリオ | 戦略 | 操作 | 結果 |
  |---|---|---|---|
  | 祈りに応えるな | 放置 | なし | dead: 内乱で一段退く |
  | 〃 | 応える | 祈りが出たら集落へ疫病 | dead: 「祈りに 1 回応えた」 |
  | 〃 | 気まぐれ | 毎年違う種を放つ | dead: 3 種類以上の混在と無視で内乱 |
  | 〃 | 儀式(想定解 1) | 3 年ごとに苔を集落へ | alive |
  | 〃 | 先回り(想定解 2) | 狼の年に祈りが出る前に疫病、2 年ごとの儀式 | alive |
  | 霊脈枯れ | 放置 | なし | dead: 集落の生気が落ちる |
  | 〃 | 苔だけ | 3 年ごとの苔 + 20 年目から 5 年ごとに周りへ苔 | dead: 脈が尽きて戻らない |
  | 〃 | 信仰なしの勅令 | 5 年ごとに「止めよ」 | dead: 民が聞かない |
  | 〃 | 応えて止める(想定解 1) | 祈りに疫病で応え、0.6 で「止めよ」 | alive |
  | 〃 | 儀式で止める(想定解 2) | 3 年ごとの苔、0.6 で「止めよ」 | alive |

  既存の 20 件も通る(塔 5 / 放置・台本 11 / 素朴・罠 7 の 3 分割)。

### 4.21 実装時の差分(M9 レビューの修正、2026-09-22)

マージ前のコードレビュー(main との差分)で挙がった 10 件をすべて直した。

- **崩壊時のリセット**(`World.collapseCiv`): 段階 0 になったとき home だけでなく信仰・祈り・勅令・`crystalStart`・集落の生気・発生判定と信仰の履歴・内乱と衰退の連続数を捨てる。残すと次に芽生えた文明が古い勅令で掘らず、期限切れの祈りを翌年に無視し、信仰が古い値から始まり、発生判定が古い履歴で 1 年後に再発生した。応えた/無視した/取り下げた数はシナリオの判定の履歴なので残す。`faith_low` にも段階 ≥ 1 の門。
- **数えないコマンド**: `apply` で弾かれるコマンド(海への放流など)は信仰・祈りに数えない(`dispatch` で先に `validate`)。`dispatch(cmd, { fromStar: false })` で予定コマンドと力切れの気候の戻しは星の行為ではない(儀式にも応えにも数えない。集落を襲った災害だけは数える)。
- **勅令**: `CivState.edict.n`(通し番号)で年表の重複を弾く(同じ年の 2 つ目も出る)。勅令は介入回数(`interventions`)に数えない。
- **セーブ**: `crystal0` を保存し、restore で使う(沈降で陸が減ると seed から同じ値に生成できない)。古いセーブは seed から生成。
- **判定**: `civVitality` は World が年に 1 回記録した `civ.vitality` を使う(100 倍速では年の境界から最大 100 tick 後に判定するので、測り直すと HUD と食い違う)。
- **採掘の走査**: 脈ごとのセル一覧(`veinCellLists`)を前計算し、`stepMining` は全セルを走査しない。

### 4.22 実装時の差分(M10-01: 気象塔)

レベルデザイン `docs/design/2026-09-22-level-design-devices.md` §3.1 の気象塔を実装した。新規モジュール `src/simulation/weatherTower.ts` に係数と純粋関数をまとめる(edict.ts / faith.ts と同じ流儀)。

- **係数**: `TOWER_STAGE` 6(塔)、`TOWER_FAITH` 0.6、`TOWER_CRYSTAL` 1.0、`TOWER_RADIUS` 6、`rainScale` 省略時 1.5・`tempOffset` 省略時 0、`TOWER_COST` 12(星の力)、`TOWER_UPKEEP` 4/年(塔 1 つあたり)。
- **門** (`canBuildTower`): 文明がない → 段階が塔に満たない → 信仰が足りない(値つき)→ セルは海 → そのセルには既に塔がある → 輝石が足りない、の順に確かめ、`{ ok: false; reason }` を返す。輝石の合計 (`crystalAvailable`) は呼び出し元 (`World.validate`) が `towerCrystalPool`(`stepMining` と同じ採掘半径 + 脈全体のプール)で先に計算し、副作用のない validate と、実際に取り除く `takeCrystal`(apply 側)を分けた。
- **局所気候**: `towerFactors` が塔ごとの半径内に rainScale/tempOffset を書く per-cell 配列 (`World.rainFactor`/`tempFactor`) を作る。重なるセルは後で建てた塔が勝つ(配列の後ろが上書き)。`climate.ts` の `stepClimate` は `ClimateState.rainFactor`/`tempFactor` が省略ならこれまでと同じ挙動(倍率 1・オフセット 0)。
- **維持費と停止**: `ScenarioRunner` が年ごとに `TOWER_UPKEEP × 塔の数` を通常の気候維持費と別に引く。払えなければ `tower_power { active: false }` を `fromStar: false` で dispatch して年表に `tower_stopped`、力が戻れば `tower_power { active: true }` で `tower_resumed`。`tower_power` は全ての塔の `active` を一括で切り替える(個々の塔ではなく星の力の増減という 1 つの事象として扱う)。
- **信仰の儀式**: `commandKey` で `build_tower` は星の行為として数え(儀式・ばらつきの対象)、`tower_power` は勅令や沈降と同じ「言葉・自動処理」として数えない (null)。
- **UI**: HUD の災害列に「気象塔」チップ(武装 → 次の島クリックで `build_tower`、信仰・輝石の下限をヒント表示、力が足りなければ薄く見せる)。セル詳細に半径内なら「気象塔: 雨 N×」。SceneView に塔ごとの小さな目印。石板の年表は専用の `tower`/`tower_stopped`/`tower_resumed` kind(汎用の `intervene` とは分け、二重に出さない)。
- **ファイル**: `src/simulation/weatherTower.ts`(新規)、`src/simulation/types.ts`・`World.ts`・`climate.ts`・`faith.ts`、`src/scenario/ScenarioRunner.ts`・`types.ts`、`src/ui/Hud.ts`・`Tablet.ts`、`src/render/SceneView.ts`、`src/main.ts`、`assets/data/scenarios.json`(`test-tower` を追加)。

### 4.24 実装時の差分(M10-03: 空の舟)

(§4.23 は M10-02「迎撃の塔」用に予約。この節を書いた時点ではまだ書かれていない)

レベルデザイン `docs/design/2026-09-22-level-design-devices.md` §3.3 の舟の建造を実装した。新規モジュール `src/simulation/ship.ts` に係数と純粋関数をまとめる(works.ts / weatherTower.ts と同じ流儀)。この節は**機構の実装のみ**を記す。「空の舟」シナリオの校正(想定解が通るか)は tests/slow で別途行う(このコミットの時点では未着手)。

- **係数**: `SHIP_STAGE` 5(帆)、`SHIP_FAITH` 0.5、`SHIP_FOREST_MIN` 6、`SHIP_CUT` 0.3/年、`SHIP_NEED` 10。
- **材**: `timberAround` が徴収半径 (`LOAD_RADIUS[civ.stage]`、既存の M8-03 文明の負荷と同じ半径) 内・陸セルの森 + 鐘樹の密度和を返す。
- **門** (`canLaunchShip`): 文明がない → 段階が帆に満たない → 信仰が足りない(値つき)→ 舟は既に建造中/既に飛び立った → 材が足りない(値つき)、の順に確かめる(`canBuildTower` と同じ「門 → 状態の重複チェック → 資源」の流儀)。
- **建造** (`stepShip`): 年に一度、材 × `SHIP_CUT` を伐って進みに積む。合計の伐採量が残りの必要量 (`SHIP_NEED − progress`) を超えるなら割合を落として頭打ちにする(`works.ts` の按分と同じ考え方)。材が 0 の年は進まない。既に飛び立っていれば何もしない。
- **完成と信仰**: `World.stepCivYearly` が works ブロックの後・衰退判定の前で年に一度 `stepShip` を呼ぶ。`shipDone` で完成を判定し、信仰 ≥ `SHIP_FAITH` なら `launchedYear` を立てて `sim.ship.launched`、足りなければ `sim.ship.waiting` を出して毎年再判定する。崩壊(段階 0)で未発進の舟は `collapseCiv` が捨て `sim.ship.lost` を出す(既に飛び立った舟は残す)。
- **持ち出し** (`exportCargo`/`aliveSpeciesCount`): 生きている種(総量 > 0)だけを `{ id, total, density }` の配列にし、`CivState` のコピーと合わせて `{ version: 1, year, size, species, civ }` の JSON にする。
- **判定**: `ScenarioDef.escape?: Condition` を追加し、`judgeScenario` は年ごとに escape → dead → (years 到達時の) alive の順で評価する(escape が dead より先: 舟が飛び立った瞬間は他の dead 条件より優先する部分勝利)。新しい条件 `{ type: 'escaped'; minSpecies? }` は `s.ship?.launchedYear !== undefined && aliveSpeciesCount(s) >= (minSpecies ?? 1)` を見る。`ScenarioStatus` に `'escaped'` を追加。
- **信仰の儀式**: `commandKey` で `launch_ship` は `civ_edict` と同じ「言葉」として数えない(null)。`ScenarioRunner.costOf` は 0、`intervene` の介入回数にも数えない。
- **開始オプション**: `start.civilization.shipProgress`(E2E の決定論のため。指定があれば年 0 に着工した舟をその進みで持つ)を `CivilizationConfig.start` / `resolveCivilizationStart` / `ScenarioDef.start.civilization` に通した。
- **UI**: HUD に `#hud-ship` 行(文明が発生していれば表示。ボタン `#ship-btn`「舟を作れ」、`formatShipHint` が門の説明・進み・「民は乗らない」・「舟は飛び立った」を出し分ける。`formatCiv` の既存の文字列は変えていない)。石板のオーバーレイは escaped で見出し「次の島へ」を出し、`showVerdict(verdict, cargo?)` が Blob + `<a download="cargo.json">` の「持ち出しを保存」ボタンを出す(`main.ts` が `verdict.status === 'escaped'` のときだけ `exportCargo(world.snapshot())` を渡す)。年表は `describeEvent` に `launch_ship`(「石板が告げた: 舟を作れ」)と `verdict` の escaped 分岐(「次の島へ逃れた」)を足した。
- **ファイル**: `src/simulation/ship.ts`(新規)、`src/simulation/types.ts`・`World.ts`・`civilization.ts`・`faith.ts`、`src/scenario/types.ts`・`judge.ts`・`ScenarioRunner.ts`、`src/ui/Hud.ts`・`Tablet.ts`・`hud.css`、`src/main.ts`、`assets/data/scenarios.json`(`sky-ship`・`test-ship` を追加)。

## 5. データ

| ファイル | 内容 |
|---|---|
| `assets/data/world.default.json` | `WorldConfig` から `species` を除いたもの |
| `assets/data/species.json` | `SpeciesDef[]`。M1 は植物 2 種(草・森)、M2 で草食獣 2 種・肉食獣 1 種を追加 |

種の初期ラインナップと災害の効果値は M1 実装中にデータで調整する。設計書では固定しない。

### 4.23 実装時の差分(M10-02: 迎撃 — 星の門・工事・迎撃・薄い脈)

LD: docs/design/2026-09-22-level-design-devices.md §3.2・§8.1・§8.2。

- **星の門**(`civilizationLoad.ts` `canAscend` / `populationFor`): 塔 → 星は半径 `STAR_RADIUS` = LOAD_RADIUS[7] = 12 の民 ≥ POP_NEED[7](4.0)
  かつ信仰 ≥ `STAR_FAITH` 0.8。星の衰退も半径 12 の民で見る。塔以下は支え半径 8 のまま。`CivState.populationStar` を年 1 回更新。
- **星の工事**(`works.ts`): 星は年に `WORKS_RATE`(= MINE_RATE[6] × 360 = 0.36、塔の採掘量)を脈(採掘半径 5 に掛かる脈全体)から備蓄に積む。信仰 < `WORKS_FAITH` 0.6 の年は止まる。
  備蓄が `INTERCEPT_NEED` 3.0 に達しても掘り続ける(星になっても民は掘るのをやめない。LD §8.2)。`CivState.works { stock, stopped }`、`intercepted`。開始指定 `start.civilization.worksStock`。
- **迎撃**: コマンド `intercept`(World は `canIntercept` で拒否理由を出す。備蓄を 3.0 消費、`intercepted` +1)。ScenarioRunner は最新の snapshot で
  同じ条件を確かめ、次の単発の予定隕石を取り消す(`cancelled`)。`InterveneResult.reason` に `no_target` / `rejected`。年表 `intercepted`、
  `milestones()` は取り消した年の節目を外す、`nextMeteorYear()`。判定条件 `intercepted { min, max }`。力は要らない(民の備蓄で払う)。
- **薄い脈**: `WorldConfig.crystalScale`(`start.crystalScale`)。seed から生成した輝石に掛ける。脈の形は変わらない。restore でも config から再生成。
- UI: HUD の文明行に「工事 備蓄 / 3」(止まっていれば「止」)、`#hud-works` の「星を砕け」(備蓄不足は unaffordable)。石板は取り消した節目を消し、
  年表に「星が砕けた(N 年目の星は落ちない)」。
- シナリオ「迎撃の塔」(`intercept-tower`): 石@1770、薪 1400、信仰 0.5、crystalScale 0.62、隕石 60/100/140 年目(半径 48)、
  alive = 三度砕く かつ 段階 ≥ 塔 5 年、dead = 崩壊 か 鹿の絶滅。tests/slow: 放置 dead、応えるだけ dead、儀式後回し+勅令なし dead、
  儀式後回し+勅令 alive、儀式を最初から alive。校正の表:

| 手 | 星に上がる年 | 三度目の備蓄 | 結果 |
|---|---|---|---|
| 放置 | — | — | dead(60 年目) |
| 儀式なし、祈りに応えるだけ | —(信仰 0.6〜0.7) | — | dead(60 年目) |
| 儀式を 20 年目から、止めよ無し | 34 | 2.15 / 3.0 | dead(140 年目) |
| 儀式を 20 年目から、塔で止めよ | 38 | 3.0 | alive |
| 儀式を最初から | 25 | 3.0 | alive |

#### 4.24.1 校正(M10-03、2026-09-22)

LD §8.3。`SHIP_NEED` 10 → 120。シナリオ「空の舟」(`sky-ship`): 帆@2787、薪 800、信仰 0.5、沈没 0.0006/年、escape = 逃がした種 ≥ 5。

| 手 | 材の出所 | 飛ぶ年 | 結果 |
|---|---|---|---|
| 放置 | — | — | dead(177 年、崩壊) |
| 開始時の森で着工、苔の儀式だけ | 最初の森 22 | —(進み 10 で止まる) | dead |
| 森を 2 年ごとに放ち続ける | 鹿に食われ 1〜2 | —(200 年で 104) | dead |
| 鐘樹を 2 年ごとに植えながら着工 | 鐘樹 10〜20 | 25 | escaped |
| 鐘樹を 30 年育ててから着工 | 鐘樹 45 | 43 | escaped |

### 4.25 実装時の差分(M10 レビューの修正、2026-09-22)

code-review の指摘 10 件を直した。

- `World.dispatch` が validate の結果 `{ ok } | { ok: false, reason }` を返す。ScenarioRunner は World の門(気象塔の段階・信仰・輝石、舟の材、海への放流)で
  弾かれたら力を引かず、介入に数えず、年表にも積まない(`rejected`)。それまでは気象塔・舟が門で弾かれても力 12 が消え、年表に偽の行が残っていた。
- 迎撃の連打: まだ World に適用されていない迎撃(`pendingIntercepts`)の分を備蓄から引いて判定する。停止中に 3 回押しても 1 回分の備蓄で 3 つ取り消せない。
- 舟の警告: 成った舟が信仰不足で飛ばないときは `ship_waiting`(「材が無い」と言わない)。`ship_late` の経過は世界の年(snapshot.year)で測り、石板の年と混ぜない。
- 判定 `escaped` の理由: 飛んだが種が足りないときは「舟は飛んだが、乗せた種は N」。
- 気象塔の維持費を石板の「維持」(upkeepLastYear)と upkeep_over_income に含める。
- restore はセーブに舟が無ければ舟を持たない(start.shipProgress から作った舟が崩壊後のセーブで蘇らない)。
- 脈の辿り方と比例除去を一本化: `towerCrystalPool` は `miningPool` の薄い包み、`stepWorks` は `takeCrystal` を使う。
- HUD の文明行に、塔以上では星の門と星の衰退が見る半径 12 の民「星の民 N」を出す。

### 4.26 実装時の差分(M10R-02: 民の記憶 = 信仰の上限、祈りの間隔 0)

レベルデザイン `docs/design/2026-09-22-level-design-faith-economy.md` §3.1・§3.2 を実装した。faith.ts に係数と純粋関数を足す(既存の updateFaith と同じファイル)。

- **係数**(faith.ts): `FAITH_CAP_INITIAL` 1.0、`FAITH_CAP_IGNORE` 0.1(無視 1 回)、`FAITH_CAP_ANSWER` 0.1(応え 1 回)、`FAITH_CAP_RECOVER` 0.01(祈りの無い年)。
- **`updateFaithCap`**(純粋関数): `prev + answered×FAITH_CAP_ANSWER − ignored×FAITH_CAP_IGNORE`、さらに「祈りが無い年」(`prayerPending` が false かつ answered/ignored とも 0、つまり今年は困りごと自体が無かった)だけ `FAITH_CAP_RECOVER` を足し、`[0,1]` にクランプする。
- **`CivState.faithCap`**: faith と同じ最初の年 (stage ≥ 1) に生まれる。`World.stepCivYearly` が `updateFaith` の直後に毎年更新し(`prevCap = civ.faithCap ?? FAITH_CAP_INITIAL`)、`civ.faith = Math.min(civ.faith, civ.faithCap)` で信仰を抑える。ログ `sim.civ.faith_cap { year, faithCap, delta }` は 1e-9 を超えて動いた年だけ出す。内乱の戻りは `Math.min(UNREST_FAITH_AFTER, civ.faithCap)`(上限より上へは戻らない)。`World.collapseCiv` は faith と同じく `faithCap` も捨てる。
- **祈りの間隔**(prayer.ts): `PRAYER_COOLDOWN` を 3 → 0 に。ただし「解決した年のうちに同じ年で再発行しない」ため、`World.civPrayerCooldownUntil` の代入 3 箇所 (応えた・取り下げた・無視した) を `年 + PRAYER_COOLDOWN + 1` にした(間隔 0 でも次に出せるのは翌年から)。
- **UI**: HUD の信仰行は `faithCap` があれば「信仰 0.73 / 上限 0.80」、無ければ (古いセーブ等) 従来どおり「信仰 0.73」。石板の年表に新しい kind `civ_faith_cap`(civ_faith と同じ ±0.1 の閾値)を足し、下がれば「民は忘れない: 信仰の上限 0.90」、上がれば「民の記憶が薄れる: 信仰の上限 0.91」。
- **ファイル**: `src/simulation/faith.ts`・`civilization.ts`・`World.ts`・`prayer.ts`、`src/scenario/ScenarioRunner.ts`、`src/ui/Hud.ts`・`Tablet.ts`。

### 4.27 実装時の差分(M10R-04: 舟か塔か(舟が先に伐る)と乗せる民)

レベルデザイン `docs/design/2026-09-22-level-design-faith-economy.md` §3.4 を実装した。既存の `src/simulation/ship.ts` に係数と関数を足す(新規モジュールは無い)。

- **順序**: `World.stepCivYearly` の年次ブロックの並びを「舟 → 塔の燃料 → 星の工事」に変えた(以前は「塔の燃料 → 星の工事 → 舟」)。舟の `stepShip` が徴収半径 `LOAD_RADIUS[civ.stage]` 内の森+鐘樹を `SHIP_CUT` だけ先に伐り、塔の燃料 (`collectFuel`、同じ半径の鐘樹が対象) はその残りから取る(民は舟を優先する。LD §3.4)。fuel 側の計算そのものは舟の有無を見ないので、ブロックを丸ごと入れ替えるだけで済んだ(依存の再構成は不要)。
- **乗せる民**: `SHIP_CREW = POP_NEED[SHIP_STAGE]`(初期値 0.6)を `ship.ts` に追加。`shipCrew(pops, home, elevation, size)` は `civilizationLoad.populationFor(SHIP_STAGE, ...)` の薄い包み(段階 帆 は MAX_STAGE 未満なので中身は `populationAround`、SUPPORT_RADIUS)。`CivState.populationShip`(`populationStar` と同じ流儀で年 1 回更新)を追加し、舟の門・警告・HUD はこの値を読む。
- **完成の門**: 舟が完成 (`shipDone`) した年、信仰 ≥ `SHIP_FAITH` **かつ** `populationShip` ≥ `SHIP_CREW` の両方を満たさなければ飛ばない。信仰を先に見る(`canLaunchShip` と同じ門の順)。信仰は足りて民だけ足りなければ `sim.ship.waiting` の `reason` が `'crew'`(信仰が足りなければ `'faith'`)。どちらも毎年再判定する。`sim.ship.launched` に `crew` を足した。
- **警告・HUD**: `warnings.ts` の `ship_waiting` は信仰不足のときの文言(既存)に加え、民不足のとき「舟は成ったが民が足りない(民 0.42。0.6 に足りない)」を出す(`s.civ.populationShip` を直接読み、`ShipContext` の拡張は不要だった)。`Hud.ts` の `formatShipHint` は同様に「· 民が乗るには足りない(民 0.42 / 0.6)」を追加(信仰不足の文言が優先)。石板の年表は汎用の `warning` kind (`⚠ ${warning.text}`) がそのまま理由つきの文言を出すので、`Tablet.ts`/`ScenarioRunner.ts` の `TimelineEvent` に変更は無い。
- **ファイル**: `src/simulation/ship.ts`・`civilization.ts`(`CivState.populationShip`)・`World.ts`、`src/scenario/warnings.ts`、`src/ui/Hud.ts`。

### 4.28 実装時の差分(M10R-03: 夢喰い、状態機械の影)

レベルデザイン `docs/design/2026-09-22-level-design-faith-economy.md` §3.3 を実装した。新規モジュール `src/simulation/dreamEater.ts`(unrest.ts と同じ流儀: 純粋関数 + `applyDreamEater`)。

- **係数**(dreamEater.ts): `DREAM_CAP` 0.3(出現の上限)、`DREAM_STAGE` 3(歌、出現に要る最低段階)、`DREAM_EAT` 0.2(毎年支え半径内の民に掛ける減り)、`DREAM_LEAVE` 0.5(去る上限)。
- **`DreamEaterState`**: `{ since: number }`(現れた年)。`ship.ts` の `ShipState`・`weatherTower.ts` の `WeatherTower` と同じく、種としての密度を持たない舞台装置の状態として `World` が別に持つ(`CivState` には持たせない。M17 の本体は密度を持つ種として別に残す)。
- **`stepDreamEater`**(純粋関数): 現れていなければ 段階 ≥ `DREAM_STAGE` かつ `faithCap < DREAM_CAP` で出現、現れていれば `faithCap ≥ DREAM_LEAVE` で退去。`faithCap` が無ければ(発生直後で未計算)1 とみなし出現しない。
- **`applyDreamEater`**(純粋関数): `applyUnrest` と同じ形。home の支え半径内の陸セルの、その文明種の密度を `(1 − DREAM_EAT)` 倍にする。
- **`World`**: `this.dreamEater: DreamEaterState | null` を `towers`/`ship` と同じ流儀で snapshot・serialize・restore に持たせる(セーブに無ければ null)。`stepCivYearly` は `faithCap` の更新・内乱の判定(崩壊すれば先に `collapseCiv` が `dreamEater` を消す)の後で `stepDreamEater` を呼び、現れた/去った年にログ `sim.civ.dream_eater { year, phase, faithCap }` を出す。出現中は毎年 `applyDreamEater` を掛ける。文明の進みは、採掘そのもの(`stepMining`、輝石の消費)は止めずに、`this.civ = this.dreamEater ? this.civ : state`(`stepMining` が返す新しい progress/stage を捨てる)で止める。年境界の直後の 1 年は、境界の判定より前に採掘が走るため、進みが止まるのは出現した翌年からになる。
- **判定**: `judge.ts` に条件 `{ type: 'dream_eater' }`(`s.dreamEater !== null`)を足した。真のとき why は「夢喰いに食われた」(`intercepted`/`escaped` と同じ、型と評価を switch に足すだけ)。`assets/data/scenarios.json` の `no-answer` の `dead`(`any`)にこの条件を追加した。
- **UI**: `ScenarioRunner` は `snapshot.dreamEater` の有無の flip を前年と比べて `TimelineEvent { kind: 'dream_eater', phase, faithCap }` を積む(`tower_power` のように自分で dispatch する状態ではないので、`civ_faith_cap` と同じ「値の変化を見る」流儀)。`Tablet.ts` の `describeEvent` は「夢喰いが集落に現れた(信仰の上限 0.28)」「夢喰いが去った(信仰の上限 0.50)」(`formatFaith`)。`Hud.ts` の `formatCiv` は第 2 引数 `dreamEater: boolean`(既定 false)を足し、信仰の文言の直後に「· 夢喰い」を出す(`CivState` に無い値なので、呼び出し元が `snapshot.dreamEater !== null` を渡す)。
- **SceneView**: `src/render/dreamEaterShade.ts`(`settlementInstances` と同じ流儀の純粋関数)が home・支え半径・表示の有無を返し、`SceneView.ts` は暗い半透明の円 (`CircleGeometry`) を集落の上に置く/隠すだけ(塔・集落の箱と同じ、tick/civ が変わった時だけ置き直す)。
- **ファイル**: `src/simulation/dreamEater.ts`(新規)・`civilization.ts` の型注釈なし(`CivState` は変えていない)・`World.ts`、`src/scenario/types.ts`・`judge.ts`・`ScenarioRunner.ts`、`src/ui/Tablet.ts`・`Hud.ts`、`src/render/dreamEaterShade.ts`(新規)・`SceneView.ts`、`assets/data/scenarios.json`。

### 4.29 実装時の差分(M10R-05: 校正で足した仕組み)

レベルデザイン `docs/design/2026-09-22-level-design-faith-economy.md` §8 の計測から足した。

- **勅令「採掘を止めよ」は星の工事の採掘も止める**(`works.ts` の `stepWorks` が `civ.miningStopped` を見る)。備蓄は残り、迎撃はできる。
  `works.stopped` は信仰不足の印なので立てない。信仰の上限が入ると、脈が 10% を切ったあとの「星の砂を」の無視で上限が削れて工事が止まり、
  星が掘り続ける限りどの手も滅びたため。
- **帆を失えば舟は止まる**(`World.stepCivYearly`): 段階 < 帆の年は伐らず進まず、完成していても飛ばない。ログ `sim.ship.halted { year, stage, progress }`、
  警告 `ship_stalled` の文言「帆を失い、舟は止まっている(段階 4 < 5。進み …)」。進みは残り、帆に戻れば再開する。
- **シナリオ**: 迎撃の塔は脈 1.0 に戻し、予言と節目に「掘り尽くせば祈り、失望が積もれば工事が止まる。止めよで蓄えは残る」を足した。
  空の舟は薪の蓄え 0、予言と節目を「舟か塔か」「陰で群れが痩せる」に書き換えた。
- **ファイル**: `src/simulation/works.ts`、`src/simulation/World.ts`、`src/scenario/warnings.ts`、`assets/data/scenarios.json`、
  `tests/unit/works.test.ts`、`tests/unit/world.ship.test.ts`、`tests/unit/scenario.warnings.test.ts`、`tests/slow/scenarios.playthrough.test.ts`。
- **レビューの修正**(M10R、7eff673): 上限の年表の閾値に 1e-9 の余裕(無視 1 回の 0.1 が二進小数で落ちていた)。`everyYears` は `untilYear`
  省略時に予言の年まで繰り返す(以前は 1 回だけ。既存の「祈りに応えるな」の狼も 6 年目の 1 回だった)。`dreamEater` 欠落のスナップショットは
  「いない」(`!= null`)。内乱と夢喰いの民の減らし方を `scalePopulationAround` に共用。祈りの解決を `markPrayerResolved` に一本化。
  帆を失った舟の HUD 文言。`populationShip` は `population` を写す(同じ半径の平均で、走査を重ねない)。内乱の戻り min(0.4, 上限) は
  上限 < 0.3 で連鎖する(夢喰いの局面の意図した螺旋、unrest.ts に注記)。
- **空の舟の差し戻し**(M10R-06 の手動受入、LD §8.7〜8.8): 薪 0 の定義は UI(環 1 の放流)では手で勝てず、机上でも林だけでは塔が飢えると分かったため、
  空の舟の定義と通し実行は M10 の状態(薪 800、予言・節目も)に戻した。帆を失えば止まる・乗せる民の仕組みは残る(薪 800 の間は効かない)。作り直しは M10R-08。

## 6. マイルストーンと受入基準

証跡はテスト名とファイルパスで示す。sprint-qa-process に従い、各項目に commit SHA を後から追記する。

### M10R-04: 舟か塔か(材の天秤)と乗せる民

| 受入項目 | 証跡 |
|---|---|
| 舟の伐採の後に燃料を取ることが単体テストで確かめられる(同じ木で舟が進むと塔の燃料が減る) | `tests/unit/world.ship.test.ts`(民は舟を優先する) · 6906514 |
| 民が足りない完成済みの舟は飛ばず、ログと警告に「民が足りない」が出る。増えれば飛ぶ | `tests/unit/world.ship.test.ts`(乗せる民)、`tests/unit/ship.test.ts`、`tests/unit/scenario.warnings.test.ts` · 6906514 |
| HUD・石板の文言(内容検証のテスト)。E2E が通る | `tests/unit/ui.hud.test.ts`、`tests/unit/ui.tablet.test.ts`、`npx playwright test` · 6906514 |
| npm run check と単体・E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`、`npx playwright test` · 6906514 |

### M10-01: 気象塔

| 受入項目 | 証跡 |
|---|---|
| コマンド build_tower { cell, rainScale?, tempOffset? }。段階 < 塔 または 信仰 < 0.6 または 輝石不足なら拒否(単体テスト、cmd.rejected の理由つき) | `tests/unit/weatherTower.test.ts`、`tests/unit/world.tower.test.ts` · e7e2a39 |
| 塔の半径内だけ気候が変わり、外は変わらない(単体テスト)。塔は snapshot・保存に含まれる | `tests/unit/weatherTower.test.ts`、`tests/unit/world.tower.test.ts` · e7e2a39 |
| 塔の維持費が星の力から毎年引かれ、尽きたら塔が止まる(単体テスト) | `tests/unit/scenario.budget.test.ts`、`tests/unit/world.tower.test.ts` · e7e2a39 |
| SceneView に塔が立ち、HUD の災害列に「気象塔」チップ、セル詳細に塔の効果(E2E: 建てると年表に出る) | `src/render/SceneView.ts`、`src/ui/Hud.ts`、`tests/e2e/smoke.spec.ts` · e7e2a39 |
| npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`(373 テスト通過)、`npx playwright test`(19 テスト通過) · e7e2a39 |

### M10-02: 迎撃

| 受入項目 | 証跡 |
|---|---|
| 校正の前にレベルデザイン文書を書き、ユーザーの承認を得る | `docs/design/2026-09-22-level-design-devices.md` §9(2026-09-22 承認)· 00d1dd0 / ddda979 |
| レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る) | 群れの感度が通らず、星の門を半径 12 + 信仰 0.8 に(LD §8.1)· 3ce0429。`tests/unit/civilizationLoad.test.ts`、`tests/unit/world.civilization.star.test.ts`、`tests/unit/world.vein.test.ts` |
| コマンド intercept: 段階 星 かつ 輝石 ≥ 必要量で、次に予定された隕石の予定コマンドを取り消す。条件を満たさなければ拒否(単体テスト) | `tests/unit/works.test.ts`、`tests/unit/world.civilization.works.test.ts`、`tests/unit/scenario.intercept.test.ts` · 9076a1e / 50968ac |
| 取り消した予定は石板の節目から消え、年表に「星が砕けた」が並ぶ(E2E) | `tests/e2e/smoke.spec.ts`(intercept: test-intercept)、`tests/unit/ui.tablet.test.ts`、`tests/unit/ui.hud.test.ts` · 50968ac |
| 「迎撃の塔」: 放置 dead・素朴戦略 dead・想定解 2 つ alive(tests/slow) | `tests/slow/scenarios.playthrough.test.ts`(intercept-tower 5 件)、`tests/unit/world.crystalScale.test.ts` · 9a30d6e |
| 設計書に校正の表と証跡 | §4.23 · 9a30d6e |
| npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`、`npx playwright test`(20 件)· 9a30d6e |

### M10-04: 手動受入プレイテスト(M10)

| 受入項目 | 証跡 |
|---|---|
| プレイ記録 3 回分(うち 1 回以上 dead) | `docs/specs/plans/2026-09-22-m10-playtest.md`(迎撃の塔 alive、空の舟 dead、空の舟 escaped)· 2e22bc7 |
| 表示の問題を直し E2E が通る | 舟の行を逃がす石板だけに(`Hud.setShipEnabled`)、`[hidden]` を display より優先(hud.css)、舟の警告 ship_stalled / ship_late(`warnings.ts`)。`tests/unit/scenario.warnings.test.ts`、`tests/e2e/smoke.spec.ts` · 2e22bc7 |
| 設計書 §6 と企画書に反映 | この表、`docs/design/2026-09-19-proposal.html` の M10 段落 · 2e22bc7 |
| npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`(442 件)、`npx playwright test`(21 件)· 2e22bc7 |

### M10-03: 空の舟

| 受入項目 | 証跡 |
|---|---|
| コマンド launch_ship: 段階 < 帆 または 信仰 < 0.5 または 材不足なら拒否(単体テスト、cmd.rejected の理由つき)。持ち出し JSON の形を固定 | `tests/unit/ship.test.ts`、`tests/unit/world.ship.test.ts` · 3ad6a98 |
| 舟の建造中は森(+鐘樹)が徴収半径内だけ減る(単体テスト)。材が 0 の年は進まない | `tests/unit/ship.test.ts`、`tests/unit/world.ship.test.ts` · 3ad6a98 |
| Verdict に escaped が増え、escape が dead より先に評価される。石板のオーバーレイが「次の島へ」を出し、持ち出しデータをダウンロードできる(E2E) | `tests/unit/scenario.judge.test.ts`、`tests/unit/ui.tablet.test.ts`、`tests/e2e/smoke.spec.ts` · 3ad6a98 |
| npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`(437 テスト通過)、`npx playwright test`(21 テスト通過) · 3ad6a98 |
| 「空の舟」シナリオの校正(tests/slow: 放置 dead、舟だけ急ぐ dead、想定解 2 つ escaped) | `tests/slow/scenarios.playthrough.test.ts`(sky-ship 5 件)、§4.24.1 · 5969f4e |

### M10R-02: 民の記憶(信仰の上限)と絶え間ない祈り

| 受入項目 | 証跡 |
|---|---|
| faith.ts の純粋関数で上限の更新(無視/応え/回復/クランプ)が単体テストで確かめられる | `tests/unit/faith.test.ts`(updateFaithCap)· a4377b7 |
| World で無視 → 上限が下がり、儀式を続けても信仰が上限を超えない。内乱の後の信仰が min(0.4, 上限)。save/restore で往復 | `tests/unit/world.civilization.prayer.test.ts`(信仰の上限 = 民の記憶)· a4377b7 |
| 祈りが解決/無視/取り下げになった翌年に、困りごとが続いていれば次の祈りが出る | `tests/unit/world.civilization.prayer.test.ts`(祈りの間隔は 0)、`tests/unit/prayer.test.ts` · a4377b7 |
| HUD・石板に上限が出る(内容検証のテスト)。E2E が通る | `tests/unit/ui.hud.test.ts`、`tests/unit/ui.tablet.test.ts`、`tests/unit/scenario.budget.test.ts`(civ_faith_cap)、`npx playwright test` · a4377b7 |
| npm run check と単体・E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`、`npx playwright test` · a4377b7 |

### M10R-03: 夢喰い(信仰の上限が尽きると集落に影)

| 受入項目 | 証跡 |
|---|---|
| 純粋関数(出現/捕食/退去)が単体テストで確かめられる。World で出現中は民が減り progress が進まない。save/restore で往復 | `tests/unit/dreamEater.test.ts`、`tests/unit/world.dreamEater.test.ts` · 5ee76c1 |
| 判定条件 dream_eater が judge で使え、dead の理由文に「夢喰い」が出る | `tests/unit/scenario.judge.test.ts`(dream_eater)、`assets/data/scenarios.json`(no-answer の dead) · 5ee76c1 |
| HUD・石板・SceneView に出る(内容検証のテスト)。E2E が通る | `tests/unit/ui.hud.test.ts`、`tests/unit/ui.tablet.test.ts`、`tests/unit/scenario.budget.test.ts`(dream_eater の年表)、`tests/unit/render.dreamEaterShade.test.ts`、`npx playwright test` · 5ee76c1 |
| npm run check と単体・E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`(502 テスト通過)、`npx playwright test`(21 テスト通過) · 5ee76c1 |

### M9-00: 文明の自然発生を地域で測る

| 受入項目 | 証跡 |
|---|---|
| checkEmergence が地域の履歴・輝石の有無・相対植生で判定する(境界値つき)、pickHomeCandidate / trackHomeCandidate / cellDistance | `tests/unit/civilization.test.ts` · 2a35b32 |
| seed 42 / size 64 / 全種で鹿の文明が 60 年以内に発生する(実測 22 年目、集落 2635) | `tests/unit/world.civilization.test.ts` · 2a35b32 |
| 草だけの世界の既存テストが変わらない | `tests/unit/world.civilization.test.ts` · 2a35b32 |
| 既存の通し実行 20 件が通る(塔 v2 5 件 / 放置・台本 11 件 / 素朴・罠 7 件の 3 分割) | `tests/slow/scenarios.playthrough.test.ts` · 8ac0fa6 |

### M9-01: 信仰の値

| 受入項目 | 証跡 |
|---|---|
| 純粋関数で信仰を更新する。同じ種類のコマンドが 10 年内に 3 回続くと上がり、直近 10 年で 3 種類以上のコマンドが混ざると下がる。災害は必ず下げる(単体テスト、境界値つき) | `tests/unit/faith.test.ts` · 40bd5c0 |
| 介入がなければ年ごとに一定率で減衰し 0 未満・1 超にならない(性質テスト) | `tests/unit/faith.test.ts` · 40bd5c0 |
| 文明のない世界では信仰の値も表示も存在しない(既存テストが変わらない) | `tests/unit/world.civilization.faith.test.ts`、`tests/unit/ui.hud.test.ts` · 40bd5c0 |
| HUD の文明の行に「信仰 0.62」が出る。snapshot と保存データに含まれ、serialize→restore で一致する | `tests/unit/world.civilization.faith.test.ts`、`tests/unit/ui.hud.test.ts`、`tests/e2e/smoke.spec.ts` · 40bd5c0 |
| ログ sim.civ.faith を年 1 回、年表に ±0.1 以上動いた年だけ出す | `tests/unit/world.civilization.faith.test.ts`、`tests/unit/scenario.budget.test.ts`、`tests/unit/ui.tablet.test.ts` · 40bd5c0 |
| npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`(242 テスト通過)、`npx playwright test`(16 テスト通過) · 40bd5c0 |

### M9-05: 手動受入プレイテスト(信仰と祈り)

| 受入項目 | 証跡 |
|---|---|
| プレイ記録 3 回分(応える → dead、儀式 → alive、儀式で止める → alive) | `docs/specs/plans/2026-09-22-m9-playtest.md` · 5f040bb |
| 記録で挙がった表示の問題を直し E2E が通る(信仰の切り捨て表示 `formatFaith`、HUD の集落の生気と警告 `civ_vitality_low`) | `tests/unit/faith.test.ts`、`tests/unit/ui.hud.test.ts`、`tests/unit/ui.tablet.test.ts`、`tests/unit/scenario.warnings.test.ts`、`tests/e2e/smoke.spec.ts`(18 件) · 5f040bb |
| 設計書 §6 と企画書に反映 | 本表、`docs/design/2026-09-19-proposal.html` · 5f040bb |

### M9-04: 「祈りに応えるな」「霊脈枯れ(簡易版)」の校正

| 受入項目 | 証跡 |
|---|---|
| 校正の前にレベルデザイン文書を書き、ユーザーの承認を得る | `docs/design/2026-09-21-level-design-faith.md` §9 · c94ed36 / 2654ffe(承認 2026-09-21) |
| レバー感度・定着・副作用の確認がヘッドレスで通っている | `tests/unit/world.vein.test.ts`、`tests/unit/faith.test.ts`、`tests/unit/prayer.test.ts`、既存の通し 20 件 · 1e342f0 |
| scenarios.json に 2 本(予言・開始の文明段階・予算・節目・alive/dead) | `assets/data/scenarios.json`、`tests/unit/scenario.judge.test.ts` · 6b75c9b |
| tests/slow: 各シナリオで 放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive。既存の通し実行も通る | `tests/slow/scenarios.playthrough.test.ts`(faith scenarios 10 件 + 既存 20 件) · 6b75c9b |
| 設計書 §4 に係数と校正の表、§6 に証跡 | §4.19、§4.20 · d33de56 |

### M9-03: 信仰の効き(内乱と採掘の制止)

| 受入項目 | 証跡 |
|---|---|
| 信仰 < 0.3 が 3 年続くと内乱: 集落の民が半減し段階 −1。ログ sim.civ.unrest | `tests/unit/unrest.test.ts`、`tests/unit/world.civilization.edict.test.ts`(内乱の配線) · 1e342f0 |
| 「採掘を止めよ / 再開せよ」は信仰 ≥ 0.6 のときだけ効き、効いた年から採掘が 0(単体 + E2E) | `tests/unit/world.civilization.edict.test.ts`、`tests/e2e/smoke.spec.ts`(edict) · 1e342f0 |
| Condition faith { min?, max? }、警告 faith_low(< 0.4)。prayers_answered、civ_vitality | `tests/unit/scenario.judge.test.ts`、`tests/unit/scenario.warnings.test.ts`、`tests/unit/scenario.budget.test.ts`(civ_edict の年表・力 0) · 1e342f0 |
| 文明のない世界では何も起きない | `tests/unit/world.civilization.edict.test.ts`(文明のない世界では勅令は何も起こさない) · 1e342f0 |
| 霊脈: 脈の番号付け・脈全体の枯渇・器としての上限、民は脈を辿って掘る。感度と定着(LD §5) | `tests/unit/vein.test.ts`、`tests/unit/civilization.test.ts`(stepMining と霊脈)、`tests/unit/world.vein.test.ts` · 1e342f0 |
| 祈りの「いつもより」と取り下げ(副作用の校正) | `tests/unit/prayer.test.ts`、`tests/unit/world.civilization.prayer.test.ts` · 1e342f0 |
| 既存の通し実行 20 件が通る(塔 v2 は台本を変えずに通る) | `tests/slow/scenarios.playthrough.test.ts` · 1e342f0 |

### M9-02: 祈り

| 受入項目 | 証跡 |
|---|---|
| 祈りの生成は純粋関数。条件(草の密度・捕食者比・輝石量)ごとに 1 種類、同時に 1 つだけ、期限 5 年(単体テスト) | `tests/unit/prayer.test.ts`、`tests/unit/world.civilization.prayer.test.ts` · ad80ea3 |
| 期限内に対応する種類の介入があれば「応えた」と判定して信仰 +、期限切れで −(単体テスト) | `tests/unit/prayer.test.ts`、`tests/unit/faith.test.ts`、`tests/unit/world.civilization.prayer.test.ts` · ad80ea3 |
| 石板に現在の祈りと残り年数が出て、応えた・無視したが年表に並ぶ(E2E: 試し読みシナリオで祈りが出て、対応する介入で消える) | `tests/unit/ui.tablet.test.ts`、`tests/unit/scenario.budget.test.ts`、`tests/e2e/smoke.spec.ts` · ad80ea3 |
| ログ scenario.prayer(issued / answered / ignored) | `tests/unit/scenario.budget.test.ts`、`tests/e2e/smoke.spec.ts` · ad80ea3 |
| npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す | `npm run check`(287 テスト通過)、`npx playwright test`(17 テスト通過) · ad80ea3 |

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
| 枯死→生気の分解、分解者による加速、拡散と漏出、海は 0 | `tests/unit/vitality.test.ts` · 084f3b9 |
| 生気が薄いと成長が遅く、成長は生気を消費し、死亡は枯死を積む | `tests/unit/vegetation.test.ts` · 084f3b9 |
| 分解者は枯死で増え無いと減る。動物の死亡が枯死を積む。山火事は分解者も焼き灰を残す | `tests/unit/populations.test.ts`、`tests/unit/disaster.test.ts` · 084f3b9 |
| 生気レイヤーの着色、保存に vitality/litter | `tests/unit/render.layerToColors.test.ts`、`tests/unit/world.save.test.ts` · 084f3b9 |
| 100 年共存と振動が維持される | `tests/unit/data.test.ts`、`tests/unit/world.oscillation.test.ts` · 084f3b9 |
| 生気の飢饉: 放置で滅び、五年目に苔を放てば回避 | `tests/slow/scenarios.playthrough.test.ts` · 084f3b9 |
| 星が落ちる夜・火の山の目覚めは、苔も含めて放ち直せば回避できる(M4 の 4 本も引き続き通る) | `tests/slow/scenarios.playthrough.test.ts` · 084f3b9 |

### M6: 沈む欠片をジレンマのあるゲームに

| 受入項目 | 証跡 |
|---|---|
| 星の力: 値段・拒否・収入・維持費・上限・枯渇時の気候リセット。budget なしは無料 | `tests/unit/scenario.budget.test.ts` · adfb981 |
| `spawn_species` の `radius`(省略時は 1 セル) | `tests/unit/world.commands.test.ts` · adfb981 |
| 石板に力が出て放流で減り、足りないと弾かれる | `tests/e2e/smoke.spec.ts` · adfb981 |
| 住みやすさレイヤーの着色、海は地形色、不明種は暗色 | `tests/unit/render.layerToColors.test.ts` · 73869bb |
| 密度 / 住みやすさのモードチップ | `tests/e2e/smoke.spec.ts` · 73869bb |
| 警告 4 種の真偽と順序、同じ警告のログは初回だけ、結果の内訳 | `tests/unit/scenario.warnings.test.ts`、`tests/unit/scenario.budget.test.ts` · 8c32ebc |
| 節目が到達で消え、警告が出て、内訳が表示される | `tests/e2e/smoke.spec.ts` · 8c32ebc |
| `species_mean` の平均判定と履歴 | `tests/unit/scenario.judge.test.ts`、`tests/unit/scenario.runner.test.ts` · af130f8 |
| 沈む欠片: 放置と素朴 3 戦略は dead、想定解 2 通りは alive、他 4 本は引き続き通る | `tests/slow/scenarios.playthrough.test.ts` · af130f8(15 件通過) |
| 手動プレイ 3 回の記録(M6-05)、スライダー同期と凡例の数字 | `docs/specs/plans/2026-09-19-m6-playtest.md`、`tests/e2e/smoke.spec.ts` · 2608ae3 |

### M7-01〜03: プレイテストの改善点

| 受入項目 | 証跡 |
|---|---|
| 上限到達の警告、ignoreWarnings の除外 | `tests/unit/scenario.warnings.test.ts` · 97a1327 |
| 年表に介入・予定・力切れ・警告・勝敗が積まれ、沈降は積まれない。文の整形 | `tests/unit/scenario.budget.test.ts`、`tests/unit/ui.tablet.test.ts` · 97a1327 |
| 石板の年表に放流が出る | `tests/e2e/smoke.spec.ts` · 97a1327 |

### M8-05: 判定条件と「塔の重さ」の校正

| 受入項目 | 証跡 |
|---|---|
| 判定条件 `civ_stage`(直近 years 年の最小段階)、警告 `civ_declining` | `tests/unit/scenario.judge.test.ts`、`tests/unit/scenario.warnings.test.ts` · 2f54853 |
| 「塔の重さ」: 放置・森の放流だけ・疫病だけは dead、雨+放流・疫病(間引き)+放流の 2 通りは alive、既存 15 件も通る | `tests/slow/scenarios.playthrough.test.ts` · 2f54853(20 件通過) |
| `POP_NEED`・`SUPPORT_RADIUS`・`applyLoad` の人口ベース負荷減衰の校正、`ScenarioRunner.intervene()` の `resolve()` 未適用バグ修正 | `tests/unit/civilizationLoad.test.ts`、`tests/unit/world.civilization.load.test.ts` · 2f54853 |

### M8-05 v2: 「塔の重さ」をキーアイテムで作り直す

| 受入項目 | 証跡 |
|---|---|
| 燃料の蓄えと負債(蓄え上限 4 年分、負債 ≥ 3 年分で衰退)、`start.fuelStock` | `tests/unit/civilizationFuel.test.ts`、`tests/unit/world.civilization.fuel.test.ts` · 951de6b |
| 炎蜥蜴は熱の門(`minHeat`)で湧き、噴火後に鹿を減らし、熱が冷めれば消える | `tests/unit/firelizard.test.ts` · 951de6b |
| 鐘樹の陰(`shade 0.2`)の代償と放流の定着 | `tests/unit/belltree.test.ts` · 951de6b |
| 塔の重さ v2: 放置・火だけ・樹だけは dead、配分 2 通りは alive。既存 15 件も通る | `tests/slow/scenarios.playthrough.test.ts` · 951de6b(20 件通過) |
| HUD の燃料表示「蓄え / 必要年」と火の山の案内 | `tests/e2e/smoke.spec.ts` · 951de6b |

### M8-06: 手動受入プレイテスト(塔の重さ v2)

| 受入項目 | 証跡 |
|---|---|
| プレイ記録 3 回分(火だけ・樹だけは滅び、配分は生き延びる。理由が石板で分かる) | `docs/specs/plans/2026-09-20-m8-playtest.md` · 99ae814 |
| 燃料の警告を蓄えと負債で判定(「心細い」「足りない(不足 N 年分)」) | `tests/unit/scenario.warnings.test.ts` · 99ae814 |
| 企画書に文明と塔の一節 | `docs/design/2026-09-19-proposal.html` · 99ae814 |

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
