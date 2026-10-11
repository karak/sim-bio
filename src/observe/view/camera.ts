import { Box3, Raycaster, Sphere, Vector3, type Group } from 'three';
import type { TimelineEvent } from '../../scenario/ScenarioRunner';
import { mulberry32 } from '../../simulation/rng';
import type { Landmarks, Point } from '../area';
import { CELL_M, type TerrainField } from '../render/terrain';
import type { LodProps } from '../render/instancer';
import type { ShipView } from '../render/ship';
import { createShotCamera, frameBlocked, inFoliage, type AvoidZone } from '../render/shotCamera';
import type { ObserveInspect } from '../inspect';
import { directorContext, stepDirector, type Shot } from '../director';
import { detectScenes, sceneFrame, type SceneEvent, type SceneFrame } from '../scenes';
import { AREA_R, OPT } from './options';
import type { Stage } from './stage';
import type { ViewState } from './state';

export const DEPART_S = 70;

export type FramingInput = { field: TerrainField; stage: Stage; lods: LodProps[]; settlement: Group; marks: Landmarks; slip: Point; state: ViewState };

export type Framing = { presets: Record<string, () => void>; lookInsp: ObserveInspect['look'] };

export function createFraming({ field, stage: { camera, controls }, lods, settlement, marks, slip, state }: FramingInput): Framing {
  // 美観チェック用のカメラの寄せ先 (自動カメラ M22-08 までの仮)。群れ・狼は今いる個体の重心へ寄る
  const lookFrom = (tx: number, tz: number, dist: number, height: number, yaw: number) => {
    const ty = field.heightAt(tx, tz);
    controls.target.set(tx, ty + 1.2, tz);
    // (M22-03: 林の置き方が変わると寄せ先のカメラが樹冠に入るので、狙いとの間に木があれば向きを少しずつ振って見通しの良い所を探す。
    // どの向きも塞がっていれば、最初の向きで木の手前に寄せる)
    const blockers = [...lods.map((l) => l.group), settlement];
    const place = (yw: number) => {
      const cx = tx + Math.sin(yw) * dist;
      const cz = tz + Math.cos(yw) * dist;
      camera.position.set(cx, Math.max(ty + height, field.heightAt(cx, cz) + 1.6), cz);
      const to = camera.position.clone().sub(controls.target);
      const len = to.length();
      const hit = new Raycaster(controls.target.clone(), to.clone().normalize(), 0, len).intersectObjects(blockers, true)[0];
      // (M22-07 の樹冠の隙間で、見通しは通っても樹冠の中に入ることがあるので、カメラの周りも見る)
      camera.lookAt(controls.target);
      const near = inFoliage(camera.position, blockers) || frameBlocked(camera, blockers);
      return { to: to.normalize(), hit: hit ?? (near ? { distance: len * 0.6 } : undefined) };
    };
    for (const dy of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) if (!place(yaw + dy).hit) return;
    const { to, hit } = place(yaw);
    if (hit) camera.position.copy(controls.target).addScaledVector(to, Math.max(4, hit.distance - 1.5));
  };
  // 群れは区域の縁の何か所かに分かれるので、重心ではなく「15 m 以内の仲間が最も多い個体」に寄る
  const centroid = (sp: string) => {
    const xs = state.agents.agents.filter((a) => a.species === sp && a.state !== 'enter' && a.state !== 'leave');
    let best: { x: number; z: number } | null = null;
    let bestN = -1;
    for (const a of xs) {
      const n = xs.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 15).length;
      if (n > bestN) {
        bestN = n;
        best = { x: a.x, z: a.z };
      }
    }
    return best;
  };
  const presets: Record<string, () => void> = {
    集落: () => lookFrom(marks.center.x, marks.center.z, 30, 10, 1.9),
    船台: () => lookFrom(slip.x, slip.z, 40, 9, 0.9),
    群れ: () => {
      const c = centroid('deer') ?? marks.center;
      lookFrom(c.x, c.z, 14, 2.6, 0.6);
    },
    林: () => (marks.grove ? lookFrom(marks.grove.x, marks.grove.z, 26, 4, -0.8) : undefined),
    狼: () => {
      const c = centroid('wolf') ?? marks.center;
      lookFrom(c.x, c.z, 16, 3.5, 2.0);
    },
    // 海岸は林の上から見下ろす (低いと手前の鐘樹の樹冠に入る)
    海岸: () => lookFrom(marks.coast.x, marks.coast.z, 55, 24, 3.6),

  };
  // (草の磨き上げ) 調整用: 種の群れ (または点 {x, z}) へ寄る (__probe.observe.look('rabbit', 距離, 高さ, 向き))。兎が草に埋もれないかを近くの低い目で確かめる
  const lookInsp: ObserveInspect['look'] = (at, dist = 6, height = 1.2, yaw = 0) => {
    const c = typeof at === 'string' ? centroid(at) : at;
    if (c) lookFrom(c.x, c.z, dist, height, yaw);
  };
  return { presets, lookInsp };
}

export type DirectorInput = FramingInput & {
  shipView: ShipView;
  shots: HTMLElement;
  playScene(e: SceneEvent): void;
  notice(e: TimelineEvent): void;
};

