export type Trophic = 'plant' | 'herbivore' | 'carnivore';

/** 種の定義。assets/data/species.json から読む。 */
export type SpeciesDef = {
  id: string;
  name: string;
  trophic: Trophic;
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
  /** SceneView の AssetTable のキー */
  assetId: string;
  /** グラフ・ヒートマップの色 (#rrggbb) */
  color: string;
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
};

export type DisasterKind = 'meteor' | 'volcano' | 'wildfire' | 'plague';

/** プレイヤーの介入。すべて World.dispatch 経由。 */
export type Command =
  | { type: 'spawn_species'; speciesId: string; cell: number; amount: number }
  | { type: 'set_climate'; tempOffset?: number; rainScale?: number }
  | { type: 'disaster'; kind: DisasterKind; cell: number; radius: number };

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
    populations: Record<string, Float32Array>;
  };
  totals: Record<string, number>;
  meanTemperature: number;
  co2: number;
  species: SpeciesDef[];
};

export type SaveData = {
  version: 1;
  config: WorldConfig;
  tick: number;
  elevation: number[];
  moistureBase: number[];
  heat: number[];
  populations: Record<string, number[]>;
};
