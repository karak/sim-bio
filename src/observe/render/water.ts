import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh } from 'three';
import { createToonMaterial } from './toon';
import { CELL_M, type TerrainField } from './terrain';

/**
 * 海と池 (設計 §5)。水深で浅瀬の色 → 深い青、岸では泡。波は頂点シェーダで実時間に揺らす。
 * 沈降で海岸線が動くので、地面の heightAt から水深を焼く (区域を作り直すときに一緒に作り直す)。
 */
const SHALLOW = new Color('#6FC7C0');
const DEEP = new Color('#2C6E8E');
const FOAM = new Color('#F4F7EF');

export type Water = {
  mesh: Mesh;
  update(t: number): void;
  /** 海面を level m 上げる (M22-08、沈降)。本体の沈降は全セルの標高を同じだけ下げるので、地面を作り直す代わりに海を上げる */
  setLevel(level: number): void;
};

/** (M23-03) 地面の窓の内側の細かい格子の目の大きさ (m)。水際の泡の帯 (水深 −0.2〜0.5 m) と水深の色を拾う */
const FINE_STEP = 3.5;
/**
 * (M23-03) 細かい格子の外の輪。t は細かい格子の縁 (0) から海の果て (1) までの位置、div は輪の 1 辺の分割を細かい格子の何分の 1 にするか。
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
 * (M23-03) 海の形。半辺 fineHalf の正方形は一様な細かい格子 (1 辺 fineSegs 分割)、その外は正方形の輪を重ねて半辺 extent / 2 まで広げる。
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
  // 細かい格子
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

export function createWater(field: TerrainField, extent: number): Water {
  // 区域の近くは細かく、遠くは地平まで伸ばすので分割を増やしすぎない (1 辺 240 分割)
  // (M23-03 で変更: 一様な 240 分割 (115 千三角形) をやめ、地面の窓 (半辺 125 m) は 3.5 m 前後の細かい格子、その外は外ほど粗い輪にした。約 14 千三角形)
  const fineHalf = Math.min(((field.window * 2 + 1) * CELL_M) / 2, extent / 4);
  const fineSegs = Math.max(4, Math.round((2 * fineHalf) / FINE_STEP / 4) * 4);
  const geo = buildWaterGeometry(extent, fineHalf, fineSegs);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  // (M23-03) 頂点の水深。泡の帯は画素ごとに、三角形の中で補った水深から塗る
  const dep = new Float32Array(pos.count);
  const c = new Color();
  // 海面の高さ (沈降で上がる)。水深と泡の帯は海面から測り直す
  let level = 0;
  const paint = () => {
    for (let i = 0; i < pos.count; i++) {
      const depth = level - field.heightAt(pos.getX(i), pos.getZ(i));
      c.copy(SHALLOW).lerp(DEEP, Math.min(1, Math.max(0, depth / 6)));
      // 岸 (水深 0〜0.5 m) に泡の帯
      // (M23-03 で変更: 泡は頂点の色に焼かず、水深を頂点に持たせて画素ごとに同じ式で塗る (下の onBeforeCompile)。
      //  帯の幅 (約 1〜2 m) より頂点の間隔が広いと、泡が頂点のある所だけの点線や筋になるため)
      dep[i] = depth;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
  };
  paint();
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('aDepth', new BufferAttribute(dep, 1));
  const mat = createToonMaterial({ vertexColors: true, transparent: true, opacity: 0.86, side: DoubleSide, rim: 0.25, rimColor: '#E8F6FF' });
  // 半透明の両面は裏と表の 2 回描かれる。水面は下から見ないので 1 回で描く (M22-03)
  mat.forceSinglePass = true;
  // (M23-03) 泡を画素で塗るので、縁の光が同じ値の他のトゥーンと shader を取り違えないように
  mat.customProgramCacheKey = () => 'toon-water-foam';
  const uniforms = { uTime: { value: 0 }, uFoam: { value: FOAM } };
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(mat, shader, renderer);
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFoam = uniforms.uFoam;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'transformed.y += sin(position.x * 0.18 + uTime * 0.9) * 0.08 + sin(position.z * 0.23 - uTime * 0.7) * 0.06;',
        ].join('\n'),
      )
      // (M23-03) 水深を画素へ渡す
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
    // (M23-03) 岸 (水深 −0.2〜0.5 m、芯は 0.15 m) に泡の帯。以前の頂点の色と同じ式を画素ごとに
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFoam;\nvarying float vDepth;')
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'if (vDepth < 0.5 && vDepth > -0.2) diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, 0.55 * (1.0 - abs(vDepth - 0.15) / 0.35));',
        ].join('\n'),
      );
  };
  const mesh = new Mesh(geo, mat);
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  mesh.name = 'observe-water';
  return {
    mesh,
    update: (t) => (uniforms.uTime.value = t),
    setLevel(l) {
      if (Math.abs(l - level) < 0.05) return;
      level = l;
      paint();
      geo.getAttribute('color').needsUpdate = true;
      geo.getAttribute('aDepth').needsUpdate = true;
      mesh.position.y = 0.02 + level;
    },
  };
}
