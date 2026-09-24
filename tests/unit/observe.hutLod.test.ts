import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3, type InstancedMesh } from 'three';
import { lodProps } from '../../src/observe/render/instancer';
import { switchJitter } from '../../src/observe/render/impostor';
import { installShadowOnly } from '../../src/observe/render/shadowOnly';
import { HUT_NEAR_M, HUT_NEAR_SPREAD, HUT_OFFSETS, PROP_NEAR_M, hutPlacements } from '../../src/observe/settlementLayout';

/**
 * 小屋の遠距離版 (M23-09): hut と hut_lod1 を lodProps で振り分ける。切り替えの距離は小屋ごとに揺らし、カメラの高さも入れた距離で測る。
 * 影は近い・遠いに依らず全部の小屋を hut_lod1 で落とし、自動カメラの遮りの光線は近い・遠いどちらの小屋にも当たる
 */

/** 1 m の箱 (三角形 12) の近い形と、8 三角形の遠い形 (数えて見分ける) */
function nearNode(): Group {
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshBasicMaterial()));
  return g;
}
function farNode(): Group {
  const g = new Group();
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  geo.setIndex(Array.from(geo.index!.array.slice(0, 24)));
  g.add(new Mesh(geo, new MeshBasicMaterial()));
  return g;
}
const at = (x: number, z: number, y = 0) => new Matrix4().makeTranslation(x, y, z);
const pos = (x: number, y: number, z: number) => ({ position: { x, y, z } });
const meshes = (l: ReturnType<typeof lodProps>) => ({
  near: l.group.children[0].children[0] as InstancedMesh,
  far: l.group.children[1].children[0] as InstancedMesh,
});
/** 近い組・遠い組に並んだ置き場所の x (影と当たり判定に使う全部) */
function xsOf(im: InstancedMesh): number[] {
  const m = new Matrix4();
  const p = new Vector3();
  return Array.from({ length: im.userData.shadowCount as number }, (_, i) => (im.getMatrixAt(i, m), +p.setFromMatrixPosition(m).x.toFixed(3))).sort((a, b) => a - b);
}

