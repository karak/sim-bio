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
  Box3,
  Sphere,
  Matrix4,
  Mesh,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldSnapshot } from '../simulation/types';
import type { TimelineEvent } from '../scenario/ScenarioRunner';
import { createNoticeBand } from './notice';
import { mulberry32 } from '../simulation/rng';
import { CELL_M, ELEV_M, createTerrainField, createTerrainMesh, groundLayers, wearTerrain, type Worn } from './render/terrain';
import { createWater } from './render/water';
import { createGrass } from './render/grass';
import { createGrade } from './render/grade';
import { createToonMaterial, rimLight } from './render/toon';
import { findNode, loadGlb } from './render/assets';
import { glow } from './render/bake';
import { culledProps, instanceProps, lodProps, type CulledProps, type LodProps } from './render/instancer';
import { HUT_NEAR_M, HUT_NEAR_SPREAD, hutPlacements } from './settlementLayout';
import { createCreatureView } from './render/creatures';
import { createShipView } from './render/ship';
import { createMotes } from './render/motes';
import { createPuddles, puddleSpots } from './render/puddles';
import { createSurface } from './render/roofs';
import { MIST_S, mistEnvelope, surgeStep, wetness, type SurgeState } from './fx';
import { createShotCamera, frameBlocked, inFoliage, type AvoidZone } from './render/shotCamera';
import { triangleBreakdown } from './render/breakdown';
import { installShadowOnly } from './render/shadowOnly';
import { bakeImpostor } from './render/impostor';
import { directorContext, initialDirector, stepDirector, type Shot } from './director';
import { detectScenes, sceneFrame, type SceneEvent, type SceneFrame } from './scenes';
import { AtmospherePass, createSky } from './render/atmosphere';
import { createDynamicResolution } from './render/dynamicResolution';
import { DAY_CYCLE_S, daylightAt, phaseAt } from './daylight';
import { extractArea, landmarks } from './area';
import { K_DEFAULT, BUDGET_PER_SECOND, folkRuleFor, reconcile, targetCounts } from './population';
import { applyPlan, stepAgents, type AgentWorld } from './agents';

/**
 * M22-02 デフォルメ試作 (observe.html)。空の舟 25 年目 (舟は肋の段) の保存から、集落の周り半径 8 セルを組んで見る。
 * 本体は読むだけ。個体の動きは試作用の単純な徘徊で、M22-04 の個体層に置き換える。
 * URL: ?deer=300&trees=200&near=40&grass=20000&grade=1&bloom=1&shadow=1
 * (個体層をつないだ後: deer は区域の鹿の目標頭数。K を密度の合計から逆算する。0 なら本体の密度 × K_DEFAULT のまま。near は使わない)
 * (M22-06: ship は舟の進み (0〜120、無ければ保存の値)、launched=1 で飛び立った舟、forest は森の木の上限本数)
 * (M22-08: depart=1 で開いてすぐ舟が飛び去る。sink は海面を何 m 上げて見せるか (沈降の試し)。auto=0 で自動カメラを切る (shot を指定したときも切る)。speed は本体の速さ (0 / 1 / 10、1 = 1 秒に 1 tick)。freeze=1 は本体も止める)
 * (M22-07: air=0 で空気の層と昼夜を切る。time は始まりの時刻 (0 = 夜明け、0.3 = 正午、0.8 = 深夜)、day は 1 周の秒数、freeze=1 で時刻を止める)
 * (M23-06: far は鐘樹の成木と森の木をインポスター (板) に替える距離 (m)。0 で切る)
 * (M23-08: cfar は動物を遠い段 (群れ LOD を削った形) に替える距離 (m、個体ごとに ±10%)。0 で切る)
 * (M23-09: hut は小屋を遠距離版 hut_lod1 に替える距離 (m、カメラの高さも入れた距離、小屋ごとに ±10% 揺らす)。0 で切る (いつも近い形))
 * (M23-07: msaa は場面の MSAA の段 (0 / 2 / 4)、pr はピクセル比の上限、airres は空気の層を場面の何分の 1 で描くか (1 か 2、既定 2)、
 *  dynres=0 で動的な解像度 (コマが 60 fps の予算を続けて超えたときだけ合成の倍率を下げる。ピクセル比 2 で 0.5、1 で 0.7 まで) を切る)
 */
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(params.get(k) ?? d);
const flag = (k: string) => params.get(k) !== '0';
const OPT = {
  deer: num('deer', 0),
  trees: num('trees', 140),
  near: num('near', 40),
  cfar: num('cfar', 50),
  // (草の磨き上げ: 房を 36 三角形に減らした分、25,000 から 30,000 房に増やして草の絨毯を密にする)
  grass: num('grass', 30000),
  grade: flag('grade'),
  bloom: flag('bloom'),
  shadow: flag('shadow'),
  forest: num('forest', 80),
  ship: params.has('ship') ? num('ship', 0) : null,
  launched: params.get('launched') === '1',
  depart: params.get('depart') === '1',
  speed: num('speed', 1),
  sink: num('sink', 0),
  auto: params.get('auto') !== '0' && !params.has('shot'),
  air: flag('air'),
  time: num('time', 0.16),
  day: num('day', DAY_CYCLE_S),
  freeze: params.get('freeze') === '1',
  far: num('far', 60),
  hut: num('hut', HUT_NEAR_M),
  msaa: num('msaa', 4),
  pr: num('pr', 2),
  airScale: (num('airres', 2) === 1 ? 1 : 2) as 1 | 2,
  dynres: flag('dynres'),
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
};

