import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  BoxGeometry,
  Matrix4,
  Mesh,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World } from '../simulation/World';
import { createMemorySink } from '../core/log/memorySink';
import type { SaveData } from '../simulation/types';
import { mulberry32 } from '../simulation/rng';
import { CELL_M, createTerrainField, createTerrainMesh } from './render/terrain';
import { createWater } from './render/water';
import { createGrass } from './render/grass';
import { createGrade } from './render/grade';
import { createToonMaterial } from './render/toon';
import { findNode, loadGlb } from './render/assets';
import { instanceProps, lodProps, type LodProps } from './render/instancer';
import { createCreatureView } from './render/creatures';
import { AtmospherePass, createSky } from './render/atmosphere';
import { DAY_CYCLE_S, daylightAt, phaseAt } from './daylight';
import { extractArea, landmarks } from './area';
import { K_DEFAULT, BUDGET_PER_SECOND, folkRuleFor, reconcile, targetCounts } from './population';
import { applyPlan, stepAgents, type AgentWorld } from './agents';

/**
 * M22-02 デフォルメ試作 (observe.html)。空の舟 25 年目 (舟は肋の段) の保存から、集落の周り半径 8 セルを組んで見る。
 * 本体は読むだけ。個体の動きは試作用の単純な徘徊で、M22-04 の個体層に置き換える。
 * URL: ?deer=300&trees=200&near=40&grass=20000&grade=1&bloom=1&shadow=1
 * (個体層をつないだ後: deer は区域の鹿の目標頭数。K を密度の合計から逆算する。0 なら本体の密度 × K_DEFAULT のまま。near は使わない)
 * (M22-07: air=0 で空気の層と昼夜を切る。time は始まりの時刻 (0 = 夜明け、0.3 = 正午、0.8 = 深夜)、day は 1 周の秒数、freeze=1 で時刻を止める)
 */
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(params.get(k) ?? d);
const flag = (k: string) => params.get(k) !== '0';
const OPT = {
  deer: num('deer', 0),
  trees: num('trees', 140),
  near: num('near', 40),
  grass: num('grass', 25000),
  grade: flag('grade'),
  bloom: flag('bloom'),
  shadow: flag('shadow'),
  air: flag('air'),
  time: num('time', 0.16),
  day: num('day', DAY_CYCLE_S),
  freeze: params.get('freeze') === '1',
};
/** 区域 (半径 8) の外に、地面を 4 セル分の縁まで作る */
const AREA_R = 8;
const WINDOW = 12;

function skyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#7FA9C9');
  grad.addColorStop(0.55, '#CFE0E4');
  grad.addColorStop(1, '#F3E3C4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function placeholderTree(kind: 'mature' | 'sapling' | 'seedling' | 'stump'): Group {
  const g = new Group();
  const bark = createToonMaterial({ color: '#E4DCCB' });
  const leaf = createToonMaterial({ color: '#6E9A48' });
  const bell = createToonMaterial({ color: '#B7813C', emissive: new Color('#FFC46B'), emissiveIntensity: 0.9 });
  const h = kind === 'mature' ? 9 : kind === 'sapling' ? 3 : kind === 'stump' ? 0.6 : 0.4;
  const trunk = new Mesh(new CylinderGeometry(h * 0.04, h * 0.07, h * (kind === 'stump' ? 1 : 0.55), 7), bark);
  trunk.position.y = (h * (kind === 'stump' ? 1 : 0.55)) / 2;
  g.add(trunk);
  if (kind === 'mature' || kind === 'sapling') {
    for (let i = 0; i < (kind === 'mature' ? 5 : 2); i++) {
      const clump = new Mesh(new IcosahedronGeometry(h * 0.22, 1), leaf);
      const a = (i / 5) * Math.PI * 2;
      clump.position.set(Math.cos(a) * h * 0.15, h * 0.72 + (i % 2) * h * 0.08, Math.sin(a) * h * 0.15);
      g.add(clump);
    }
    if (kind === 'mature') {
      for (let i = 0; i < 12; i++) {
        const b = new Mesh(new CylinderGeometry(0.05, 0.14, 0.22, 6), bell);
        const a = (i / 12) * Math.PI * 2;
        b.position.set(Math.cos(a) * h * 0.3, h * 0.55, Math.sin(a) * h * 0.3);
        g.add(b);
      }
    }
  }
  g.traverse((o) => ((o as Mesh).castShadow = true));
  return g;
}