describe('小屋の遠距離版 (lodProps の近い・遠いの切り替え)', () => {
  it('nearSpread: 置き場所ごとに nearM × (1 + nearSpread × 揺らぎ) で切り替える。植え直しても同じ所は同じ距離', () => {
    // 原点から 28〜36 m の間に 120 か所
    const spots = Array.from({ length: 120 }, (_, i) => {
      const a = i * 2.4;
      const d = 28 + (i % 17) * 0.5;
      return [Math.cos(a) * d, Math.sin(a) * d] as const;
    });
    const nearOf = (pts: readonly (readonly [number, number])[]) =>
      pts.filter(([x, z]) => Math.hypot(x, z) < 32 * (1 + 0.2 * switchJitter(x, z))).map(([x]) => +x.toFixed(3)).sort((a, b) => a - b);
    const l = lodProps(nearNode(), farNode(), spots.map(([x, z]) => at(x, z)), 32, 120, null, null, { nearSpread: 0.2 });
    l.update(pos(0, 0, 0));
    const { near, far } = meshes(l);
    expect(xsOf(near)).toEqual(nearOf(spots));
    expect(near.count + far.count).toBe(120);
    // 32 m の輪の内でも遠い形、外でも近い形の所がある (3 棟が同じ距離で一斉に替わらない)
    const near1 = new Set(xsOf(near));
    expect(spots.some(([x, z]) => Math.hypot(x, z) < 32 && !near1.has(+x.toFixed(3)))).toBe(true);
    expect(spots.some(([x, z]) => Math.hypot(x, z) > 32 && near1.has(+x.toFixed(3)))).toBe(true);
    // 揺らぎの幅は nearM × (1 ± nearSpread / 2)
    for (const [x, z] of spots) {
      const m = 32 * (1 + 0.2 * switchJitter(x, z));
      expect(m).toBeGreaterThanOrEqual(32 * 0.9);
      expect(m).toBeLessThanOrEqual(32 * 1.1);
    }
    // 植え直し: 残った所の段は置き場所で決まる
    const next = [...spots.slice(10).reverse(), [3, 4] as const];
    l.setPlacements(next.map(([x, z]) => at(x, z)));
    l.update(pos(0, 0, 0));
    expect(xsOf(meshes(l).near)).toEqual(nearOf(next));
  });

  it('nearSpread を渡さなければ今までどおり全部 nearM で切り替える (木)', () => {
    const l = lodProps(nearNode(), farNode(), [at(31.9, 0), at(32.1, 0), at(0, -31.9), at(0, -32.1)], 32);
    l.update(pos(0, 0, 0));
    expect(xsOf(meshes(l).near)).toEqual([0, 31.9]);
    expect(meshes(l).far.userData.shadowCount).toBe(2);
  });

  it('height: カメラの高さも入れた距離で切り替える。渡さなければ水平の距離 (木)', () => {
    // 水平 25 m・高さの差 30 m (距離 39 m)
    const placements = [at(25, 0, 2), at(-10, 0, 2)];
    const tall = lodProps(nearNode(), farNode(), placements, 32, 2, null, null, { height: true });
    tall.update(pos(0, 32, 0));
    expect(xsOf(meshes(tall).near)).toEqual([-10]);
    expect(xsOf(meshes(tall).far)).toEqual([25]);
    const flat = lodProps(nearNode(), farNode(), placements, 32);
    flat.update(pos(0, 32, 0));
    expect(xsOf(meshes(flat).near)).toEqual([-10, 25]);
    // 位置だけで高さの無いカメラは水平の距離
    const noY = lodProps(nearNode(), farNode(), placements, 32, 2, null, null, { height: true });
    noY.update({ position: { x: 0, z: 0 } });
    expect(xsOf(meshes(noY).near)).toEqual([-10, 25]);
  });

  it('影は近い・遠いに依らず全部の小屋を遠い形で落とし、遮りの光線は近い形・遠い形のどちらの小屋にも当たる (影の形には当たらない)', () => {
    const shadowMap = { render() {} };
    const stage = installShadowOnly(shadowMap);
    const far = farNode();
    const l = lodProps(nearNode(), far, [at(0, -10), at(0, -60), at(40, 0)], 32, 3, far, null, { nearSpread: HUT_NEAR_SPREAD, height: true });
    stage.add(l.shadow!);
    const settlement = new Group();
    settlement.add(l.group);
    const camera = new PerspectiveCamera(50, 16 / 9, 0.2, 500);
    camera.position.set(0, 3, 0);
    camera.lookAt(0, 3, -1);
    camera.updateMatrixWorld();
    l.update(camera);
    const { near, far: farMesh } = meshes(l);
    expect([near.castShadow, farMesh.castShadow]).toEqual([false, false]);
    const proxy = l.shadow!.children[0] as InstancedMesh;
    expect([proxy.castShadow, proxy.count]).toEqual([true, 3]);
    // 近い 1 棟は画面の中、遠い 2 棟のうち 40 m の東の小屋は画面の外 (本の描画は 1 棟、当たり判定は 2 棟)
    expect([near.count, farMesh.count, farMesh.userData.shadowCount]).toEqual([1, 1, 2]);
    settlement.updateMatrixWorld(true);
    const hit = (from: Vector3, dir: Vector3) => new Raycaster(from, dir.normalize(), 0, 200).intersectObject(settlement, true).map((h) => h.object);
    // (遠い形の箱は ±z の面を持たないので、遠い小屋には横 (x) から当てる)
    expect(new Set(hit(new Vector3(0, 0.5, 5), new Vector3(0, 0, -1)))).toEqual(new Set([near]));
    expect(new Set(hit(new Vector3(5, 0.5, -60), new Vector3(-1, 0, 0)))).toEqual(new Set([farMesh]));
    // 画面の外の遠い小屋にも当たる (自動カメラは寄せ先を決めるとき画面の外にも光線を当てる)
    expect(new Set(hit(new Vector3(20, 0.5, 0), new Vector3(1, 0, 0)))).toEqual(new Set([farMesh]));
    // 影の代わりの形 (近い小屋の所にもある) には当たらない
    expect(hit(new Vector3(5, 0.5, -10), new Vector3(-1, 0, 0))).toHaveLength(2);
    expect(new Set(hit(new Vector3(5, 0.5, -10), new Vector3(-1, 0, 0)))).toEqual(new Set([near]));
  });
});

