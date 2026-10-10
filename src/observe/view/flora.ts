import { Color, CylinderGeometry, Group, IcosahedronGeometry, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { WorldSnapshot } from '../../simulation/types';
import type { Point } from '../area';
import { CELL_M, type TerrainField } from '../render/terrain';
import { createToonMaterial } from '../render/toon';
import { findNode } from '../render/assets';
import { culledProps, instanceProps, lodProps, type CulledProps, type LodProps } from '../render/instancer';
import { bakeImpostor } from '../render/impostor';
import { AREA_R, OPT } from './options';
import type { Stage } from './stage';

/**
 * (遠距離版の追加で追加) 作り直した芽・株・下草を遠距離版に替える距離 (m)。どれも近い形の 1〜2 割の三角形で、切り替わりの距離では数画素の違い。
 * 羊歯は FERN_BEYOND_M より先をさらに遠い版 (12 三角形) にする (林の画で遠距離版 120 三角形が 555 株見え、6.7 万三角形あった)
 */
const SEEDLING_NEAR_M = 25;
const STUMP_NEAR_M = 35;
const UNDER_NEAR_M: Record<string, number> = { fern: 22, flower_patch: 25, moongrass_tuft_seed: 25 };
const FERN_BEYOND_M = 45;

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

type Spot = { x: number; z: number; th: number; k: number; rot: number };
const tq = new Quaternion();
const ty = new Vector3(0, 1, 0);
const tp = new Vector3();
const ts = new Vector3();

export type FloraInput = {
  s: WorldSnapshot;
  field: TerrainField;
  rng: () => number;
  hasSettlement: boolean;
  slip: Point;
  treeGlb: GLTF | null;
  floraGlb: GLTF | null;
  stage: Stage;
};

export type Flora = {
  lods: LodProps[];
  stumpSet: LodProps | null;
  forestSet: LodProps | null;
  understory: CulledProps[];
  replant(next: WorldSnapshot): void;
  treeCount(): number;
};

function plantBelltrees({ s, field, rng, hasSettlement, slip, treeGlb, stage: { renderer, shadowOnly, scene } }: FloraInput) {
  // 鐘樹: 密度に比例して最大 OPT.trees 本。密度で段 (成木・若木・芽) を選ぶ。舟の材を伐った跡として船台の近くに株を置く
  const bt = s.layers.populations['belltree'];
  // (M22-03: 植えた鐘樹が芽吹くように) 候補地 (位置・選ぶ閾値・大きさ・向き) は一度だけ決め、本体の密度が変わるたびに同じ候補から選び直す。
  // 残る木は同じ場所・同じ姿のまま、密度が上がった所に新しい木が現れる
  const spots: Spot[] = [];
  for (let i = 0; i < OPT.trees * 8; i++) {
    const x = (rng() * 2 - 1) * AREA_R * CELL_M;
    const z = (rng() * 2 - 1) * AREA_R * CELL_M;
    if (Math.hypot(x, z) > AREA_R * CELL_M || field.heightAt(x, z) < 1.2) continue;
    // 集落の広場と船台は民が切り開いた場所として木を置かない (本体の鐘樹は集落を中心に立つが、小屋が林に埋もれて見えない)
    // (M22-06: 船台の切り開きは南の固定位置 (0, 20) から目印の船台へ)
    if (hasSettlement && (Math.hypot(x - slip.x, z - slip.z) < 19 || Math.hypot(x, z + 6) < 20)) continue;
    spots.push({ x, z, th: rng(), k: 0.65 + rng() * 0.3, rot: rng() * Math.PI * 2 });
  }
  let treeCount = 0;
  // 段ごとに置き場所の行列を集め、GLB のノード (無ければ仮の形) をまとめてインスタンス化する
  const byKind: Record<string, Matrix4[]> = { mature: [], sapling: [], seedling: [], stump: [] };
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
  for (let i = 0; i < (hasSettlement ? 6 : 0); i++) {
    const a = rng() * Math.PI * 2;
    const x = slip.x + Math.cos(a) * (15 + rng() * 6);
    const z = slip.z + Math.sin(a) * (15 + rng() * 6);
    byKind.stump.push(new Matrix4().compose(tp.set(x, field.heightAt(x, z) - 0.05, z), tq.setFromAxisAngle(ty, rng() * Math.PI * 2), ts.set(1, 1, 1)));
  }
  const lods: LodProps[] = [];
  // (遠距離版の追加で追加) 株の近い・遠いの組 (自動カメラの遮りには今までどおり入れない)
  let stumpSet: LodProps | null = null;
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
      // (遠距離版の追加で変更: 芽 (746 三角形) も 25 m より先は遠距離版 belltree_seedling_lod1 (57 三角形) で描く)
      const farNode = kind === 'seedling' ? (findNode(treeGlb, 'belltree_seedling_lod1') ?? far) : far;
      const l = lodProps(node, farNode, mats, kind === 'seedling' ? SEEDLING_NEAR_M : 45, OPT.trees);
      // (M23-04) 芽 (0.4 m) は影を落とさない (影が小さく見えない。下草と同じ)
      if (kind === 'seedling') l.group.traverse((o) => (o.castShadow = false));
      lods.push(l);
      belltreeSets[kind] = l;
      scene.add(l.group);
    } else {
      // (遠距離版の追加で変更: 株 (1,662 三角形) は 35 m より先を遠距離版 belltree_stump_lod1 (220 三角形) で描く。無ければ今までどおり 1 つの組)
      const stumpFar = findNode(treeGlb, 'belltree_stump_lod1');
      if (stumpFar) {
        stumpSet = lodProps(node, stumpFar, mats, STUMP_NEAR_M);
        scene.add(stumpSet.group);
      } else scene.add(instanceProps(node, mats));
    }
  }
  return { lods, stumpSet, belltreeSets, selectBelltrees, bt, treeCount: () => treeCount };
}

