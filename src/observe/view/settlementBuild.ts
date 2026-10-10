import { BoxGeometry, Color, CylinderGeometry, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { WorldSnapshot } from '../../simulation/types';
import { mulberry32 } from '../../simulation/rng';
import type { Landmarks, Point } from '../area';
import { CELL_M, type TerrainField, type Worn } from '../render/terrain';
import { createToonMaterial } from '../render/toon';
import { findNode, type loadGlb } from '../render/assets';
import { instanceProps, lodProps, type LodProps } from '../render/instancer';
import { HUT_NEAR_SPREAD, hutPlacements, shadowNodeOf } from '../settlementLayout';
import { createShipView, type ShipView } from '../render/ship';
import { createMotes, type Motes } from '../render/motes';
import { createPuddles, puddleSpots, type Puddles } from '../render/puddles';
import { createSurface } from '../render/roofs';
import type { ObserveInspect } from '../inspect';
import { AREA_R, OPT } from './options';
import type { Stage } from './stage';

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

export type SettlementInput = {
  s: WorldSnapshot;
  field: TerrainField;
  rng: () => number;
  hasSettlement: boolean;
  marks: Landmarks;
  slip: Point;
  plaza: Point;
  worn: Worn[];
  settleGlb: GLTF | null;
  shipGlb: GLTF | null;
  stage: Stage;
};

export type Settlement = {
  settlement: Group;
  hutSet: LodProps | null;
  propSets: LodProps[];
  motes: Motes;
  puddles: Puddles;
  shipView: ShipView;
  hutsInsp: ObserveInspect['huts'];
  propsInsp: ObserveInspect['props'];
};

function placeSettlement({ field, hasSettlement, marks, slip, plaza }: SettlementInput) {
  // 集落の一角: 船台は南の海岸へ向け、小屋・灯り・巨石・石垣で囲む
  // (M22-04 の後: 南の固定位置をやめ、個体層の目印に合わせる)
  // 集落の一角 (個体層の目印に合わせる): 船台は集落に最も近い海辺のセルに、海へ向けて置く。小屋・灯り・巨石・石垣は集落の周り
  // (M22-06: 区域と目印は鐘樹の前で決めた)
  // 同じ部品はまとめてインスタンス化する (小屋・灯り柱を 1 つずつ複製すると部品 × 材質 × 影の draw call になる)
  const settlementPlacements = new Map<string, Matrix4[]>();
  // (集落の建物の作り直しで変更: y を渡すとその高さに置く (小屋は戸口の外の地面に合わせる、敷石は斜面に沿わせる))
  const place = (name: string, x: number, z: number, ry = 0, y = field.heightAt(x, z) - 0.15) => {
    // (M19-18) 集落が無い島では集落の部品を 1 つも置かない
    if (!hasSettlement) return;
    const list = settlementPlacements.get(name) ?? [];
    list.push(new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), new Vector3(1, 1, 1)));
    settlementPlacements.set(name, list);
  };
  // (M22-06: 集落から船台への向きをやめ、船台から外海が最も開けた方位へ向ける)
  const toSea = Math.atan2(marks.slipwayBow.x, marks.slipwayBow.z);
  place('slipway', slip.x, slip.z, toSea);
  const c0 = marks.center;
  // (集落の建物の作り直しで変更: 小屋は戸口を広場へ向ける (元は 0.4 / −0.6 / 0.1 の向き)。位置は settlementLayout.ts の HUT_OFFSETS)
  const huts = hasSettlement ? hutPlacements(c0, plaza, field.heightAt) : [];
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
  return { settlementPlacements, huts, toSea, side };
}