function placeholderSettlement(name: string): Group {
  const g = new Group();
  const stone = createToonMaterial({ color: '#A7A193' });
  const roof = createToonMaterial({ color: '#6C5A3A' });
  const glow = createToonMaterial({ color: '#FFD08A', emissive: new Color('#FFC46B'), emissiveIntensity: 1.6 });
  if (name === 'hut') {
    const base = new Mesh(new BoxGeometry(4, 2.4, 4), stone);
    base.position.y = 1.2;
    const top = new Mesh(new CylinderGeometry(0, 3.4, 2, 4), roof);
    top.position.y = 3.4;
    top.rotation.y = Math.PI / 4;
    g.add(base, top);
  } else if (name === 'lantern_post') {
    const post = new Mesh(new BoxGeometry(0.4, 2.6, 0.4), stone);
    post.position.y = 1.3;
    const lamp = new Mesh(new BoxGeometry(0.35, 0.45, 0.35), glow);
    lamp.position.set(0.45, 2.3, 0);
    g.add(post, lamp);
  } else if (name === 'slipway') {
    const s = new Mesh(new BoxGeometry(5, 0.8, 16), stone);
    s.position.y = 0.2;
    g.add(s);
  } else if (name === 'megalith') {
    const m = new Mesh(new BoxGeometry(1.4, 4.5, 0.9), stone);
    m.position.y = 2.2;
    g.add(m);
  } else {
    const w = new Mesh(new BoxGeometry(4, 0.9, 0.7), stone);
    w.position.y = 0.45;
    g.add(w);
  }
  g.traverse((o) => ((o as Mesh).castShadow = true));
  return g;
}

/** GLB の名前付きノードを複製する。無ければ仮の形 */
function instanceOf(gltf: Awaited<ReturnType<typeof loadGlb>>, name: string, fallback: () => Object3D): Object3D {
  const node = findNode(gltf, name);
  return node ? node.clone(true) : fallback();
}

