import { describe, it, expect } from 'vitest';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
  type InstancedMesh,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createCreatureView, farAtOf, FAR_M } from '../../src/observe/render/creatures';
import type { Agent } from '../../src/observe/agents';

/** 動物の遠い段 (M23-08): 群れ LOD (VAT) の先に、群れ LOD を削った形の VAT を足す */

function eye(): PerspectiveCamera {
  const c = new PerspectiveCamera(42, 16 / 9, 0.2, 2000);
  c.position.set(0, 2, 0);
  c.lookAt(0, 2, -1);
  c.updateMatrixWorld();
  return c;
}

/** 1 本の骨で動く形。群れ LOD は箱 (12 三角形)、遠い段は 4 三角形の四面体 */
function skinned(name: string, geo: BufferGeometry, bone: Bone): SkinnedMesh {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const sk = new SkinnedMesh(geo, new MeshBasicMaterial());
  sk.name = name;
  sk.bind(new Skeleton([bone]));
  return sk;
}

function tetra(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 1, 0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
  return g;
}

function fakeGlb(withFar = true): GLTF {
  const bone = new Bone();
  bone.name = 'root';
  const scene = new Group();
  scene.add(bone, skinned('deer', new BoxGeometry(1, 1, 2), bone), skinned('deer_lod1', new BoxGeometry(1, 1, 2), bone));
  if (withFar) scene.add(skinned('deer_far', tetra(), bone));
  const clips = [
    new AnimationClip('idle', 1, [new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0.1, 0])]),
    new AnimationClip('graze', 2, [new VectorKeyframeTrack('root.position', [0, 2], [0, 0, 0, 0, -0.1, 0])]),
  ];
  return { scene, animations: clips } as unknown as GLTF;
}

const deer = (id: number, z: number, x = 0): Agent => ({ id, species: 'deer', role: 'wild', x, z, heading: 0, state: 'graze', t: 0 });
/** カメラの近く (z = -3) で骨入りの 12 枠を埋める個体 */
const nearTwelve = () => Array.from({ length: 12 }, (_, i) => deer(i, -3, (i - 6) * 0.5));

function herds(view: ReturnType<typeof createCreatureView>) {
  const inst = view.group.children.filter((o) => (o as InstancedMesh).isInstancedMesh && (o as InstancedMesh).geometry.getAttribute('aVid')) as InstancedMesh[];
  const byTris = (tris: number) => inst.filter((m) => m.geometry.index!.count / 3 === tris);
  return { lod1: byTris(12), far: byTris(4), vat: inst };
}

const zOf = (m: InstancedMesh, i: number) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(m.instanceMatrix.array, i * 16)).z;

