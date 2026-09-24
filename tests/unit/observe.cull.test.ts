import { describe, it, expect } from 'vitest';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Frustum,
  Group,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
  type InstancedMesh,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ViewCull, packVisible } from '../../src/observe/render/cull';
import { culledProps, lodProps } from '../../src/observe/render/instancer';
import { createGrass } from '../../src/observe/render/grass';
import { createCreatureView } from '../../src/observe/render/creatures';
import { createShotCamera } from '../../src/observe/render/shotCamera';
import { createTerrainField, groundColorAt, type GroundLayers } from '../../src/observe/render/terrain';
import type { Agent } from '../../src/observe/agents';
import type { Shot } from '../../src/observe/director';
import { mulberry32 } from '../../src/simulation/rng';
import type { WorldSnapshot } from '../../src/simulation/types';

/** 12×12 の陸 (observe.grass.test.ts と同じ)。草の密度は 0.4、東の半分に苔 */
function snap(): WorldSnapshot {
  const size = 12;
  const elevation = new Float32Array(size * size).fill(0.45);
  const grass = new Float32Array(size * size).fill(0.4);
  const moss = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 6; x < size; x++) moss[y * size + x] = 0.5;
  return {
    size,
    layers: { elevation, populations: { grass, moss } },
  } as unknown as WorldSnapshot;
}
const home = 6 * 12 + 6;

/** 原点から -z を見るカメラ (画角 42°、16:9) */
function eye(x = 0, y = 2, z = 0, lookX = 0, lookZ = -1): PerspectiveCamera {
  const c = new PerspectiveCamera(42, 16 / 9, 0.2, 2000);
  c.position.set(x, y, z);
  c.lookAt(x + lookX, y, z + lookZ);
  c.updateMatrixWorld();
  return c;
}

/** 本当の (広げない) 視錐台に球が掛かるか */
function trulySees(camera: PerspectiveCamera, c: Vector3, r: number): boolean {
  camera.updateMatrixWorld();
  const f = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return f.intersectsSphere(new Sphere(c, r));
}

/** 高さ 1 m・幅 1 m の箱を、根元を原点に置いたノード */
function boxNode(): Group {
  const g = new Group();
  const m = new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshBasicMaterial());
  g.add(m);
  return g;
}

const at = (x: number, z: number) => new Matrix4().makeTranslation(x, 0, z);

