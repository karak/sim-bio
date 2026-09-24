import { describe, it, expect } from 'vitest';
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
  type Object3D,
} from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { installShadowOnly } from '../../src/observe/render/shadowOnly';
import { lodProps } from '../../src/observe/render/instancer';
import { triangleBreakdown } from '../../src/observe/render/breakdown';
import { createCreatureView, trimGlow } from '../../src/observe/render/creatures';
import type { Agent } from '../../src/observe/agents';

/** 高さ 1 m・幅 1 m の箱 (12 三角形) を、根元を原点に置いたノード */
function boxNode(): Group {
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshBasicMaterial()));
  return g;
}

/** 8 面体 (8 三角形) の影の代わりの形 */
function proxyNode(): Group {
  const g = new Group();
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  geo.setIndex(Array.from(geo.index!.array.slice(0, 24)));
  g.add(new Mesh(geo, new MeshBasicMaterial()));
  return g;
}

const at = (x: number, z: number) => new Matrix4().makeTranslation(x, 0, z);

/** three.js の WebGLShadowMap の代わり: render の間に見えていたものを記録する */
function fakeShadowMap(scene: Object3D) {
  const seen: string[][] = [];
  const map = {
    render() {
      const names: string[] = [];
      scene.traverseVisible((o) => {
        if ((o as Mesh).isMesh && o.castShadow) names.push(o.name);
      });
      seen.push(names);
    },
  };
  return { map, seen };
}

