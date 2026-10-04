import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { writeCellOutline, outlineVertexCount, type SurfaceGrid } from '../../src/render/cellHighlight';
import { cellViewOf, outlineBounds, pinMaskOf, PIN_ID_RGB, selectionOf } from '../../src/render/inspect';

const SIZE = 8;
const HS = 10;
const HEAD = 1.7;

const gridOf = (f: (x: number, y: number) => number): SurfaceGrid => {
  const elevation = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) elevation[y * SIZE + x] = f(x, y);
  return { elevation, size: SIZE, heightScale: HS, floor: -Infinity };
};

/** eye から target を見るカメラ (SceneView と同じ画角 50°、画面 400x300) */
const cameraAt = (eye: [number, number, number], target: Vector3): PerspectiveCamera => {
  const c = new PerspectiveCamera(50, 400 / 300, 0.1, 1000);
  c.position.set(...eye);
  c.lookAt(target);
  c.updateMatrixWorld();
  return c;
};

const VIEW = { width: 400, height: 300 };
/** セル (3, 4) の中心 (世界座標) */
const CELL = 4 * SIZE + 3;
const CELL_CENTER = new Vector3(3 - SIZE / 2 + 0.5, 0, 4 - SIZE / 2 + 0.5);

describe('cellViewOf (M21-08: 選んだセルの見え方を、画を撮る前に読む)', () => {
  const land = gridOf(() => 0.6);

  it('印の頭は画面の内・セルは隠れず、セルの面は狙いより下・カメラの側へ片寄った位置に落ちる', () => {
    const at = new Vector3(CELL_CENTER.x, 9, CELL_CENTER.z);
    const cam = cameraAt([CELL_CENTER.x + 3, 20, CELL_CENTER.z + 6], at);
    const v = cellViewOf(land, cam, at, VIEW, HEAD, CELL);
    expect(v.sea).toBe(false);
    expect(v.cellHidden).toBe(false);
    expect(v.markerHidden).toBe(false);
    expect(v.markerOnScreen).toBe(true);
    expect(v.screen.y).toBeGreaterThan(VIEW.height / 2);
    expect(v.screen.y).toBeLessThan(VIEW.height);
    expect(v.screen.x).toBeLessThan(VIEW.width / 2);
    expect(v.screen.x).toBeGreaterThan(0);
  });

  it('カメラがセルと反対を向いていれば、印の頭は画面の外', () => {
    const away = new Vector3(CELL_CENTER.x, 6, CELL_CENTER.z + 40);
    const cam = cameraAt([CELL_CENTER.x, 20, CELL_CENTER.z + 6], away);
    expect(cellViewOf(land, cam, away, VIEW, HEAD, CELL).markerOnScreen).toBe(false);
  });

  it('標高が海面より低いセルは sea', () => {
    const wet = gridOf((x, y) => (x === 3 && y === 4 ? 0.1 : 0.6));
    const at = new Vector3(CELL_CENTER.x, 2, CELL_CENTER.z);
    const cam = cameraAt([CELL_CENTER.x, 20, CELL_CENTER.z + 6], at);
    expect(cellViewOf(wet, cam, at, VIEW, HEAD, CELL).sea).toBe(true);
  });

  it('手前に高い地形の壁があれば、セルの面も印の頭も隠れる', () => {
    const wall = gridOf((x, y) => (y === 6 ? 3 : 0.6));
    const at = new Vector3(CELL_CENTER.x, 6, CELL_CENTER.z);
    const cam = cameraAt([CELL_CENTER.x, 8, CELL_CENTER.z + 3], at);
    const v = cellViewOf(wall, cam, at, VIEW, HEAD, CELL);
    expect(v.cellHidden).toBe(true);
    expect(v.markerHidden).toBe(true);
  });
});