export type ObservationView = {
  /** 本体が進んだ snapshot を渡す (clock の無いとき)。timeline は石板の年表 (介入の場面を引くため、全体を渡してよい) */
  setSnapshot(s: WorldSnapshot, timeline?: readonly TimelineEvent[]): void;
  start(): void;
  stop(): void;
  /** 今のカメラ: 自動 (自然記録調)・自由 (触ったあと、20 秒で自動に戻る)・個体を追う */
  cameraMode(): 'auto' | 'free' | 'follow';
};

export async function createObservationView(host: ObserveHost): Promise<ObservationView> {
  const status = host.status;
  const s = host.snapshot;
  const home = s.civ?.home ?? 2787;
  const field = createTerrainField(s, home, WINDOW);

  const canvas = host.canvas;
  // (M23-07 で変更: 画面 (canvas) の MSAA を切る。描画はすべて合成 (grade.ts) を通り、MSAA は場面の描画先が持つ。画面の MSAA は最後の全画面の 1 枚にしか掛からず、解決の分だけ重かった)
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // (M23-07 で変更: ピクセル比の上限は OPT.pr)
  renderer.setPixelRatio(Math.min(OPT.pr, window.devicePixelRatio));
  renderer.shadowMap.enabled = OPT.shadow;
  renderer.shadowMap.type = PCFShadowMap;
  // (M23-04) 影の描画だけに出す粗い代わりの形 (鐘樹の成木・小屋・近くの動物)。本の描画の形は castShadow = false にする
  const shadowOnly = installShadowOnly(renderer.shadowMap);
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

  // (M22-06: 林の切り開きと株を船台に合わせるため、区域と目印をここで決める。元は集落の一角の直前)
  let area = extractArea(s, home, AREA_R);
  const marks = landmarks(area);
  // (M22-06 試作 2: 船台が 27 m になったので、船台の点 (外海に接する陸のセルの中心) から陸の側へ 6.5 m ずらし、
  //  舳先の端が水際を 2 m ほど越えるところに置く。舟・丸太の山・切り開きはこの中心に合わせる)
  const slip = { x: marks.slipway.x - marks.slipwayBow.x * 6.5, z: marks.slipway.z - marks.slipwayBow.z * 6.5 };
  // (草の磨き上げ) 集落の広場・小屋の戸口への道・船台への道を踏み固めた土にし、そこの草を減らす (小屋の位置は下の集落の一角と同じ)
  const plaza = { x: marks.center.x, z: marks.center.z - 6 };
  const worn: Worn[] = [
    { ax: plaza.x, az: plaza.z, bx: plaza.x, bz: plaza.z, r: 9 },
    { ax: plaza.x, az: plaza.z, bx: slip.x, bz: slip.z, r: 2.6 },
    ...hutPlacements(marks.center, plaza, field.heightAt).map((h) => ({ ax: plaza.x, az: plaza.z, bx: h.x, bz: h.z, r: 2.2 })),
  ];
  wearTerrain(terrain, worn);
  grass.trample(worn);

  // 鐘樹: 密度に比例して最大 OPT.trees 本。密度で段 (成木・若木・芽) を選ぶ。舟の材を伐った跡として船台の近くに株を置く
  const rng = mulberry32(11);
  const bt = s.layers.populations['belltree'];
  // (M22-03: 植えた鐘樹が芽吹くように) 候補地 (位置・選ぶ閾値・大きさ・向き) は一度だけ決め、本体の密度が変わるたびに同じ候補から選び直す。
  // 残る木は同じ場所・同じ姿のまま、密度が上がった所に新しい木が現れる
  type Spot = { x: number; z: number; th: number; k: number; rot: number };
  const spots: Spot[] = [];
  for (let i = 0; i < OPT.trees * 8; i++) {
    const x = (rng() * 2 - 1) * AREA_R * CELL_M;
    const z = (rng() * 2 - 1) * AREA_R * CELL_M;
    if (Math.hypot(x, z) > AREA_R * CELL_M || field.heightAt(x, z) < 1.2) continue;
    // 集落の広場と船台は民が切り開いた場所として木を置かない (本体の鐘樹は集落を中心に立つが、小屋が林に埋もれて見えない)
    // (M22-06: 船台の切り開きは南の固定位置 (0, 20) から目印の船台へ)
    if (Math.hypot(x - slip.x, z - slip.z) < 19 || Math.hypot(x, z + 6) < 20) continue;
    spots.push({ x, z, th: rng(), k: 0.65 + rng() * 0.3, rot: rng() * Math.PI * 2 });
  }
  let treeCount = 0;
  // 段ごとに置き場所の行列を集め、GLB のノード (無ければ仮の形) をまとめてインスタンス化する
  const byKind: Record<string, Matrix4[]> = { mature: [], sapling: [], seedling: [], stump: [] };
  const tq = new Quaternion();
  const ty = new Vector3(0, 1, 0);
  const tp = new Vector3();
  const ts = new Vector3();
  const selectBelltrees = (layer: Float32Array | undefined) => {
    const out: Record<'mature' | 'sapling' | 'seedling', Matrix4[]> = { mature: [], sapling: [], seedling: [] };
    let n = 0;
    for (const c of spots) {
      if (n >= OPT.trees) break;
      const d = layer ? field.layerAt(layer, c.x, c.z) : 0;
      if (c.th >= d * 1.4) continue;
      const kind = d > 0.35 ? 'mature' : d > 0.15 ? 'sapling' : 'seedling';
      out[kind].push(new Matrix4().compose(tp.set(c.x, field.heightAt(c.x, c.z) - 0.1, c.z), tq.setFromAxisAngle(ty, c.rot), ts.set(c.k, c.k, c.k)));
      n++;
    }
    treeCount = n;
    return out;
  };
  Object.assign(byKind, selectBelltrees(bt));
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const x = slip.x + Math.cos(a) * (15 + rng() * 6);
    const z = slip.z + Math.sin(a) * (15 + rng() * 6);
    byKind.stump.push(new Matrix4().compose(tp.set(x, field.heightAt(x, z) - 0.05, z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(1, 1, 1)));
  }
  const lods: LodProps[] = [];
  const belltreeSets: Partial<Record<string, LodProps>> = {};
  for (const [kind, mats] of Object.entries(byKind)) {
    const node = findNode(treeGlb, `belltree_${kind}`) ?? placeholderTree(kind as 'mature' | 'sapling' | 'seedling' | 'stump');
    const lod1 = kind === 'mature' ? findNode(treeGlb, 'belltree_mature_lod1') : null;
    if (lod1) {
      // (M23-06) OPT.far より先は lod1 を焼いた板 (インポスター、2 三角形) で描く
      const far = OPT.far > 0 ? { node: bakeImpostor(renderer, lod1).mesh, farM: OPT.far } : null;
      // (M23-04 で変更: 成木の影は近い・遠いの形ではなく、影の代わりの形 belltree_mature_shadow (420 三角形) で落とす)
      const l = lodProps(node, lod1, mats, 38, OPT.trees, findNode(treeGlb, 'belltree_mature_shadow'), far);
      if (l.shadow) shadowOnly.add(l.shadow);
      lods.push(l);
      belltreeSets[kind] = l;
      scene.add(l.group);
    } else if (kind !== 'stump') {
      // (M22-03: 若木と芽も植え直せるよう、遠くも同じ形の組にして置き場所を入れ替えられるようにする)
      // (鐘樹の段の作り直しで変更: 若木は作り直して 1,421 三角形になったので、45 m より先は遠距離版 belltree_sapling_lod1 (356 三角形) で描く)
      const far = (kind === 'sapling' ? findNode(treeGlb, 'belltree_sapling_lod1') : null) ?? node;
      const l = lodProps(node, far, mats, 45, OPT.trees);
      // (M23-04) 芽 (0.4 m) は影を落とさない (影が小さく見えない。下草と同じ)
      if (kind === 'seedling') l.group.traverse((o) => (o.castShadow = false));
      lods.push(l);
      belltreeSets[kind] = l;
      scene.add(l.group);
    } else scene.add(instanceProps(node, mats));
  }

  // 森の木 (M22-03): 本体の forest の密度に比例して最大 OPT.forest 本。鐘樹と同じく集落の広場と船台は切り開く
  const forest = s.layers.populations['forest'];
  const forestNode = findNode(floraGlb, 'forest_tree');
  const forestLod = findNode(floraGlb, 'forest_tree_lod1');
  // (M22-03: 鐘樹と同じく、候補地を一度だけ決めて密度が変わるたびに選び直す)
  const forestSpots: Spot[] = [];
  for (let i = 0; i < OPT.forest * 10; i++) {
    const x = (rng() * 2 - 1) * AREA_R * CELL_M;
    const z = (rng() * 2 - 1) * AREA_R * CELL_M;
    if (Math.hypot(x, z) > AREA_R * CELL_M || field.heightAt(x, z) < 1.2) continue;
    if (Math.hypot(x - slip.x, z - slip.z) < 19 || Math.hypot(x, z + 6) < 20) continue;
    forestSpots.push({ x, z, th: rng(), k: 0.8 + rng() * 0.35, rot: rng() * Math.PI * 2 });
  }
  const selectForest = (layer: Float32Array | undefined) => {
    const mats: Matrix4[] = [];
    for (const c of forestSpots) {
      if (mats.length >= OPT.forest) break;
      if (!layer || c.th >= field.layerAt(layer, c.x, c.z) * 1.6) continue;
      mats.push(new Matrix4().compose(tp.set(c.x, field.heightAt(c.x, c.z) - 0.1, c.z), tq.setFromAxisAngle(ty, c.rot), ts.set(c.k, c.k, c.k)));
    }
    return mats;
  };
  let forestSet: LodProps | null = null;
  if (forestNode && forestLod) {
    // (M23-06 で変更: OPT.far より先はインポスター。森の木は影の代わりの形を持たないので、影は今までどおり lod1 の組が全部の木で落とす)
    const far = OPT.far > 0 ? { node: bakeImpostor(renderer, forestLod).mesh, farM: OPT.far } : null;
    forestSet = lodProps(forestNode, forestLod, selectForest(forest), 45, OPT.forest, null, far);
    lods.push(forestSet);
    scene.add(forestSet.group);
  }
  // 本体の年が進んだら、鐘樹と森の木を今の密度で選び直す
  let treeYear = s.year;
  const replant = (next: WorldSnapshot) => {
    if (next.year === treeYear) return;
    treeYear = next.year;
    const b = selectBelltrees(next.layers.populations['belltree']);
    for (const kind of ['mature', 'sapling', 'seedling'] as const) belltreeSets[kind]?.setPlacements(b[kind]);
    forestSet?.setPlacements(selectForest(next.layers.populations['forest']));
  };

  // 下草 (M22-03): 羊歯は木の陰 (鐘樹と森の密度)、小花は草地、穂の出た月草は草地にまばら
  const under: Record<string, Matrix4[]> = { fern: [], flower_patch: [], moongrass_tuft_seed: [] };
  const grassLayer = s.layers.populations['grass'];
  for (let i = 0; i < 9000; i++) {
    const x = (rng() * 2 - 1) * (AREA_R + 1) * CELL_M;
    const z = (rng() * 2 - 1) * (AREA_R + 1) * CELL_M;
    if (Math.hypot(x, z) > (AREA_R + 1) * CELL_M || field.heightAt(x, z) < 1.0 || Math.hypot(x - slip.x, z - slip.z) < 9) continue;
    const shade = (bt ? field.layerAt(bt, x, z) : 0) + (forest ? field.layerAt(forest, x, z) : 0);
    const open = grassLayer ? field.layerAt(grassLayer, x, z) : 0;
    const r = rng();
    const kind = r < shade * 0.5 ? 'fern' : r < shade * 0.5 + open * 0.08 ? 'flower_patch' : r < shade * 0.5 + open * 0.1 ? 'moongrass_tuft_seed' : null;
    if (!kind || under[kind].length >= 600) continue;
    const k = 0.8 + rng() * 0.6;
    under[kind].push(new Matrix4().compose(tp.set(x, field.heightAt(x, z) - 0.03, z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(k, k, k)));
  }
  // (M23-02 で変更: 下草は視錐台で見える株だけを描く。update は毎コマ、カメラを動かした後に呼ぶ)
  const understory: CulledProps[] = [];
  for (const [name, mats] of Object.entries(under)) {
    const node = findNode(floraGlb, name);
    // (鐘樹の段の作り直しで変更: 羊歯は作り直して 417 三角形になり、林の画で数百株が見えるので、22 m より先は遠距離版 fern_lod1 (120 三角形) で描く。
    //  下草なので影は落とさない (近い・遠いの組の castShadow を切る)。自動カメラの遮り (lods) には入れない)
    const far = findNode(floraGlb, `${name}_lod1`);
    if (node && far && mats.length) {
      const l = lodProps(node, far, mats, 22);
      l.group.traverse((o) => (o.castShadow = false));
      understory.push(l);
    } else if (node && mats.length) understory.push(culledProps(node, mats, false));
  }
  for (const u of understory) scene.add(u.group);

  // 集落の一角: 船台は南の海岸へ向け、小屋・灯り・巨石・石垣で囲む
  // (M22-04 の後: 南の固定位置をやめ、個体層の目印に合わせる)
  // 集落の一角 (個体層の目印に合わせる): 船台は集落に最も近い海辺のセルに、海へ向けて置く。小屋・灯り・巨石・石垣は集落の周り
  // (M22-06: 区域と目印は鐘樹の前で決めた)
  // 同じ部品はまとめてインスタンス化する (小屋・灯り柱を 1 つずつ複製すると部品 × 材質 × 影の draw call になる)
  const settlementPlacements = new Map<string, Matrix4[]>();
  // (集落の建物の作り直しで変更: y を渡すとその高さに置く (小屋は戸口の外の地面に合わせる、敷石は斜面に沿わせる))
  const place = (name: string, x: number, z: number, ry = 0, y = field.heightAt(x, z) - 0.15) => {
    const list = settlementPlacements.get(name) ?? [];
    list.push(new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), new Vector3(1, 1, 1)));
    settlementPlacements.set(name, list);
  };
  // (M22-06: 集落から船台への向きをやめ、船台から外海が最も開けた方位へ向ける)
  const toSea = Math.atan2(marks.slipwayBow.x, marks.slipwayBow.z);
  place('slipway', slip.x, slip.z, toSea);
  const c0 = marks.center;
  // (集落の建物の作り直しで変更: 小屋は戸口を広場へ向ける (元は 0.4 / −0.6 / 0.1 の向き)。位置は settlementLayout.ts の HUT_OFFSETS)
  const huts = hutPlacements(c0, plaza, field.heightAt);
  for (const h of huts) {
    place('hut', h.x, h.z, h.ry, h.y);
    for (const st of h.steps) place('stepping_stone', st.x, st.z, st.ry, field.heightAt(st.x, st.z) - 0.03);
  }
  for (const l of marks.lanterns.slice(0, 5)) place('lantern_post', l.x + 3, l.z + 3, 0);
  place('megalith', c0.x - 12, c0.z + 6, 0.3);
  place('megalith', c0.x + 16, c0.z + 2, -0.2);
  place('stone_wall', c0.x - 20, c0.z - 2, 1.2);
  place('stone_wall', c0.x + 20, c0.z - 4, -1.1);
  // (M22-06: 衝立は小屋の脇、L 字の石垣は集落の北の角、丸太の山は船台の横)
  place('woven_screen', c0.x - 10, c0.z - 12, 0.4);
  place('woven_screen', c0.x + 9, c0.z - 7, -0.6);
  place('stone_wall_corner', c0.x - 22, c0.z - 18, 0.8);
  const side = { x: marks.slipwayBow.z, z: -marks.slipwayBow.x };
  // 小屋・巨石・石垣もカメラの遮りに数える (舟の見上げのカメラが集落の中に立って巨石が画を覆ったため)。自動カメラは舟も数える (集落の俯瞰が舟の甲板の上に立ったため)
  const settlement = new Group();
  scene.add(settlement);
  // (M23-09) 小屋の近い・遠い (hut と hut_lod1) の組。settlement の中に置くので、自動カメラの遮りの光線は今までどおり小屋に当たる
  let hutSet: LodProps | null = null;
  for (const [name, mats] of settlementPlacements) {
    // (M23-09) 小屋は OPT.hut より先を遠距離版 hut_lod1 で描く (影は近い・遠いに依らず全部の小屋を hut_lod1 で落とす。M23-04 と同じ)
    const far = name === 'hut' && OPT.hut > 0 ? findNode(settleGlb, 'hut_lod1') : null;
    // (M23-09 のやり直しで追加) 影は hut_shadow (前の遠距離版、1,249 三角形) で落とす。遠距離版は 5 千三角形を超えたので影には重い (無ければ遠距離版)
    const hutShadow = name === 'hut' ? (findNode(settleGlb, 'hut_shadow') ?? findNode(settleGlb, 'hut_lod1')) : null;
    if (far) {
      hutSet = lodProps(instanceOf(settleGlb, name, () => placeholderSettlement(name)), far, mats, OPT.hut, mats.length, hutShadow, null, { nearSpread: HUT_NEAR_SPREAD, height: true });
      if (hutSet.shadow) shadowOnly.add(hutSet.shadow);
      settlement.add(hutSet.group);
      continue;
    }
    const g = instanceProps(instanceOf(settleGlb, name, () => placeholderSettlement(name)), mats);
    settlement.add(g);
    // (M23-04) 小屋 (1 棟 10 千三角形) の影は遠い段 hut_lod1 (766 三角形) で落とす
    const lod1 = name === 'hut' ? findNode(settleGlb, 'hut_lod1') : null;
    if (!lod1) continue;
    // (M23-09 のやり直しで追加) 影の形は hut_shadow (上と同じ)
    const lod1Shadow = hutShadow ?? lod1;
    g.traverse((o) => (o.castShadow = false));
    const proxy = instanceProps(lod1Shadow, mats);
    settlement.add(proxy);
    shadowOnly.add(proxy);
  }
  const pile = findNode(shipGlb, 'timber_pile');
  if (pile) {
    const px = slip.x + side.x * 9 - marks.slipwayBow.x * 3;
    const pz = slip.z + side.z * 9 - marks.slipwayBow.z * 3;
    scene.add(instanceProps(pile, [new Matrix4().compose(new Vector3(px, field.heightAt(px, pz) - 0.05, pz), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), toSea + 0.3), new Vector3(1, 1, 1))]));
  }
  // 光の粒と灯りの溜まり (M22-07): 蛍は草地と林の低い所 (区域の陸からまばらに選ぶ)
  const fireflyAt: { x: number; z: number }[] = [];
  for (let i = 0; i < 400 && fireflyAt.length < 60; i++) {
    const x = (rng() * 2 - 1) * AREA_R * CELL_M;
    const z = (rng() * 2 - 1) * AREA_R * CELL_M;
    if (Math.hypot(x, z) <= AREA_R * CELL_M && field.heightAt(x, z) > 1.2) fireflyAt.push({ x, z });
  }
  // (M22-07 の手直し、雨「屋根や地面での跳ね返りがない」) 跳ね返りを置く面の高さ: 小屋の近くは、近い形の小屋 (描かない複製) に真上から光線を落として焼いた屋根の高さ (render/roofs.ts)
  const roofNode = findNode(settleGlb, 'hut');
  const roofs = roofNode && settlementPlacements.get('hut')?.length ? instanceProps(roofNode, settlementPlacements.get('hut')!, false) : null;
  // (M22-07 の 3 回目、雨「跳ね返りの対象を石垣と柱に広げて」) 石垣・灯り柱・立石・衝立の天端も、描かない複製に光線を落として焼く (置き場所ごとの四角の半幅 m)
  const propReach: Record<string, number> = { stone_wall: 2.6, stone_wall_corner: 3.6, lantern_post: 1.4, megalith: 1.3, woven_screen: 2 };
  const surfaceProps = Object.entries(propReach).flatMap(([name, reach]) => {
    const node = findNode(settleGlb, name);
    const mats = settlementPlacements.get(name);
    return node && mats?.length ? [{ node: instanceProps(node, mats, false), reach, sites: mats.map((m) => new Vector3().setFromMatrixPosition(m)) }] : [];
  });
  const surface = createSurface(field.heightAt, huts, roofs, undefined, undefined, surfaceProps);
  // (集落の建物の作り直しで変更: 小屋の炉にも灯りの溜まりを置く (夜に戸口から火の明かりがこぼれる。帆を失うと灯りと一緒に消える))
  // (M22-07 の手直しで変更: 跳ね返りを置く面 (surfaceAt・roofPoints) を渡す)
  const motes = createMotes({ rng, heightAt: field.heightAt, lanterns: [...marks.lanterns.slice(0, 5).map((l) => ({ x: l.x + 3, z: l.z + 3 })), ...huts.map((h) => h.hearth)], fireflyAt, surfaceAt: surface.at, roofPoints: surface.roofPoints, propPoints: surface.propPoints });
  scene.add(motes.group);
  // (M22-07 の手直し、雨「水たまりと波紋がない」) 水たまり: 踏み固めた広場・道・小屋の戸口の窪み。置き場所は専用の乱数で決める (他の置き場所の乱数を動かさない)
  const wornSpots = worn.flatMap((w) => {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const n = Math.max(1, Math.round(len / 5));
    return Array.from({ length: n }, (_, i) => ({ x: w.ax + ((w.bx - w.ax) * (i + 0.5)) / n, z: w.az + ((w.bz - w.az) * (i + 0.5)) / n, r: w.r }));
  });
  const puddles = createPuddles(puddleSpots(wornSpots, field.heightAt, mulberry32(41), 16), field.heightAt);
  scene.add(puddles.mesh);
  // 空の舟 (M22-06): 進みで段を切り替えて船台に載せる
  const shipView = createShipView(shipGlb, slip, toSea, field.heightAt(slip.x, slip.z) - 0.15);
  const shipState = s.ship ? { ...s.ship, ...(OPT.ship !== null ? { progress: OPT.ship } : {}), ...(OPT.launched || OPT.depart ? { launchedYear: s.year } : {}) } : null;
  shipView.set(shipState, { hold: OPT.launched });
  scene.add(shipView.group);

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
  let targets = targetCounts(area, K, folk);
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
  let building = !!s.ship && s.ship.launchedYear === undefined && (s.civ?.stage ?? 0) >= 5;
  // 本体の時間 (M22-08): 速度 speed のとき実時間 1 秒に speed tick 進める (操作画面と同じ。1 年 = 360 tick)。
  // 進んだら区域の密度から目標頭数を引き直す。目印 (船台・林) は最初に決めたまま動かさない (船台は着工の年に決めて動かさない)
  let simSpeed = OPT.freeze ? 0 : OPT.speed;
  let simAcc = 0;
  let snap = s;
  // 沈降 (M22-08): 集落のセルの標高が最初からどれだけ下がったかを、海面の上がりとして見せる
  const elev0 = s.layers.elevation[home];
  water.setLevel(OPT.sink);
  grass.setLevel(OPT.sink);
  // (M22-07 の手直し) 沈む海: 本体の沈降から決まる海面 seaTarget (と調整用の上げ seaExtra) へ、見せる海面 sea.level を上げていく
  let seaTarget = OPT.sink;
  let seaExtra = 0;
  let sea: SurgeState = { level: OPT.sink, surge: 0, hold: 0 };
  const onSnapshot = (next: WorldSnapshot) => {
    snap = next;
    replant(next);
    const level = OPT.sink + Math.max(0, elev0 - next.layers.elevation[home]) * ELEV_M;
    // (M22-07 の手直しで変更: 海面はすぐには上げず、fx で SURGE_RATE m/s で追わせ、上がる間は波立ちと流れを見せる (沈む海岸「波立ちがない。流れが見えない。」))
    seaTarget = level;
    area = extractArea(snap, home, AREA_R);
    targets = targetCounts(area, K, folkRuleFor(snap.civ, 3));
    building = !!snap.ship && snap.ship.launchedYear === undefined && (snap.civ?.stage ?? 0) >= 5;
    if (OPT.ship === null && !OPT.launched && !OPT.depart) shipView.set(snap.ship);
  };
  const clock = host.clock;
  const advance = (dt: number) => {
    if (!clock || simSpeed <= 0) return;
    simAcc += dt * simSpeed;
    const n = Math.min(Math.floor(simAcc), 50);
    if (n <= 0) return;
    simAcc -= n;
    clock.step(n);
    onSnapshot(clock.snapshot());
  };

  // (M23-07 で変更: 空気の層は既定で場面の半分の大きさで描く (OPT.airScale))
  const air = OPT.air ? new AtmospherePass(camera, sun, OPT.airScale) : null;
  // (M23-07 で変更: 場面の MSAA の段を渡す)
  const grade = createGrade(renderer, scene, camera, air ? [air] : [], { msaa: OPT.msaa });
  // 調整用 (M22-07): 開発者ツールから空気の層の uniform と時刻を触る
  (window as unknown as { __observeAir: unknown }).__observeAir = { air, sun, camera, controls, scene, renderer, heightAt: field.heightAt };
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
    b.addEventListener('click', () => (simSpeed = v));
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
  let director = initialDirector();
  let prevFrame: SceneFrame | null = null;
  let touched = !OPT.auto;
  let shownShot: Shot | null = null;
  controls.addEventListener('start', () => (touched = true));
  shots.addEventListener('click', () => (touched = true));
  const drng = mulberry32(37);
  const baseFov = camera.fov;
  // 介入の場面 (M22-08): 芽吹きの金の粒・疫病の霧・雨。霧と雨は実時間で薄れる
  let newEvents: TimelineEvent[] = [];
  let seenEvents = 0;
  // 入った (start した) あとの最初の年表は、見る前の出来事として既読にするだけ (入るたびに昔の介入を再生しない)
  let baseline = true;
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
    else if (e.kind === 'departure') departLeft = DEPART_S;
    else if (e.kind === 'sailLost') lampsTarget = 0;
  };
  // 帆を失う (M22-08、設計 §6): 民が灯りを消す。文明の段階が帆に戻ったら (船が進み出したら) また灯す
  let lamps = 1;
  let lampsTarget = 1;
  // 知らせの帯 (M22-08): 石板の警告・祈り・結末を、画面の上に控えめに出して 8 秒で消す
  // (M22-08 の手直しで変更: 帯の DOM・見た目・寿命は notice.ts へ移した。石板の銘板の見た目にし、続けて来た知らせは待たせて順に出す)
  const band = createNoticeBand(canvas.parentElement ?? document.body, () => host.names ?? {});
  const notice = (e: TimelineEvent) => band.push(e);
  // 調整用: 開発者ツールから知らせを出す (__observeNotice({ year, kind: 'prayer', phase: 'issued', prayer: 'wolves' }))
  (window as unknown as { __observeNotice: unknown }).__observeNotice = notice;
  // 飛び立ちの画 (M22-08、key-visuals/departure): 自動カメラの間は、船台の後ろの高い所から外海へ去る舟を追う
  const DEPART_S = 70;
  let departLeft = OPT.depart && OPT.auto ? DEPART_S : 0;
  const shipAt = new Vector3();
  const departCam = (dt: number): boolean => {
    if (departLeft <= 0) return false;
    departLeft -= dt;
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
    band.step(performance.now());
    if (lampsTarget === 0 && snap.ship && snap.civ && snap.civ.stage >= 5) lampsTarget = 1;
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
  // 調整用: 開発者ツールから場面を起こす (__observeFx('sprout' | 'mist' | 'rain'))
  // (M22-07 の手直しで変更: 'sinking' は海面を 1.5 m 上げる (本体の沈降の代わり)。上がる間は波立ちと流れが見える)
  (window as unknown as { __observeFx: unknown }).__observeFx = (kind: 'sprout' | 'mist' | 'rain' | 'sinking') => {
    const at = marks.grove ?? marks.center;
    if (kind === 'sprout') playScene({ kind, year: snap.year, cell: home, at, speciesId: 'belltree', radius: 1 });
    else if (kind === 'mist') playScene({ kind, year: snap.year, cell: home, at, radius: 4 });
    else if (kind === 'sinking') seaExtra += 1.5;
    else playScene({ kind, year: snap.year });
  };
  // (草の磨き上げ) 調整用: 種の群れ (または点 {x, z}) へ寄る (__observeLook('rabbit', 距離, 高さ, 向き))。兎が草に埋もれないかを近くの低い目で確かめる
  (window as unknown as { __observeLook: unknown }).__observeLook = (at: string | { x: number; z: number }, dist = 6, height = 1.2, yaw = 0) => {
    const c = typeof at === 'string' ? centroid(at) : at;
    if (c) lookFrom(c.x, c.z, dist, height, yaw);
  };
  // (M23-09) 調整用: 小屋の置き場所 (遠距離版への切り替えを寄せ引きで確かめる)
  (window as unknown as { __observeHuts: unknown }).__observeHuts = () => huts.map((h) => ({ x: h.x, y: h.y, z: h.z, ry: h.ry }));
  const direct = (dt: number) => {
    const frame = sceneFrame(snap, area);
    const scenes = detectScenes(prevFrame, frame, newEvents, area);
    for (const e of newEvents) notice(e);
    newEvents = [];
    for (const e of scenes) playScene(e);
    prevFrame = frame;
    const was = director.mode;
    director = stepDirector(director, directorContext(agents.agents, marks), { dt, scenes, userInput: touched }, drng);
    // auto=0 のあいだは自動に戻らない
    if (!OPT.auto) director = { ...director, mode: 'free', shot: null, idle: 0 };
    touched = false;
    if (director.mode === 'auto' && departCam(dt)) {
      shownShot = null;
      return;
    }
    if (director.mode === 'auto' && director.shot) {
      if (director.shot !== shownShot) {
        shownShot = director.shot;
        shotCam.start(director.shot, agents.agents);
      }
      shotCam.update(dt, agents.agents);
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
    const f = followId !== null ? agents.agents.find((a) => a.id === followId) : undefined;
    if (followId !== null && !f) followId = null;
    if (f) {
      const y = field.heightAt(f.x, f.z) + 0.8;
      followDelta.set(f.x - controls.target.x, y - controls.target.y, f.z - controls.target.z).multiplyScalar(Math.min(1, dt * 3));
      controls.target.add(followDelta);
      camera.position.add(followDelta);
    }
    controls.update();
  };
  // 個体を押す (ドラッグでない短い押し) と、その個体を追う。何もない所を押すと追うのをやめる
  let followId: number | null = null;
  const followDelta = new Vector3();
  const down = { x: 0, y: 0 };
  const proj = new Vector3();
  // 試験用 (E2E): 個体の画面上の位置 (canvas の左上から px)。画面の外・カメラの後ろなら null
  // 軽量化の試算用: 区分ごとの三角形の内訳 (render/breakdown.ts)。__observeBreakdown() を開発者ツールから呼ぶ
  (window as unknown as { __observeBreakdown: unknown }).__observeBreakdown = () =>
    triangleBreakdown(camera, { terrain: [terrain], water: [water.mesh], grass: [grass.mesh], belltree: lods.filter((l) => l !== forestSet).map((l) => l.group), forest: forestSet ? [forestSet.group] : [], settlement: [settlement], ship: [shipView.group], creatures: [creatures.group] }, scene);
  (window as unknown as { __observeScreen: unknown }).__observeScreen = (id: number) => {
    const a = agents.agents.find((g) => g.id === id);
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
    for (const a of agents.agents) {
      proj.set(a.x, field.heightAt(a.x, a.z) + 0.8, a.z).project(camera);
      if (proj.z > 1) continue;
      const d = Math.hypot(((proj.x + 1) / 2) * r.width - (e.clientX - r.left), ((1 - proj.y) / 2) * r.height - (e.clientY - r.top));
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    followId = best;
    touched = true;
  });
  const first = params.get('shot');
  if (first && presets[first]) setTimeout(presets[first], 1500);
  const stats = host.stats;
  let last = performance.now();
  let t = 0;
  let frames = 0;
  let acc = 0;
  let fps = 0;
  // (M23-07) 動的な解像度。倍率は renderer のピクセル比に掛ける (ピクセル比 2 の画面は 0.5 = CSS の画素まで、1 の画面は 0.7 まで下げる)
  const dynres = OPT.dynres ? createDynamicResolution({ min: renderer.getPixelRatio() >= 1.5 ? 0.5 : 0.7 }) : null;
  const loop = () => {
    const now = performance.now();
    if (dynres) grade.setPixelRatio(renderer.getPixelRatio() * dynres.update(now - last));
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    // 試作の徘徊: 目的地へ歩き、着いたら食むか待つ (M22-04 の個体層に置き換える)
    // (置き換えた: 以下は個体層の 1 フレーム。出入りの計画 → 状態機械 → 描画)
    advance(dt);
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
    agents = stepAgents(agents, { area, marks, night: day.night > 0.6, building, launched: false, targets }, dt, arng);
    motes.update(t, dt, day.night, camera, controls.target, agents.agents);
    water.update(t);
    shipView.update(t);
    direct(dt);
    // (M23-02 で変更: 視錐台で落とすもの (群れ・木・下草・草) は、このコマのカメラが決まった後 (direct の後) に更新する。前だと寄せ先へ切り替えた最初のコマが前の画の視錐台で描かれる)
    creatures.update(agents.agents, camera, field.heightAt, t, dt);
    for (const l of lods) l.update(camera);
    hutSet?.update(camera);
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
      const count = (sp: string) => agents.agents.filter((a) => a.species === sp).length;
      const st = { follow: followId, camera: director.mode === 'auto' ? `${director.shot?.kind}:${director.shot?.reason}` : 'free', at: camera.position.toArray().map(Math.round), year: snap.year, tick: snap.tick, speed: simSpeed, ship: shipView.node(), phase: +day.phase.toFixed(3), fps: Math.round(fps), res: dynres?.scale ?? 1, calls: info.calls, triangles: info.triangles, deer: count('deer'), wolf: count('wolf'), rabbit: count('rabbit'), folk: agents.agents.filter((a) => a.role === 'folk').length, trees: treeCount, grass: grass.mesh.count + grass.far.count, assets: { deer: !!deerGlb, belltree: !!treeGlb, settlement: !!settleGlb, flora: !!floraGlb, wolf: !!wolfGlb, rabbit: !!rabbitGlb } };
      (window as unknown as { __observeStats: unknown }).__observeStats = st;
      (window as unknown as { __observeDebug: unknown }).__observeDebug = { marks, agents: agents.agents.map((g) => ({ id: g.id, sp: g.species, role: g.role, st: g.state, x: Math.round(g.x), z: Math.round(g.z) })) };
      if (host.debug === false) stats.textContent = `${st.year} 年`;
      else stats.textContent = `${st.year} 年 · ${!clock ? '' : simSpeed === 0 ? '⏸ · ' : `${simSpeed}x · `}${st.fps} fps${st.res < 1 ? ` (解像度 ×${st.res})` : ''} · calls ${st.calls} · tris ${(st.triangles / 1000).toFixed(0)}k · 鹿 ${st.deer}(民 ${st.folk}) · 狼 ${st.wolf} · 兎 ${st.rabbit} · 鐘樹 ${st.trees} · 草 ${st.grass}`;
    }
    if (running) handle = requestAnimationFrame(loop);
  };
  let running = false;
  let handle = 0;
  return {
    setSnapshot(next, timeline) {
      if (timeline) {
        if (timeline.length < seenEvents) seenEvents = 0;
        if (!baseline) newEvents.push(...timeline.slice(seenEvents));
        seenEvents = timeline.length;
        baseline = false;
      }
      if (next.tick !== snap.tick) onSnapshot(next);
    },
    start() {
      if (running) return;
      running = true;
      baseline = true;
      last = performance.now();
      resize();
      handle = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    cameraMode() {
      if (director.mode === 'auto') return 'auto';
      return followId !== null ? 'follow' : 'free';
    },
  };
}