describe('小屋の切り替えの距離 (HUT_NEAR_M・HUT_NEAR_SPREAD)', () => {
  // 平らな地面に置いた 3 棟 (集落の中心は原点、広場は中心の少し南)
  const huts = hutPlacements({ x: 0, z: 0 }, { x: 0, z: -6 }, () => 0);
  const maxSwitch = HUT_NEAR_M * (1 + HUT_NEAR_SPREAD / 2);

  const switchOf = (h: { x: number; z: number }) => HUT_NEAR_M * (1 + HUT_NEAR_SPREAD * switchJitter(h.x, h.z));

  it('切り替えは 54〜66 m の間 (3 回目で 36 → 60 m。3 棟は 62.3・57.3・61.4 m で、寄せ引きの比較画の 50〜70 m の中)', () => {
    expect(HUT_NEAR_M).toBe(60);
    const ms = huts.map((h) => +switchOf(h).toFixed(1));
    expect(ms).toEqual([62.3, 57.3, 61.4]);
    for (const m of ms) {
      expect(m).toBeGreaterThanOrEqual(HUT_NEAR_M * (1 - HUT_NEAR_SPREAD / 2));
      expect(m).toBeLessThanOrEqual(maxSwitch);
      expect(m).toBeGreaterThan(50);
      expect(m).toBeLessThan(70);
    }
    expect(huts).toHaveLength(HUT_OFFSETS.length);
  });

  it('集落の俯瞰 (中心から 46 m 引いて 30 m の高さ、shotCamera の settlementHigh) で遠距離版になる小屋はどの向きでも 57 m より遠い (回ると 72 向きのうち 53 向きで 1 棟以上が替わる。60 m で合意した替わり)', () => {
    let turns = 0;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const cam = { x: Math.sin(a) * 46, y: 30, z: Math.cos(a) * 46 };
      const far = huts.filter((h) => Math.hypot(h.x - cam.x, h.y - cam.y, h.z - cam.z) >= switchOf(h));
      for (const h of far) expect(Math.hypot(h.x - cam.x, h.y - cam.y, h.z - cam.z)).toBeGreaterThan(57);
      if (far.length) turns++;
    }
    expect(turns).toBe(53);
  });

  it('小屋でない部品 (灯り柱・石垣・立石・船台) も小屋と同じ 60 m で遠距離版に替える', () => {
    expect(PROP_NEAR_M).toBe(HUT_NEAR_M);
  });

  it('3 棟の切り替えの距離はみな違う (同じ距離で一斉に替わらない)', () => {
    const ms = huts.map((h) => HUT_NEAR_M * (1 + HUT_NEAR_SPREAD * switchJitter(h.x, h.z)));
    expect(new Set(ms.map((m) => m.toFixed(2))).size).toBe(huts.length);
  });
});

describe('settlement.glb の小屋の 3 つの形 (M23-09 のやり直し)', () => {
  // glb の JSON の塊から、ノードごとの三角形の数と材質の名前を読む
  const glb = readFileSync(new URL('../../assets/models/observe/settlement.glb', import.meta.url));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name: string; mesh?: number }[];
    meshes: { primitives: { indices: number; material: number }[] }[];
    accessors: { count: number }[];
    materials: { name: string }[];
  };
  const nodeOf = (name: string) => {
    const node = json.nodes.find((n) => n.name === name);
    const prims = node?.mesh === undefined ? [] : json.meshes[node.mesh].primitives;
    return {
      triangles: prims.reduce((t, p) => t + json.accessors[p.indices].count / 3, 0),
      materials: prims.map((p) => json.materials[p.material].name).sort(),
    };
  };

  it('遠距離版 hut_lod1 は 60 m より先の軽い形 (2,460 三角形、hut の 4 分の 1 より少ない)、影の形 hut_shadow は前の遠距離版 (1,249)', () => {
    const [hut, far, shadow] = ['hut', 'hut_lod1', 'hut_shadow'].map(nodeOf);
    expect(hut.triangles).toBe(10178);
    expect(far.triangles).toBe(2460);
    expect(far.triangles).toBeLessThan(hut.triangles / 4);
    expect(shadow.triangles).toBe(1249);
    // 遠距離版は hut と同じ材質で塗る (屋根板・石の頂点色の白の材質、蔓、紋・灯籠の光)
    for (const m of ['settlement_roof', 'settlement_stone_paint', 'settlement_vine', 'settlement_glyph', 'settlement_lantern']) {
      expect(hut.materials).toContain(m);
      expect(far.materials).toContain(m);
    }
    expect(far.materials.every((m) => hut.materials.includes(m))).toBe(true);
  });

  it('小屋でない部品の遠距離版 <名前>_lod1 (M23-09 の 3 回目): 三角形は近い形より少なく、材質の組は近い形と同じ (draw call は段ごとに同じ数)', () => {
    const counts = Object.fromEntries(
      ['lantern_post', 'megalith', 'slipway', 'stone_wall', 'stone_wall_corner', 'woven_screen'].map((name) => {
        const [near, far] = [nodeOf(name), nodeOf(`${name}_lod1`)];
        expect(far.materials).toEqual(near.materials);
        return [name, [near.triangles, far.triangles]];
      }),
    );
    expect(counts).toEqual({
      lantern_post: [586, 130],
      megalith: [596, 172],
      slipway: [1982, 1020],
      stone_wall: [948, 230],
      stone_wall_corner: [1544, 484],
      woven_screen: [1060, 884],
    });
  });
});