describe('selectionOf / outlineBounds (強調の今の状態を読む)', () => {
  const surface = gridOf(() => 0.6);
  const pos = new Float32Array(outlineVertexCount(8) * 3);
  writeCellOutline(surface, CELL, { samplesPerSide: 8, width: 0.2, lift: 0.06 }, pos);
  const view = { sea: false, cellHidden: false, markerHidden: false, markerOnScreen: true, screen: { x: 1, y: 2 } };
  const shown = { size: SIZE, cell: CELL, outlinePos: pos, shown: true, marker: { x: 1, y: 2, z: 3, scale: 0.5 }, drawCalls: 7, camera: { x: 4, y: 5, z: 6 }, view };

  it('帯の頂点の外接の四角は、セルの四角に帯の幅の半分を足したもの', () => {
    const b = outlineBounds(pos);
    const x0 = 3 - SIZE / 2;
    const z0 = 4 - SIZE / 2;
    expect(b.minX).toBeCloseTo(x0 - 0.1, 5);
    expect(b.maxX).toBeCloseTo(x0 + 1 + 0.1, 5);
    expect(b.minZ).toBeCloseTo(z0 - 0.1, 5);
    expect(b.maxZ).toBeCloseTo(z0 + 1 + 0.1, 5);
  });

  it('出しているときは、セル・帯・印・見え方・カメラ・draw call を返す', () => {
    const s = selectionOf(shown);
    expect(s.cell).toBe(CELL);
    expect(s.size).toBe(SIZE);
    expect(s.outline).toEqual(outlineBounds(pos));
    expect(s.marker).toEqual({ x: 1, y: 2, z: 3, scale: 0.5 });
    expect(s.drawCalls).toBe(7);
    expect(s.view).toEqual(view);
    expect(s.camera).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('選びが無い (出していない) ときは、cell・outline・marker・view が null で、size とカメラは返す', () => {
    const s = selectionOf({ ...shown, shown: false, marker: null, view: null });
    expect(s).toMatchObject({ cell: null, outline: null, marker: null, view: null, size: SIZE, camera: { x: 4, y: 5, z: 6 } });
  });

  it('読むだけで、渡した帯の頂点を書き換えない', () => {
    const copy = Float32Array.from(pos);
    selectionOf(shown);
    expect(pos).toEqual(copy);
  });
});

describe('pinMaskOf (M25-02: ピンだけを 1 色で描いた画から、見える画素の面積と外接の四角を読む)', () => {
  const [r, g, b] = PIN_ID_RGB;
  /** w x h の RGBA (GL の読み出しの順 = 下の行が先)。下から数えた行 y の x にピンの色を置く */
  const glImage = (w: number, h: number, pins: [number, number][]) => {
    const px = new Uint8Array(w * h * 4);
    for (const [x, y] of pins) px.set([r, g, b, 255], (y * w + x) * 4);
    return px;
  };

  it('ピンの色の画素の数と、画面の上から数えた外接の四角を返す', () => {
    // 4x3。GL の下から 0 行目 (= 画面の 2 行目 = 一番下) に 2 つ、下から 1 行目に 1 つ
    const m = pinMaskOf(glImage(4, 3, [[1, 0], [2, 0], [2, 1]]), 4, 3);
    expect(m.area).toBe(3);
    expect(m.bounds).toEqual({ minX: 1, maxX: 2, minY: 1, maxY: 2 });
    expect(m.mask[2 * 4 + 1]).toBe(1);
    expect(m.mask[1 * 4 + 2]).toBe(1);
    expect(m.mask[0]).toBe(0);
  });

  it('ピンの色でない画素 (地形の深さで隠れて描かれなかった所・背景) は数えない。全部隠れれば面積 0・bounds は null', () => {
    const none = pinMaskOf(new Uint8Array(4 * 3 * 4), 4, 3);
    expect(none.area).toBe(0);
    expect(none.bounds).toBeNull();
    const px = glImage(2, 2, [[0, 0]]);
    px.set([r, g, 0, 255], (1 * 2 + 1) * 4);
    expect(pinMaskOf(px, 2, 2).area).toBe(1);
  });
});
