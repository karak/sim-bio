/**
 * 介入の場面の時間の形 (M22-07 の手直し、審査台 2026-09-24 20:25 の判断)。純粋関数のみ (Three.js・DOM に依存しない)。
 *
 * 契約:
 * - mistEnvelope(age): 疫病の霧の濃さ amount (0〜1) と、消えていく段 fade (0〜1)。全体は MIST_S 秒 (試作 3 の判断のまま)。
 *   立ち上がりに MIST_RISE_S 秒、MIST_S − MIST_LINGER_S まで満ち、最後の MIST_LINGER_S 秒は余韻 (fade が 0 → 1、
 *   amount はゆっくり尾を引いて 0 へ)。余韻の間、霧は筋に千切れ、薄く広がって少し持ち上がる (atmosphere.ts が fade を読む)。
 * - sproutBurst(rng, radiusM): 芽吹きの粒 1 つの飛び方。植えた点から水平に放射状に飛び出し (速さ speed、向き angle)、
 *   抗力 SPROUT_DRAG で止まるまでに進む距離は radiusM の 0.55〜1.35 倍 (= speed / SPROUT_DRAG)。上向きの初速 up で弧を描く。
 *   (M22-07 の 3 回目で変更: 進む距離は radiusM の SPROUT_REACH_MIN〜SPROUT_REACH_MAX (0.3〜1.0) 倍。粒は植えた円の中に収まり、外へ飛び出さない)
 * - wetness(prev, raining, dt): 雨の濡れ (水たまりの広がり、0〜1)。降っている間は WET_FILL_S 秒で満ち、止むと WET_DRY_S 秒で乾く。
 * - surgeStep(state, target, dt): 沈む海の海面と波立ち。見せる海面 level は target へ SURGE_RATE m/s で上がり
 *   (下がるときはすぐ)、上がっている間と上がり終えてから SURGE_HOLD_S 秒は surge (波立ちと流れ、0〜1) が 2.5 秒で 1 へ、
 *   そのあと SURGE_CALM_S 秒で静まる (本体の沈降は 1 tick ごとに少しずつなので、上がりが途切れ途切れでも波立ちを保つ)。
 */

export const MIST_S = 90;
export const MIST_RISE_S = 4;
export const MIST_LINGER_S = 32;

export type MistEnvelope = { amount: number; fade: number };
/**
 * (M22-07 の 3 回目、疫病の霧「螺旋の動きがみえない。」) 渦の腕が回る速さ (rad/s、負は腕が外から中心へ吸い込まれて見える向き)。
 * 2.5 秒で 60° 回り、見ていて回っているのが分かる (前は腕の位相の進みと回転が打ち消し合い、1 秒に 2° ほど)。render/atmosphere.ts の霧が使う
 */
export const MIST_SPIN = -0.42;

export function mistEnvelope(age: number): MistEnvelope {
  if (age <= 0 || age >= MIST_S) return { amount: 0, fade: age >= MIST_S ? 1 : 0 };
  const rise = Math.min(1, age / MIST_RISE_S);
  const linger0 = MIST_S - MIST_LINGER_S;
  if (age < linger0) return { amount: rise * rise * (3 - 2 * rise), fade: 0 };
  const f = (age - linger0) / MIST_LINGER_S;
  // 余韻: 初めはほとんど減らず (筋に千切れていく)、終わりに向かって薄れきる
  const amount = Math.pow(1 - f, 1.6) * (0.55 + 0.45 * Math.cos(f * Math.PI * 0.5));
  return { amount, fade: f };
}

export const SPROUT_DRAG = 2.2;
/** (M22-07 の 3 回目、芽吹き「放射が広すぎないか。草の周辺だけでいいのに」) 粒が止まるまでに進む距離の、植えた円の半径に対する倍率の幅 */
export const SPROUT_REACH_MIN = 0.3;
export const SPROUT_REACH_MAX = 1.0;

export type SproutParticle = { angle: number; speed: number; up: number; delay: number };

export function sproutBurst(rng: () => number, radiusM: number): SproutParticle {
  const reach = radiusM * (SPROUT_REACH_MIN + rng() * (SPROUT_REACH_MAX - SPROUT_REACH_MIN));
  // 放射の筋が揃って見えるよう、角度は 22 本の筋のまわりに寄せる (筋の間にもまばらに散らす)
  const ray = Math.floor(rng() * 22);
  const onRay = rng() < 0.7;
  const angle = onRay ? ((ray + 0.5) / 22) * Math.PI * 2 + (rng() - 0.5) * 0.05 : rng() * Math.PI * 2;
  return { angle, speed: reach * SPROUT_DRAG, up: 1.2 + rng() * 2.4, delay: rng() * rng() * 0.5 };
}

/** 抗力 drag で減速する水平の動き: t 秒後に進んだ距離 (speed / drag に近づく) */
export function sproutReach(speed: number, t: number): number {
  return (speed / SPROUT_DRAG) * (1 - Math.exp(-SPROUT_DRAG * Math.max(0, t)));
}

export const WET_FILL_S = 14;
export const WET_DRY_S = 40;

export function wetness(prev: number, raining: boolean, dt: number): number {
  return raining ? Math.min(1, prev + dt / WET_FILL_S) : Math.max(0, prev - dt / WET_DRY_S);
}

export const SURGE_RATE = 0.12;
export const SURGE_HOLD_S = 6;
export const SURGE_CALM_S = 24;

export type SurgeState = { level: number; surge: number; hold: number };

export function surgeStep(s: SurgeState, target: number, dt: number): SurgeState {
  if (target <= s.level) {
    const hold = Math.max(0, s.hold - dt);
    const surge = hold > 0 ? Math.min(1, s.surge + dt / 2.5) : Math.max(0, s.surge - dt / SURGE_CALM_S);
    return { level: target, surge, hold };
  }
  const level = Math.min(target, s.level + SURGE_RATE * dt);
  return { level, surge: Math.min(1, s.surge + dt / 2.5), hold: SURGE_HOLD_S };
}
