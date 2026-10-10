import {
  Box3,
  Sphere,
  Raycaster,
  Vector3,
} from 'three';
import type { WorldSnapshot } from '../simulation/types';
import type { TimelineEvent } from '../scenario/ScenarioRunner';
import { createNoticeBand } from './notice';
import { observeYearText } from '../core/season';
import { mulberry32 } from '../simulation/rng';
import { CELL_M, ELEV_M, createTerrainField, createTerrainMesh, groundLayers } from './render/terrain';
import { createWater } from './render/water';
import { createGrass } from './render/grass';
import { rimLight } from './render/toon';
import { loadGlb } from './render/assets';
import { glow } from './render/bake';
import { createCreatureView } from './render/creatures';
import { MIST_S, mistEnvelope, surgeStep, wetness, type SurgeState } from './fx';
import { createShotCamera, frameBlocked, inFoliage, type AvoidZone } from './render/shotCamera';
import { triangleBreakdown } from './render/breakdown';
import { terrainDigest } from '../render/inspect';
import type { ObserveDebug, ObserveInspect, ObserveStats } from './inspect';
import { directorContext, initialDirector, stepDirector, type Shot } from './director';
import { detectScenes, sceneFrame, type SceneEvent, type SceneFrame } from './scenes';
import { createDynamicResolution } from './render/dynamicResolution';
import { DAY_CYCLE_S, daylightAt, phaseAt } from './daylight';
import { extractArea, observeCenter } from './area';
import { K_DEFAULT, BUDGET_PER_SECOND, folkRuleFor, reconcile, targetCounts } from './population';
import { applyPlan, stepAgents, type AgentWorld } from './agents';
import type { ViewState } from './view/state';
import { AREA_R, OPT, params, WINDOW } from './view/options';
import { createComposite, createStage, disposeStage } from './view/stage';
import { layOutSite } from './view/layout';
import { createFlora } from './view/flora';
import { createSettlement } from './view/settlementBuild';

const DEPART_S = 70;

/**
 * 観察画面の置き場所 (M22-08)。試作のページ (observe.html) と操作画面の両方から使う。
 * clock があれば観察画面が自分で本体の時間を進め (試作)、無ければ呼び出し側が setSnapshot で本体の snapshot を渡す (操作画面)。
 */
export type ObserveHost = {
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  stats: HTMLElement;
  shots: HTMLElement;
  snapshot: WorldSnapshot;
  clock?: { step(n: number): void; snapshot(): WorldSnapshot };
  /** 種 id → 名前 (知らせの帯の文に使う) */
  names?: Record<string, string>;
  /** 計測の行と寄せ先のボタンを出す (試作のページ)。操作画面から入ったときは年だけを出す (設計 §7「UI は極力消す」) */
  debug?: boolean;
  /** 描きの時計 (ms)。t・動的な解像度・知らせの帯の時間の元。既定は performance.now()。止めた時計を渡すと t は進まず、撮る画が回ごとに変わらない (M25-02) */
  now?: () => number;
};

export type ObservationView = {
  /** 本体が進んだ snapshot を渡す (clock の無いとき)。timeline は石板の年表 (介入の場面を引くため、全体を渡してよい) */
  setSnapshot(s: WorldSnapshot, timeline?: readonly TimelineEvent[]): void;
  start(): void;
  stop(): void;
  /** 今のカメラ: 自動 (自然記録調)・自由 (触ったあと、20 秒で自動に戻る)・個体を追う */
  cameraMode(): 'auto' | 'free' | 'follow';
  /** 組んだ物を捨てる (M26-07): 止め、listener を外し、GPU の資源 (地形・素材・描画先・context) を解放する。以後は使わない */
  dispose(): void;
  /** 試験の口 (M25-09): 描いている物を読む。src/dev/probe.ts が開発・受入のビルドだけ window.__probe に繋ぐ */
  inspect(): ObserveInspect;
};