function plantForest({ s, field, rng, hasSettlement, slip, floraGlb, stage: { renderer, scene } }: FloraInput, lods: LodProps[]) {
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
    if (hasSettlement && (Math.hypot(x - slip.x, z - slip.z) < 19 || Math.hypot(x, z + 6) < 20)) continue;
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
  return { forestSet, selectForest, forest };
}

function plantUnderstory({ s, field, rng, hasSettlement, slip, floraGlb, stage: { scene } }: FloraInput, bt: Float32Array | undefined, forest: Float32Array | undefined): CulledProps[] {
  // 下草 (M22-03): 羊歯は木の陰 (鐘樹と森の密度)、小花は草地、穂の出た月草は草地にまばら
  const under: Record<string, Matrix4[]> = { fern: [], flower_patch: [], moongrass_tuft_seed: [] };
  const grassLayer = s.layers.populations['grass'];
  for (let i = 0; i < 9000; i++) {
    const x = (rng() * 2 - 1) * (AREA_R + 1) * CELL_M;
    const z = (rng() * 2 - 1) * (AREA_R + 1) * CELL_M;
    if (Math.hypot(x, z) > (AREA_R + 1) * CELL_M || field.heightAt(x, z) < 1.0 || (hasSettlement && Math.hypot(x - slip.x, z - slip.z) < 9)) continue;
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
    // (遠距離版の追加で変更: 近い・遠いの切り替えの距離は下草ごと (UNDER_NEAR_M)。羊歯は 45 m より先をさらに遠い版 fern_lod2 (12 三角形) で描く)
    const beyond = findNode(floraGlb, `${name}_lod2`);
    if (node && far && mats.length) {
      const l = lodProps(node, far, mats, UNDER_NEAR_M[name] ?? 22, mats.length, null, beyond ? { node: beyond, farM: FERN_BEYOND_M } : null);
      l.group.traverse((o) => (o.castShadow = false));
      understory.push(l);
    } else if (node && mats.length) understory.push(culledProps(node, mats, false));
  }
  for (const u of understory) scene.add(u.group);
  return understory;
}

export function createFlora(input: FloraInput): Flora {
  const { lods, stumpSet, belltreeSets, selectBelltrees, bt, treeCount } = plantBelltrees(input);
  const { forestSet, selectForest, forest } = plantForest(input, lods);
  // 本体の年が進んだら、鐘樹と森の木を今の密度で選び直す
  let treeYear = input.s.year;
  const replant = (next: WorldSnapshot) => {
    if (next.year === treeYear) return;
    treeYear = next.year;
    const b = selectBelltrees(next.layers.populations['belltree']);
    for (const kind of ['mature', 'sapling', 'seedling'] as const) belltreeSets[kind]?.setPlacements(b[kind]);
    forestSet?.setPlacements(selectForest(next.layers.populations['forest']));
  };
  const understory = plantUnderstory(input, bt, forest);
  return { lods, stumpSet, forestSet, understory, replant, treeCount };
}