export function createDirector({ field, stage: { camera, controls }, lods, settlement, shipView, marks, slip, state, shots, playScene, notice }: DirectorInput): { direct(dt: number): void } {
  // 自動カメラ (M22-08): 場面の引き金・狩り・民・群れ・風景からショットを選び、触れば自由カメラ、20 秒触らなければ戻る
  // 舟の見上げ以外は、舟を狙いより手前に映さない (集落の俯瞰が帆柱の真上に立ったため)
  const shipBox = new Box3();
  const shipBall = new Sphere();
  const shipAvoid = (shot: Shot): AvoidZone[] => {
    if (!shipView.node() || shot.kind === 'shipLookUp') return [];
    shipBox.setFromObject(shipView.group);
    if (shipBox.isEmpty()) return [];
    shipBox.getBoundingSphere(shipBall);
    return [{ x: shipBall.center.x, y: shipBall.center.y, z: shipBall.center.z, r: shipBall.radius }];
  };
  const shotCam = createShotCamera(camera, field.heightAt, () => [...lods.map((l) => l.group), settlement, shipView.group], AREA_R * CELL_M, mulberry32(31), shipAvoid);
  let prevFrame: SceneFrame | null = null;
  let shownShot: Shot | null = null;
  controls.addEventListener('start', () => (state.touched = true));
  shots.addEventListener('click', () => (state.touched = true));
  const drng = mulberry32(37);
  const baseFov = camera.fov;
  // 飛び立ちの画 (M22-08、key-visuals/departure): 自動カメラの間は、船台の後ろの高い所から外海へ去る舟を追う
  const shipAt = new Vector3();
  const departCam = (dt: number): boolean => {
    if (state.departLeft <= 0) return false;
    state.departLeft -= dt;
    const b = marks.slipwayBow;
    const y = field.heightAt(slip.x, slip.z);
    camera.position.set(slip.x - b.x * 62 + b.z * 22, y + 20, slip.z - b.z * 62 - b.x * 22);
    shipView.group.getWorldPosition(shipAt);
    camera.lookAt(shipAt.x, shipAt.y - 2, shipAt.z);
    if (camera.fov !== 40) {
      camera.fov = 40;
      camera.updateProjectionMatrix();
    }
    return true;
  };
  const followDelta = new Vector3();
  const direct = (dt: number) => {
    const frame = sceneFrame(state.snap, state.area);
    const scenes = detectScenes(prevFrame, frame, state.newEvents, state.area);
    for (const e of state.newEvents) notice(e);
    state.newEvents = [];
    for (const e of scenes) playScene(e);
    prevFrame = frame;
    const was = state.director.mode;
    state.director = stepDirector(state.director, directorContext(state.agents.agents, marks), { dt, scenes, userInput: state.touched }, drng);
    // auto=0 のあいだは自動に戻らない
    if (!OPT.auto) state.director = { ...state.director, mode: 'free', shot: null, idle: 0 };
    state.touched = false;
    if (state.director.mode === 'auto' && departCam(dt)) {
      shownShot = null;
      return;
    }
    if (state.director.mode === 'auto' && state.director.shot) {
      if (state.director.shot !== shownShot) {
        shownShot = state.director.shot;
        shotCam.start(state.director.shot, state.agents.agents);
      }
      shotCam.update(dt, state.agents.agents);
      return;
    }
    if (was === 'auto') {
      // 自由カメラに移る: 今の狙いを操作の中心にし、画角を戻す
      controls.target.copy(shotCam.target());
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      shownShot = null;
    }
    // 個体を追う (M22-08): 押した個体が動いたぶん、狙いとカメラを一緒に動かす
    const f = state.followId !== null ? state.agents.agents.find((a) => a.id === state.followId) : undefined;
    if (state.followId !== null && !f) state.followId = null;
    if (f) {
      const y = field.heightAt(f.x, f.z) + 0.8;
      followDelta.set(f.x - controls.target.x, y - controls.target.y, f.z - controls.target.z).multiplyScalar(Math.min(1, dt * 3));
      controls.target.add(followDelta);
      camera.position.add(followDelta);
    }
    controls.update();
  };
  return { direct };
}

export type PointerInput = { canvas: HTMLCanvasElement; field: TerrainField; stage: Stage; state: ViewState };

export function bindPointer({ canvas, field, stage: { camera }, state }: PointerInput): { screenInsp: ObserveInspect['screen'] } {
  // 個体を押す (ドラッグでない短い押し) と、その個体を追う。何もない所を押すと追うのをやめる
  const down = { x: 0, y: 0 };
  const proj = new Vector3();
  // 試験用 (E2E): 個体の画面上の位置 (canvas の左上から px)。画面の外・カメラの後ろなら null
  const screenInsp: ObserveInspect['screen'] = (id) => {
    const a = state.agents.agents.find((g) => g.id === id);
    if (!a) return null;
    proj.set(a.x, field.heightAt(a.x, a.z) + 0.8, a.z).project(camera);
    if (proj.z > 1 || Math.abs(proj.x) > 0.9 || Math.abs(proj.y) > 0.9) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((proj.x + 1) / 2) * r.width, y: r.top + ((1 - proj.y) / 2) * r.height };
  };
  canvas.addEventListener('pointerdown', (e) => {
    down.x = e.clientX;
    down.y = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const r = canvas.getBoundingClientRect();
    let best: number | null = null;
    let bestD = 40;
    for (const a of state.agents.agents) {
      proj.set(a.x, field.heightAt(a.x, a.z) + 0.8, a.z).project(camera);
      if (proj.z > 1) continue;
      const d = Math.hypot(((proj.x + 1) / 2) * r.width - (e.clientX - r.left), ((1 - proj.y) / 2) * r.height - (e.clientY - r.top));
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    state.followId = best;
    state.touched = true;
  });
  return { screenInsp };
}
