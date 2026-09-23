import { BufferAttribute, BufferGeometry, Color, Mesh, type MeshToonMaterial } from 'three';
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
  // (草の磨き上げ) 茂った草地・乾いた暖かい草地・土の見える所・水際の湿り
  lush: new Color('#7AA64C'),
  warmDry: new Color('#A9A45E'),
  bareSoil: new Color('#8E7650'),
  damp: new Color('#5E7F43'),
};

/** 地面の色を決める本体の層 (草の磨き上げ: 草の根元の色を地面と同じ式で決めるため、地面と草で共有する) */
export type GroundLayers = { grass?: Float32Array; belltree?: Float32Array; moss?: Float32Array; forest?: Float32Array };
export function groundLayers(s: WorldSnapshot): GroundLayers {
  const P = s.layers.populations;
  return { grass: P['grass'], belltree: P['belltree'], moss: P['moss'], forest: P['forest'] };
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 地面の絵の具のむら (草の磨き上げ、sheets/terrain の「茂った草地」「踏まれて土の出た草地」)。
 * dry: 40 m ほどの大きな斑で、乾いて暖かい草地 (1) と茂った草地 (0) を分ける。
 * bare: 15 m ほどの斑で、草が薄く土の見える所 (草の密度が低いほど出やすい)。
 * clump: 5 m ほどの斑で、草の房が寄り集まる所 (1) と疎らな所 (0)。草の置き方と丈に使う。
 * 地面の色と草の置き方が同じ値を見るので、土の見える所には草が少なく、茂った所は地面も濃い。
 */
export function groundPatch(x: number, z: number, grassDensity: number): { dry: number; bare: number; clump: number } {
  const dry = smooth(0.38, 0.66, fbm(x * 0.024 + 11.3, z * 0.024 - 5.7));
  const bare = smooth(0.6, 0.78, fbm(x * 0.065 + 3.1, z * 0.065 + 9.4) + (0.25 - Math.min(0.25, grassDensity)) * 0.5);
  const clump = smooth(0.3, 0.7, fbm(x * 0.19 - 2.3, z * 0.19 + 4.1));
  return { dry, bare, clump };
}

/** 細かな明るさのむら (terrain の頂点色と草の根元の色で同じ値を使う) */
export function groundJitter(x: number, z: number): number {
  return 0.92 + fbm(x * 0.21 + 7, z * 0.21 - 3) * 0.16;
}

/** 地面の基本の色 (明るさのむら groundJitter を掛ける前)。h は heightAt(x, z) */
export function groundBase(field: TerrainField, L: GroundLayers, x: number, z: number, h: number, out: Color): Color {
  const slope = Math.hypot(field.heightAt(x + 1, z) - h, field.heightAt(x, z + 1) - h);
  const g = L.grass ? field.layerAt(L.grass, x, z) : 0;
  const b = L.belltree ? field.layerAt(L.belltree, x, z) : 0;
  const m = L.moss ? field.layerAt(L.moss, x, z) : 0;
  const f = L.forest ? field.layerAt(L.forest, x, z) : 0;
  const c = out;
  if (h < 0) c.copy(C.wetSand);
  else if (h < 1.2) c.copy(C.sand).lerp(C.meadow, Math.max(0, (h - 0.6) / 0.6) * 0.6);
  else {
    c.copy(C.soil).lerp(C.dryGrass, Math.min(1, g * 3 + 0.25)).lerp(C.meadow, Math.min(1, g * 2.5));
    c.lerp(C.moss, Math.min(0.45, m * 0.4));
    // (草の磨き上げ) 大きな斑で茂った草地と乾いた草地を塗り分け、小さな斑で土をのぞかせる
    const p = groundPatch(x, z, g);
    c.lerp(C.lush, (1 - p.dry) * 0.35).lerp(C.warmDry, p.dry * 0.35);
    c.lerp(C.bareSoil, p.bare * 0.5);
    // 水際の少し上 (1.2〜3 m) は湿って濃い
    c.lerp(C.damp, (1 - smooth(1.2, 3.2, h)) * 0.35);
    c.lerp(C.forestFloor, Math.min(0.75, b * 1.3 + f * 0.9));
  }
  c.lerp(C.rock, Math.min(1, Math.max(0, (slope - 0.35) * 2.5)));
  return c;
}

/** 地面の色 (groundBase × groundJitter)。草の根元と遠くの草はこの色に溶ける */
export function groundColorAt(field: TerrainField, L: GroundLayers, x: number, z: number, out: Color): Color {
  const h = field.heightAt(x, z);
  groundBase(field, L, x, z, h, out);
  return out.multiplyScalar(groundJitter(x, z));
}

/** 踏み固めた所 (草の磨き上げ: 集落の広場・戸口・船台への道)。a から b への線分の周り半径 r、縁はノイズで揺らす */
export type Worn = { ax: number; az: number; bx: number; bz: number; r: number };
export function wearAt(worn: readonly Worn[], x: number, z: number): number {
  let w = 0;
  for (const s of worn) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / len2)) : 0;
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
    const edge = s.r * (0.75 + fbm(x * 0.3 + 1.7, z * 0.3 - 8.2) * 0.5);
    w = Math.max(w, 1 - smooth(edge * 0.55, edge, d));
  }
  return w;
}
/** 踏み固めた土の色 (草が擦り切れて土と短い草が混じる) */
export const TRAMPLED = new Color('#8C7A55');
/** 地面の頂点色に踏み固めた所を塗る (createTerrainMesh の後に、集落の目印が決まってから呼ぶ) */
export function wearTerrain(mesh: Mesh, worn: readonly Worn[]): void {
  const pos = mesh.geometry.getAttribute('position');
  const col = mesh.geometry.getAttribute('color');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 1.2) continue;
    const w = wearAt(worn, pos.getX(i), pos.getZ(i));
    if (w <= 0) continue;
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(TRAMPLED, w * 0.7);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

