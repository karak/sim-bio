import { Group, Quaternion, Vector3, type Object3D } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ShipState } from '../../simulation/ship';
import { shipStage, type ShipStage } from '../scenes';

/**
 * 空の舟 (M22-06、アセットの約束は docs/design/qa/observe/keyitems.md)。ship.glb は段ごとに 1 ノードで、進みに合わせて 1 つだけ見せる。
 * 舟は船台の上に、船台と同じ向き (舳先 = 外海) で載せ、船台の傾き (3.2°、舳先側が下) だけ傾ける。
 * 飛び立った舟は盤木が無い ship_flying にして、船台の上に浮かべてゆっくり揺らす (飛び去る動きは M22-08 の場面で足す)。
 */
const NODE: Record<ShipStage, string> = {
  keel: 'ship_keel',
  ribs: 'ship_ribs',
  planks: 'ship_planks',
  mast: 'ship_mast',
  sails: 'ship_sails',
  // 完成は帆を畳んだ ship_sails のまま (帆を張るのは飛び立ちの段だけ)
  done: 'ship_sails',
};
const FLYING = 'ship_flying';
/** 船台の盤木の上面 (船台の中央、地面から) と、舟の原点から盤木の下端まで */
// (M22-06 試作 2 の判断「船は大きく、立派な感じがほしい」で変更: 舟は全長 ≈ 26 m・幅 7 m・主帆柱 22 m、船台は 27 × 7.6 m。
//  盤木の上面 0.99 → 1.36、盤木の下端 0.35 → 0.5、船台の傾き atan(0.9/16) → atan(1.5/27) (≈ 3.2° のまま)、
//  浮かべる高さ 7 → 11 m (竜骨の下の光の輪が原点の 2.6 m 下まで下がるので、船台の柱石 2.6 m の上に輪が離れて見える高さ))
const SLIP_TOP = 1.36;
const BLOCK_DROP = 0.5;
const SLIP_TILT = Math.atan(1.5 / 27);
const HOVER = 11;

export type ShipView = { group: Group; set(ship: ShipState | null): void; update(t: number): void; node(): string | null };

export function createShipView(glb: GLTF | null, at: { x: number; z: number }, yaw: number, ground: number): ShipView {
  const group = new Group();
  group.name = 'observe-ship';
  const nodes = new Map<string, Object3D>();
  for (const name of [...new Set([...Object.values(NODE), FLYING])]) {
    const n = glb?.scene.getObjectByName(name);
    if (!n) continue;
    const c = n.clone(true);
    c.position.set(0, 0, 0);
    c.visible = false;
    group.add(c);
    nodes.set(name, c);
  }
  const base = new Vector3(at.x, ground + SLIP_TOP + BLOCK_DROP, at.z);
  const rest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), SLIP_TILT));
  const level = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  group.position.copy(base);
  group.quaternion.copy(rest);
  let shown: string | null = null;
  let flying = false;
  return {
    group,
    set(ship) {
      flying = ship?.launchedYear !== undefined;
      const name = !ship ? null : flying ? FLYING : NODE[shipStage(ship.progress)];
      shown = name && nodes.has(name) ? name : null;
      for (const [n, o] of nodes) o.visible = n === shown;
      group.quaternion.copy(flying ? level : rest);
    },
    update(t) {
      if (!flying) return;
      group.position.set(base.x, base.y + HOVER + Math.sin(t * 0.6) * 0.35, base.z);
      group.rotation.z = Math.sin(t * 0.45) * 0.03;
    },
    node: () => shown,
  };
}
