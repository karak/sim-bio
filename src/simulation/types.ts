import type { CivState, CivilizationConfig } from './civilization';

/** decomposer は枯死 (litter) を餌にし、いる場所の分解を速める第 4 の階層 */
export type Trophic = 'plant' | 'herbivore' | 'carnivore' | 'decomposer';

/** 種の定義。assets/data/species.json から読む。 */
export type SpeciesDef = {
  id: string;
  name: string;
  trophic: Trophic;
  /** 植物: 1 tick の成長率。動物: 摂取した餌密度あたりの増加係数 (変換効率) */
  growthRate: number;
  mortality: number;
  /** 生存に適した気温帯 (℃) */
  tempRange: [number, number];
  /** 生存に適した水分帯 [0,1] */
  moistureRange: [number, number];
  /** 隣接セルへの拡散率 */
  diffusion: number;
  /** 被食者の種 ID (動物のみ) */
  eats?: string[];
  /** 餌に対する 1 tick あたりの捕食率 (動物のみ) */
  predation?: number;
  /** 餌 1 単位の処理時間 (動物のみ、省略時 0 = 線形応答)。大きいほど摂食が飽和し、振動が出やすい (Holling II 型) */
  handlingTime?: number;
  /** create 時に陸の全セルへ与える初期密度。省略時は植物 0.05、動物 0 */
  initialDensity?: number;
  /** SceneView の AssetTable のキー */
  assetId: string;
  /** グラフ・ヒートマップの色 (#rrggbb) */
  color: string;
  /** HUD の放流チップに出すか。省略時 true。false は凡例・住みやすさレイヤーには出るが、見守り手が放てない種 (M8-09: 炎蜥蜴) */
  spawnable?: boolean;
};

export type WorldConfig = {
  seed: number;
  /** 一辺のセル数 */
  size: number;
  ticksPerYear: number;
  species: SpeciesDef[];
  climate: {
    seasonAmplitudeTemp: number;
    seasonAmplitudeRain: number;
    /** set_climate で変更 */
    tempOffset: number;
    /** set_climate で変更 */
    rainScale: number;
  };
  feedback: {
    /** 植生 → 降水。M1 で有効 */
    vegetationToRain: number;
    /** 以下はスロットのみ (0) */
    vegetationToTemp: number;
    co2ToTemp: number;
    iceAlbedo: number;
  };
  /** 文明を持つ種 (M8-02)。省略時は文明なし (既定の世界・既存シナリオはすべてこれ) */
  civilization?: CivilizationConfig;
};

export type DisasterKind = 'meteor' | 'volcano' | 'wildfire' | 'plague';

/** プレイヤーの介入。すべて World.dispatch 経由。 */
export type Command =
  /** radius を足すと中心セルだけでなく半径内の陸セルすべてに放つ (省略時 0 = 中心セルのみ、既存動作のまま) */
  | { type: 'spawn_species'; speciesId: string; cell: number; amount: number; radius?: number }
  | { type: 'set_climate'; tempOffset?: number; rainScale?: number }
  | { type: 'disaster'; kind: DisasterKind; cell: number; radius: number }
  /** 島全体の標高を amount 下げる (沈降)。シナリオの「滅びの進行」用 */
  | { type: 'sink'; amount: number };

/** 読み取り専用ビュー。layers は内部バッファそのもの (コピーしない)。 */
export type WorldSnapshot = {
  tick: number;
  year: number;
  dayOfYear: number;
  size: number;
  layers: {
    elevation: Float32Array;
    temperature: Float32Array;
    moisture: Float32Array;
    /** 植物種の合計 */
    vegetation: Float32Array;
    /** 生気 [0,1]。植物の成長が消費し、枯死の分解で戻る */
    vitality: Float32Array;
    /** 枯死 (死骸・落ち葉・灰) [0,1]。分解されて生気になる */
    litter: Float32Array;
    /** 輝石 [0,1]。陸だけに決定論で塊状に置かれる。海は 0。掘削 (M8-02) までは変化しない */
    crystal: Float32Array;
    populations: Record<string, Float32Array>;
  };
  totals: Record<string, number>;
  meanTemperature: number;
  co2: number;
  species: SpeciesDef[];
  /** 現在の気候設定 (set_climate で変わる)。星の力の維持費の計算に使う */
  climate: { tempOffset: number; rainScale: number };
  /** 文明の状態のコピー。config.civilization が無ければ null (M8-02) */
  civ: CivState | null;
};

export type SaveData = {
  version: 1;
  config: WorldConfig;
  tick: number;
  elevation: number[];
  moistureBase: number[];
  heat: number[];
  /** M3 で追加。古いセーブには無い */
  grazed?: number[];
  /** M5 で追加 */
  vitality?: number[];
  litter?: number[];
  /** M8 で追加。古いセーブには無い場合、restore 時に seed から決定論的に埋め直す */
  crystal?: number[];
  populations: Record<string, number[]>;
  /** M8-02 で追加。config.civilization が無ければ無い */
  civ?: CivState;
};
