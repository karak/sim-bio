/**
 * 集落の小屋の置き方 (M22-06、集落の建物の作り直し)。純粋関数のみ (Three.js・DOM に依存しない)。
 *
 * 小屋 (settlement.glb の hut) は戸口がノードの +Z を向き、炉は中心から戸口の側へ HEARTH_M の所にある。
 * 小屋は戸口を広場へ向けて置く (広場から小屋へ踏み固めた道が、戸口の敷石で終わる)。
 * 斜面では戸口の外の地面が中心より高いことがあるので、小屋の高さは中心と戸口の外の高い方に合わせる
 * (小屋は壁と柱の下に 1 m の石の土台を持つので、下り側は土台が覗く)。
 * 戸口から広場へ下りる敷石 (stepping_stone) は、斜面に沿うよう 1 枚ずつ地面に置く。
 * 炉の位置は夜の灯りの溜まり (motes.ts) を置くのに使う。
 */

/** 集落の中心からの小屋の位置 (m)。広場と戸口への道 (view.ts の worn) もこの点へ引く */
export const HUT_OFFSETS: readonly (readonly [number, number])[] = [
  [-14, -8],
  [12, -12],
  [-4, -20],
];

/** 小屋の中心から炉までの距離 (m、戸口の側)。observe_settlement.py の炉 (Blender の y = −0.3) と同じ */
export const HEARTH_M = 0.3;
/** 高さを合わせる戸口の外の点 (中心から m) */
export const DOOR_M = 1.8;
/** 地面から沈める深さ (m)。他の集落の部品 (view.ts の place) と同じ */
export const SINK_M = 0.15;
/** 戸口の外に合わせて上げる高さの上限 (m)。土台 (1 m) が浮かないように */
export const MAX_LIFT_M = 0.8;
/** 敷石の中心から戸口の外への距離 (m) と横のずれ・向き */
const STEPS: readonly (readonly [number, number, number])[] = [
  [2.1, 0.08, 0.14],
  [2.75, -0.12, -0.2],
  [3.4, 0.1, 0.35],
];

export type HutPlacement = {
  x: number;
  z: number;
  /** 小屋の原点の高さ (中心と戸口の外の地面の高い方 − SINK_M、中心から MAX_LIFT_M まで) */
  y: number;
  /** Y 軸まわりの回転 (ラジアン)。ノードの +Z (戸口) が (sin ry, cos ry) を向く */
  ry: number;
  /** 炉の位置 (夜の灯りの溜まりを置く) */
  hearth: { x: number; z: number };
  /** 戸口から広場へ下りる敷石 (位置と Y 軸まわりの回転) */
  steps: { x: number; z: number; ry: number }[];
};

/** 集落の中心 center のまわりに小屋を置き、戸口を広場 plaza へ向ける。heightAt は地面の高さ */
export function hutPlacements(
  center: { x: number; z: number },
  plaza: { x: number; z: number },
  heightAt: (x: number, z: number) => number,
): HutPlacement[] {
  return HUT_OFFSETS.map(([dx, dz]) => {
    const x = center.x + dx;
    const z = center.z + dz;
    const ry = Math.atan2(plaza.x - x, plaza.z - z);
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    const ground = heightAt(x, z);
    const door = heightAt(x + fx * DOOR_M, z + fz * DOOR_M);
    const y = Math.min(Math.max(ground, door), ground + MAX_LIFT_M) - SINK_M;
    const steps = STEPS.map(([d, side, rot]) => ({ x: x + fx * d + fz * side, z: z + fz * d - fx * side, ry: ry + rot }));
    return { x, z, y, ry, hearth: { x: x + fx * HEARTH_M, z: z + fz * HEARTH_M }, steps };
  });
}
