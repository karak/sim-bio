import { BufferAttribute, BufferGeometry, Color, Mesh } from 'three';
import type { WorldSnapshot } from '../../simulation/types';
import { SEA_LEVEL } from '../../simulation/terrain';
import { createToonMaterial } from './toon';

/** 1 セル = 10 m (設計 §1) */
export const CELL_M = 10;
/** 標高 → メートル。本体の起伏 (区域で 0.27) は小さいので、設計 §5 のとおり 60 m × 1.6 に強調する */
export const ELEV_M = 96;
/** 1 セルを何分割して地面を作るか */
const SUB = 6;

export type TerrainField = {
  /** 区域の中心 (集落) のセル */
  home: number;
  /** 窓の半径 (セル)。区域 (半径 8) の外に縁を足した範囲まで地面を作る */
  window: number;
  heightAt(x: number, z: number): number;
  /** ワールド座標 (m) の点の、セル単位の層の値 (双線形) */
  layerAt(layer: Float32Array, x: number, z: number): number;
  size: number;
};

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** 決定論の値ノイズ。地面の小さな起伏に使う (本体の標高の上に 1 m 未満) */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number): number {
  return valueNoise(x, y) * 0.6 + valueNoise(x * 2.1, y * 2.1) * 0.3 + valueNoise(x * 4.3, y * 4.3) * 0.1;
}

export function createTerrainField(s: WorldSnapshot, home: number, window: number): TerrainField {
  const size = s.size;
  const hx = home % size;
  const hy = Math.floor(home / size);
  const at = (layer: Float32Array, cx: number, cy: number) => layer[Math.min(size - 1, Math.max(0, cy)) * size + Math.min(size - 1, Math.max(0, cx))];
  // ワールド (m) → 連続セル座標 (セル中心が整数)
  const toCell = (x: number, z: number) => [x / CELL_M + hx, z / CELL_M + hy] as const;
  const elevAt = (x: number, z: number) => {
    const [fx, fy] = toCell(x, z);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const e = s.layers.elevation;
    const row = (dy: number) => catmull(at(e, ix - 1, iy + dy), at(e, ix, iy + dy), at(e, ix + 1, iy + dy), at(e, ix + 2, iy + dy), tx);
    return catmull(row(-1), row(0), row(1), row(2), ty);
  };
  return {
    home,
    window,
    size,
    heightAt(x, z) {
      const h = (elevAt(x, z) - SEA_LEVEL) * ELEV_M;
      // 陸だけに小さな起伏を足す (水際は滑らかに)
      const land = Math.min(1, Math.max(0, h / 2));
      return h + (fbm(x * 0.08, z * 0.08) - 0.5) * 1.6 * land;
    },
    layerAt(layer, x, z) {
      const [fx, fy] = toCell(x, z);
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const a = at(layer, ix, iy);
      const b = at(layer, ix + 1, iy);
      const c = at(layer, ix, iy + 1);
      const d = at(layer, ix + 1, iy + 1);
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    },
  };
}

const C = {
  sand: new Color('#E2CC98'),
  wetSand: new Color('#A99466'),
  meadow: new Color('#8DB35C'),
  dryGrass: new Color('#B8B46A'),
  forestFloor: new Color('#4E6A37'),
  moss: new Color('#5F9443'),
  soil: new Color('#8A6F4E'),
  rock: new Color('#9A9486'),
};

/** 区域の地面 (高解像度) を作る。頂点色は植生・苔・鐘樹・海からの高さ・傾きで塗り分ける (色味は sheets/terrain) */
export function createTerrainMesh(s: WorldSnapshot, field: TerrainField): Mesh {
  const span = field.window * 2 + 1;
  const n = span * SUB + 1;
  const half = (span * CELL_M) / 2;
  const step = (span * CELL_M) / (n - 1);
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const L = s.layers;
  const grass = L.populations['grass'];
  const belltree = L.populations['belltree'];
  const moss = L.populations['moss'];
  const c = new Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const h = field.heightAt(x, z);
      const k = (j * n + i) * 3;
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = z;
      const slope = Math.hypot(field.heightAt(x + 1, z) - h, field.heightAt(x, z + 1) - h);
      const g = grass ? field.layerAt(grass, x, z) : 0;
      const b = belltree ? field.layerAt(belltree, x, z) : 0;
      const m = moss ? field.layerAt(moss, x, z) : 0;
      if (h < 0) c.copy(C.wetSand);
      else if (h < 1.2) c.copy(C.sand).lerp(C.meadow, Math.max(0, (h - 0.6) / 0.6) * 0.6);
      else {
        c.copy(C.soil).lerp(C.dryGrass, Math.min(1, g * 3 + 0.25)).lerp(C.meadow, Math.min(1, g * 2.5));
        c.lerp(C.moss, Math.min(0.45, m * 0.4));
        c.lerp(C.forestFloor, Math.min(0.75, b * 1.3));
      }
      c.lerp(C.rock, Math.min(1, Math.max(0, (slope - 0.35) * 2.5)));
      // 同じ色が広く続くと CG に見えるので、ノイズで明るさを揺らす (紙の上の絵の具のむら)
      const jitter = 0.92 + fbm(x * 0.21 + 7, z * 0.21 - 3) * 0.16;
      col[k] = c.r * jitter;
      col[k + 1] = c.g * jitter;
      col[k + 2] = c.b * jitter;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      idx.set([a, d, b, b, d, e], t);
      t += 6;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, createToonMaterial({ vertexColors: true, rim: 0.08 }));
  mesh.receiveShadow = true;
  mesh.name = 'observe-terrain';
  return mesh;
}
