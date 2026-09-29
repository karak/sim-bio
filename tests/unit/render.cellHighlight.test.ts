import { describe, it, expect } from 'vitest';
import { BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import {
  cellMarkerAnchor,
  hiddenFrom,
  markerBob,
  markerScale,
  outlineIndices,
  outlineVertexCount,
  outlineWidth,
  surfaceHeightAt,
  writeCellOutline,
  type SurfaceGrid,
} from '../../src/render/cellHighlight';

/** 標高を index の関数で埋めた格子 */
const gridOf = (size: number, f: (x: number, y: number) => number, hs = 12, floor = -Infinity): SurfaceGrid => {
  const elevation = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) elevation[y * size + x] = f(x, y);
  return { elevation, size, heightScale: hs, floor };
};

/** SceneView と同じ作りの地形 (PlaneGeometry を rotateX(-90°)、頂点 i の高さ = elevation[i] × hs) */
const terrainMesh = (g: SurfaceGrid): Mesh => {
  const geo = new PlaneGeometry(g.size, g.size, g.size - 1, g.size - 1);
  geo.rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < g.size * g.size; i++) p.setY(i, g.elevation[i] * g.heightScale);
  return new Mesh(geo, new MeshBasicMaterial());
};

/** 真上から下ろした光線が地形に当たる高さ (three の三角形そのもの) */
const rayHeight = (m: Mesh, x: number, z: number): number => {
  const ray = new Raycaster(new Vector3(x, 1000, z), new Vector3(0, -1, 0));
  const hit = ray.intersectObject(m, false)[0];
  if (!hit) throw new Error(`no hit at ${x},${z}`);
  return hit.point.y;
};

describe('surfaceHeightAt (M22-10: 操作画面の地形の面の高さ)', () => {
  it('平らな地形なら標高 × hs', () => {
    const g = gridOf(8, () => 0.5, 10);
    expect(surfaceHeightAt(g, 0.3, -1.7)).toBeCloseTo(5);
  });
  it('凸凹の地形で、three の地形の三角形を真上から射た高さと一致する (頂点と頂点の間、対角線の両側)', () => {
    const g = gridOf(6, (x, y) => ((x * 7 + y * 13) % 5) / 5 + (x === 2 && y === 3 ? 1 : 0));
    const m = terrainMesh(g);
    for (const [x, z] of [[0.1, 0.2], [-1.37, 0.81], [1.9, -2.2], [-2.6, 2.4], [0.49, 0.51], [2.2, 1.1]]) {
      expect(surfaceHeightAt(g, x, z)).toBeCloseTo(rayHeight(m, x, z), 4);
    }
  });
  it('海の下は床 (海面) で止まる。線を半透明の海の下に沈めない', () => {
    const g = gridOf(4, () => 0.1, 10, 3);
    expect(surfaceHeightAt(g, 0, 0)).toBe(3);
  });
  it('地図の外は端の頂点の高さに寄せる', () => {
    const g = gridOf(4, (x) => x, 1);
    expect(surfaceHeightAt(g, 99, 0)).toBeCloseTo(3);
    expect(surfaceHeightAt(g, -99, 0)).toBeCloseTo(0);
  });
});

describe('writeCellOutline (M22-10: 選んだセルの境界の帯)', () => {
  const opts = { samplesPerSide: 4, width: 0.2, lift: 0.05 };
  it('頂点の数は 4 辺 × 標本数 × (外と内の 2)', () => {
    expect(outlineVertexCount(4)).toBe(32);
  });
  it('帯はセルの四角 (x・z が cx-size/2 .. +1) の境界をまたぎ、外の縁は幅の半分だけ外、内の縁は半分だけ内', () => {
    const size = 8;
    const g = gridOf(size, () => 0.2);
    const out = new Float32Array(outlineVertexCount(4) * 3);
    const cell = 3 * size + 5; // (5, 3)
    writeCellOutline(g, cell, opts, out);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let k = 0; k < out.length / 3; k++) {
      xs.push(out[k * 3]);
      zs.push(out[k * 3 + 2]);
    }
    const x0 = 5 - size / 2;
    const z0 = 3 - size / 2;
    expect(Math.min(...xs)).toBeCloseTo(x0 - 0.1);
    expect(Math.max(...xs)).toBeCloseTo(x0 + 1 + 0.1);
    expect(Math.min(...zs)).toBeCloseTo(z0 - 0.1);
    expect(Math.max(...zs)).toBeCloseTo(z0 + 1 + 0.1);
    // 内の縁 (奇数番) はセルの内側
    for (let k = 1; k < out.length / 3; k += 2) {
      expect(out[k * 3]).toBeGreaterThanOrEqual(x0 + 0.1 - 1e-6);
      expect(out[k * 3]).toBeLessThanOrEqual(x0 + 0.9 + 1e-6);
    }
  });
  it('どの頂点も、その真下の地形の面より lift だけ上にある (地形に埋もれない)', () => {
    const size = 10;
    const g = gridOf(size, (x, y) => Math.sin(x * 1.3) * 0.4 + Math.cos(y * 0.7) * 0.3 + 0.5);
    const m = terrainMesh(g);
    const out = new Float32Array(outlineVertexCount(6) * 3);
    writeCellOutline(g, 4 * size + 6, { samplesPerSide: 6, width: 0.3, lift: 0.05 }, out);
    for (let k = 0; k < out.length / 3; k++) {
      expect(out[k * 3 + 1]).toBeCloseTo(rayHeight(m, out[k * 3], out[k * 3 + 2]) + 0.05, 4);
    }
  });
  it('書き先の配列はそのまま使い回す (作り直さない)。別のセルを書けば位置が移る', () => {
    const size = 8;
    const g = gridOf(size, () => 0.2);
    const out = new Float32Array(outlineVertexCount(4) * 3);
    writeCellOutline(g, 0, opts, out);
    const first = out[0];
    writeCellOutline(g, 7, opts, out);
    expect(out[0]).toBeCloseTo(first + 7);
  });
});

