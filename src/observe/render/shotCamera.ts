import { PerspectiveCamera, Raycaster, Vector2, Vector3, type Object3D } from 'three';
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
  // (水平線を入れるため、狙いを 8 m 上げて俯角を 13° ほどに。カメラは陸の側から海を向く — start の向きの決め方)
  coastWide: { dist: 60, height: 22, fov: 40, orbit: 0.008, track: 0, aim: 8 },
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

/** この高さ (狙いの地面から、m) 以上のショットは見下ろし */
const HIGH_M = 20;
/** カメラの前 LIFT_NEAR_M 以内の個体を越すために持ち上げる高さ (いちばん近いとき) */
const LIFT_NEAR_M = 6;
const LIFT_M = 2.4;

const GRID = [-0.5, 0, 0.5].flatMap((x) => [-0.5, 0, 0.5].map((y) => new Vector2(x, y)));

/**
 * 画の手前 NEAR_M 以内を木が塞いでいるか。画面の 3 × 3 の点から光線を出し、3 本以上が近くの木に当たれば塞がれている
 * (狙いとの見通しが樹冠の隙間を抜けても、手前の木が画を覆うことがあるため)。camera は位置と向きを決めてから渡す
 */
export function frameBlocked(camera: PerspectiveCamera, blockers: Object3D[], nearM = 10, upperOnly = false): boolean {
  camera.updateMatrixWorld();
  const rc = new Raycaster();
  rc.far = nearM;
  let n = 0;
  // (upperOnly: 高い所から見下ろすショットでは、画の下の段が眼下の樹冠に当たるのは覆われたことにしない)
  for (const p of upperOnly ? GRID.filter((g) => g.y >= 0) : GRID) {
    rc.setFromCamera(p, camera);
    if (rc.intersectObjects(blockers, true).length > 0) n++;
  }
  return n >= 3;
}

/** 画の手前に入れない球 (m)。舟のように、見通しを遮らなくても真下や脇から画に大きく入るもの。狙いより奥に映るのはよい */
export type AvoidZone = { x: number; y: number; z: number; r: number };

export function createShotCamera(
  camera: PerspectiveCamera,
  heightAt: (x: number, z: number) => number,
  blockers: () => Object3D[],
  maxR: number,
  rng: () => number,
  avoid: (s: Shot) => AvoidZone[] = () => [],
): ShotCamera {
  let shot: Shot | null = null;
  let frame: Frame = FRAMES.settlementHigh;
  let yaw = 0;
  let t = 0;
  const aim = new Vector3();
  const want = new Vector3();
  const look = new Vector3();
  // 狙いでない個体がカメラのすぐ前に入ったら、その上へ持ち上げて越す (望遠の寄りで手前の鹿が画を覆うため)
  let lift = 0;
  const liftFor = (agents: readonly Agent[], subject: number | null): number => {
    let need = 0;
    const fx = aim.x - want.x;
    const fz = aim.z - want.z;
    const fl = Math.hypot(fx, fz) || 1;
    for (const g of agents) {
      if (g.id === subject) continue;
      const dx = g.x - want.x;
      const dz = g.z - want.z;
      const d = Math.hypot(dx, dz);
      if (d > LIFT_NEAR_M || (dx * fx + dz * fz) / (fl * (d || 1)) < 0.5) continue;
      need = Math.max(need, LIFT_M * (1 - d / LIFT_NEAR_M) + 0.6);
    }
    return need;
  };
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
    clamped = r > maxR;
    if (r > maxR) {
      cx *= maxR / r;
      cz *= maxR / r;
    }
    // 見下ろしのショットは、カメラの足元の地面からも高さを取る (内陸の丘の上で樹冠に入らないように)
    const floor = frame.height >= HIGH_M ? frame.height * 0.8 : 0.5;
    out.set(cx, Math.max(y + frame.height, heightAt(cx, cz) + floor), cz);
  };
  let clamped = false;
  const probe = new PerspectiveCamera();
  const ndc = new Vector3();
  const inFront = (z: AvoidZone, at: Vector3, target: Vector3): boolean => {
    const c = new Vector3(z.x, z.y, z.z);
    const d = at.distanceTo(c);
    if (d < z.r) return true;
    if (d - z.r > at.distanceTo(target)) return false;
    probe.fov = frame.fov;
    probe.aspect = camera.aspect;
    probe.updateProjectionMatrix();
    probe.position.copy(at);
    probe.lookAt(target);
    probe.updateMatrixWorld();
    ndc.copy(c).project(probe);
    if (ndc.z > 1) return false;
    // 球の見かけの半径 (画面の高さの半分を 1 とする)
    const m = z.r / (d * Math.tan((frame.fov * Math.PI) / 360));
    return Math.abs(ndc.x) < 1 + m / probe.aspect && Math.abs(ndc.y) < 1 + m;
  };
  const clear = (p: Point, y: number): boolean => {
    const from = new Vector3(p.x, y + frame.aim, p.z);
    // ショットの始めと終わり (回る・横に動くぶん) のどちらも、避ける球が狙いより手前で画に入らないか
    const zones = shot ? avoid(shot) : [];
    for (const tt of [0, shot?.duration ?? 0]) {
      place(p, y, tt, want);
      // 区域の縁で押し戻される向きは、距離が縮んで真下を向くので選ばない
      if (clamped || zones.some((z) => inFront(z, want, from))) return false;
    }
    place(p, y, 0, want);
    const to = want.clone().sub(from);
    const len = to.length();
    if (new Raycaster(from, to.normalize(), 0, len).intersectObjects(blockers(), true).length > 0 || inFoliage(want, blockers())) return false;
    // 手前の木が画を覆わないか、実際の向きで確かめる
    const keep = camera.position.clone();
    const keepQ = camera.quaternion.clone();
    camera.position.copy(want);
    camera.lookAt(from);
    const blocked = frameBlocked(camera, blockers(), 10, frame.height >= HIGH_M);
    camera.position.copy(keep);
    camera.quaternion.copy(keepQ);
    return !blocked;
  };
  return {
    start(s, agents) {
      shot = s;
      frame = FRAMES[s.kind];
      t = 0;
      lift = 0;
      const p = subjectAt(s, agents) ?? { x: 0, z: 0 };
      const y = heightAt(p.x, p.z);
      // 追う個体は、動く向きの斜め後ろから。ほかは乱数の向きから始めて、木に塞がれない向きを探す
      const a = 'agent' in s.subject ? agents.find((g) => 'agent' in s.subject && g.id === s.subject.agent) : undefined;
      // 海岸の引きは区域の中心の側 (陸) から。海の側に立つと区域の縁に押し戻されて真下を向く
      const base = a ? a.heading + Math.PI + 0.6 : s.kind === 'coastWide' ? Math.atan2(-p.x, -p.z) + (rng() - 0.5) * 0.6 : rng() * Math.PI * 2;
      yaw = base;
      camera.fov = frame.fov;
      camera.updateProjectionMatrix();
      let found = false;
      for (const dy of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2, Math.PI]) {
        yaw = base + dy;
        if ((found = clear(p, y))) break;
      }
      // どの向きも塞がっていれば、最初の向き (海岸なら陸の側) に戻す
      if (!found) yaw = base;
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
      lift += (liftFor(agents, 'agent' in shot.subject ? shot.subject.agent : null) - lift) * (1 - Math.exp(-dt * 2.5));
      want.y += lift;
      if ('agent' in shot.subject) camera.position.lerp(want, k);
      else camera.position.copy(want);
      camera.lookAt(aim);
    },
    target: () => aim.clone(),
  };
}