async function boot(): Promise<void> {
  const status = document.getElementById('status')!;
  status.textContent = '保存を読んでいます…';
  const save = (await (await fetch('/data/observe/sky-ship-y25.json')).json()) as SaveData;
  const world = World.restore(save, { log: createMemorySink() });
  const s = world.snapshot();
  const home = s.civ?.home ?? 2787;
  const field = createTerrainField(s, home, WINDOW);

  const canvas = document.getElementById('observe') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = OPT.shadow;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = skyTexture();
  // 霧の色は空の地平の帯に合わせ、水面の端 (区域の外の遠景) を地平に溶かす
  scene.fog = new Fog(new Color('#D9E4E2'), 80, 320);
  // (M22-07: 空気の層を使うときは、空は昼夜で変わる球、霧は後段の霞と靄が受け持つ)
  const sky = OPT.air ? createSky() : null;
  if (sky) {
    scene.background = null;
    scene.fog = null;
    scene.add(sky.mesh);
  }
  // (M22-07: 空気の層で水面の果て 1.5 km まで霞ませるので、遠くの切り捨てを 800 m から 2 km に)
  const camera = new PerspectiveCamera(42, 1, 0.2, 2000);
  camera.position.set(-26, field.heightAt(-26, 44) + 6, 44);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(2, field.heightAt(2, 0) + 3, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 160;

  const hemi = new HemisphereLight(new Color('#D7E8F2'), new Color('#6F7A4E'), 1.1);
  scene.add(hemi);
  const sun = new DirectionalLight(new Color('#FFE3B6'), 2.4);
  sun.position.set(-60, 70, 40);
  sun.castShadow = OPT.shadow;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -100;
  sc.right = 100;
  sc.top = 100;
  sc.bottom = -100;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);

  status.textContent = '地形を組んでいます…';
  const terrain = createTerrainMesh(s, field);
  scene.add(terrain);
  const water = createWater(field, 3000);
  scene.add(water.mesh);

  const [deerGlb, treeGlb, settleGlb, floraGlb, wolfGlb, rabbitGlb] = await Promise.all([
    loadGlb('/models/observe/deer.glb'),
    loadGlb('/models/observe/belltree.glb'),
    loadGlb('/models/observe/settlement.glb'),
    loadGlb('/models/observe/flora.glb'),
    loadGlb('/models/observe/wolf.glb'),
    loadGlb('/models/observe/rabbit.glb'),
  ]);
  const tuft = findNode(floraGlb, 'grass_tuft') as Mesh | null;
  const grass = createGrass(field, { grass: s.layers.populations['grass'], moss: s.layers.populations['moss'] }, OPT.grass, 7, tuft?.geometry, (AREA_R + 1) * CELL_M);
  scene.add(grass.mesh);

  // 鐘樹: 密度に比例して最大 OPT.trees 本。密度で段 (成木・若木・芽) を選ぶ。舟の材を伐った跡として船台の近くに株を置く
  const rng = mulberry32(11);
  const bt = s.layers.populations['belltree'];
  const cands: { x: number; z: number; d: number }[] = [];
  for (let i = 0; i < OPT.trees * 8; i++) {
    const x = (rng() * 2 - 1) * AREA_R * CELL_M;
    const z = (rng() * 2 - 1) * AREA_R * CELL_M;
    if (Math.hypot(x, z) > AREA_R * CELL_M || field.heightAt(x, z) < 1.2) continue;
    // 集落の広場と船台は民が切り開いた場所として木を置かない (本体の鐘樹は集落を中心に立つが、小屋が林に埋もれて見えない)
    if (Math.hypot(x, z - 20) < 13 || Math.hypot(x, z + 6) < 20) continue;
    const d = bt ? field.layerAt(bt, x, z) : 0;
    if (rng() < d * 1.4) cands.push({ x, z, d });
  }
  const treeCount = Math.min(OPT.trees, cands.length);
  // 段ごとに置き場所の行列を集め、GLB のノード (無ければ仮の形) をまとめてインスタンス化する
  const byKind: Record<string, Matrix4[]> = { mature: [], sapling: [], seedling: [], stump: [] };
  const tq = new Quaternion();
  const ty = new Vector3(0, 1, 0);
  const tp = new Vector3();
  const ts = new Vector3();
  for (let i = 0; i < treeCount; i++) {
    const c = cands[i];
    const kind = c.d > 0.35 ? 'mature' : c.d > 0.15 ? 'sapling' : 'seedling';
    const k = 0.65 + rng() * 0.3;
    byKind[kind].push(new Matrix4().compose(tp.set(c.x, field.heightAt(c.x, c.z) - 0.1, c.z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(k, k, k)));
  }
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * (15 + rng() * 6);
    const z = 20 + Math.sin(a) * (15 + rng() * 6);
    byKind.stump.push(new Matrix4().compose(tp.set(x, field.heightAt(x, z) - 0.05, z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(1, 1, 1)));
  }
  const lods: LodProps[] = [];
  for (const [kind, mats] of Object.entries(byKind)) {
    const node = findNode(treeGlb, `belltree_${kind}`) ?? placeholderTree(kind as 'mature' | 'sapling' | 'seedling' | 'stump');
    const lod1 = kind === 'mature' ? findNode(treeGlb, 'belltree_mature_lod1') : null;
    if (lod1) {
      const l = lodProps(node, lod1, mats, 45);
      lods.push(l);
      scene.add(l.group);
    } else scene.add(instanceProps(node, mats));
  }

  // 集落の一角: 船台は南の海岸へ向け、小屋・灯り・巨石・石垣で囲む
  // (M22-04 の後: 南の固定位置をやめ、個体層の目印に合わせる)
  // 集落の一角 (個体層の目印に合わせる): 船台は集落に最も近い海辺のセルに、海へ向けて置く。小屋・灯り・巨石・石垣は集落の周り
  const area = extractArea(s, home, AREA_R);
  const marks = landmarks(area);
  // 同じ部品はまとめてインスタンス化する (小屋・灯り柱を 1 つずつ複製すると部品 × 材質 × 影の draw call になる)
  const settlementPlacements = new Map<string, Matrix4[]>();
  const place = (name: string, x: number, z: number, ry = 0) => {
    const list = settlementPlacements.get(name) ?? [];
    list.push(new Matrix4().compose(new Vector3(x, field.heightAt(x, z) - 0.15, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), new Vector3(1, 1, 1)));
    settlementPlacements.set(name, list);
  };
  // (M22-06: 集落から船台への向きをやめ、船台から外海が最も開けた方位へ向ける)
  const toSea = Math.atan2(marks.slipwayBow.x, marks.slipwayBow.z);
  place('slipway', marks.slipway.x, marks.slipway.z, toSea);
  const c0 = marks.center;
  place('hut', c0.x - 14, c0.z - 8, 0.4);
  place('hut', c0.x + 12, c0.z - 12, -0.6);
  place('hut', c0.x - 4, c0.z - 20, 0.1);
  for (const l of marks.lanterns.slice(0, 5)) place('lantern_post', l.x + 3, l.z + 3, 0);
  place('megalith', c0.x - 12, c0.z + 6, 0.3);
  place('megalith', c0.x + 16, c0.z + 2, -0.2);
  place('stone_wall', c0.x - 20, c0.z - 2, 1.2);
  place('stone_wall', c0.x + 20, c0.z - 4, -1.1);
  for (const [name, mats] of settlementPlacements) scene.add(instanceProps(instanceOf(settleGlb, name, () => placeholderSettlement(name)), mats));

  // 月鹿: 近い OPT.near 頭は SkinnedMesh、残りは VAT の InstancedMesh (設計 §8 の群れの LOD)
  // (M22-04 の後: 近くの振り分けと VAT は render/creatures.ts に移し、頭数は個体層が決める)
  // 個体層 (M22-04): 区域の密度 → 目標頭数 → 出入りの計画 → 状態機械。民は集落の近く (半径 3 セル) の鹿だけにする
  // (設計どおり支え半径 8 にすると区域の鹿が全部民になり、夜は全頭が灯りに寄り、飛び立ちで群れが消える。M22-04 の申し送り)
  status.textContent = '鹿を焼いています…';
  const folk = folkRuleFor(s.civ, 3);
  let K = { ...K_DEFAULT };
  if (OPT.deer > 0) {
    const sum = area.cells.reduce((acc, c) => acc + (c.isLand ? (c.density['deer'] ?? 0) : 0), 0);
    if (sum > 0) K = { ...K, deer: OPT.deer / sum };
  }
  const targets = targetCounts(area, K, folk);
  const creatures = createCreatureView({ deer: deerGlb, wolf: wolfGlb, rabbit: rabbitGlb }, Math.max(400, targets.totals.deer * 2 + 50));
  scene.add(creatures.group);
  let agents: AgentWorld = { agents: [], nextId: 1 };
  let credit = 0;
  const arng = mulberry32(23);
  // 開いた瞬間から群れが見えるよう、最初の 1 回だけ目標頭数ぶんを上限なしで出す
  {
    const plan = reconcile(agents.agents, targets, 1e6, 1, arng, 0);
    agents = applyPlan(agents, plan);
  }
  const building = !!s.ship && s.ship.launchedYear === undefined && (s.civ?.stage ?? 0) >= 5;

  const air = OPT.air ? new AtmospherePass(camera, sun) : null;
  const grade = createGrade(renderer, scene, camera, air ? [air] : []);
  // 調整用 (M22-07): 開発者ツールから空気の層の uniform と時刻を触る
  (window as unknown as { __observeAir: unknown }).__observeAir = { air, sun, camera, controls, heightAt: field.heightAt };
  grade.setEnabled({ grade: OPT.grade, bloom: OPT.bloom });
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    grade.setSize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();
  status.textContent = '';

  // 美観チェック用のカメラの寄せ先 (自動カメラ M22-08 までの仮)。群れ・狼は今いる個体の重心へ寄る
  const shots = document.getElementById('shots')!;
  const lookFrom = (tx: number, tz: number, dist: number, height: number, yaw: number) => {
    const ty = field.heightAt(tx, tz);
    controls.target.set(tx, ty + 1.2, tz);
    const cx = tx + Math.sin(yaw) * dist;
    const cz = tz + Math.cos(yaw) * dist;
    camera.position.set(cx, Math.max(ty + height, field.heightAt(cx, cz) + 1.6), cz);
  };
  // 群れは区域の縁の何か所かに分かれるので、重心ではなく「15 m 以内の仲間が最も多い個体」に寄る
  const centroid = (sp: string) => {
    const xs = agents.agents.filter((a) => a.species === sp && a.state !== 'enter' && a.state !== 'leave');
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
    船台: () => lookFrom(marks.slipway.x, marks.slipway.z, 22, 6, 0.9),
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
  for (const [label, go] of Object.entries(presets)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', go);
    shots.appendChild(b);
  }
  const first = params.get('shot');
  if (first && presets[first]) setTimeout(presets[first], 1500);
  const stats = document.getElementById('stats')!;
  let last = performance.now();
  let t = 0;
  let frames = 0;
  let acc = 0;
  let fps = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    // 試作の徘徊: 目的地へ歩き、着いたら食むか待つ (M22-04 の個体層に置き換える)
    // (置き換えた: 以下は個体層の 1 フレーム。出入りの計画 → 状態機械 → 描画)
    const plan = reconcile(agents.agents, targets, BUDGET_PER_SECOND, dt, arng, credit);
    credit = plan.credit;
    agents = applyPlan(agents, plan);
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
    }
    agents = stepAgents(agents, { area, marks, night: day.night > 0.6, building, launched: false, targets }, dt, arng);
    creatures.update(agents.agents, camera, field.heightAt, t, dt);
    for (const l of lods) l.update(camera);
    water.update(t);
    grass.update(t);
    controls.update();
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
      const count = (sp: string) => agents.agents.filter((a) => a.species === sp).length;
      const st = { phase: +day.phase.toFixed(3), fps: Math.round(fps), calls: info.calls, triangles: info.triangles, deer: count('deer'), wolf: count('wolf'), rabbit: count('rabbit'), folk: agents.agents.filter((a) => a.role === 'folk').length, trees: treeCount, grass: grass.mesh.count, assets: { deer: !!deerGlb, belltree: !!treeGlb, settlement: !!settleGlb, flora: !!floraGlb, wolf: !!wolfGlb, rabbit: !!rabbitGlb } };
      (window as unknown as { __observeStats: unknown }).__observeStats = st;
      (window as unknown as { __observeDebug: unknown }).__observeDebug = { marks, agents: agents.agents.map((g) => ({ id: g.id, sp: g.species, role: g.role, st: g.state, x: Math.round(g.x), z: Math.round(g.z) })) };
      stats.textContent = `${st.fps} fps · calls ${st.calls} · tris ${(st.triangles / 1000).toFixed(0)}k · 鹿 ${st.deer}(民 ${st.folk}) · 狼 ${st.wolf} · 兎 ${st.rabbit} · 鐘樹 ${st.trees} · 草 ${st.grass}`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  const el = document.getElementById('status');
  if (el) el.textContent = `読み込みに失敗: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
