import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, FloatType, Mesh, NearestFilter, RGFormat } from 'three';
import { createToonMaterial } from './toon';
import { CELL_M, terrainGrid, type TerrainField } from './terrain';

/**
 * 海と池 (設計 §5)。水深で浅瀬の色 → 深い青、岸では泡。波は頂点シェーダで実時間に揺らす。
 * 沈降で海岸線が動くので、地面の heightAt から水深を焼く (区域を作り直すときに一緒に作り直す)。
 * (M23-03 のやり直しで変更: 水深は頂点に焼かず、地面の高さの表 (bakeHeightGrid) を shader で読んで画素ごとに求める。
 *  水深の色・泡の帯・海岸の形が海の格子の細かさに依らず、地面と同じ滑らかさになる。沈降は海面の高さの uniform を変えるだけ)
 */
const SHALLOW = new Color('#6FC7C0');
const DEEP = new Color('#2C6E8E');
const FOAM = new Color('#F4F7EF');

export type Water = {
  mesh: Mesh;
  update(t: number): void;
  /** 海面を level m 上げる (M22-08、沈降)。本体の沈降は全セルの標高を同じだけ下げるので、地面を作り直す代わりに海を上げる */
  setLevel(level: number): void;
  /** (M23-03 のやり直し) 水の shader が読む地面の高さと陸の縁からの距離の表 (試験と調整用。setLevel で距離を書き直す) */
  heights: HeightGrid;
};

/**
 * (M23-03 のやり直し) 地面の高さの表。地面の頂点と同じ格子 (terrainGrid、1.67 m おき) を、地面の窓の外へ本体の世界の端まで広げる。
 * 画素 (i, j) は x = x0 + i × step、z = z0 + j × step の点で、data[(j × nx + i) × 2] が heightAt、その次が陸の縁からの横の距離 (paintShoreDistance)。
 * 窓の中の点は地面の頂点とちょうど重なる
 */
export type HeightGrid = {
  data: Float32Array;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  step: number;
  /** 地面の窓の半辺 (m) */
  half: number;
};

/**
 * (M23-03 のやり直し) 地面の高さを表に焼く。範囲は地面の窓と、本体の世界 (field.size 四方のセル) に 2 セルの縁を足した所。
 * heightAt は世界の外で端のセルを引き伸ばすので、表の外は端の値を引き伸ばして読めば同じになる (sampleHeightGrid)
 */
export function bakeHeightGrid(field: TerrainField): HeightGrid {
  const { half, step } = terrainGrid(field);
  const hx = field.home % field.size;
  const hy = Math.floor(field.home / field.size);
  // 世界のセル c の中心は x = (c − hx) × CELL_M。セル −2 から size + 1 まで (catmull の 4 点が端に張りつくまで)
  const range = (hc: number) => {
    const lo = Math.min(-half, (-2 - hc) * CELL_M);
    const hi = Math.max(half, (field.size + 1 - hc) * CELL_M);
    // 地面の頂点の番号 (−half が 0) で数える
    const i0 = Math.floor((lo + half) / step);
    const i1 = Math.ceil((hi + half) / step);
    return { i0, n: i1 - i0 + 1 };
  };
  const rx = range(hx);
  const rz = range(hy);
  const data = new Float32Array(rx.n * rz.n * 2);
  for (let j = 0; j < rz.n; j++) {
    // 地面の頂点と同じ式 (−half + 番号 × step) で位置を出し、窓の中は頂点の高さとちょうど同じ値にする
    const z = -half + (j + rz.i0) * step;
    for (let i = 0; i < rx.n; i++) data[(j * rx.n + i) * 2] = field.heightAt(-half + (i + rx.i0) * step, z);
  }
  return { data, nx: rx.n, nz: rz.n, x0: -half + rx.i0 * step, z0: -half + rz.i0 * step, step, half };
}