/**
 * 地面の筆のむら (草の磨き上げ)。頂点色 (1.7 m おき) より細かい 0.5〜3 m の斑を、画素ごとに世界座標の値ノイズで足す。
 * 片方向に伸ばした斑で筆の跡のように見せ、明るさ ±6% と、暗い所は青緑・明るい所は黄へ少し色を振る。
 */
function paintedGround(mat: MeshToonMaterial): MeshToonMaterial {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vGroundW;',
          'float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
          'float gNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
          '  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y); }',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec2 gp = vGroundW.xz;',
          'float gn = gNoise(vec2(gp.x * 0.9 + gp.y * 0.35, gp.y * 0.28 - gp.x * 0.1)) * 0.6 + gNoise(gp * 1.7 + 13.0) * 0.4 - 0.5;',
          'diffuseColor.rgb *= 1.0 + gn * 0.12;',
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 1.0, 1.02), clamp(-gn * 2.0, 0.0, 1.0));',
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.02, 0.9), clamp(gn * 2.0, 0.0, 1.0));',
          // 近く (25 m まで) の草地には 15 cm ほどの細かな斑を足し、房の間の地面を短い草の絨毯に見せる (遠くはちらつくので消す)
          'float gGreen = clamp((diffuseColor.g - diffuseColor.r) * 8.0, 0.0, 1.0);',
          'float gNear = 1.0 - smoothstep(10.0, 25.0, length(vViewPosition));',
          'float gFine = gNoise(vec2(gp.x * 7.0 + gp.y * 2.0, gp.y * 7.0 - gp.x * 2.0)) - 0.5;',
          'diffuseColor.rgb *= 1.0 + gFine * 0.16 * gGreen * gNear;',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => 'observe-ground';
  return mat;
}

/** 区域の地面 (高解像度) を作る。頂点色は植生・苔・鐘樹・海からの高さ・傾きで塗り分ける (色味は sheets/terrain) */
// (草の磨き上げ: 色の式は groundBase・groundJitter に移し、草の根元の色と共有する。森の木の陰も濃くする)
export function createTerrainMesh(s: WorldSnapshot, field: TerrainField): Mesh {
  const span = field.window * 2 + 1;
  const n = span * SUB + 1;
  const half = (span * CELL_M) / 2;
  const step = (span * CELL_M) / (n - 1);
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const layers = groundLayers(s);
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
      groundBase(field, layers, x, z, h, c);
      // 同じ色が広く続くと CG に見えるので、ノイズで明るさを揺らす (紙の上の絵の具のむら)
      const jitter = groundJitter(x, z);
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
  const mesh = new Mesh(geo, paintedGround(createToonMaterial({ vertexColors: true, rim: 0.08 })));
  mesh.receiveShadow = true;
  mesh.name = 'observe-terrain';
  return mesh;
}