function buildSettlement({ settleGlb, stage: { scene, shadowOnly } }: SettlementInput, settlementPlacements: Map<string, Matrix4[]>) {
  // 小屋・巨石・石垣もカメラの遮りに数える (舟の見上げのカメラが集落の中に立って巨石が画を覆ったため)。自動カメラは舟も数える (集落の俯瞰が舟の甲板の上に立ったため)
  const settlement = new Group();
  scene.add(settlement);
  // (M23-09) 小屋の近い・遠い (hut と hut_lod1) の組。settlement の中に置くので、自動カメラの遮りの光線は今までどおり小屋に当たる
  let hutSet: LodProps | null = null;
  // (M23-09 の 3 回目で追加) 小屋でない部品の近い・遠いの組 (<名前>_lod1 があるもの)
  const propSets: LodProps[] = [];
  for (const [name, mats] of settlementPlacements) {
    // (M23-09) 小屋は OPT.hut より先を遠距離版 hut_lod1 で描く (影は近い・遠いに依らず全部の小屋を hut_lod1 で落とす。M23-04 と同じ)
    const far = name === 'hut' && OPT.hut > 0 ? findNode(settleGlb, 'hut_lod1') : null;
    // (M23-09 のやり直しで追加) 影は hut_shadow (前の遠距離版、1,249 三角形) で落とす。遠距離版は 5 千三角形を超えたので影には重い (無ければ遠距離版)
    const hutShadow = name === 'hut' ? (findNode(settleGlb, shadowNodeOf('hut')) ?? findNode(settleGlb, 'hut_lod1')) : null;
    if (far) {
      hutSet = lodProps(instanceOf(settleGlb, name, () => placeholderSettlement(name)), far, mats, OPT.hut, mats.length, hutShadow, null, { nearSpread: HUT_NEAR_SPREAD, height: true });
      if (hutSet.shadow) shadowOnly.add(hutSet.shadow);
      settlement.add(hutSet.group);
      continue;
    }
    // (M23-09 の 3 回目で追加) 小屋でない部品は OPT.prop より先を遠距離版で描く (小屋と同じく置き場所ごとに揺らし、高さも入れた距離。影は下の M23-10 のとおり遠距離版で落とす)
    const propFar = name !== 'hut' && OPT.prop > 0 ? findNode(settleGlb, `${name}_lod1`) : null;
    if (propFar) {
      // (M23-10 で変更: 影は近い・遠いに依らず全部の置き場所を shadowNodeOf の形 (遠距離版) で落とす。近い形 (settle1 の格子の丸めた石) で落とすと影が 3〜4 倍になった)
      const propShadow = findNode(settleGlb, shadowNodeOf(name));
      const set = lodProps(instanceOf(settleGlb, name, () => placeholderSettlement(name)), propFar, mats, OPT.prop, mats.length, propShadow, null, { nearSpread: HUT_NEAR_SPREAD, height: true });
      if (set.shadow) shadowOnly.add(set.shadow);
      propSets.push(set);
      settlement.add(set.group);
      continue;
    }
    const g = instanceProps(instanceOf(settleGlb, name, () => placeholderSettlement(name)), mats);
    settlement.add(g);
    // (M23-04) 遠距離版の組にしなかった小屋・部品も、影は粗い形 (小屋は hut_lod1、ほかは shadowNodeOf の形) で落とす
    // (M23-10 で変更: 小屋でない部品も、遠距離版を切った (prop=0) ときは shadowNodeOf の形で影を落とす。既定の段と影を揃え、いつも近い形の比べの画で影が変わらない)
    const lod1 = name === 'hut' ? findNode(settleGlb, 'hut_lod1') : findNode(settleGlb, shadowNodeOf(name));
    if (!lod1) continue;
    // (M23-09 のやり直しで追加) 影の形は hut_shadow (上と同じ)
    const lod1Shadow = hutShadow ?? lod1;
    g.traverse((o) => (o.castShadow = false));
    const proxy = instanceProps(lod1Shadow, mats);
    settlement.add(proxy);
    shadowOnly.add(proxy);
  }
  return { settlement, hutSet, propSets };
}

export function createSettlement(input: SettlementInput): Settlement {
  const { s, field, rng, hasSettlement, marks, slip, worn, settleGlb, shipGlb, stage: { scene } } = input;
  const { settlementPlacements, huts, toSea, side } = placeSettlement(input);
  const { settlement, hutSet, propSets } = buildSettlement(input, settlementPlacements);
  const pile = findNode(shipGlb, 'timber_pile');
  if (pile && hasSettlement) {
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
  // (M23-09) 調整用: 小屋の置き場所 (遠距離版への切り替えを寄せ引きで確かめる)
  const hutsInsp: ObserveInspect['huts'] = () => huts.map((h) => ({ x: h.x, y: h.y, z: h.z, ry: h.ry }));
  // (M23-09 の 3 回目で追加) 調整用: 集落の部品の名前と置き場所
  const propsInsp: ObserveInspect['props'] = () => [...settlementPlacements].map(([name, ms]) => ({ name, at: ms.map((m) => [m.elements[12], m.elements[13], m.elements[14]]) }));
  return { settlement, hutSet, propSets, motes, puddles, shipView, hutsInsp, propsInsp };
}