/**
 * (M23-03 のやり直し) 表の 2 つ目の値に、海面 level の水際からの横の距離 (m、reach で頭打ち) を書く。
 * 水際は地面の三角形 (sampleHeightGrid と同じ切り方) の中で高さが level になる線分で、描いた地面と海面の交わりと同じ線。
 * 泡の帯をこの距離で切り、岸に沿う細い帯にする (水深だけだと、平らな浅瀬が一面の泡になる)。沈降で海面が変わったら書き直す。
 * within を渡すと、原点から x・z とも within m の内の線だけを使う (地面の窓の外は地面を描かないので、そこの「岸」には泡を引かない)
 */
export function paintShoreDistance(g: HeightGrid, level: number, reach: number, within = Infinity): void {
  const { nx, nz, data } = g;
  for (let k = 0; k < nx * nz; k++) data[k * 2 + 1] = reach;
  const r = Math.ceil(reach / g.step) + 1;
  const hAt = (i: number, j: number) => data[(j * nx + i) * 2];
  // 格子の座標 (目の単位) の線分 p–q から、周りの画素までの距離を書く
  const seg = (px: number, pz: number, qx: number, qz: number) => {
    const dx = qx - px;
    const dz = qz - pz;
    const len2 = dx * dx + dz * dz;
    const i0 = Math.max(0, Math.floor(Math.min(px, qx)) - r);
    const i1 = Math.min(nx - 1, Math.ceil(Math.max(px, qx)) + r);
    const j0 = Math.max(0, Math.floor(Math.min(pz, qz)) - r);
    const j1 = Math.min(nz - 1, Math.ceil(Math.max(pz, qz)) + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((i - px) * dx + (j - pz) * dz) / len2)) : 0;
        const d = Math.hypot(i - (px + dx * t), j - (pz + dz * t)) * g.step;
        const k = (j * nx + i) * 2 + 1;
        if (d < data[k]) data[k] = d;
      }
    }
  };
  // 三角形 (頂点は格子の座標と高さ) の中で高さが level になる線分
  const tri = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number, cx: number, cz: number, ch: number) => {
    const pts: number[] = [];
    const edge = (x0: number, z0: number, h0: number, x1: number, z1: number, h1: number) => {
      if (h0 >= level === h1 >= level) return;
      const t = (level - h0) / (h1 - h0);
      pts.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    };
    edge(ax, az, ah, bx, bz, bh);
    edge(bx, bz, bh, cx, cz, ch);
    edge(cx, cz, ch, ax, az, ah);
    if (pts.length === 4) seg(pts[0], pts[1], pts[2], pts[3]);
  };
  for (let j = 0; j < nz - 1; j++) {
    if (Math.abs(g.z0 + (j + 0.5) * g.step) > within) continue;
    for (let i = 0; i < nx - 1; i++) {
      if (Math.abs(g.x0 + (i + 0.5) * g.step) > within) continue;
      const a = hAt(i, j);
      const b = hAt(i + 1, j);
      const d = hAt(i, j + 1);
      const e = hAt(i + 1, j + 1);
      const lo = Math.min(a, b, d, e);
      const hi = Math.max(a, b, d, e);
      if (lo >= level || hi < level) continue;
      tri(i, j, a, i + 1, j, b, i, j + 1, d);
      tri(i + 1, j, b, i, j + 1, d, i + 1, j + 1, e);
    }
  }
}

/**
 * (M23-03 のやり直し) 表の高さを読む (shader の wTerrain と同じ式。単体試験用)。地面の三角形と同じく、
 * 目を (i+1, j)–(i, j+1) の対角線で 2 枚に分けて平面で補う。水深 0 の線が描いた地面と海面の交わりに重なる。
 * channel 1 は水際からの距離を同じ補いで読む
 */
export function sampleHeightGrid(g: HeightGrid, x: number, z: number, channel: 0 | 1 = 0): number {
  const gx = Math.min(Math.max((x - g.x0) / g.step, 0), g.nx - 1.001);
  const gz = Math.min(Math.max((z - g.z0) / g.step, 0), g.nz - 1.001);
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const at = (a: number, b: number) => g.data[(b * g.nx + a) * 2 + channel];
  const b = at(i + 1, j);
  const d = at(i, j + 1);
  if (fx + fz <= 1) {
    const a = at(i, j);
    return a + (b - a) * fx + (d - a) * fz;
  }
  const e = at(i + 1, j + 1);
  return e + (d - e) * (1 - fx) + (b - e) * (1 - fz);
}

