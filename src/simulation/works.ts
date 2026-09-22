import { MAX_STAGE, MINE_RADIUS, miningPool, type CivState } from './civilization';

/**
 * 星の工事と迎撃 (M10-02)。設計: docs/design/2026-09-22-level-design-devices.md §3.2。
 * 星 (7) は掘っても段階が上がらない (MINE_RATE[7] = 0) ので、その採掘を「迎撃の備蓄」に充てる。
 * 年に一度、脈から WORKS_RATE の輝石を備蓄に積み、INTERCEPT_NEED に達したら迎撃できる。
 * 信仰が WORKS_FAITH 未満の年は工事が止まる (民が働かない)。World には依存しない純粋関数群。
 */

/** 工事が進むのに要る信仰。勅令の門 (EDICT_FAITH) と同じ値 */
export const WORKS_FAITH = 0.6;
/** 年に備蓄に積む輝石の量 (脈の残量がこれより少なければ残量だけ) */
export const WORKS_RATE = 0.2;
/** 迎撃 1 回に要る備蓄 */
export const INTERCEPT_NEED = 3.0;

export type WorksState = NonNullable<CivState['works']>;

/**
 * 年に一度呼ぶ。星でなければ何もしない (works も付けない)。
 * 備蓄が INTERCEPT_NEED に達していれば掘らない (脈を無駄に減らさない)。信仰不足なら stopped = true で掘らない。
 * crystal は呼び出し元の配列をその場で書き換える (stepMining と同じ流儀)。
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
  if (works.stock >= INTERCEPT_NEED) return { civ: { ...civ, works: { ...works, stopped: false } }, mined: 0 };
  if ((civ.faith ?? 0) < WORKS_FAITH) return { civ: { ...civ, works: { ...works, stopped: true } }, mined: 0 };
  const pool = miningPool(civ.home, MINE_RADIUS[MAX_STAGE], elevation, size, veins);
  let total = 0;
  for (const i of pool) total += crystal[i];
  const mined = Math.max(0, Math.min(WORKS_RATE, total, INTERCEPT_NEED - works.stock));
  if (mined > 0) {
    const k = mined / total;
    for (const i of pool) if (crystal[i] > 0) crystal[i] -= crystal[i] * k;
  }
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
