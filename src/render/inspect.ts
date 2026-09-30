import { Vector3, type PerspectiveCamera } from 'three';
import { SEA_LEVEL } from '../simulation/terrain';
import { cellMarkerAnchor, hiddenFrom, markerScale, type SurfaceGrid } from './cellHighlight';

/**
 * 操作画面の 3D の島 (SceneView) の試験の口 (M25-09)。SceneView は window に何も書かず、読むだけの inspect() を返す。
 * window に載せるのは開発・受入のビルドだけが読み込む src/dev/probe.ts で、本番のビルドには入らない。
 */

/** 選んだセルの見え方 (M21-08)。screen はセルの面の canvas の上の位置 (CSS px)。地形は選んだセルを置いた時のもの */
export type CellView = {
  sea: boolean;
  cellHidden: boolean;
  markerHidden: boolean;
  markerOnScreen: boolean;
  screen: { x: number; y: number };
};

export type OutlineBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export type SceneSelection = {
  cell: number | null;
  size: number;
  outline: OutlineBounds | null;
  marker: { x: number; y: number; z: number; scale: number } | null;
  drawCalls: number;
  view: CellView | null;
  camera: { x: number; y: number; z: number };
};

export type SceneInspect = {
  /** 強調の今の状態。読むだけで何も変えない */
  selection(): SceneSelection;
  /** 選んだセルがあるとき、任意のセルの見え方。選びが無ければ null */
  cell(cell: number): CellView | null;
};

/**
 * M21-08: 画を撮る前に、今のカメラからセルの面と印の頭が地形に隠れていないか、印の頭が画面の内にあるかを確かめる。
 * headOffset は印の足もとから頭までの高さ (大きさ 1 のとき)。target はカメラの狙い (印の大きさを距離で決める)
 */
export function cellViewOf(surface: SurfaceGrid, camera: PerspectiveCamera, target: Vector3, view: { width: number; height: number }, headOffset: number, cell: number): CellView {
  const at = cellMarkerAnchor(surface, cell);
  const k = markerScale(camera.position.distanceTo(target));
  const head = new Vector3(at.x, at.y + headOffset * k, at.z);
  const top = head.clone().project(camera);
  const face = new Vector3(at.x, at.y, at.z).project(camera);
  return {
    sea: surface.elevation[cell] < SEA_LEVEL,
    cellHidden: hiddenFrom(surface, camera.position, at),
    markerHidden: hiddenFrom(surface, camera.position, head),
    markerOnScreen: Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 && top.z < 1,
    screen: { x: ((face.x + 1) / 2) * view.width, y: ((1 - face.y) / 2) * view.height },
  };
}

/** 帯の頂点 (x, y, z の並び) の x・z の外接の四角 */
export function outlineBounds(pos: ArrayLike<number>): OutlineBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]);
    maxX = Math.max(maxX, pos[i]);
    minZ = Math.min(minZ, pos[i + 2]);
    maxZ = Math.max(maxZ, pos[i + 2]);
  }
  return { minX, maxX, minZ, maxZ };
}

export type SelectionState = {
  size: number;
  /** 出している帯のセル (出していなければ何でもよい) */
  cell: number;
  outlinePos: ArrayLike<number>;
  /** 帯を出しているか */
  shown: boolean;
  marker: { x: number; y: number; z: number; scale: number } | null;
  drawCalls: number;
  camera: { x: number; y: number; z: number };
  view: CellView | null;
};

export function selectionOf(s: SelectionState): SceneSelection {
  return {
    cell: s.shown ? s.cell : null,
    size: s.size,
    outline: s.shown ? outlineBounds(s.outlinePos) : null,
    marker: s.marker,
    drawCalls: s.drawCalls,
    view: s.view,
    camera: s.camera,
  };
}
