import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

/**
 * 樹皮の筆致と年輪の升 (M22-11、2026-10-11 審査台「基準画をベースにすると物足りない。肌のテクスチャや切り株、丸太はまだ余地が残っている」)。
 * 基準画 (sheets/belltree・flora) の幹は、淡い地に縦へ長い筆の筋 (陰の側は青灰、光の側は暖かい) が流れる。筋の幅 (5〜10 cm) は
 * 幹の頂点の間隔 (約 20 cm) より細かく頂点色では描けないので、継ぎ目の無い升を起動時に作り、焼いた材質 (bake.ts) が樹皮の UV で読む。
 * 升 1 枚は、周りの向き (u) に BARK_UV m (tools/blender/observe_kit.py)、軸の向き (v) に BARK_TILE_V m。
 * R: 筆の筋の高さ (0 = 筋の間の溝、1 = 盛り上がった筋)。G: 大きな斑 (暖かい / 冷たい色の振れ)。
 * B: 年輪の揺れ (木口の輪の半径を角度でずらす)。A: 樹皮の裂け目 (1 = 裂け目)。
 * どの組も周期の升なので、繰り返しても継ぎ目が出ない。升はファイルに置かず決定論で作る (groundDetail.ts と同じ)。
 */
export const BARK_SIZE = 256;
/** 升 1 枚の軸の向きの長さ (m) */
export const BARK_TILE_V = 1.6;

function hash(ix: number, iy: number, seed: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const wrap = (i: number, p: number) => ((i % p) + p) % p;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 継ぎ目の無い値ノイズ (u の周期 pu、v の周期 pv の格子。u, v は 0〜1 の升の座標) */
function tileNoise(u: number, v: number, pu: number, pv: number, seed: number): number {
  const x = u * pu;
  const y = v * pv;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(wrap(xi, pu), wrap(yi, pv), seed);
  const b = hash(wrap(xi + 1, pu), wrap(yi, pv), seed);
  const c = hash(wrap(xi, pu), wrap(yi + 1, pv), seed);
  const d = hash(wrap(xi + 1, pu), wrap(yi + 1, pv), seed);
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * 筆の筋: 周りに 14 本ほどの筋が軸の向きに長く伸びる (格子が u に細かく v に粗い値ノイズ)。
 * 筋は軸に沿ってゆっくり左右へ揺れ (筆の運び)、ところどころで途切れる
 */
export function strokeHeight(u: number, v: number): number {
  const sway = (tileNoise(u, v, 2, 3, 61) - 0.5) * 0.06;
  const uu = u + sway;
  const n = tileNoise(uu, v, 14, 2, 63) * 0.6 + tileNoise(uu, v, 28, 4, 65) * 0.28 + tileNoise(uu, v, 56, 6, 67) * 0.12;
  return clamp01((n - 0.5) * 1.6 + 0.5);
}

/** 大きな斑 (0〜1): 周りに 3 つ、軸に 1 つほどの塊。暖かい / 冷たい色の振れに使う */
export function patchTone(u: number, v: number): number {
  return tileNoise(u, v, 3, 2, 71) * 0.7 + tileNoise(u, v, 6, 3, 73) * 0.3;
}

/** 年輪の揺れ (0〜1): u を角度 (周り 1)、v を半径として読む。角度に 5 つほどのうねり */
export function ringWobble(u: number, v: number): number {
  return tileNoise(u, v, 5, 4, 81) * 0.65 + tileNoise(u, v, 11, 8, 83) * 0.35;
}

/**
 * 樹皮の裂け目 (0〜1): 軸の向きに長い値ノイズの等高線 (値が 0.5 を横切る所) を細い溝にする。周りに 5 本ほど、途切れながら縦に走る
 */
export function crackMask(u: number, v: number): number {
  const sway = (tileNoise(u, v, 3, 2, 91) - 0.5) * 0.08;
  const n = tileNoise(u + sway, v, 5, 1, 93);
  const line = 1 - smooth(0.0, 0.07, Math.abs(n - 0.5));
  const broken = smooth(0.35, 0.6, tileNoise(u, v, 5, 3, 95));
  return clamp01(line * broken);
}

/** 升の画素 (RGBA、左上から行ごと)。値 0〜1 を 0〜255 に */
export function barkDetailPixels(size = BARK_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      const k = (j * size + i) * 4;
      out[k] = Math.round(strokeHeight(u, v) * 255);
      out[k + 1] = Math.round(patchTone(u, v) * 255);
      out[k + 2] = Math.round(ringWobble(u, v) * 255);
      out[k + 3] = Math.round(crackMask(u, v) * 255);
    }
  }
  return out;
}

let cached: DataTexture | null = null;
/** 樹皮の升のテクスチャ (繰り返し・ミップマップ。遠くはミップで均され、筋が自然に薄れる) */
export function barkDetailTexture(): DataTexture {
  if (cached) return cached;
  const t = new DataTexture(barkDetailPixels(), BARK_SIZE, BARK_SIZE, RGBAFormat, UnsignedByteType);
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
