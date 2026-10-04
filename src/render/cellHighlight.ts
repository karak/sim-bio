/**
 * 選んだセルの強調 (M22-10)。操作画面 (SceneView) の地形の上に、セルの境界の帯と浮かぶ印を置くための純粋な計算。
 *
 * 地形は SceneView と同じ作り: PlaneGeometry(size, size, size-1, size-1) を rotateX(-90°) し、頂点 i の高さを elevation[i] × hs にする。
 * セル (cx, cy) の四角は x ∈ [cx - size/2, cx - size/2 + 1]、z も同じ (pickCell の床関数と同じ区切り)。
 */

/** 地形の面を求めるのに要るもの。floor は面の下限 (海面)。半透明の海の下に線を沈めない */
export type SurfaceGrid = {
  elevation: ArrayLike<number>;
  size: number;
  heightScale: number;
  floor: number;
};

export type OutlineOptions = {
  /** 1 辺あたりの標本の数。地形の折れ目を拾うほど多く */
  samplesPerSide: number;
  /** 帯の幅 (セルの境界をまたいで、外と内へ半分ずつ) */
  width: number;
  /** 地形の面からの浮かせ (z-fighting を避ける) */
  lift: number;
};

/**
 * 世界座標 (x, z) の真下の地形の面の高さ。three の PlaneGeometry の三角形の割り方 (a,b,d)・(b,c,d) のとおりに補間するので、
 * 描いている地形の面とずれない。地図の外は端に寄せ、floor より下は floor にする。
 */
export function surfaceHeightAt(g: SurfaceGrid, x: number, z: number): number {
  const { elevation: e, size } = g;
  const seg = size / (size - 1);
  const fx = Math.min(size - 1, Math.max(0, (x + size / 2) / seg));
  const fz = Math.min(size - 1, Math.max(0, (z + size / 2) / seg));
  const ix = Math.min(size - 2, Math.floor(fx));
  const iz = Math.min(size - 2, Math.floor(fz));
  const u = fx - ix;
  const v = fz - iz;
  const ha = e[iz * size + ix];
  const hb = e[(iz + 1) * size + ix];
  const hc = e[(iz + 1) * size + ix + 1];
  const hd = e[iz * size + ix + 1];
  const h = u + v <= 1 ? ha + u * (hd - ha) + v * (hb - ha) : hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
  return Math.max(h * g.heightScale, g.floor);
}

export const outlineVertexCount = (samplesPerSide: number): number => 4 * samplesPerSide * 2;

/**
 * セルの境界の帯の頂点を out に書く (作り直さず、その場で書き換える)。
 * 標本 k ごとに外の縁 (2k) と内の縁 (2k+1)。外と内は同じ中心の大小の四角の同じ位置なので、角は自然に斜めに継がる。
 * 高さは各頂点の真下の地形の面 + lift。
 */
export function writeCellOutline(g: SurfaceGrid, cell: number, o: OutlineOptions, out: Float32Array): void {
  const { size } = g;
  const cx = cell % size;
  const cy = (cell - cx) / size;
  const midX = cx - size / 2 + 0.5;
  const midZ = cy - size / 2 + 0.5;
  const m = o.samplesPerSide;
  const total = 4 * m;
  for (let k = 0; k < total; k++) {
    // 周の上の位置 (0..4): 奥の辺 → 右の辺 → 手前の辺 → 左の辺
    const side = Math.floor(k / m);
    const t = (k % m) / m;
    const [px, pz] = side === 0 ? [-0.5 + t, -0.5] : side === 1 ? [0.5, -0.5 + t] : side === 2 ? [0.5 - t, 0.5] : [-0.5, 0.5 - t];
    for (let edge = 0; edge < 2; edge++) {
      // 外は 1 + width、内は 1 - width の大きさの四角 (中心からの比)
      const s = edge === 0 ? 1 + o.width : 1 - o.width;
      const x = midX + px * s;
      const z = midZ + pz * s;
      const j = (k * 2 + edge) * 3;
      out[j] = x;
      out[j + 1] = surfaceHeightAt(g, x, z) + o.lift;
      out[j + 2] = z;
    }
  }
}

/** 帯の三角形。標本の輪を閉じる。頂点の並びは writeCellOutline のとおり */
export function outlineIndices(samplesPerSide: number): Uint16Array {
  const total = 4 * samplesPerSide;
  const idx = new Uint16Array(total * 6);
  for (let k = 0; k < total; k++) {
    const n = (k + 1) % total;
    const o0 = k * 2;
    const i0 = k * 2 + 1;
    const o1 = n * 2;
    const i1 = n * 2 + 1;
    idx.set([o0, i0, o1, i0, i1, o1], k * 6);
  }
  return idx;
}

/** 浮かぶ印の足もと。セルの中心の真上で、セルの上の面 (角・辺の中点・中心) の最も高い所 */
export function cellMarkerAnchor(g: SurfaceGrid, cell: number): { x: number; y: number; z: number } {
  const { size } = g;
  const cx = cell % size;
  const cy = (cell - cx) / size;
  const x = cx - size / 2 + 0.5;
  const z = cy - size / 2 + 0.5;
  let y = -Infinity;
  for (const dx of [-0.5, 0, 0.5]) for (const dz of [-0.5, 0, 0.5]) y = Math.max(y, surfaceHeightAt(g, x + dx, z + dz));
  return { x, y, z };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 印の大きさ。カメラから遠いほど大きくし、画面の上でおよそ同じ大きさに見せる */
export const markerScale = (cameraDistance: number): number => clamp(cameraDistance * 0.018, 0.35, 3.2);

/** 帯の幅。遠いと細い線は 1 px を切るので太くする。セルが帯で埋まらないよう 0.45 で止める */
export const outlineWidth = (cameraDistance: number): number => clamp(cameraDistance * 0.003, 0.2, 0.45);

/** 印のゆっくりした上下 (約 1.6 秒で 1 往復、振れ幅 0.25)。動きを減らす設定 (prefers-reduced-motion) なら止める */
export const markerBob = (seconds: number, reducedMotion: boolean): number =>
  reducedMotion ? 0 : Math.sin((seconds * 2 * Math.PI) / 1.6) * 0.25;

type Point3 = { x: number; y: number; z: number };

/**
 * 目 (カメラ) から点までの線分が、点より手前で地形の面の下をくぐるか (M21-08)。面は surfaceHeightAt で求めるので、描いている地形と揃う。
 * 点の足もとの面 (点から near 以内) は数えない
 */
export function hiddenFrom(g: SurfaceGrid, eye: Point3, point: Point3, step = 0.25, near = 0.75): boolean {
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const len = Math.hypot(dx, dy, dz);
  for (let d = step; d < len - near; d += step) {
    const t = d / len;
    if (surfaceHeightAt(g, eye.x + dx * t, eye.z + dz * t) > eye.y + dy * t) return true;
  }
  return false;
}
