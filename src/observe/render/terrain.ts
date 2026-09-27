import { BufferAttribute, BufferGeometry, Color, Mesh, type MeshToonMaterial } from 'three';
import type { WorldSnapshot } from '../../simulation/types';
import { SEA_LEVEL } from '../../simulation/terrain';
import { createToonMaterial } from './toon';
import { RELIEF, groundDetailTexture } from './groundDetail';

/** 1 セル = 10 m (設計 §1) */
export const CELL_M = 10;
/** 標高 → メートル。本体の起伏 (区域で 0.27) は小さいので、設計 §5 のとおり 60 m × 1.6 に強調する */
export const ELEV_M = 96;
/** 1 セルを何分割して地面を作るか */
const SUB = 6;

/**
 * (M23-03 のやり直し) 地面の頂点の格子 (createTerrainMesh と同じ数え方)。頂点 i の x は −half + i × step (z も同じ)。
 * 海は水深を画素ごとにこの格子・同じ三角形の切り方で読み、水際を描いた地面の形に合わせる
 */
export function terrainGrid(field: Pick<TerrainField, 'window'>): { n: number; half: number; step: number } {
  const span = field.window * 2 + 1;
  const n = span * SUB + 1;
  return { n, half: (span * CELL_M) / 2, step: (span * CELL_M) / (n - 1) };
}

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

/**
 * 地面の質感の種類の重み (地面の質感): [草地の土, むき出しの土 (踏み固めた道・広場・土の見える斑), 砂 (浜と浅瀬), 岩 (急な斜面)]。合計は 1。
 * 頂点ごとに持たせ、シェーダ (paintedGround) が種類ごとの起伏 (土の塊・小石・風紋・割れ目) の混ぜ方を決める。色の塗り分け (groundBase) と同じ高さ・傾き・斑を見る
 */
export type GroundKind = [grass: number, bare: number, sand: number, rock: number];
export function groundKind(field: TerrainField, L: GroundLayers, x: number, z: number, h: number): GroundKind {
  const slope = Math.hypot(field.heightAt(x + 1, z) - h, field.heightAt(x, z + 1) - h);
  const rock = Math.min(1, Math.max(0, (slope - 0.35) * 2.5));
  const sand = (1 - smooth(0.6, 1.3, h)) * (1 - rock);
  const g = L.grass ? field.layerAt(L.grass, x, z) : 0;
  const bare = h < 1.2 ? 0 : groundPatch(x, z, g).bare * 0.45 * (1 - rock - sand);
  return [Math.max(0, 1 - rock - sand - bare), bare, sand, rock];
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
  // (地面の質感) 踏み固めた所は質感もむき出しの土 (小石) へ寄せる
  const kind = mesh.geometry.getAttribute('groundKind');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 1.2) continue;
    const w = wearAt(worn, pos.getX(i), pos.getZ(i));
    if (w <= 0) continue;
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(TRAMPLED, w * 0.7);
    col.setXYZ(i, c.r, c.g, c.b);
    if (kind) {
      const t = w * 0.9;
      const rock = kind.getW(i);
      const soil = 1 - rock;
      kind.setXYZW(i, kind.getX(i) * (1 - t), kind.getY(i) * (1 - t) + soil * t, kind.getZ(i) * (1 - t), rock);
    }
  }
  col.needsUpdate = true;
  if (kind) kind.needsUpdate = true;
}

/**
 * 地面の質感 (2026-09-24 審査台 t03-coast「もういっぽざらつきや凹凸などの質感がほしい」)。
 * 質感の升 (groundDetail.ts) を世界座標で 2 つの大きさ (近い 5 m 升・広い 13 m 升を 34° 回す、繰り返しを目立たせない) に敷き、
 * 種類の重み (草地の土・むき出しの土・砂・岩) で起伏の高さを混ぜる。3 点で読んだ差から傾きを出して法線を揺らし (日の当たる稜と陰の窪み)、
 * 高さで窪みを暗く・盛り上がりを明るくする (筆で置いた陰)。近い升は 18〜45 m、広い升は 40〜110 m で消し (ちらつき・モアレを避ける)、
 * 升はミップマップなので遠いほど均される。形 (三角形) は変えない (水たまり・草・動物の足は heightAt のまま地面に乗る)。
 */