describe('動物の遠い段 (M23-08)', () => {
  it('替わる距離は個体ごとに FAR_M の ±10% で、同じ id は同じ距離。0 で遠い段を切る', () => {
    const at = Array.from({ length: 200 }, (_, id) => farAtOf(id, FAR_M));
    expect(Math.min(...at)).toBeGreaterThanOrEqual(FAR_M * 0.9);
    expect(Math.max(...at)).toBeLessThanOrEqual(FAR_M * 1.1);
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan(FAR_M * 0.15);
    expect(farAtOf(7, FAR_M)).toBe(farAtOf(7, FAR_M));
    expect(farAtOf(7, 0)).toBe(Infinity);
  });

  it('近い 12 頭は骨入り、その先は群れ LOD、替わる距離より遠い個体は遠い段で描く', () => {
    const view = createCreatureView({ deer: fakeGlb() }, 60);
    const h = herds(view);
    expect(h.lod1.length).toBe(1);
    expect(h.far.length).toBe(1);
    // 遠い段は影を落とさない (群れ LOD の VAT と同じ)
    expect(h.far[0].castShadow).toBe(false);
    view.update([...nearTwelve(), deer(100, -20), deer(101, -30), deer(200, -80), deer(201, -120)], eye(), () => 0, 0, 1 / 60);
    expect(h.lod1[0].count).toBe(2);
    expect([zOf(h.lod1[0], 0), zOf(h.lod1[0], 1)].sort((a, b) => a - b)).toEqual([-30, -20]);
    expect(h.far[0].count).toBe(2);
    expect([zOf(h.far[0], 0), zOf(h.far[0], 1)].sort((a, b) => a - b)).toEqual([-120, -80]);
    // 骨入りの枠の中の遠い段は描かない
    const slots = view.group.children.filter((o) => !(o as InstancedMesh).isInstancedMesh && o.visible);
    expect(slots.length).toBe(12);
    for (const s of slots) expect(s.getObjectByName('deer_far')!.visible).toBe(false);
  });

  it('替わる距離より遠い個体は骨入りの枠に入れない (枠が空いていても)', () => {
    const view = createCreatureView({ deer: fakeGlb() }, 60);
    const h = herds(view);
    view.update([deer(1, -20), deer(2, -90)], eye(), () => 0, 0, 1 / 60);
    const slots = view.group.children.filter((o) => !(o as InstancedMesh).isInstancedMesh && o.visible);
    expect(slots.length).toBe(1);
    expect(slots[0].position.z).toBe(-20);
    expect(h.far[0].count).toBe(1);
    expect(zOf(h.far[0], 0)).toBe(-90);
    expect(h.lod1[0].count).toBe(0);
  });

  it('遠い段から戻るのは 2 m 手前 (境目を歩く個体がちらつかない)', () => {
    const view = createCreatureView({ deer: fakeGlb() }, 60);
    const h = herds(view);
    const id = 500;
    const at = farAtOf(id, FAR_M);
    // 足元の高さ 0、目の高さ 2 m なので、距離 d の個体は z = −√(d² − 4)
    const zAt = (d: number) => -Math.sqrt(d * d - 4);
    const step = (d: number) => view.update([...nearTwelve(), deer(id, zAt(d))], eye(), () => 0, 0, 1 / 60);
    step(at - 0.5);
    expect([h.lod1[0].count, h.far[0].count]).toEqual([1, 0]);
    step(at + 0.5);
    expect([h.lod1[0].count, h.far[0].count]).toEqual([0, 1]);
    step(at - 1.5);
    expect([h.lod1[0].count, h.far[0].count]).toEqual([0, 1]);
    step(at - 2.5);
    expect([h.lod1[0].count, h.far[0].count]).toEqual([1, 0]);
  });

  it('群れ LOD と遠い段は同じクリップ・同じ位相 (替わっても姿勢が跳ばない)', () => {
    const view = createCreatureView({ deer: fakeGlb() }, 60);
    const h = herds(view);
    const clipOf = (m: InstancedMesh) => {
      const a = m.geometry.getAttribute('aClip');
      return [a.getX(0), a.getY(0), a.getZ(0)];
    };
    view.update([...nearTwelve(), deer(300, -30)], eye(), () => 0, 0, 1 / 60);
    const near = clipOf(h.lod1[0]);
    view.update([...nearTwelve(), deer(300, -90)], eye(), () => 0, 0.5, 1 / 60);
    expect(clipOf(h.far[0])).toEqual(near);
    // graze は 2 つ目のクリップ (idle の 15 コマの後)
    expect(near[0]).toBe(15);
  });

  it('farM = 0 と、遠い段の無い GLB は今までどおり 2 段', () => {
    for (const view of [createCreatureView({ deer: fakeGlb() }, 60, undefined, 0), createCreatureView({ deer: fakeGlb(false) }, 60)]) {
      const h = herds(view);
      expect(h.far.length).toBe(0);
      expect(h.vat.length).toBe(1);
      view.update([...nearTwelve(), deer(200, -80)], eye(), () => 0, 0, 1 / 60);
      expect(h.lod1[0].count).toBe(1);
    }
    // 枠が空いていれば、遠い個体も骨入りで描く (今までどおり)
    const off = createCreatureView({ deer: fakeGlb() }, 60, undefined, 0);
    off.update([deer(1, -20), deer(2, -90)], eye(), () => 0, 0, 1 / 60);
    expect(off.group.children.filter((o) => !(o as InstancedMesh).isInstancedMesh && o.visible).length).toBe(2);
  });
});
