import {
  AnimationMixer,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Material,
  type SkinnedMesh,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
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
import { bakeVat, createVatHerd } from './render/vat';
import { instanceProps } from './render/instancer';

/**
 * M22-02 デフォルメ試作 (observe.html)。空の舟 25 年目 (舟は肋の段) の保存から、集落の周り半径 8 セルを組んで見る。
 * 本体は読むだけ。個体の動きは試作用の単純な徘徊で、M22-04 の個体層に置き換える。
 * URL: ?deer=300&trees=200&near=40&grass=20000&grade=1&bloom=1&shadow=1
 */
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(params.get(k) ?? d);
const flag = (k: string) => params.get(k) !== '0';
const OPT = {
  deer: num('deer', 300),
  trees: num('trees', 200),
  near: num('near', 40),
  grass: num('grass', 20000),
  grade: flag('grade'),
  bloom: flag('bloom'),
  shadow: flag('shadow'),
};
/** 区域 (半径 8) の外に、地面を 4 セル分の縁まで作る */
const AREA_R = 8;
const WINDOW = 12;

type Deer = { x: number; z: number; heading: number; target: Vector3 | null; clip: string; clipT: number; near: number; far: number };

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

function placeholderDeer(): Group {
  const g = new Group();
  const body = new Mesh(new CapsuleGeometry(0.35, 1.0, 4, 8), createToonMaterial({ color: '#D2A04E' }));
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.0;
  const plate = new Mesh(new BoxGeometry(0.5, 0.45, 0.8), createToonMaterial({ color: '#2F6B62' }));
  plate.position.set(0, 1.05, 0.25);
  const neck = new Mesh(new CapsuleGeometry(0.14, 0.5, 4, 8), createToonMaterial({ color: '#D2A04E' }));
  neck.position.set(0, 1.45, 0.55);
  neck.rotation.x = -0.5;
  const antler = new Mesh(new IcosahedronGeometry(0.22, 0), createToonMaterial({ color: '#8FF5E6', emissive: new Color('#8FF5E6'), emissiveIntensity: 1.4 }));
  antler.position.set(0, 1.95, 0.7);
  g.add(body, plate, neck, antler);
  for (const [x, z] of [[-0.18, 0.4], [0.18, 0.4], [-0.18, -0.4], [0.18, -0.4]]) {
    const leg = new Mesh(new CylinderGeometry(0.05, 0.05, 0.8, 6), createToonMaterial({ color: '#B98A3E' }));
    leg.position.set(x, 0.4, z);
    g.add(leg);
  }
  g.traverse((o) => ((o as Mesh).castShadow = true));
  return g;
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
  renderer.shadowMap.type = PCFSoftShadowMap;
  const scene = new Scene();
  scene.background = skyTexture();
  scene.fog = new Fog(new Color('#DCE3DA'), 70, 190);
  const camera = new PerspectiveCamera(42, 1, 0.2, 800);
  camera.position.set(-38, 18, 58);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, field.heightAt(0, 0) + 2, 6);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 160;

  scene.add(new HemisphereLight(new Color('#D7E8F2'), new Color('#6F7A4E'), 1.1));
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
  const water = createWater(field, WINDOW * 2 * CELL_M + 400);
  scene.add(water.mesh);

  const [deerGlb, treeGlb, settleGlb, floraGlb] = await Promise.all([
    loadGlb('/models/observe/deer.glb'),
    loadGlb('/models/observe/belltree.glb'),
    loadGlb('/models/observe/settlement.glb'),
    loadGlb('/models/observe/flora.glb'),
  ]);
  const tuft = findNode(floraGlb, 'grass_tuft') as Mesh | null;
  const grass = createGrass(field, { grass: s.layers.populations['grass'], moss: s.layers.populations['moss'] }, OPT.grass, 7, tuft?.geometry);
  scene.add(grass.mesh);

  // 鐘樹: 密度に比例して最大 OPT.trees 本。密度で段 (成木・若木・芽) を選ぶ。舟の材を伐った跡として船台の近くに株を置く
  const rng = mulberry32(11);
  const bt = s.layers.populations['belltree'];
  const cands: { x: number; z: number; d: number }[] = [];
  for (let i = 0; i < OPT.trees * 8; i++) {
    const x = (rng() * 2 - 1) * AREA_R * CELL_M;
    const z = (rng() * 2 - 1) * AREA_R * CELL_M;
    if (Math.hypot(x, z) > AREA_R * CELL_M || field.heightAt(x, z) < 1.2) continue;
    if (Math.hypot(x, z - 20) < 13) continue;
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
    const k = 0.8 + rng() * 0.4;
    byKind[kind].push(new Matrix4().compose(tp.set(c.x, field.heightAt(c.x, c.z) - 0.1, c.z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(k, k, k)));
  }
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * (15 + rng() * 6);
    const z = 20 + Math.sin(a) * (15 + rng() * 6);
    byKind.stump.push(new Matrix4().compose(tp.set(x, field.heightAt(x, z) - 0.05, z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(1, 1, 1)));
  }
  for (const [kind, mats] of Object.entries(byKind)) {
    const node = findNode(treeGlb, `belltree_${kind}`) ?? placeholderTree(kind as 'mature' | 'sapling' | 'seedling' | 'stump');
    scene.add(instanceProps(node, mats));
  }

  // 集落の一角: 船台は南の海岸へ向け、小屋・灯り・巨石・石垣で囲む
  const place = (name: string, x: number, z: number, ry = 0) => {
    const o = instanceOf(settleGlb, name, () => placeholderSettlement(name));
    o.position.set(x, field.heightAt(x, z) - 0.15, z);
    o.rotation.y = ry;
    scene.add(o);
    return o;
  };
  place('slipway', 0, 20, 0);
  place('hut', -14, -8, 0.4);
  place('hut', 12, -12, -0.6);
  place('hut', -4, -20, 0.1);
  for (const [x, z] of [[-5, 10], [5, 10], [-5, 30], [5, 30]]) place('lantern_post', x, z, 0);
  place('megalith', -12, 6, 0.3);
  place('megalith', 16, 2, -0.2);
  place('stone_wall', -20, -2, 1.2);
  place('stone_wall', 20, -4, -1.1);
  place('stone_wall', 0, -30, 0);

  // 月鹿: 近い OPT.near 頭は SkinnedMesh、残りは VAT の InstancedMesh (設計 §8 の群れの LOD)
  status.textContent = '鹿を焼いています…';
  const clips: AnimationClip[] = deerGlb?.animations ?? [];
  const land = () => {
    for (;;) {
      const x = (rng() * 2 - 1) * AREA_R * CELL_M;
      const z = (rng() * 2 - 1) * AREA_R * CELL_M;
      if (Math.hypot(x, z) < AREA_R * CELL_M && field.heightAt(x, z) > 1.5) return new Vector3(x, 0, z);
    }
  };
  const deer: Deer[] = [];
  for (let i = 0; i < OPT.deer; i++) {
    const p = land();
    deer.push({ x: p.x, z: p.z, heading: rng() * Math.PI * 2, target: null, clip: 'idle', clipT: rng() * 5, near: -1, far: -1 });
  }
  const nearMixers: AnimationMixer[] = [];
  const nearObjs: Object3D[] = [];
  const lod0 = deerGlb ? (deerGlb.scene.getObjectByName('deer') ?? deerGlb.scene) : null;
  for (let i = 0; i < Math.min(OPT.near, deer.length); i++) {
    const o = lod0 ? cloneSkinned(deerGlb!.scene) : placeholderDeer();
    const lod1 = o.getObjectByName('deer_lod1');
    if (lod1) lod1.visible = false;
    scene.add(o);
    nearObjs.push(o);
    deer[i].near = i;
    const mixer = new AnimationMixer(o);
    nearMixers.push(mixer);
  }
  const lod1Mesh = deerGlb?.scene.getObjectByName('deer_lod1') as SkinnedMesh | undefined;
  const bake = deerGlb && lod1Mesh && clips.length ? bakeVat(deerGlb.scene, 'deer_lod1', clips) : null;
  const farCount = deer.length - nearObjs.length;
  let herd: ReturnType<typeof createVatHerd> | null = null;
  let farPlaceholder: InstancedMesh | null = null;
  if (bake && lod1Mesh) {
    herd = createVatHerd(bake, lod1Mesh.material as Material | Material[], Math.max(1, farCount));
    herd.mesh.count = farCount;
    scene.add(herd.mesh);
  } else if (farCount > 0) {
    farPlaceholder = new InstancedMesh(new CapsuleGeometry(0.35, 1.0, 3, 6), createToonMaterial({ color: '#D2A04E' }), farCount);
    farPlaceholder.castShadow = true;
    scene.add(farPlaceholder);
  }
  for (let i = nearObjs.length, k = 0; i < deer.length; i++, k++) deer[i].far = k;

  const setClip = (d: Deer, clip: string) => {
    if (d.clip === clip) return;
    d.clip = clip;
    if (d.near >= 0 && clips.length) {
      const m = nearMixers[d.near];
      const c = clips.find((a) => a.name === clip);
      if (c) {
        m.stopAllAction();
        m.clipAction(c).reset().play();
      }
    }
    if (d.far >= 0 && herd) herd.setClip(d.far, clip, rng() * 5);
  };
  for (const d of deer) {
    const c = d.clip;
    d.clip = '';
    setClip(d, c);
  }

  const grade = createGrade(renderer, scene, camera);
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

  const stats = document.getElementById('stats')!;
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const p = new Vector3();
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
    for (const d of deer) {
      d.clipT -= dt;
      if (d.target) {
        const dx = d.target.x - d.x;
        const dz = d.target.z - d.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.5) {
          d.target = null;
          d.clipT = 4 + rng() * 8;
          setClip(d, rng() < 0.6 ? 'graze' : 'idle');
        } else {
          const want = Math.atan2(dx, dz);
          let diff = want - d.heading;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          d.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.5);
          d.x += Math.sin(d.heading) * 1.3 * dt;
          d.z += Math.cos(d.heading) * 1.3 * dt;
        }
      } else if (d.clipT <= 0) {
        const tgt = new Vector3(d.x + (rng() * 2 - 1) * 12, 0, d.z + (rng() * 2 - 1) * 12);
        if (field.heightAt(tgt.x, tgt.z) > 1.5 && Math.hypot(tgt.x, tgt.z) < AREA_R * CELL_M) {
          d.target = tgt;
          setClip(d, 'walk');
        } else d.clipT = 1;
      }
      const y = field.heightAt(d.x, d.z);
      if (d.near >= 0) {
        const o = nearObjs[d.near];
        o.position.set(d.x, y, d.z);
        o.rotation.y = d.heading;
        nearMixers[d.near].update(dt);
      } else if (herd) {
        q.setFromAxisAngle(up, d.heading);
        herd.mesh.setMatrixAt(d.far, m4.compose(p.set(d.x, y, d.z), q, one));
      } else if (farPlaceholder) {
        q.setFromAxisAngle(up, d.heading + Math.PI / 2);
        farPlaceholder.setMatrixAt(d.far, m4.compose(p.set(d.x, y + 1, d.z), q, one));
      }
    }
    if (herd) {
      herd.mesh.instanceMatrix.needsUpdate = true;
      herd.update(t);
    }
    if (farPlaceholder) farPlaceholder.instanceMatrix.needsUpdate = true;
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
      const st = { fps: Math.round(fps), calls: info.calls, triangles: info.triangles, deer: deer.length, near: nearObjs.length, far: farCount, vat: !!herd, trees: treeCount, grass: grass.mesh.count, assets: { deer: !!deerGlb, belltree: !!treeGlb, settlement: !!settleGlb, flora: !!floraGlb } };
      (window as unknown as { __observeStats: unknown }).__observeStats = st;
      stats.textContent = `${st.fps} fps · calls ${st.calls} · tris ${(st.triangles / 1000).toFixed(0)}k · 鹿 ${st.deer} (近 ${st.near} / VAT ${st.vat ? st.far : 0}) · 鐘樹 ${st.trees} · 草 ${st.grass}`;
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