export async function createObservationView(host: ObserveHost): Promise<ObservationView> {
  const status = host.status;
  const s = host.snapshot;
  const nowMs = host.now ?? (() => performance.now());
  // (M19-18) 区域の中心。集落が無ければ島の真ん中の陸セルにし、集落だけの形 (小屋・船台など)・踏み固めた道・切り開き・民を置かない
  const { cell: home, settlement: hasSettlement } = observeCenter(s);
  const field = createTerrainField(s, home, WINDOW);

  const canvas = host.canvas;
  const stage = createStage(canvas, field);
  const { renderer, shadowOnly, scene, sky, camera, controls, hemi, sun } = stage;

  status.textContent = '地形を組んでいます…';
  const terrain = createTerrainMesh(s, field);
  scene.add(terrain);
  const water = createWater(field, 3000);
  scene.add(water.mesh);

  const [deerGlb, treeGlb, settleGlb, floraGlb, wolfGlb, rabbitGlb, shipGlb] = await Promise.all([
    loadGlb('/models/observe/deer.glb'),
    loadGlb('/models/observe/belltree.glb'),
    loadGlb('/models/observe/settlement.glb'),
    loadGlb('/models/observe/flora.glb'),
    loadGlb('/models/observe/wolf.glb'),
    loadGlb('/models/observe/rabbit.glb'),
    loadGlb('/models/observe/ship.glb'),
  ]);
  // (草の磨き上げ: 房の形は grass.ts の carpetTuft を使う (flora.glb の grass_tuft は星形に開いて判を押したように見えた)。地面と同じ層で色を決める)
  const grass = createGrass(field, groundLayers(s), OPT.grass, 7, undefined, (AREA_R + 1) * CELL_M);
  scene.add(grass.mesh);

  const { area, marks, slip, plaza, worn } = layOutSite(s, home, hasSettlement, field, terrain, grass);

  const rng = mulberry32(11);
  const flora = createFlora({ s, field, rng, hasSettlement, slip, treeGlb, floraGlb, stage });
  const { lods, stumpSet, forestSet, understory, replant } = flora;

  const settle = createSettlement({ s, field, rng, hasSettlement, marks, slip, plaza, worn, settleGlb, shipGlb, stage });
  const { settlement, hutSet, propSets, motes, puddles, shipView } = settle;

  // 月鹿: 近い OPT.near 頭は SkinnedMesh、残りは VAT の InstancedMesh (設計 §8 の群れの LOD)
  // (M22-04 の後: 近くの振り分けと VAT は render/creatures.ts に移し、頭数は個体層が決める)
  // 個体層 (M22-04): 区域の密度 → 目標頭数 → 出入りの計画 → 状態機械。民は集落の近く (半径 3 セル) の鹿だけにする
  // (設計どおり支え半径 8 にすると区域の鹿が全部民になり、夜は全頭が灯りに寄り、飛び立ちで群れが消える。M22-04 の申し送り)
  status.textContent = '鹿を焼いています…';
  const folk = folkRuleFor(hasSettlement ? s.civ : null, 3);
  let K = { ...K_DEFAULT };
  if (OPT.deer > 0) {
    const sum = area.cells.reduce((acc, c) => acc + (c.isLand ? (c.density['deer'] ?? 0) : 0), 0);
    if (sum > 0) K = { ...K, deer: OPT.deer / sum };
  }
  const targets = targetCounts(area, K, folk);
  // (M23-04 で変更: 近くの骨入りの個体の影は群れ LOD で落とす)
  // (M23-08 で変更: 遠い段に替える距離 OPT.cfar を渡す)
  const creatures = createCreatureView({ deer: deerGlb, wolf: wolfGlb, rabbit: rabbitGlb }, Math.max(400, targets.totals.deer * 2 + 50), (o) => shadowOnly.add(o), OPT.cfar);
  scene.add(creatures.group);
  let agents: AgentWorld = { agents: [], nextId: 1 };
  let credit = 0;
  const arng = mulberry32(23);
  // 開いた瞬間から群れが見えるよう、最初の 1 回だけ目標頭数ぶんを上限なしで出す
  {
    const plan = reconcile(agents.agents, targets, 1e6, 1, arng, 0);
    agents = applyPlan(agents, plan);
  }
  const state: ViewState = {
    snap: s,
    area,
    targets,
    building: !!s.ship && s.ship.launchedYear === undefined && (s.civ?.stage ?? 0) >= 5,
    agents,
    simSpeed: OPT.freeze ? 0 : OPT.speed,
    director: initialDirector(),
    touched: !OPT.auto,
    followId: null,
    departLeft: OPT.depart && OPT.auto ? DEPART_S : 0,
    newEvents: [],
    seenEvents: 0,
    // 入った (start した) あとの最初の年表は、見る前の出来事として既読にするだけ (入るたびに昔の介入を再生しない)
    baseline: true,
  };
  // 本体の時間 (M22-08): 速度 speed のとき実時間 1 秒に speed tick 進める (操作画面と同じ。1 年 = 360 tick)。
  // 進んだら区域の密度から目標頭数を引き直す。目印 (船台・林) は最初に決めたまま動かさない (船台は着工の年に決めて動かさない)
  let simAcc = 0;
  // 沈降 (M22-08): 集落のセルの標高が最初からどれだけ下がったかを、海面の上がりとして見せる
  const elev0 = s.layers.elevation[home];
  water.setLevel(OPT.sink);
  grass.setLevel(OPT.sink);
  // (M22-07 の手直し) 沈む海: 本体の沈降から決まる海面 seaTarget (と調整用の上げ seaExtra) へ、見せる海面 sea.level を上げていく
  let seaTarget = OPT.sink;
  let seaExtra = 0;
  let sea: SurgeState = { level: OPT.sink, surge: 0, hold: 0 };
  const onSnapshot = (next: WorldSnapshot) => {
    state.snap = next;
    replant(next);
    const level = OPT.sink + Math.max(0, elev0 - next.layers.elevation[home]) * ELEV_M;
    // (M22-07 の手直しで変更: 海面はすぐには上げず、fx で SURGE_RATE m/s で追わせ、上がる間は波立ちと流れを見せる (沈む海岸「波立ちがない。流れが見えない。」))
    seaTarget = level;
    state.area = extractArea(state.snap, home, AREA_R);
    state.targets = targetCounts(state.area, K, folkRuleFor(hasSettlement ? state.snap.civ : null, 3));
    state.building = !!state.snap.ship && state.snap.ship.launchedYear === undefined && (state.snap.civ?.stage ?? 0) >= 5;
    if (OPT.ship === null && !OPT.launched && !OPT.depart) shipView.set(state.snap.ship);
  };
  const clock = host.clock;
  const advance = (dt: number) => {
    if (!clock || state.simSpeed <= 0) return;
    simAcc += dt * state.simSpeed;
    const n = Math.min(Math.floor(simAcc), 50);
    if (n <= 0) return;
    simAcc -= n;
    clock.step(n);
    onSnapshot(clock.snapshot());
  };

  const { air, grade, resize } = createComposite(stage, canvas);
  // 調整用 (M22-07): 開発者ツールから空気の層の uniform と時刻を触る
  // 試験の口 (M25-09): window に書かず inspect() で返す。src/dev/probe.ts が開発・受入のビルドだけ window に繋ぐ
  let lastStats: ObserveStats | null = null;
  let lastDebug: ObserveDebug | null = null;
  const airInsp: ObserveInspect['air'] = { air, sun, camera, controls, scene, renderer, heightAt: field.heightAt };
  status.textContent = '';

  // 美観チェック用のカメラの寄せ先 (自動カメラ M22-08 までの仮)。群れ・狼は今いる個体の重心へ寄る
  const shots = host.shots;
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
  for (const [label, go] of host.debug === false ? [] : Object.entries(presets)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', go);
    shots.appendChild(b);
  }
  // 本体の速さ (M22-08 の仮。観察画面では 100x を選べない)
  // (操作画面から入ったときは操作画面の速さに従うので、ボタンは時間を自分で進めるとき (試作) だけ)
  for (const v of clock ? [0, 1, 10] : []) {
    const b = document.createElement('button');
    b.textContent = v === 0 ? '⏸' : `${v}x`;
    b.addEventListener('click', () => (state.simSpeed = v));
    shots.appendChild(b);
  }
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
  // 介入の場面 (M22-08): 芽吹きの金の粒・疫病の霧・雨。霧と雨は実時間で薄れる
  let mist = 0;
  // (M22-07 の手直し) 霧が立ってからの秒数。濃さと余韻は fx.ts の mistEnvelope が決める (MIST_S を過ぎたら消えている)
  let mistAge = MIST_S;
  let mistAt = { x: 0, y: 0, z: 0 };
  let mistR = 20;
  let rain = 0;
  let rainLeft = 0;
  // (M22-07 の手直しで変更: 霧の長さ MIST_S (90 秒) は fx.ts に移した)
  const RAIN_S = 45;
  // (M22-07 の手直し) 雨の濡れ (水たまりの広がり) と、波紋を動かす時刻
  let wet = 0;
  let fxTime = 0;
  const playScene = (e: SceneEvent) => {
    if (e.kind === 'sprout') motes.sprout(e.at, Math.max(1, e.radius) * CELL_M);
    else if (e.kind === 'mist') {
      mist = 1;
      mistAge = 0;
      mistR = Math.max(12, e.radius * CELL_M);
      mistAt = { x: e.at.x, y: field.heightAt(e.at.x, e.at.z), z: e.at.z };
    } else if (e.kind === 'rain') rainLeft = RAIN_S;
    else if (e.kind === 'departure') state.departLeft = DEPART_S;
    else if (e.kind === 'sailLost') lampsTarget = 0;
  };
  // 帆を失う (M22-08、設計 §6): 民が灯りを消す。文明の段階が帆に戻ったら (船が進み出したら) また灯す
  let lamps = 1;
  let lampsTarget = 1;
  // 知らせの帯 (M22-08): 石板の警告・祈り・結末を、画面の上に控えめに出して 8 秒で消す
  // (M22-08 の手直しで変更: 帯の DOM・見た目・寿命は notice.ts へ移した。石板の銘板の見た目にし、続けて来た知らせは待たせて順に出す)
  const band = createNoticeBand(canvas.parentElement ?? document.body, () => host.names ?? {});
  const notice = (e: TimelineEvent) => band.push(e);
  // 調整用: 開発者ツールから知らせを出す (__probe.observe.notice({ year, kind: 'prayer', phase: 'issued', prayer: 'wolves' }))
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
  const fx = (dt: number) => {
    band.step(nowMs());
    if (lampsTarget === 0 && state.snap.ship && state.snap.civ && state.snap.civ.stage >= 5) lampsTarget = 1;
    lamps += (lampsTarget - lamps) * Math.min(1, dt / 3);
    motes.setLamps(lamps);
    // (M22-07 の手直しで変更: 霧の濃さは一様に薄めず、fx.ts の mistEnvelope (立ち上がり → 満ちる → 最後の 32 秒の余韻) で決める)
    mistAge += dt;
    const env = mistEnvelope(mistAge);
    mist = env.amount;
    // (M22-07 の 3 回目で変更: 地面の高さを渡し、霧を地形に沿わせる (atmosphere.ts が霧の下の高さの表を焼く))
    air?.setMist(mistAt, mistR, mist, env.fade, field.heightAt);
    rainLeft = Math.max(0, rainLeft - dt);
    rain += ((rainLeft > 0 ? 1 : 0) - rain) * Math.min(1, dt / 4);
    motes.setRain(rain);
    // (M22-07 の手直し) 雨の水たまり・海面の波紋
    fxTime += dt;
    // (審査台 23:54 の指摘で変更: 濡れはいま見えている雨の強さ rain で満ちる。降り始めに水たまりが雨より先に広がらない)
    wet = wetness(wet, rainLeft > 0, dt, rain);
    puddles.update(wet, rain, hemi.color, fxTime);
    water.setRain(rain);
    // (M22-07 の手直し) 沈む海: 海面を追わせ、上がる間の波立ちと流れ
    sea = surgeStep(sea, seaTarget + seaExtra, dt);
    water.setLevel(sea.level);
    grass.setLevel(sea.level);
    water.setSurge(sea.surge);
  };
  // 調整用: 開発者ツールから場面を起こす (__probe.observe.fx('sprout' | 'mist' | 'rain'))
  // (M22-07 の手直しで変更: 'sinking' は海面を 1.5 m 上げる (本体の沈降の代わり)。上がる間は波立ちと流れが見える)
  const fxInsp: ObserveInspect['fx'] = (kind) => {
    const at = marks.grove ?? marks.center;
    if (kind === 'sprout') playScene({ kind, year: state.snap.year, cell: home, at, speciesId: 'belltree', radius: 1 });
    else if (kind === 'mist') playScene({ kind, year: state.snap.year, cell: home, at, radius: 4 });
    else if (kind === 'sinking') seaExtra += 1.5;
    else playScene({ kind, year: state.snap.year });
  };
  // (草の磨き上げ) 調整用: 種の群れ (または点 {x, z}) へ寄る (__probe.observe.look('rabbit', 距離, 高さ, 向き))。兎が草に埋もれないかを近くの低い目で確かめる
  const lookInsp: ObserveInspect['look'] = (at, dist = 6, height = 1.2, yaw = 0) => {
    const c = typeof at === 'string' ? centroid(at) : at;
    if (c) lookFrom(c.x, c.z, dist, height, yaw);
  };
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
  // 個体を押す (ドラッグでない短い押し) と、その個体を追う。何もない所を押すと追うのをやめる
  const followDelta = new Vector3();
  const down = { x: 0, y: 0 };
  const proj = new Vector3();
  // 試験用 (E2E): 個体の画面上の位置 (canvas の左上から px)。画面の外・カメラの後ろなら null
  // 軽量化の試算用: 区分ごとの三角形の内訳 (render/breakdown.ts)。__probe.observe.breakdown() を開発者ツールから呼ぶ
  const breakdownInsp: ObserveInspect['breakdown'] = () =>
    triangleBreakdown(camera, { terrain: [terrain], water: [water.mesh], grass: [grass.mesh], belltree: lods.filter((l) => l !== forestSet).map((l) => l.group), forest: forestSet ? [forestSet.group] : [], settlement: [settlement], ship: [shipView.group], creatures: [creatures.group] }, scene);
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
  const first = params.get('shot');
  const presetTimer = first && presets[first] ? setTimeout(presets[first], 1500) : 0;
  const stats = host.stats;
  let last = nowMs();
  let t = 0;
  let frames = 0;
  let acc = 0;
  let fps = 0;
  // (M23-07) 動的な解像度。倍率は renderer のピクセル比に掛ける (ピクセル比 2 の画面は 0.5 = CSS の画素まで、1 の画面は 0.7 まで下げる)
  const dynres = OPT.dynres ? createDynamicResolution({ min: renderer.getPixelRatio() >= 1.5 ? 0.5 : 0.7 }) : null;
  const loop = () => {
    const now = nowMs();
    if (dynres) grade.setPixelRatio(renderer.getPixelRatio() * dynres.update(now - last));
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    // 試作の徘徊: 目的地へ歩き、着いたら食むか待つ (M22-04 の個体層に置き換える)
    // (置き換えた: 以下は個体層の 1 フレーム。出入りの計画 → 状態機械 → 描画)
    advance(dt);
    const plan = reconcile(state.agents.agents, state.targets, BUDGET_PER_SECOND, dt, arng, credit);
    credit = plan.credit;
    state.agents = applyPlan(state.agents, plan);
    const day = daylightAt(phaseAt(OPT.freeze ? 0 : (t * DAY_CYCLE_S) / OPT.day, OPT.time));
    if (sky && air) {
      sky.update(day, camera);
      air.setDay(day, t);
      hemi.color.set(day.skyColor);
      hemi.groundColor.set(day.groundColor);
      hemi.intensity = day.hemiIntensity;
      sun.color.set(day.lightColor);
      sun.intensity = day.lightIntensity;
      sun.position.set(day.lightDir.x * 120, day.lightDir.y * 120, day.lightDir.z * 120);
      // 夜は灯り・鐘の口・ムーの光を強める (焼いた材質の発光に共通で掛かる)
      glow.value = 1 + day.night * 1.1;
      rimLight.value.set(day.lightColor).multiplyScalar(day.lightIntensity / 2.6);
      // 雨の間は日が陰り、空気が濃くなる
      if (rain > 0.01) {
        sun.intensity *= 1 - rain * 0.5;
        hemi.intensity *= 1 - rain * 0.2;
        air.mat.uniforms.uHaze.value *= 1 + rain * 1.8;
        air.mat.uniforms.uShafts.value *= 1 - rain * 0.8;
      }
    }
    fx(dt);
    state.agents = stepAgents(state.agents, { area: state.area, marks, night: day.night > 0.6, building: state.building, launched: false, targets: state.targets }, dt, arng);
    motes.update(t, dt, day.night, camera, controls.target, state.agents.agents);
    water.update(t);
    shipView.update(t);
    direct(dt);
    // (M23-02 で変更: 視錐台で落とすもの (群れ・木・下草・草) は、このコマのカメラが決まった後 (direct の後) に更新する。前だと寄せ先へ切り替えた最初のコマが前の画の視錐台で描かれる)
    creatures.update(state.agents.agents, camera, field.heightAt, t, dt);
    for (const l of lods) l.update(camera);
    hutSet?.update(camera);
    stumpSet?.update(camera);
    for (const p of propSets) p.update(camera);
    for (const u of understory) u.update(camera);
    grass.update(t, camera.position, camera);
    renderer.info.autoReset = false;
    renderer.info.reset();
    grade.render(dt);
    frames++;
    acc += dt;
    if (acc >= 0.5) {
      fps = frames / acc;
      frames = 0;
      acc = 0;
      const info = renderer.info.render;
      const count = (sp: string) => state.agents.agents.filter((a) => a.species === sp).length;
      const st: ObserveStats = { follow: state.followId, camera: state.director.mode === 'auto' ? `${state.director.shot?.kind}:${state.director.shot?.reason}` : 'free', at: camera.position.toArray().map(Math.round), year: state.snap.year, tick: state.snap.tick, speed: state.simSpeed, ship: shipView.node(), phase: +day.phase.toFixed(3), fps: Math.round(fps), res: dynres?.scale ?? 1, calls: info.calls, triangles: info.triangles, deer: count('deer'), wolf: count('wolf'), rabbit: count('rabbit'), folk: state.agents.agents.filter((a) => a.role === 'folk').length, trees: flora.treeCount(), grass: grass.mesh.count + grass.far.count, assets: { deer: !!deerGlb, belltree: !!treeGlb, settlement: !!settleGlb, flora: !!floraGlb, wolf: !!wolfGlb, rabbit: !!rabbitGlb } };
      lastStats = st;
      lastDebug = { marks, agents: state.agents.agents.map((g) => ({ id: g.id, sp: g.species, role: g.role, st: g.state, x: Math.round(g.x), z: Math.round(g.z) })) };
      if (host.debug === false) stats.textContent = observeYearText(state.snap);
      else stats.textContent = `${st.year} 年 · ${!clock ? '' : state.simSpeed === 0 ? '⏸ · ' : `${state.simSpeed}x · `}${st.fps} fps${st.res < 1 ? ` (解像度 ×${st.res})` : ''} · calls ${st.calls} · tris ${(st.triangles / 1000).toFixed(0)}k · 鹿 ${st.deer}(民 ${st.folk}) · 狼 ${st.wolf} · 兎 ${st.rabbit} · 鐘樹 ${st.trees} · 草 ${st.grass}`;
    }
    if (running) handle = requestAnimationFrame(loop);
  };
  let running = false;
  let handle = 0;
  return {
    inspect: () => ({ air: airInsp, notice, fx: fxInsp, look: lookInsp, huts: settle.hutsInsp, props: settle.propsInsp, breakdown: breakdownInsp, screen: screenInsp, stats: () => lastStats, debug: () => lastDebug, terrainDigest: () => terrainDigest(terrain.geometry.getAttribute('position').array as Float32Array) }),
    setSnapshot(next, timeline) {
      if (timeline) {
        if (timeline.length < state.seenEvents) state.seenEvents = 0;
        if (!state.baseline) state.newEvents.push(...timeline.slice(state.seenEvents));
        state.seenEvents = timeline.length;
        state.baseline = false;
      }
      if (next.tick !== state.snap.tick) onSnapshot(next);
    },
    start() {
      if (running) return;
      running = true;
      state.baseline = true;
      last = nowMs();
      resize();
      handle = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    dispose() {
      clearTimeout(presetTimer);
      running = false;
      cancelAnimationFrame(handle);
      disposeStage(stage, resize);
    },
    cameraMode() {
      if (state.director.mode === 'auto') return 'auto';
      return state.followId !== null ? 'follow' : 'free';
    },
  };
}
