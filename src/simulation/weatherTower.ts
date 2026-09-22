/**
 * 気象塔 (M10-01)。舞台装置: 段階「塔」以上で信仰が足りる文明の島に、見守り手が建てられる。
 * 輝石と星の力を払い、半径内の雨と気温を局所で変える。維持費が毎年かかり、払えなければ止まる。
 * レベルデザイン docs/design/2026-09-22-level-design-devices.md §3.1。World には依存しない純粋関数群。
 * 係数はすべてこのファイルの定数にまとめ、校正はここだけを触れば済むようにする (edict.ts / faith.ts と同じ流儀)。
 */
import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';
import { MINE_RADIUS, type CivState } from './civilization';
import { formatFaith } from './faith';

/** 塔を建てられる最低段階 (塔、6) */
export const TOWER_STAGE = 6;
/** 塔を建てる・維持するのに要る信仰の下限。勅令 (edict.ts EDICT_FAITH) と同じ値 */
export const TOWER_FAITH = 0.6;
/** 建設に要る輝石の量 (徴収半径の脈から比例で取る) */
export const TOWER_CRYSTAL = 1.0;
/** 効果の半径 (セル) */
export const TOWER_RADIUS = 6;
/** rainScale 省略時の既定値 (雨を 1.5 倍にする) */
export const TOWER_RAIN_SCALE_DEFAULT = 1.5;
/** tempOffset 省略時の既定値 (気温は変えない) */
export const TOWER_TEMP_OFFSET_DEFAULT = 0;
/** 建設 1 回の星の力の値段 (省略時。LD §5 の係数の初期値) */
export const TOWER_COST = 12;
/** 塔 1 つあたりの年ごとの維持費 (省略時。LD §5 の係数の初期値) */
export const TOWER_UPKEEP = 4;

/** 気象塔の状態。1 つのセルに効果を局所で及ぼす */
export type WeatherTower = {
  cell: number;
  radius: number;
  /** 半径内の降水倍率 (config.climate.rainScale に掛ける) */
  rainScale: number;
  /** 半径内の気温オフセット (config.climate.tempOffset に足す) */
  tempOffset: number;
  /** 維持費が払えていて効いているか。false なら効果 0 (rain 1 倍・temp 0) */
  active: boolean;
  /** 建てた年 */
  year: number;
};

/**
 * build_tower の門。段階 → 信仰 → セル (海でない・二重建設でない) → 輝石の順に確かめる。
 * crystalAvailable は呼び出し元 (World) が towerCrystalPool + 輝石の合計で先に計算しておく
 * (輝石の合計を求める走査と、実際に取り除く takeCrystal を分けておくと、validate (副作用なし) と
 * apply (書き換えあり) の役割が既存の stepMining / applyEdict と同じ形に揃う)。
 */
export function canBuildTower(
  civ: CivState | null,
  cell: number,
  crystalAvailable: number,
  ctx: { elevation: Float32Array; towers: WeatherTower[] },
): { ok: true } | { ok: false; reason: string } {
  if (!civ) return { ok: false, reason: '文明がない' };
  if (civ.stage < TOWER_STAGE) return { ok: false, reason: '段階が塔に満たない' };
  const faith = civ.faith ?? 0;
  if (faith < TOWER_FAITH) return { ok: false, reason: `信仰が足りない(信仰 ${formatFaith(faith)} < ${TOWER_FAITH})` };
  if (ctx.elevation[cell] < SEA_LEVEL) return { ok: false, reason: 'セルは海' };
  if (ctx.towers.some((t) => t.cell === cell)) return { ok: false, reason: 'そのセルには既に塔がある' };
  if (crystalAvailable < TOWER_CRYSTAL) return { ok: false, reason: '輝石が足りない' };
  return { ok: true };
}

/**
 * 建設に使う輝石を集める対象のセル一覧 (stepMining と同じ流儀: 採掘半径 MINE_RADIUS[stage] 内の陸セル。
 * 脈があれば、半径に掛かる脈を辿ってその脈のセル全体まで広げる)。World.veins/veinCells を渡す。
 */
export function towerCrystalPool(
  home: number,
  stage: number,
  elevation: Float32Array,
  size: number,
  veins: { ids: Int32Array; cells: number[][] },
): number[] {
  const radius = MINE_RADIUS[stage] ?? 0;
  const pool: number[] = [];
  const touched = new Set<number>();
  forEachInRadius(home, radius, size, (i) => {
    if (elevation[i] < SEA_LEVEL) return;
    if (veins.ids[i] >= 0) touched.add(veins.ids[i]);
    else pool.push(i);
  });
  for (const v of touched) for (const i of veins.cells[v]) if (elevation[i] >= SEA_LEVEL) pool.push(i);
  return pool;
}

/**
 * pool のセルから輝石を残量に比例して amount だけ取り除く (stepMining の採掘と同じ流儀)。
 * pool の合計が amount 未満なら何も変えず ok:false を返す (呼び出し元は canBuildTower で
 * 先に crystalAvailable >= TOWER_CRYSTAL を確かめてから呼ぶので、通常はここで false にならない)。
 * crystal は呼び出し元の配列をその場で書き換える (他の step 関数と同じ流儀)。
 */
export function takeCrystal(pool: number[], crystal: Float32Array, amount: number): { ok: true } | { ok: false } {
  let total = 0;
  for (const i of pool) total += crystal[i];
  if (total < amount) return { ok: false };
  const k = amount / total;
  for (const i of pool) if (crystal[i] > 0) crystal[i] -= crystal[i] * k;
  return { ok: true };
}

/**
 * 塔ごとの効果を per-cell の配列に落とす。out.rain は既定 1 (倍率なし)、out.temp は既定 0 (オフセットなし)。
 * active な塔の半径内だけ書き換える。塔が重なるセルは、towers 配列の後ろにあるもの (= 後で建てたもの) が勝つ
 * (先着ではなく後着優先。既存の塔を壊さず新しい塔で上書きできるようにするため)。
 */
export function towerFactors(towers: WeatherTower[], size: number, out: { rain: Float32Array; temp: Float32Array }): void {
  out.rain.fill(1);
  out.temp.fill(0);
  for (const t of towers) {
    if (!t.active) continue;
    forEachInRadius(t.cell, t.radius, size, (i) => {
      out.rain[i] = t.rainScale;
      out.temp[i] = t.tempOffset;
    });
  }
}
