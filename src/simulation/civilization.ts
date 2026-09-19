/**
 * 文明の状態 (M8-02 で発生・段階・崩壊のロジックが入る)。
 * M8-04 はこの形に対して表示だけを組む。M8-02 のブランチが合流したらこのファイルは差し替わる。
 */
export type CivState = {
  speciesId: string;
  /** 0..7 (0 = なし) */
  stage: number;
  /** [0,1) */
  progress: number;
  /** 集落セル。文明がなければ -1 */
  home: number;
  population: number;
};

/** 段階名。index = stage */
export const STAGE_NAMES = ['なし', '巣', '火', '歌', '石', '帆', '塔', '星'];