/** (M23-03 のやり直し) 地面の窓の中の格子の目の大きさ (m)。色は画素で決まるので、波 (波長 27〜35 m、高さ 8 cm) を滑らかに描ければよい */
const FINE_STEP = 4.2;
/**
 * (M23-03 のやり直し) 細かい格子の外の輪。t は細かい格子の縁 (0) から海の果て (1) までの位置、div は輪の 1 辺の分割を細かい格子の何分の 1 にするか。
 * div が前の輪の 2 倍になる所は、内側の 2 目を外側の 1 目に 3 枚の三角形でつなぐ (T 字の継ぎ目を作らない)
 */
const RINGS: readonly { t: number; div: number }[] = [
  { t: 0.0025, div: 1 },
  { t: 0.014, div: 1 },
  { t: 0.039, div: 1 },
  { t: 0.08, div: 2 },
  { t: 0.14, div: 2 },
  { t: 0.22, div: 4 },
  { t: 0.32, div: 4 },
  { t: 0.45, div: 4 },
  { t: 0.6, div: 4 },
  { t: 0.79, div: 4 },
  { t: 1, div: 4 },
];

/**
 * (M23-03 のやり直し) 海の形。半辺 fineHalf の正方形は一様な格子 (1 辺 fineSegs 分割、4 の倍数)、その外は正方形の輪を重ねて半辺 extent / 2 まで広げる。
 * 輪は外ほど間隔が広く、1 辺の分割も 1/2 → 1/4 に減らす。頂点は輪どうし・格子と輪で共有するので、継ぎ目に隙間はできない。
 * 上 (+Y) を向いた水平の面 (y = 0)。uv は PlaneGeometry と同じ向き (x → u、−z → v)
 */
