import type { DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TimelineEvent } from '../scenario/ScenarioRunner';
import type { AtmospherePass } from './render/atmosphere';
import type { triangleBreakdown } from './render/breakdown';

/**
 * 観察画面の試験の口 (M25-09)。観察画面は window に何も書かず、inspect() を返す。
 * window に載せるのは開発・受入のビルドだけが読み込む src/dev/probe.ts で、本番のビルドには入らない。
 * notice・fx・look は場面を起こす・カメラを寄せる調整の手 (試作・撮影用)、ほかは読むだけで何も変えない。
 */

/** 0.5 秒ごとに更新される計測 (三角形・draw call・fps・個体の数・素材の読み込み) */
export type ObserveStats = {
  follow: number | null;
  camera: string;
  at: number[];
  year: number;
  tick: number;
  speed: number;
  ship: unknown;
  phase: number;
  fps: number;
  res: number;
  calls: number;
  triangles: number;
  deer: number;
  wolf: number;
  rabbit: number;
  folk: number;
  trees: number;
  grass: number;
  assets: { deer: boolean; belltree: boolean; settlement: boolean; flora: boolean; wolf: boolean; rabbit: boolean };
};

export type ObserveDebug = {
  marks: unknown;
  agents: { id: number; sp: string; role: string; st: string; x: number; z: number }[];
};

export type ObserveInspect = {
  /** 空気の層の uniform と時刻を触る手 (M22-07) */
  air: { air: AtmospherePass | null; sun: DirectionalLight; camera: PerspectiveCamera; controls: OrbitControls; scene: Scene; renderer: WebGLRenderer; heightAt: (x: number, z: number) => number };
  /** 知らせの帯に知らせを出す */
  notice(e: TimelineEvent): void;
  /** 場面を起こす */
  fx(kind: 'sprout' | 'mist' | 'rain' | 'sinking'): void;
  /** 種の群れ (または点) へ寄る */
  look(at: string | { x: number; z: number }, dist?: number, height?: number, yaw?: number): void;
  huts(): { x: number; y: number; z: number; ry: number }[];
  props(): { name: string; at: number[][] }[];
  /** 区分ごとの三角形の内訳 */
  breakdown(): ReturnType<typeof triangleBreakdown>;
  /** 個体の画面上の位置 (canvas の左上から px)。画面の外・カメラの後ろなら null */
  screen(id: number): { x: number; y: number } | null;
  /** 直近の計測。0.5 秒たつまでは null */
  stats(): ObserveStats | null;
  debug(): ObserveDebug | null;
  /** いま載せている地形の頂点の高さの要約 (M26-07)。島が替わって観察画面が組み直されたかを、見た目に頼らず読む */
  terrainDigest(): number;
};