describe('影の描画だけに出す代わりの形 (M23-04)', () => {
  it('代わりの形は影の描画の間だけ見え、ほかの時は見えない。光線は当たらない', () => {
    const scene = new Group();
    const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    body.name = 'body';
    body.castShadow = false;
    const proxy = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    proxy.name = 'proxy';
    scene.add(body, proxy);
    const { map, seen } = fakeShadowMap(scene);
    const stage = installShadowOnly(map);
    stage.add(proxy);
    expect(proxy.visible).toBe(false);
    expect(proxy.castShadow).toBe(true);
    // 本の描画 (影の描画の外) では見えない
    const main: string[] = [];
    scene.traverseVisible((o) => (o as Mesh).isMesh && main.push(o.name));
    expect(main).toEqual(['body']);
    map.render();
    expect(seen).toEqual([['proxy']]);
    expect(proxy.visible).toBe(false);
    // 光線の当たり判定 (自動カメラの遮り) には当たらない
    proxy.updateMatrixWorld();
    const hits = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObject(scene, true).map((h) => h.object.name);
    expect(new Set(hits)).toEqual(new Set(['body']));
  });

  it('描画が投げても代わりの形は見えない状態に戻る', () => {
    const map = {
      render() {
        throw new Error('描けない');
      },
    };
    const stage = installShadowOnly(map);
    const proxy = new Group();
    stage.add(proxy);
    expect(() => map.render()).toThrow('描けない');
    expect(proxy.visible).toBe(false);
  });

  it('骨入りの代わりの形は影の描画の前に骨の行列を更新する。親が見えない (使っていない枠) ときは描かず、更新もしない', () => {
    const geo = new BoxGeometry(1, 1, 1);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const bone = new Bone();
    const sk = new SkinnedMesh(geo, new MeshBasicMaterial());
    sk.name = 'lod1';
    sk.add(bone);
    sk.bind(new Skeleton([bone]));
    const slot = new Group();
    slot.add(sk);
    const scene = new Group();
    scene.add(slot);
    const { map, seen } = fakeShadowMap(scene);
    const stage = installShadowOnly(map);
    stage.add(sk);
    bone.position.set(0, 2, 0);
    scene.updateMatrixWorld(true);
    map.render();
    expect(seen[0]).toEqual(['lod1']);
    // 骨を 2 m 上げた姿勢が骨の行列に入っている (結んだときの逆行列 × 今の骨)
    expect(sk.skeleton.boneMatrices![13]).toBeCloseTo(2, 5);
    slot.visible = false;
    bone.position.set(0, 5, 0);
    scene.updateMatrixWorld(true);
    map.render();
    expect(seen[1]).toEqual([]);
    expect(sk.skeleton.boneMatrices![13]).toBeCloseTo(2, 5);
  });

  it('木 (lodProps): shadow を渡すと近い・遠いの組は影を落とさず、全部の木を代わりの形で落とす。植え直しにも付いていく', () => {
    const placements = [at(0, -10), at(0, 10), at(0, -60)];
    const l = lodProps(boxNode(), boxNode(), placements, 38, 5, proxyNode());
    const [near, far] = l.group.children.slice(0, 2).map((c) => c.children[0] as InstancedMesh);
    expect(near.castShadow).toBe(false);
    expect(far.castShadow).toBe(false);
    const proxy = l.shadow!.children[0] as InstancedMesh;
    expect(proxy.castShadow).toBe(true);
    expect(proxy.count).toBe(3);
    const camera = new PerspectiveCamera(42, 16 / 9, 0.2, 2000);
    camera.position.set(0, 2, 0);
    camera.lookAt(0, 2, -1);
    camera.updateMatrixWorld();
    l.update(camera);
    // 本の描画の詰め直しは代わりの形を動かさない
    expect(proxy.count).toBe(3);
    const m = new Matrix4();
    const zs = () => Array.from({ length: proxy.count }, (_, i) => new Vector3().setFromMatrixPosition((proxy.getMatrixAt(i, m), m)).z);
    expect(zs()).toEqual([-10, 10, -60]);
    l.setPlacements([at(5, 5), at(6, 6), at(7, 7), at(8, 8)]);
    expect(proxy.count).toBe(4);
    expect(zs()).toEqual([5, 6, 7, 8]);
    // 渡さなければ今までどおり近い・遠いの組が影を落とす
    const plain = lodProps(boxNode(), boxNode(), placements, 38);
    expect(plain.shadow).toBeNull();
    expect((plain.group.children[0].children[0] as InstancedMesh).castShadow).toBe(true);
  });

  it('内訳: 代わりの形は影の三角形にだけ数え、本の描画 (drawn・inView・インスタンス) には数えない', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 500);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const scene = new Group();
    const l = lodProps(boxNode(), boxNode(), [at(0, -10), at(0, -60)], 38, 2, proxyNode());
    scene.add(l.group);
    const stage = installShadowOnly({ render() {} });
    stage.add(l.shadow!);
    l.update(camera);
    scene.updateMatrixWorld(true);
    const rows = triangleBreakdown(camera, { belltree: [l.group] }, scene);
    expect(rows.belltree).toEqual({ drawn: 24, inView: 24, shadow: 16, beyond30: 12, beyond60: 12, instances: 2 });
  });

  it('雌の影: 群れ LOD (雄) から、頭の骨の光る頂点で高さ 1.95 m より上を含む三角形 (角) を除く', () => {
    // 三角形 3 つ: 体 (光らない、高い所)、角 (頭の骨・光る・高い)、光る模様 (頭の骨・光る・低い)
    const geo = new BufferGeometry();
    const tri = (y: number) => [0, y, 0, 1, y, 0, 0, y, 1];
    geo.setAttribute('position', new Float32BufferAttribute([...tri(2.1), ...tri(2.5), ...tri(1.5)], 3));
    geo.setAttribute('aEmissive', new Float32BufferAttribute([...Array(9).fill(0), ...Array(9).fill(0.4), ...Array(9).fill(0.4)], 3));
    const head = 3;
    const idx = [...Array(3).fill([0, 0, 0, 0]), ...Array(6).fill([head, 0, 0, 0])].flat();
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: 9 }, () => [1, 0, 0, 0]).flat(), 4));
    const out = trimGlow(geo, head, 1.95);
    expect(Array.from(out.index!.array)).toEqual([0, 1, 2, 6, 7, 8]);
    expect(out.getAttribute('position')).toBe(geo.getAttribute('position'));
    // 光る頂点が別の骨なら残す
    expect(trimGlow(geo, 7, 1.95).index!.count).toBe(9);
  });

  it('近くの骨入りの個体は群れ LOD で影を落とし、本の形は影を落とさない。雌は角を除いた形', () => {
    // 1 本の骨 (head) で動く箱を、雄 (deer)・雌 (deer_doe)・群れ LOD (deer_lod1) の 3 つにした仮の GLB。群れ LOD の上半分は光る角
    const skinned = (name: string, bone: Bone, glowAbove?: number) => {
      const geo = new BoxGeometry(1, 3, 1).translate(0, 1.5, 0);
      const n = geo.getAttribute('position').count;
      geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(n * 4), 4));
      geo.setAttribute('skinWeight', new Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      const pos = geo.getAttribute('position');
      geo.setAttribute('aEmissive', new Float32BufferAttribute(Array.from({ length: n }, (_, i) => (glowAbove !== undefined && pos.getY(i) > glowAbove ? [0.5, 0.5, 0.5] : [0, 0, 0])).flat(), 3));
      const sk = new SkinnedMesh(geo, new MeshBasicMaterial());
      sk.name = name;
      sk.castShadow = true;
      sk.bind(new Skeleton([bone]));
      return sk;
    };
    const bone = new Bone();
    bone.name = 'head';
    const scene = new Group();
    scene.add(bone, skinned('deer', bone), skinned('deer_doe', bone), skinned('deer_lod1', bone, 2));
    const idle = new AnimationClip('idle', 1, [new VectorKeyframeTrack('head.position', [0, 1], [0, 0, 0, 0, 0.1, 0])]);
    const glb = { scene, animations: [idle] } as unknown as GLTF;
    const shadowRoots: Object3D[] = [];
    const stage = installShadowOnly({ render() {} });
    const view = createCreatureView({ deer: glb }, 20, (o) => {
      shadowRoots.push(o);
      stage.add(o);
    });
    // 近くで描く枠 12 個のそれぞれの群れ LOD
    expect(shadowRoots.length).toBe(12);
    expect(shadowRoots.every((o) => o.name === 'deer_lod1')).toBe(true);
    const deer = (id: number): Agent => ({ id, species: 'deer', role: 'wild', x: id, z: -5, heading: 0, state: 'graze', t: 0 });
    view.update([deer(1), deer(2)], { position: new Vector3() }, () => 0, 0, 1 / 60);
    const slots = view.group.children.filter((o) => o.visible && !(o as InstancedMesh).isInstancedMesh);
    expect(slots.length).toBe(2);
    for (const slot of slots) {
      const cast: string[] = [];
      slot.traverse((o) => (o as Mesh).isMesh && o.castShadow && cast.push(o.name));
      expect(cast).toEqual(['deer_lod1']);
      const lod1 = slot.getObjectByName('deer_lod1') as SkinnedMesh;
      const full = new BoxGeometry(1, 3, 1).index!.count;
      // 雌は偶数の id (RIGS.deer.variant)。角 (y > 2 m の光る頂点) を含む三角形を除く
      const doe = slot.getObjectByName('deer_doe')!.visible;
      expect(lod1.geometry.index!.count < full).toBe(doe);
    }
  });
});
