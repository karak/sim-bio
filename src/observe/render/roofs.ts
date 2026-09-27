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
// (M22-07 の 3 回目で変更: propPoints は石垣・柱 (props) の天端の点。屋根の点とは別に、跳ね返りの一部を寄せる)
export type Surface = { at: SurfaceAt; roofPoints: Float32Array; propPoints: Float32Array };

/**
 * (M22-07 の 3 回目、雨「跳ね返りの対象を石垣と柱に広げて」) 屋根と同じく真上から光線を落として天端の高さを焼く部品の組。
 * node は置き場所 sites に並べた描かない複製 (instanceProps)、表は置き場所ごとに中心から reach m の四角を propStep m おき。
 * 石垣 (高さ 1 m、厚み 0.6 m)・灯り柱 (天端 0.6 m 角)・立石・衝立の柱は小さいので、屋根 (0.5 m おき) より細かい目で焼く
 */
export type SurfaceProps = { sites: readonly { x: number; z: number }[]; node: Object3D; reach: number };

/** 光線を落として当たった高さの表 (地面から 0.3 m 未満の当たりと当たらない目は NaN) */
type Grid = { x: number; z: number; reach: number; step: number; n: number; g: Float32Array };

function bakeGrids(heightAt: (x: number, z: number) => number, node: Object3D, sites: readonly { x: number; z: number }[], reach: number, step: number): Grid[] {
  node.updateMatrixWorld(true);
  // 絵で切り抜く材質 (屋根板・蔦のカード) は instanceProps が光線の当たり判定から外すので、この複製 (描かない) では当たるように戻す
  node.traverse((o) => {
    if (Object.prototype.hasOwnProperty.call(o, 'raycast')) delete (o as { raycast?: unknown }).raycast;
  });
  const top = new Box3().setFromObject(node).max.y + 1;
  const n = Math.ceil((reach * 2) / step) + 1;
  const ray = new Raycaster();
  const from = new Vector3();
  const down = new Vector3(0, -1, 0);
  const bake = (h: { x: number; z: number }): Grid => {
    const g = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = h.x - reach + i * step;
        const z = h.z - reach + j * step;
        ray.set(from.set(x, top, z), down);
        const hit = ray.intersectObject(node, true)[0];
        const ground = heightAt(x, z);
        g[j * n + i] = hit && hit.point.y > ground + 0.3 ? hit.point.y : Number.NaN;
      }
    }
    return { x: h.x, z: h.z, reach, step, n, g };
  };
  return sites.map(bake);
}

function gridPoints(grids: readonly Grid[]): Float32Array {
  const pts: number[] = [];
  for (const { x, z, reach, step, n, g } of grids) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (!Number.isNaN(g[j * n + i])) pts.push(x - reach + i * step, g[j * n + i], z - reach + j * step);
  }
  return new Float32Array(pts);
}

// (M22-07 の 3 回目で変更: props (石垣・柱) も同じ仕組みで焼く。高さは小屋の屋根を先に、次に props、どちらも無ければ地面)
export function createSurface(
  heightAt: (x: number, z: number) => number,
  huts: readonly { x: number; z: number }[],
  roofs: Object3D | null,
  reach = 9,
  step = 0.5,
  props: readonly SurfaceProps[] = [],
  propStep = 0.2,
): Surface {
  const roofGrids = roofs && huts.length > 0 ? bakeGrids(heightAt, roofs, huts, reach, step) : [];
  const propGrids = props.flatMap((p) => (p.sites.length ? bakeGrids(heightAt, p.node, p.sites, p.reach, propStep) : []));
  const grids = [...roofGrids, ...propGrids];
  if (grids.length === 0) return { at: heightAt, roofPoints: new Float32Array(0), propPoints: new Float32Array(0) };
  const at: SurfaceAt = (x, z) => {
    for (let k = 0; k < grids.length; k++) {
      const h = grids[k];
      const i = Math.round((x - h.x + h.reach) / h.step);
      const j = Math.round((z - h.z + h.reach) / h.step);
      if (i < 0 || j < 0 || i >= h.n || j >= h.n) continue;
      const g = h.g;
      const y = g[j * h.n + i];
      if (!Number.isNaN(y)) return y;
    }
    return heightAt(x, z);
  };
  return { at, roofPoints: gridPoints(roofGrids), propPoints: gridPoints(propGrids) };
}