export function buildWaterGeometry(extent: number, fineHalf: number, fineSegs: number): BufferGeometry {
  const H = extent / 2;
  const N = fineSegs;
  const step = (2 * fineHalf) / N;
  const xs: number[] = [];
  const zs: number[] = [];
  const add = (x: number, z: number) => {
    xs.push(x);
    zs.push(z);
    return xs.length - 1;
  };
  const tris: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    // 上から見て反時計回り (法線が +Y) にそろえる
    const cross = (xs[b] - xs[a]) * (zs[c] - zs[a]) - (zs[b] - zs[a]) * (xs[c] - xs[a]);
    if (cross > 0) tris.push(a, c, b);
    else tris.push(a, b, c);
  };
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) add(-fineHalf + i * step, -fineHalf + j * step);
  const g = (i: number, j: number) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      tri(g(i, j), g(i, j + 1), g(i + 1, j));
      tri(g(i + 1, j), g(i, j + 1), g(i + 1, j + 1));
    }
  }
  // 格子の縁を一周 (角 (−, −) から x+ → z+ → x− → z− の順)。これが最初の輪
  let ring: number[] = [];
  for (let k = 0; k < N; k++) ring.push(g(k, 0));
  for (let k = 0; k < N; k++) ring.push(g(N, k));
  for (let k = 0; k < N; k++) ring.push(g(N - k, N));
  for (let k = 0; k < N; k++) ring.push(g(0, N - k));
  for (const r of RINGS) {
    const h = fineHalf + (H - fineHalf) * r.t;
    const m = N / r.div;
    const next: number[] = [];
    const s = (2 * h) / m;
    for (let k = 0; k < m; k++) next.push(add(-h + k * s, -h));
    for (let k = 0; k < m; k++) next.push(add(h, -h + k * s));
    for (let k = 0; k < m; k++) next.push(add(h - k * s, h));
    for (let k = 0; k < m; k++) next.push(add(-h, h - k * s));
    const n = ring.length;
    const o = next.length;
    if (o === n) {
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        tri(ring[k], ring[k1], next[k]);
        tri(ring[k1], next[k1], next[k]);
      }
    } else {
      // 内側 2 目 → 外側 1 目
      for (let k = 0; k < o; k++) {
        const a0 = ring[2 * k];
        const a1 = ring[2 * k + 1];
        const a2 = ring[(2 * k + 2) % n];
        const b0 = next[k];
        const b1 = next[(k + 1) % o];
        tri(a0, a1, b0);
        tri(a1, b1, b0);
        tri(a1, a2, b1);
      }
    }
    ring = next;
  }
  const count = xs.length;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    position[i * 3] = xs[i];
    position[i * 3 + 2] = zs[i];
    normal[i * 3 + 1] = 1;
    uv[i * 2] = (xs[i] + H) / extent;
    uv[i * 2 + 1] = (H - zs[i]) / extent;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('normal', new BufferAttribute(normal, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setIndex(tris);
  return geo;
}

/**
 * (M23-03 のやり直し) 泡を出す、陸の縁からの横の距離 (m)。[薄れ始め, 消える所]。水深 0〜0.5 m の式だけだと、
 * 入江の口の砂州のような平らな浅瀬 (水深 0.5 m 未満が広く続く) が一面の泡になるので、岸に沿う細い帯に切る
 */
const FOAM_REACH_M = [2, 5];
/**
 * (M23-03 のやり直し) 陸の縁は、波の無い海面より DRY_M 高い線 (波 ±0.14 m をかぶらない所)。
 * 波をかぶる高さまでしか出ていない砂州 (入江の口) は陸と見ず、そこから泡の帯を引かない
 */
const DRY_M = 0.16;
/** (M23-03 のやり直し) 表に書く陸の縁からの距離の上限 (m)。FOAM_REACH_M の消える所より先は要らない */
const SHORE_DIST_MAX = 6;

/** (M23-03 のやり直し) 波の高さ。頂点シェーダの揺れ (begin_vertex の行) と同じ式を、画素の水深にも使う */
const WAVE_GLSL = 'sin(P.x * 0.18 + uTime * 0.9) * 0.08 + sin(P.y * 0.23 - uTime * 0.7) * 0.06';

export function createWater(field: TerrainField, extent: number): Water {
  // 区域の近くは細かく、遠くは地平まで伸ばすので分割を増やしすぎない (1 辺 240 分割)
  // (M23-03 のやり直しで変更: 一様な 240 分割 (115 千三角形) をやめ、地面の窓 (半辺 125 m) は 4.2 m 前後の格子、その外は外ほど粗い輪にした。
  //  色は画素ごとに地面の高さの表から決めるので、格子の目は海岸の形に出ない)
  const fineHalf = Math.min(((field.window * 2 + 1) * CELL_M) / 2, extent / 4);
  const fineSegs = Math.max(4, Math.round((2 * fineHalf) / FINE_STEP / 4) * 4);
  const geo = buildWaterGeometry(extent, fineHalf, fineSegs);
  const grid = bakeHeightGrid(field);
  // 陸の縁は波の無い海面 (0.02 + 海面) より DRY_M 高い線で引く
  paintShoreDistance(grid, 0.02 + DRY_M, SHORE_DIST_MAX, grid.half);
  const heights = new DataTexture(grid.data, grid.nx, grid.nz, RGFormat, FloatType);
  heights.minFilter = NearestFilter;
  heights.magFilter = NearestFilter;
  heights.generateMipmaps = false;
  heights.needsUpdate = true;
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uHeight: { value: heights },
    uGrid: { value: [grid.x0, grid.z0, 1 / grid.step, 0] },
    uGridN: { value: [grid.nx, grid.nz] },
    uShallow: { value: SHALLOW },
    uDeep: { value: DEEP },
    uFoam: { value: FOAM },
    uReach: { value: FOAM_REACH_M },
  };
  // 海面の高さ (沈降で上がる)。水深と泡の帯は海面から測り直す
  let level = 0;
  // (M23-03 のやり直し) 画素の水深 = 描いた海面 (0.02 + 海面 + 波) − 地面 (地面の三角形と同じ補い)。色の式は前の頂点の色と同じ
  const colorGlsl = () =>
    [
      'vec2 P = vWaterXZ;',
      'vec2 wT = wTerrain(P);',
      `float wDepth = uLevel + 0.02 + ${WAVE_GLSL} - wT.x;`,
      'vec3 wCol = mix(uShallow, uDeep, clamp(wDepth / 6.0, 0.0, 1.0));',
      // 岸 (水深 0〜0.5 m) に泡の帯
      'if (wDepth < 0.5 && wDepth > -0.2) wCol = mix(wCol, uFoam, 0.55 * (1.0 - abs(wDepth - 0.15) / 0.35) * (1.0 - smoothstep(uReach.x, uReach.y, wT.y)));',
      'diffuseColor.rgb *= wCol;',
      // (M23-03 のやり直し) 水際の 8 cm で水を透かし、地面との境の線 (地面の 1.67 m の三角形と海面の交わり) の角を和らげる
      'diffuseColor.a *= smoothstep(0.0, 0.08, wDepth);',
    ].join('\n');
  const mat = createToonMaterial({ transparent: true, opacity: 0.86, side: DoubleSide, rim: 0.25, rimColor: '#E8F6FF' });
  // 半透明の両面は裏と表の 2 回描かれる。水面は下から見ないので 1 回で描く (M22-03)
  mat.forceSinglePass = true;
  // (M23-03 のやり直し) 色を画素で塗るので、縁の光が同じ値の他のトゥーンと shader を取り違えないように
  mat.customProgramCacheKey = () => 'toon-water-depth';
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vWaterXZ;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'transformed.y += sin(position.x * 0.18 + uTime * 0.9) * 0.08 + sin(position.z * 0.23 - uTime * 0.7) * 0.06;',
          // (M23-03 のやり直し) 画素の水深を求める位置 (海は水平には動かさないので、世界の x・z)
          'vWaterXZ = (modelMatrix * vec4(position, 1.0)).xz;',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uTime;',
          'uniform float uLevel;',
          'uniform sampler2D uHeight;',
          'uniform vec4 uGrid;',
          'uniform ivec2 uGridN;',
          'uniform vec3 uShallow;',
          'uniform vec3 uDeep;',
          'uniform vec3 uFoam;',
          'uniform vec2 uReach;',
          'varying vec2 vWaterXZ;',
          // (M23-03 のやり直し) 地面の高さ (sampleHeightGrid と同じ式)
          // (x は高さ、y は陸の縁からの距離)
          'vec2 wTerrain(vec2 p) {',
          '  vec2 g = clamp((p - uGrid.xy) * uGrid.z, vec2(0.0), vec2(uGridN) - 1.001);',
          '  ivec2 i = ivec2(floor(g));',
          '  vec2 f = g - vec2(i);',
          '  vec2 b = texelFetch(uHeight, i + ivec2(1, 0), 0).rg;',
          '  vec2 d = texelFetch(uHeight, i + ivec2(0, 1), 0).rg;',
          '  if (f.x + f.y <= 1.0) { vec2 a = texelFetch(uHeight, i, 0).rg; return a + (b - a) * f.x + (d - a) * f.y; }',
          '  vec2 e = texelFetch(uHeight, i + ivec2(1, 1), 0).rg;',
          '  return e + (d - e) * (1.0 - f.x) + (b - e) * (1.0 - f.y);',
          '}',
        ].join('\n'),
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${colorGlsl()}`);
  };
  const mesh = new Mesh(geo, mat);
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  mesh.name = 'observe-water';
  return {
    mesh,
    heights: grid,
    update: (t) => (uniforms.uTime.value = t),
    setLevel(l) {
      if (Math.abs(l - level) < 0.05) return;
      level = l;
      uniforms.uLevel.value = level;
      paintShoreDistance(grid, 0.02 + DRY_M + level, SHORE_DIST_MAX, grid.half);
      heights.needsUpdate = true;
      mesh.position.y = 0.02 + level;
    },
  };
}