describe('outlineIndices (帯の三角形)', () => {
  it('標本の輪を 1 周する四角ごとに 2 枚、すべての index は頂点の数の内', () => {
    const idx = outlineIndices(4);
    expect(idx.length).toBe(16 * 6);
    expect(Math.max(...idx)).toBe(31);
    expect(Math.min(...idx)).toBe(0);
  });
  it('最後の四角は最初の標本へ閉じる', () => {
    const idx = outlineIndices(4);
    const last = [...idx.slice(-6)];
    expect(last).toContain(0);
    expect(last).toContain(1);
    expect(last).toContain(30);
    expect(last).toContain(31);
  });
});

describe('cellMarkerAnchor (浮かぶ印の足もと)', () => {
  it('セルの中心の x・z で、セルの上の面の最も高い所', () => {
    const size = 8;
    const g = gridOf(size, (x) => (x === 3 ? 1 : 0), 10);
    const a = cellMarkerAnchor(g, 1 * size + 2); // (2, 1): 右隣の頂点列 x=3 が高い
    expect(a.x).toBeCloseTo(2 - size / 2 + 0.5);
    expect(a.z).toBeCloseTo(1 - size / 2 + 0.5);
    expect(a.y).toBeGreaterThan(surfaceHeightAt(g, a.x, a.z));
    expect(a.y).toBeLessThanOrEqual(10 + 1e-6);
  });
  it('海のセルでは海面 (床) より下にならない', () => {
    const g = gridOf(4, () => 0, 10, 2.5);
    expect(cellMarkerAnchor(g, 5).y).toBe(2.5);
  });
});

describe('印の大きさと上下 (M22-10)', () => {
  it('カメラが遠いほど大きく、上下に頭打ち', () => {
    expect(markerScale(10)).toBeLessThan(markerScale(100));
    expect(markerScale(1)).toBe(markerScale(0.5));
    expect(markerScale(10_000)).toBe(markerScale(20_000));
  });
  it('帯の幅も遠いほど太く、上下に頭打ち (セルの半分を超えない)', () => {
    expect(outlineWidth(20)).toBeLessThan(outlineWidth(150));
    expect(outlineWidth(10_000)).toBeLessThanOrEqual(0.5);
    expect(outlineWidth(0)).toBeGreaterThan(0);
  });
  it('上下はゆっくりした往復で、動きを減らす設定なら 0', () => {
    expect(markerBob(0, false)).toBeCloseTo(0);
    const ys = Array.from({ length: 40 }, (_, i) => markerBob(i * 0.1, false));
    expect(Math.max(...ys)).toBeGreaterThan(0.1);
    expect(Math.min(...ys)).toBeLessThan(-0.1);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(0.3);
    for (const t of [0, 0.4, 1.3, 7]) expect(markerBob(t, true)).toBe(0);
  });
});

describe('hiddenFrom (M21-08: 選んだセルが手前の地形に隠れているか)', () => {
  /** three の Raycaster で、目から点へ向かう光線が点より手前で地形に当たるか (描いている地形そのもの) */
  const rayHidden = (m: Mesh, eye: Vector3, point: Vector3): boolean => {
    const dir = point.clone().sub(eye);
    const hit = new Raycaster(eye, dir.clone().normalize()).intersectObject(m, false)[0];
    return !!hit && hit.distance < dir.length() - 0.3;
  };
  // 32 の島の真ん中 (z = 0 の行) に東西の尾根 (標高 1 × hs 12)。ほかは平ら (0.1)
  const ridge = gridOf(32, (_, y) => (y === 16 ? 1 : 0.1));
  const mesh = terrainMesh(ridge);
  const onSurface = (x: number, z: number) => new Vector3(x, surfaceHeightAt(ridge, x, z) + 0.05, z);

  it('尾根の向こうの低い所は、低い目からは隠れ、真上の目からは見える', () => {
    const behind = onSurface(0.5, -8.5);
    const low = new Vector3(0.5, 4, 14);
    const high = new Vector3(0.5, 60, -8);
    expect(hiddenFrom(ridge, low, behind)).toBe(true);
    expect(hiddenFrom(ridge, high, behind)).toBe(false);
    expect(rayHidden(mesh, low, behind)).toBe(true);
    expect(rayHidden(mesh, high, behind)).toBe(false);
  });

  it('尾根の手前の点と、尾根より高く浮いた点は見える', () => {
    const low = new Vector3(0.5, 4, 14);
    const front = onSurface(0.5, 6.5);
    const floating = new Vector3(0.5, 20, -8.5);
    expect(hiddenFrom(ridge, low, front)).toBe(false);
    expect(hiddenFrom(ridge, low, floating)).toBe(false);
    expect(rayHidden(mesh, low, front)).toBe(false);
    expect(rayHidden(mesh, low, floating)).toBe(false);
  });

  it('点の足もとの面 (尾根の頂の上の点) は、点を隠さない', () => {
    const top = onSurface(0.5, 0.5);
    const low = new Vector3(0.5, 4, 14);
    expect(hiddenFrom(ridge, low, top)).toBe(false);
    expect(rayHidden(mesh, low, top)).toBe(false);
  });
});