/** GLSL の浮動小数の書き方 (整数も 1.0 のように小数点を付ける) */
const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const glslList = (ns: readonly number[]) => ns.map(glslFloat).join(', ');
const GROUND_DETAIL_PARS = [
  'uniform sampler2D uGroundDetail;',
  'varying vec4 vGroundK;',
  // 種類ごとの起伏の高さ (m)。列は升の組 (R 土の塊・G 小石・B 風紋・A 岩)。近い升と広い升で分ける
  // (2026-09-25 で変更: 値は groundDetail.ts の RELIEF から。前は mat4(0.11, 0.0, 0.0, 0.0,  0.05, 0.06, 0.0, 0.0,  0.0, 0.0, 0.05, 0.0,  0.0, 0.0, 0.0, 0.2) と
  // mat4(0.22, 0.0, 0.0, 0.0,  0.14, 0.0, 0.0, 0.0,  0.03, 0.0, 0.08, 0.0,  0.0, 0.0, 0.0, 0.5))
  `const mat4 G_AMP_NEAR = mat4(${glslList(RELIEF.ampNear)});`,
  `const mat4 G_AMP_FAR = mat4(${glslList(RELIEF.ampFar)});`,
  // 窪みの陰の強さ (種類ごと): 草地の土・むき出しの土・砂・岩
  // (2026-09-25 で変更: 前は vec4(0.3, 0.38, 0.22, 0.55))
  `const vec4 G_CAVITY = vec4(${glslList(RELIEF.cavity)});`,
].join('\n');
const GROUND_DETAIL_COLOR = [
  'float gDist = length(vViewPosition);',
  'float gFadeN = 1.0 - smoothstep(18.0, 45.0, gDist);',
  'float gFadeF = 1.0 - smoothstep(40.0, 110.0, gDist);',
  'vec4 gK = vGroundK / max(1e-3, dot(vGroundK, vec4(1.0)));',
  'const float gE = 1.5 / 256.0;',
  'vec2 gUn = gp / 5.0;',
  'vec2 gUf = mat2(0.829, -0.559, 0.559, 0.829) * gp / 13.0;',
  'vec4 gN0 = texture2D(uGroundDetail, gUn);',
  'vec4 gNx = texture2D(uGroundDetail, gUn + vec2(gE, 0.0));',
  'vec4 gNz = texture2D(uGroundDetail, gUn + vec2(0.0, gE));',
  'vec4 gF0 = texture2D(uGroundDetail, gUf);',
  'vec4 gFx = texture2D(uGroundDetail, gUf + vec2(gE, 0.0));',
  'vec4 gFz = texture2D(uGroundDetail, gUf + vec2(0.0, gE));',
  'vec4 gAmpN = G_AMP_NEAR * gK * gFadeN;',
  'vec4 gAmpF = G_AMP_FAR * gK * gFadeF;',
  // 傾き (高さ m / 世界の m)。広い升は回した座標の傾きを世界へ戻す
  'vec2 gGrad = vec2(dot(gNx - gN0, gAmpN), dot(gNz - gN0, gAmpN)) / (gE * 5.0);',
  'gGrad += mat2(0.829, 0.559, -0.559, 0.829) * (vec2(dot(gFx - gF0, gAmpF), dot(gFz - gF0, gAmpF)) / (gE * 13.0));',
  // 窪みの陰: 種類ごとに見る組の高さ (0.5 が平ら) を混ぜる
  'vec4 gSelN = vec4(gK.x + gK.y * 0.5, gK.y * 0.5, gK.z, gK.w);',
  'vec4 gSelF = vec4(gK.x + gK.y, 0.0, gK.z, gK.w);',
  'vec4 gMid = vec4(0.45, 0.36, 0.5, 0.5);',
  'float gHn = dot(gN0 - gMid, gSelN) * gFadeN + dot(gF0 - gMid, gSelF) * gFadeF * 0.8;',
  // (2026-09-25 で変更: 倍率と上下限は RELIEF (cavityShade と同じ式)。前は 1.6、0.55〜1.25)
  `diffuseColor.rgb *= clamp(1.0 + gHn * dot(G_CAVITY, gK) * ${glslFloat(RELIEF.gain)}, ${glslFloat(RELIEF.shadeMin)}, ${glslFloat(RELIEF.shadeMax)});`,
  // 小石は土より明るい灰色に (近い升だけ)
  'float gPebble = smoothstep(0.42, 0.6, gN0.g) * gK.y * gFadeN;',
  'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2))) * vec3(1.28, 1.24, 1.16), gPebble * 0.35);',
].join('\n');
const GROUND_DETAIL_NORMAL = [
  '{',
  '  vec3 gNw = inverseTransformDirection(normal, viewMatrix);',
  '  vec3 gG = vec3(gGrad.x, 0.0, gGrad.y);',
  '  gG -= gNw * dot(gG, gNw);',
  '  gNw = normalize(gNw - gG);',
  '  normal = normalize((viewMatrix * vec4(gNw, 0.0)).xyz);',
  '}',
].join('\n');

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
          GROUND_DETAIL_COLOR,
        ].join('\n'),
      )
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GROUND_DETAIL_NORMAL}`);
    // (地面の質感) 種類の重み (groundKind) と質感の升
    shader.uniforms.uGroundDetail = { value: groundDetailTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 groundKind;\nvarying vec4 vGroundK;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundK = groundKind;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${GROUND_DETAIL_PARS}`);
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
  // (地面の質感) 頂点ごとの質感の種類の重み (groundKind)
  const kind = new Float32Array(n * n * 4);
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
      kind.set(groundKind(field, layers, x, z, h), (j * n + i) * 4);
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
  geo.setAttribute('groundKind', new BufferAttribute(kind, 4));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, paintedGround(createToonMaterial({ vertexColors: true, rim: 0.08 })));
  mesh.receiveShadow = true;
  mesh.name = 'observe-terrain';
  return mesh;
}
