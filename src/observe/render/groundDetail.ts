import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

/**
 * 地面の質感の升 (地面の質感、2026-09-24 審査台 t03-coast「地面の肌触りは依然薄く…ざらつきや凹凸などの質感がほしい」)。
 * 継ぎ目なく並ぶ高さの升を 4 つの色の組 (RGBA) に作り、地面のシェーダが世界座標で 2 つの大きさに並べて法線を揺らす
 * (起伏の明暗と窪みの陰)。細かい写真の肌理ではなく、筆の粗いタッチの大きさ (10 cm〜1 m) にとどめる (灰狼の毛並みの「細かすぎる」)。
 * R: 土の塊 (草地の土と踏み固めた土)。G: 小石 (道と広場)。B: 砂の風紋 (浜)。A: 岩の割れ目と面 (急な斜面)。
 * どの組も 0 = 窪み、1 = 盛り上がり。升は起動時に決定論で作る (ファイルは置かない)。
 */
export const DETAIL_SIZE = 256;

function hash(ix: number, iy: number, seed: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const wrap = (i: number, p: number) => ((i % p) + p) % p;

/** 継ぎ目の無い値ノイズ (格子の周期 p、u, v は 0〜1 の升の座標) */
function tileNoise(u: number, v: number, p: number, seed: number): number {
  const x = u * p;
  const y = v * p;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(wrap(xi, p), wrap(yi, p), seed);
  const b = hash(wrap(xi + 1, p), wrap(yi, p), seed);
  const c = hash(wrap(xi, p), wrap(yi + 1, p), seed);
  const d = hash(wrap(xi + 1, p), wrap(yi + 1, p), seed);
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function tileFbm(u: number, v: number, p: number, seed: number): number {
  return tileNoise(u, v, p, seed) * 0.55 + tileNoise(u, v, p * 2, seed + 1) * 0.3 + tileNoise(u, v, p * 4, seed + 2) * 0.15;
}

/** 継ぎ目の無いセル (周期 p の格子に 1 点ずつ)。近い 2 点までの距離 (升の 1 マス = 1) と、いちばん近い点の格子の番地 */
function tileCells(u: number, v: number, p: number, seed: number): { f1: number; f2: number; cx: number; cy: number; px: number; py: number } {
  const x = u * p;
  const y = v * p;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let cx = 0;
  let cy = 0;
  let px = 0;
  let py = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = wrap(xi + dx, p);
      const gy = wrap(yi + dy, p);
      const ox = xi + dx + 0.15 + 0.7 * hash(gx, gy, seed);
      const oy = yi + dy + 0.15 + 0.7 * hash(gx, gy, seed + 5);
      const d = Math.hypot(x - ox, y - oy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cx = gx;
        cy = gy;
        px = x - ox;
        py = y - oy;
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, cx, cy, px, py };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 土の塊: 升を雑音で歪めた丸い塊 (セル 7 × 7) の間に浅い溝、上に緩いうねり。塊は大小と高さを揃えない (石畳に見せない) */
export function clodHeight(u: number, v: number): number {
  const wu = u + (tileFbm(u, v, 3, 41) - 0.5) * 0.12;
  const wv = v + (tileFbm(u, v, 3, 43) - 0.5) * 0.12;
  const c = tileCells(wu, wv, 7, 1);
  const lift = 0.5 + 0.5 * hash(c.cx, c.cy, 45);
  const dome = 1 - smooth(0.0, 1.0, c.f1 / Math.max(0.35, c.f2));
  const groove = smooth(0.0, 0.3, c.f2 - c.f1);
  return clamp01(0.12 + 0.5 * dome * groove * lift + 0.38 * tileFbm(u, v, 4, 3));
}

/** 小石の格子のマス数 (升 1 枚の一辺)。近い升 5 m なら 1 マス約 0.42 m */
export const PEBBLE_GRID = 12;
/**
 * 小石の格子のマス (gx, gy) の石 (2026-09-25 小石を減らし、大きさを散らす)。マスの 15% ほどに 1 つ、無ければ null。
 * ox, oy はマスの中の石の中心 (0〜1)、r は半径 (マス = 1)。半径は 0.1〜0.62 マスで小さい石が多く大きい石は少ない (一様の 2 乗へ寄せる)。
 * 大きい石もマスの 3 × 3 の探しからはみ出さない (r × 1.35 < 1)
 */
export function pebbleStone(gx: number, gy: number): { ox: number; oy: number; r: number } | null {
  if (hash(gx, gy, 11) >= 0.15) return null;
  const k = hash(gx, gy, 13);
  const r = 0.1 + 0.52 * k * k * k;
  // 大きい石ほど中心をマスの真ん中へ寄せる (隣のマスへ深くはみ出さない)
  const room = Math.max(0.05, 0.5 - r * 0.55);
  return { ox: 0.5 + (hash(gx, gy, 15) - 0.5) * 2 * room, oy: 0.5 + (hash(gx, gy, 19) - 0.5) * 2 * room, r };
}

/** 小石: 12 × 12 の格子の 4 割ほどに丸い石 (半径 0.2〜0.4 マス)。石の周りはわずかに窪む (踏まれて沈んだ跡) */
// (2026-09-25 で変更: 石は格子のマスの 15% ほど、半径 0.1〜0.62 マスに散らす (pebbleStone)。隣のマスの石も 3 × 3 で見て、
// いちばん高い石を採る (大きい石がマスの境で切れない)。大きい石ほど少し高い)
export function pebbleHeight(u: number, v: number): number {
  const x = u * PEBBLE_GRID;
  const y = v * PEBBLE_GRID;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const base = 0.3 + 0.12 * tileNoise(u, v, 8, 17);
  let top = 0;
  let rim = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const s = pebbleStone(wrap(xi + dx, PEBBLE_GRID), wrap(yi + dy, PEBBLE_GRID));
      if (!s) continue;
      const t = Math.hypot(x - (xi + dx + s.ox), y - (yi + dy + s.oy)) / s.r;
      if (t >= 1.35) continue;
      if (t >= 1) rim = Math.max(rim, 0.06 * (1 - (t - 1) / 0.35));
      // 平たい丸石 (上が少し平ら)
      else top = Math.max(top, (0.5 + 0.25 * Math.min(1, s.r / 0.4)) * Math.pow(1 - t * t, 0.6));
    }
  }
  return top > 0 ? clamp01(base + top) : base - rim;
}

/** 砂の風紋: 升 1 枚に 6 本の畝 (v の向き)、雑音で曲げる。風上はなだらか、風下は切り立つ */
export function rippleHeight(u: number, v: number): number {
  const phase = v * 6 + (tileFbm(u, v, 3, 21) - 0.5) * 1.4 + (tileNoise(u, v, 2, 23) - 0.5) * 0.8;
  const f = phase - Math.floor(phase);
  const saw = f < 0.72 ? f / 0.72 : 1 - (f - 0.72) / 0.28;
  const s = saw * saw * (3 - 2 * saw);
  return clamp01(0.2 + 0.6 * s * (0.7 + 0.3 * tileNoise(u, v, 6, 25)) + 0.2 * tileNoise(u, v, 12, 27));
}

/** 岩: 歪めた升の割れ目で区切られた面 (4 × 4 の大きな割れと 9 × 9 の浅い割れ)。面ごとに傾きを変え (削った面)、大きな割れ目は深く暗い */
export function rockHeight(u: number, v: number): number {
  const wu = u + (tileFbm(u, v, 2, 51) - 0.5) * 0.2;
  const wv = v + (tileFbm(u, v, 2, 53) - 0.5) * 0.2;
  const c = tileCells(wu, wv, 4, 31);
  const width = 0.06 + 0.12 * tileNoise(u, v, 5, 55);
  const crack = smooth(0.0, width, c.f2 - c.f1);
  const fine = tileCells(wu, wv, 9, 57);
  const fineCrack = 1 - 0.3 * (1 - smooth(0.0, 0.16, fine.f2 - fine.f1));
  const tx = hash(c.cx, c.cy, 33) - 0.5;
  const ty = hash(c.cx, c.cy, 35) - 0.5;
  const facet = 0.55 + (c.px * tx + c.py * ty) * 0.45 + (hash(c.cx, c.cy, 37) - 0.5) * 0.2;
  return clamp01(crack * fineCrack * (facet + 0.25 * (tileFbm(u, v, 8, 39) - 0.5)));
}

/**
 * 起伏の明暗の強さ (2026-09-25 起伏の明暗を強める)。地面のシェーダ (terrain.ts の paintedGround) はこの値から組み立てる。
 * ampNear・ampFar: 種類ごとの起伏の高さ (m) の mat4 (列ごと: 列 0 草地の土・列 1 むき出しの土・列 2 砂・列 3 岩、行は升の組 R 土の塊・G 小石・B 風紋・A 岩)。
 * 近い升 (5 m) と広い升 (13 m) で分ける。前は 近い 土の塊 0.11・むき出しの土 0.05 + 小石 0.06・砂 0.05・岩 0.2、広い 0.22・0.14・0.03 + 0.08・0.5。
 * cavity: 窪みの陰の強さ (種類ごと、前は 0.3・0.38・0.22・0.55)。gain: 高さの差 (0.5 が平ら) に掛ける倍率 (前 1.6)。
 * shadeMin・shadeMax: 明るさの掛け算の下限と上限 (前 0.55・1.25)。
 */
export const RELIEF = {
  ampNear: [0.14, 0, 0, 0, 0.08, 0.06, 0, 0, 0, 0, 0.06, 0, 0, 0, 0, 0.3],
  ampFar: [0.32, 0, 0, 0, 0.2, 0, 0, 0, 0.03, 0, 0.1, 0, 0, 0, 0, 0.6],
  cavity: [0.45, 0.5, 0.3, 0.75] as const,
  gain: 1.8,
  shadeMin: 0.42,
  shadeMax: 1.32,
} as const;

/** 窪みの陰の明るさの掛け算 (シェーダの式と同じ)。dh は升の高さの平らからの差、cavity はその所の窪みの陰の強さ */
export function cavityShade(dh: number, cavity: number): number {
  return Math.min(RELIEF.shadeMax, Math.max(RELIEF.shadeMin, 1 + dh * cavity * RELIEF.gain));
}

/** 升の画素 (RGBA、左上から行ごと)。高さ 0〜1 を 0〜255 に */
export function groundDetailPixels(size = DETAIL_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      const k = (j * size + i) * 4;
      out[k] = Math.round(clodHeight(u, v) * 255);
      out[k + 1] = Math.round(pebbleHeight(u, v) * 255);
      out[k + 2] = Math.round(rippleHeight(u, v) * 255);
      out[k + 3] = Math.round(rockHeight(u, v) * 255);
    }
  }
  return out;
}

let cached: DataTexture | null = null;
/** 地面の質感の升のテクスチャ (繰り返し・ミップマップ。遠くはミップで均され、起伏が自然に薄れる) */
export function groundDetailTexture(): DataTexture {
  if (cached) return cached;
  const t = new DataTexture(groundDetailPixels(), DETAIL_SIZE, DETAIL_SIZE, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  cached = t;
  return t;
}
