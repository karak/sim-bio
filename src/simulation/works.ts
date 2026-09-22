import { MAX_STAGE, MINE_RADIUS, MINE_RATE, miningPool, type CivState } from './civilization';
import { takeCrystal } from './weatherTower';

/**
 * 星の工事と迎撃 (M10-02)。設計: docs/design/2026-09-22-level-design-devices.md §3.2。
 * 星 (7) は掘っても段階が上がらない (MINE_RATE[7] = 0) ので、その採掘を「迎撃の備蓄」に充てる。
 * 年に一度、脈から WORKS_RATE の輝石を備蓄に積み、INTERCEPT_NEED に達したら迎撃できる。
 * 信仰が WORKS_FAITH 未満の年は工事が止まる (民が働かない)。World には依存しない純粋関数群。
 */

/** 工事が進むのに要る信仰。勅令の門 (EDICT_FAITH) と同じ値 */
export const WORKS_FAITH = 0.6;
/**
 * 年に備蓄に積む輝石の量 (脈の残量がこれより少なければ残量だけ)。塔 (6) の年間の採掘量 (MINE_RATE[6] × 360 tick = 0.36) に揃える。
 * 校正 (M10): 0.2 では星の民が塔より掘らなくなり、霊脈枯れで苔を放ち続けて星に上がった民の脈が 100 年で残ってしまった
 */
export const WORKS_RATE = MINE_RATE[6] * 360;
/** 迎撃 1 回に要る備蓄 */
export const INTERCEPT_NEED = 3.0;

export type WorksState = NonNullable<CivState['works']>;

/**
 * 年に一度呼ぶ。星でなければ何もしない (works も付けない)。信仰不足なら stopped = true で掘らない。
 * 備蓄が INTERCEPT_NEED に達しても掘り続ける (M10 の通し実行で発覚: 備蓄で止めると「星になれば掘らなくなる」ので、
 * 霊脈枯れで苔を放ち続けるだけ (儀式) の民が星に上がって脈が残り、勅令の意味が消えた。民は勝手に掘る、が M9 の前提)。
 * crystal は呼び出し元の配列をその場で書き換える (stepMining と同じ流儀)。
 * 勅令「採掘を止めよ」(miningStopped) は工事の採掘も止める (M10R-05: 信仰の上限が入ると、脈が 10% を切ったあとの「星の砂を」の
 * 無視で上限が削れて工事が止まり、星が掘り続ける限りどの手も滅びた。民が掘るのをやめれば備蓄は残り、迎撃はできる)。
 */
export function stepWorks(
  civ: CivState,
  crystal: Float32Array,
  elevation: Float32Array,
  size: number,
  veins?: { ids: Int32Array; cells: number[][] },
): { civ: CivState; mined: number } {
  if (civ.stage < MAX_STAGE || civ.home < 0) return { civ, mined: 0 };
  const works: WorksState = civ.works ?? { stock: 0, stopped: false };
  if ((civ.faith ?? 0) < WORKS_FAITH) return { civ: { ...civ, works: { ...works, stopped: true } }, mined: 0 };
  // 勅令で止まっている間は掘らない (M10R-05)。stopped は「信仰不足で民が働かない」の印なので立てない
  if (civ.miningStopped) return { civ: { ...civ, works: { ...works, stopped: false } }, mined: 0 };
  const pool = miningPool(civ.home, MINE_RADIUS[MAX_STAGE], elevation, size, veins);
  let total = 0;
  for (const i of pool) total += crystal[i];
  const mined = Math.max(0, Math.min(WORKS_RATE, total));
  // 残量に比例して取り除く (気象塔の takeCrystal と同じ。M10 レビューで一本化)
  if (mined > 0) takeCrystal(pool, crystal, mined);
  return { civ: { ...civ, works: { stock: works.stock + mined, stopped: false } }, mined };
}

/** 迎撃できるか。できなければ理由 (cmd.rejected と石板に出す) */
export function canIntercept(civ: CivState | null): { ok: true } | { ok: false; reason: string } {
  if (!civ || civ.stage < 1) return { ok: false, reason: '文明がない' };
  if (civ.stage < MAX_STAGE) return { ok: false, reason: '段階が星に満たない' };
  const stock = civ.works?.stock ?? 0;
  if (stock < INTERCEPT_NEED) return { ok: false, reason: `備蓄が足りない (${stock.toFixed(2)} / ${INTERCEPT_NEED})` };
  return { ok: true };
}

/** 迎撃する。備蓄を INTERCEPT_NEED 減らし、回数を 1 増やす。canIntercept が ok のときだけ呼ぶ */
export function applyIntercept(civ: CivState): CivState {
  const works = civ.works ?? { stock: 0, stopped: false };
  return { ...civ, works: { ...works, stock: works.stock - INTERCEPT_NEED }, intercepted: (civ.intercepted ?? 0) + 1 };
}