describe('インスタンスごとの視錐台カリング (M23-02)', () => {
  it('見えるものを前に、見えないものを後ろに並べる。rest = false なら見えないものは並べない', () => {
    const order: [number, number][] = [];
    const r = packVisible(
      6,
      (i) => i % 2 === 0,
      (from, to) => order.push([from, to]),
      true,
    );
    expect(r).toEqual({ visible: 3, all: 6 });
    expect(order).toEqual([
      [0, 0],
      [2, 1],
      [4, 2],
      [1, 3],
      [3, 4],
      [5, 5],
    ]);
    const only: number[] = [];
    expect(
      packVisible(
        6,
        (i) => i % 2 === 0,
        (from) => only.push(from),
        false,
        (i) => i !== 2,
      ),
    ).toEqual({ visible: 2, all: 2 });
    expect(only).toEqual([0, 4]);
  });

  it('カメラの前の球は見え、後ろ・横の外の球は見えない。広げた分 (角度と距離) の内側の球は見える', () => {
    const cam = eye();
    const v = new ViewCull(0.06, 1.5);
    expect(v.update(cam)).toBe(true);
    expect(v.sees(0, 2, -20, 0.5)).toBe(true);
    expect(v.sees(0, 2, 20, 0.5)).toBe(false);
    // 横の端: 半画角 (水平) は約 34.4°。40° の所は外、36° の所は広げた 3.4° の内側
    const side = (deg: number, d: number) => [Math.sin((deg * Math.PI) / 180) * d, 2, -Math.cos((deg * Math.PI) / 180) * d] as const;
    expect(v.sees(...side(40, 50), 0.1)).toBe(false);
    expect(v.sees(...side(36, 50), 0.1)).toBe(true);
    // 動いていなければ取り直さない。広げた分の半分より回ったら取り直す
    expect(v.update(cam)).toBe(false);
    cam.rotateY(0.02);
    expect(v.update(cam)).toBe(false);
    cam.rotateY(0.02);
    expect(v.update(cam)).toBe(true);
    // 画角が変われば取り直す
    cam.fov = 30;
    cam.updateProjectionMatrix();
    expect(v.update(cam)).toBe(true);
  });

  it('取り直さずにいる間 (カメラが広げた分の半分まで動く・回る) も、本当の視錐台に掛かる球は必ず見える (画面の端で消えない)', () => {
    const rng = mulberry32(5);
    const balls = Array.from({ length: 3000 }, () => ({
      c: new Vector3((rng() * 2 - 1) * 120, rng() * 12, (rng() * 2 - 1) * 120),
      r: 0.2 + rng() * 5,
    }));
    let missed = 0;
    let checked = 0;
    for (let trial = 0; trial < 60; trial++) {
      const cam = eye((rng() * 2 - 1) * 40, 1 + rng() * 20, (rng() * 2 - 1) * 40, rng() * 2 - 1, rng() * 2 - 1);
      cam.rotateX((rng() - 0.5) * 0.6);
      const v = new ViewCull();
      v.update(cam);
      // 少しずつ動かし・回し、取り直しが起きない間の姿勢ごとに確かめる
      for (let step = 0; step < 30; step++) {
        // 1 歩は広げた分の 1/4 ほど (取り直しは 2〜4 歩ごと)
        cam.position.add(new Vector3(rng() - 0.5, (rng() - 0.5) * 0.3, rng() - 0.5).multiplyScalar(v.padM * 0.4));
        cam.rotateY((rng() - 0.5) * v.marginRad * 0.6);
        cam.rotateX((rng() - 0.5) * v.marginRad * 0.4);
        cam.rotateZ((rng() - 0.5) * v.marginRad * 0.2);
        if (v.update(cam)) continue;
        for (const b of balls) {
          if (!trulySees(cam, b.c, b.r)) continue;
          checked++;
          if (!v.sees(b.c.x, b.c.y, b.c.z, b.r)) missed++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
    expect(missed).toBe(0);
  });

  it('本の描画は見える数、影の描画と光線の当たり判定と境界の球は全部で見る (splitCount)', () => {
    const g = culledProps(boxNode(), [at(0, -10), at(0, 10), at(30, -5)], true);
    const im = g.group.children[0] as InstancedMesh;
    g.update(eye());
    expect(im.count).toBe(1);
    expect(im.userData.shadowCount).toBe(3);
    // 見える箱が前 (0, -10)、見えない 2 つが後ろ
    const m = new Matrix4();
    im.getMatrixAt(0, m);
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([0, 0, -10]);
    // 影の描画の間だけ全部
    im.onBeforeShadow(null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    expect(im.count).toBe(3);
    im.onAfterShadow(null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    expect(im.count).toBe(1);
    // カメラの後ろの箱にも光線が当たる (自動カメラの遮り)
    im.updateMatrixWorld();
    const hit = new Raycaster(new Vector3(0, 0.5, 0), new Vector3(0, 0, 1), 0, 50).intersectObject(im);
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0].point.z).toBeCloseTo(9.5, 5);
    // 境界の球は 3 つとも囲む
    im.boundingSphere = null;
    im.computeBoundingSphere();
    expect(im.boundingSphere!.containsPoint(new Vector3(30, 0.5, -5))).toBe(true);
    expect(im.boundingSphere!.containsPoint(new Vector3(0, 0.5, 10))).toBe(true);
    expect(im.count).toBe(1);
  });

  it('木 (lodProps): 近い・遠いに分けた上で見える木だけを本の描画に回し、影は全部の木で落とす', () => {
    const placements = [at(0, -10), at(0, 10), at(0, -60), at(0, 60), at(40, -5)];
    const l = lodProps(boxNode(), boxNode(), placements, 38);
    const [near, far] = l.group.children.map((c) => c.children[0] as InstancedMesh);
    l.update(eye());
    // 近い (38 m 未満): (0,-10) 見える、(0,10) 後ろ、(40,-5) は 40.3 m で遠い。遠い: (0,-60) 見える、(0,60) 後ろ、(40,-5) 横で外
    expect([near.count, near.userData.shadowCount]).toEqual([1, 2]);
    expect([far.count, far.userData.shadowCount]).toEqual([1, 3]);
    const m = new Matrix4();
    const p = new Vector3();
    near.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).z).toBe(-10);
    far.getMatrixAt(0, m);
    expect(p.setFromMatrixPosition(m).z).toBe(-60);
    // 位置だけ (Camera でない) を渡したときは今までどおり全部を描く
    const l2 = lodProps(boxNode(), boxNode(), placements, 38);
    l2.update({ position: { x: 0, z: 0 } });
    const [n2, f2] = l2.group.children.map((c) => c.children[0] as InstancedMesh);
    expect([n2.count, f2.count]).toEqual([2, 3]);
  });

  it('自動カメラの遮りの判定は、画面の外で本の描画から外れた木にも当たる', () => {
    // 寄せ先の最初の向き (+z 側 36 m) の途中に木の組を置く。今のカメラは -z を見ていて、木は画面の外
    const tree = new Group();
    tree.add(new Mesh(new BoxGeometry(8, 12, 2).translate(0, 6, 0), new MeshBasicMaterial()));
    const l = lodProps(tree, tree, [at(0, 30)], 38);
    const camera = eye(0, 2, 0, 0, -1);
    l.update(camera);
    const meshes = l.group.children.map((c) => c.children[0] as InstancedMesh);
    expect(meshes.reduce((s, im) => s + im.count, 0)).toBe(0);
    l.group.updateMatrixWorld(true);
    const shot: Shot = {
      kind: 'shipLookUp',
      subject: { x: 0, z: 0 },
      duration: 12,
      reason: 'landscape',
    };
    createShotCamera(
      camera,
      () => 0,
      () => [l.group],
      80,
      () => 0,
    ).start(shot, []);
    // 木を通らない向きへ回る (遮りが無ければ +z 側 36 m に立つ。observe.shotCamera.test.ts の同じ試験)
    const toCam = new Vector3(camera.position.x, 0, camera.position.z).normalize();
    expect(toCam.z).toBeLessThan(0.95);
  });

  it('草: 見える房だけを前に詰め、根元の色 (aRoot)・房の色は行列と組のまま動く。見える房は落とさない', () => {
    const s = snap();
    const field = createTerrainField(s, home, 5);
    const layers: GroundLayers = {
      grass: s.layers.populations.grass,
      moss: s.layers.populations.moss,
    };
    const all = createGrass(field, layers, 1500, 7, undefined, 40);
    all.update(0, { x: 0, z: 0 });
    const g = createGrass(field, layers, 1500, 7, undefined, 40);
    const cam = eye(0, field.heightAt(0, 0) + 2, 0, 1, -0.3);
    g.update(0, { x: 0, z: 0 }, cam);
    expect(g.mesh.count).toBeGreaterThan(20);
    expect(g.mesh.count).toBeLessThan(all.mesh.count * 0.6);
    const root = g.mesh.geometry.getAttribute('aRoot') as InstancedBufferAttribute;
    const m = new Matrix4();
    const p = new Vector3();
    const want = new Color();
    const c = new Color();
    const colorOf = new Map<string, number[]>();
    for (let i = 0; i < all.mesh.count; i++) {
      all.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      all.mesh.getColorAt(i, c);
      colorOf.set(`${p.x},${p.z}`, c.toArray());
    }
    const seen = new Set<string>();
    for (let i = 0; i < g.mesh.count; i++) {
      g.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      seen.add(`${p.x},${p.z}`);
      groundColorAt(field, layers, p.x, p.z, want);
      expect(root.getX(i)).toBeCloseTo(want.r, 5);
      expect(root.getZ(i)).toBeCloseTo(want.b, 5);
      g.mesh.getColorAt(i, c);
      expect(c.toArray()).toEqual(colorOf.get(`${p.x},${p.z}`));
    }
    // 間引かずに残る房のうち、本当の視錐台に掛かるもの (房の根元 + 0.3 m の球) は全部描いている
    let inView = 0;
    for (let i = 0; i < all.mesh.count; i++) {
      all.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (!trulySees(cam, p.clone().setY(p.y + 0.2), 0.3)) continue;
      inView++;
      expect(seen.has(`${p.x},${p.z}`)).toBe(true);
    }
    expect(inView).toBeGreaterThan(20);
    // 向きを変えれば詰め直す
    const before = g.mesh.count;
    cam.rotateY(Math.PI);
    g.update(0, { x: 0, z: 0 }, cam);
    expect(g.mesh.count).not.toBe(before);
  });

  it('群れ (VAT): 視錐台の外の個体は書かない。近くの骨入りの個体は今までどおり', () => {
    // 1 本の骨で動く箱を群れ LOD (deer_lod1) とし、idle を 1 クリップ持つ仮の GLB
    const geo = new BoxGeometry(1, 1, 2);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    geo.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(
        new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)),
        4,
      ),
    );
    const bone = new Bone();
    bone.name = 'root';
    const sk = new SkinnedMesh(geo, new MeshBasicMaterial());
    sk.name = 'deer_lod1';
    sk.add(bone);
    sk.bind(new Skeleton([bone]));
    const scene = new Group();
    scene.add(sk);
    const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0.1, 0])]);
    const glb = { scene, animations: [idle] } as unknown as GLTF;
    const view = createCreatureView({ deer: glb }, 60);
    const herd = view.group.children.find((o) => (o as InstancedMesh).isInstancedMesh) as InstancedMesh;
    // 近くの 12 頭 (骨入り) より遠くに、前 (-z) に 10 頭、後ろ (+z) に 10 頭
    const deer = (id: number, x: number, z: number): Agent => ({
      id,
      species: 'deer',
      role: 'wild',
      x,
      z,
      heading: 0,
      state: 'graze',
      t: 0,
    });
    const agents: Agent[] = [];
    for (let i = 0; i < 12; i++) agents.push(deer(i, (i - 6) * 0.5, -2));
    for (let i = 0; i < 10; i++) agents.push(deer(100 + i, (i - 5) * 2, -40), deer(200 + i, (i - 5) * 2, 40));
    const camera = eye(0, 2, 0);
    view.update(agents, camera, () => 0, 0, 1 / 60);
    expect(herd.count).toBe(10);
    const m = new Matrix4();
    for (let i = 0; i < herd.count; i++) {
      herd.getMatrixAt(i, m);
      expect(new Vector3().setFromMatrixPosition(m).z).toBe(-40);
    }
    // 位置だけを渡したときは全部 (今までどおり)
    view.update(agents, { position: camera.position } as never, () => 0, 0, 1 / 60);
    expect(herd.count).toBe(20);
  });
});
