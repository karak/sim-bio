import { Raycaster, Vector2, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { Agent } from '../agents';
import type { Point } from '../area';
import type { Shot, ShotKind } from '../director';

/**
 * 自動カメラのショットを実際のカメラの動きにする (M22-08、設計 §7)。director.ts が選んだショットの種類と狙いから、
 * ショットの間のカメラの位置・狙い・画角を決める。ショットの切り替えは切る (つながない) が、ショットの中の追従はなめらかにする。
 * - 狙いとの間に木があれば、向きを振って見通しの良い所を選ぶ (ショットの始めに一度だけ)。
 * - 高さは地面 + 0.5 m 以上、区域の外 (半径 maxR) には出ない。
 */
type Frame = {
  /** 狙いから見たカメラの距離・高さ (狙いの地面から)・向き (ラジアン)・画角 */
  dist: number;
  height: number;
  fov: number;
  /** ショットの間に向きを回す速さ (ラジアン / 秒) と、横に動く速さ (m / 秒) */
  orbit: number;
  track: number;
  /** 狙いの高さ (狙いの地面から) */
  aim: number;
};

const FRAMES: Readonly<Record<ShotKind, Frame>> = {
  // 群れに寄る: 低い位置から望遠寄りで
  herdClose: { dist: 14, height: 1.3, fov: 26, orbit: 0.012, track: 0, aim: 0.9 },
  // 林を横移動: 目の高さで、林の縁に沿って横に動く
  groveTrack: { dist: 22, height: 2.2, fov: 38, orbit: 0, track: 0.8, aim: 2.5 },
  // 舟を見上げる: 低い所から、舟の帆柱の中ほどを狙う
  shipLookUp: { dist: 36, height: 1.6, fov: 40, orbit: 0.01, track: 0, aim: 7 },
  // 集落の俯瞰: 高い所からゆっくり回る
  settlementHigh: { dist: 46, height: 30, fov: 36, orbit: 0.025, track: 0, aim: 1 },
  // 狩りの追従: 追う側の斜め後ろから
  huntFollow: { dist: 11, height: 3, fov: 34, orbit: 0, track: 0, aim: 0.7 },
  // 海岸の引き: 林の上から海を広く
  coastWide: { dist: 60, height: 22, fov: 40, orbit: 0.008, track: 0, aim: 0 },
};

export type ShotCamera = {
  start(shot: Shot, agents: readonly Agent[]): void;
  update(dt: number, agents: readonly Agent[]): void;
  /** 今の狙い (自由カメラに移るとき、操作の中心に渡す) */
  target(): Vector3;
};

const AROUND = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

/** カメラの位置が樹冠の中か (6 方向 2.5 m 以内に木が 3 方向以上ある)。樹冠を房に分けたので、狙いとの見通しだけでは樹冠の中に入ることがある */
export function inFoliage(at: Vector3, blockers: Object3D[]): boolean {
  let n = 0;
  for (const d of AROUND) if (new Raycaster(at, d, 0, 2.5).intersectObjects(blockers, true).length > 0) n++;
  return n >= 3;
}

const GRID = [-0.5, 0, 0.5].flatMap((x) => [-0.5, 0, 0.5].map((y) => new Vector2(x, y)));

/**
 * 画の手前 NEAR_M 以内を木が塞いでいるか。画面の 3 × 3 の点から光線を出し、3 本以上が近くの木に当たれば塞がれている
 * (狙いとの見通しが樹冠の隙間を抜けても、手前の木が画を覆うことがあるため)。camera は位置と向きを決めてから渡す
 */
export function frameBlocked(camera: PerspectiveCamera, blockers: Object3D[], nearM = 10): boolean {
  camera.updateMatrixWorld();
  const rc = new Raycaster();
  rc.far = nearM;
  let n = 0;
  for (const p of GRID) {
    rc.setFromCamera(p, camera);
    if (rc.intersectObjects(blockers, true).length > 0) n++;
  }
  return n >= 3;
}

export function createShotCamera(camera: PerspectiveCamera, heightAt: (x: number, z: number) => number, blockers: () => Object3D[], maxR: number, rng: () => number): ShotCamera {
  let shot: Shot | null = null;
  let frame: Frame = FRAMES.settlementHigh;
  let yaw = 0;
  let t = 0;
  const aim = new Vector3();
  const want = new Vector3();
  const look = new Vector3();
  const subjectAt = (s: Shot, agents: readonly Agent[]): Point | null => {
    if ('agent' in s.subject) {
      const id = s.subject.agent;
      const a = agents.find((g) => g.id === id);
      return a ? { x: a.x, z: a.z } : null;
    }
    return s.subject;
  };
  const place = (p: Point, y: number, tt: number, out: Vector3) => {
    const yw = yaw + frame.orbit * tt;
    const tx = p.x + Math.cos(yaw) * frame.track * (tt - (shot?.duration ?? 0) / 2);
    const tz = p.z - Math.sin(yaw) * frame.track * (tt - (shot?.duration ?? 0) / 2);
    let cx = tx + Math.sin(yw) * frame.dist;
    let cz = tz + Math.cos(yw) * frame.dist;
    const r = Math.hypot(cx, cz);
    if (r > maxR) {
      cx *= maxR / r;
      cz *= maxR / r;
    }
    out.set(cx, Math.max(y + frame.height, heightAt(cx, cz) + 0.5), cz);
  };
  const clear = (p: Point, y: number): boolean => {
    const from = new Vector3(p.x, y + frame.aim, p.z);
    place(p, y, 0, want);
    const to = want.clone().sub(from);
    const len = to.length();
    if (new Raycaster(from, to.normalize(), 0, len).intersectObjects(blockers(), true).length > 0 || inFoliage(want, blockers())) return false;
    // 手前の木が画を覆わないか、実際の向きで確かめる
    const keep = camera.position.clone();
    const keepQ = camera.quaternion.clone();
    camera.position.copy(want);
    camera.lookAt(from);
    const blocked = frameBlocked(camera, blockers());
    camera.position.copy(keep);
    camera.quaternion.copy(keepQ);
    return !blocked;
  };
  return {
    start(s, agents) {
      shot = s;
      frame = FRAMES[s.kind];
      t = 0;
      const p = subjectAt(s, agents) ?? { x: 0, z: 0 };
      const y = heightAt(p.x, p.z);
      // 追う個体は、動く向きの斜め後ろから。ほかは乱数の向きから始めて、木に塞がれない向きを探す
      const a = 'agent' in s.subject ? agents.find((g) => 'agent' in s.subject && g.id === s.subject.agent) : undefined;
      const base = a ? a.heading + Math.PI + 0.6 : rng() * Math.PI * 2;
      yaw = base;
      for (const dy of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2, Math.PI]) {
        yaw = base + dy;
        if (clear(p, y)) break;
      }
      camera.fov = frame.fov;
      camera.updateProjectionMatrix();
      aim.set(p.x, y + frame.aim, p.z);
      place(p, y, 0, camera.position);
      camera.lookAt(aim);
    },
    update(dt, agents) {
      if (!shot) return;
      t += dt;
      const p = subjectAt(shot, agents);
      if (!p) return;
      const y = heightAt(p.x, p.z);
      look.set(p.x, y + frame.aim, p.z);
      // 追う個体はなめらかに (1 秒で 8 割ほど寄る)、止まった狙いはそのまま
      const k = 1 - Math.exp(-dt * 1.6);
      aim.lerp(look, 'agent' in shot.subject ? k : 1);
      place(p, y, t, want);
      if ('agent' in shot.subject) camera.position.lerp(want, k);
      else camera.position.copy(want);
      camera.lookAt(aim);
    },
    target: () => aim.clone(),
  };
}
