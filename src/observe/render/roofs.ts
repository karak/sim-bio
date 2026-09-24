import { Box3, Raycaster, Vector3, type Object3D } from 'three';

/**
 * 雨の跳ね返りを置く面の高さ (M22-07 の手直し、審査台 2026-09-24 20:25 の判断「屋根や地面での跳ね返りがない」)。
 * 小屋の周り (中心から reach m の四角) は、屋根の形 roofs に真上から光線を落とした高さの表 (step m おき) を、作るときに小屋ごとに焼く
 * (1 棟 55 ms ほど。雨が降り出したときに焼くとコマが詰まるので、読み込みの間に焼く)。
 * 小屋の外、屋根の無い所 (地面から 0.3 m 未満の当たり) は地面の高さ heightAt。
 * 表は近い形 (hut) で焼く (遠距離版 hut_lod1 は屋根が近い形より低く、近くで見ると跳ね返りが屋根に埋もれる)。1 棟 37 × 37 本の光線を一度だけ
 */
export type SurfaceAt = (x: number, z: number) => number;
/** 面の高さと、屋根の上の点 (表の目のうち屋根に当たった所、x・y・z の並び)。雨の跳ね返りの一部を屋根に寄せて置くのに使う */
export type Surface = { at: SurfaceAt; roofPoints: Float32Array };

export function createSurface(heightAt: (x: number, z: number) => number, huts: readonly { x: number; z: number }[], roofs: Object3D | null, reach = 9, step = 0.5): Surface {
  if (!roofs || huts.length === 0) return { at: heightAt, roofPoints: new Float32Array(0) };
  roofs.updateMatrixWorld(true);
  // 絵で切り抜く材質 (屋根板・蔦のカード) は instanceProps が光線の当たり判定から外すので、この複製 (描かない) では当たるように戻す
  roofs.traverse((o) => {
    if (Object.prototype.hasOwnProperty.call(o, 'raycast')) delete (o as { raycast?: unknown }).raycast;
  });
  const top = new Box3().setFromObject(roofs).max.y + 1;
  const n = Math.ceil((reach * 2) / step) + 1;
  const ray = new Raycaster();
  const from = new Vector3();
  const down = new Vector3(0, -1, 0);
  const bake = (h: { x: number; z: number }) => {
    const g = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = h.x - reach + i * step;
        const z = h.z - reach + j * step;
        ray.set(from.set(x, top, z), down);
        const hit = ray.intersectObject(roofs, true)[0];
        const ground = heightAt(x, z);
        g[j * n + i] = hit && hit.point.y > ground + 0.3 ? hit.point.y : Number.NaN;
      }
    }
    return g;
  };
  const grids = huts.map(bake);
  const pts: number[] = [];
  grids.forEach((g, k) => {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (!Number.isNaN(g[j * n + i])) pts.push(huts[k].x - reach + i * step, g[j * n + i], huts[k].z - reach + j * step);
  });
  const at: SurfaceAt = (x, z) => {
    for (let k = 0; k < huts.length; k++) {
      const h = huts[k];
      const i = Math.round((x - h.x + reach) / step);
      const j = Math.round((z - h.z + reach) / step);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const g = grids[k];
      const y = g[j * n + i];
      if (!Number.isNaN(y)) return y;
    }
    return heightAt(x, z);
  };
  return { at, roofPoints: new Float32Array(pts) };
}
