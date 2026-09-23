import { Group, InstancedMesh, Matrix4, type Mesh, type Object3D } from 'three';

/**
 * 同じ形の静物 (鐘樹・株・草むら・岩) を、GLB のノードごとに InstancedMesh へまとめる (設計 §8 の draw call 予算)。
 * ノードの中のメッシュ 1 つにつき InstancedMesh 1 つ。置き場所の行列 × メッシュのノード内の行列 を各インスタンスに入れる。
 */
/** castShadow = false は小さな下草など、影を落としても見えないもの (影の draw call を増やさない) */
export function instanceProps(node: Object3D, placements: Matrix4[], castShadow = true): Group {
  const group = new Group();
  if (placements.length === 0) return group;
  node.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(node.matrixWorld).invert();
  const local = new Matrix4();
  const m = new Matrix4();
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    local.multiplyMatrices(rootInv, mesh.matrixWorld);
    const inst = new InstancedMesh(mesh.geometry, mesh.material, placements.length);
    placements.forEach((p, i) => inst.setMatrixAt(i, m.multiplyMatrices(p, local)));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = castShadow;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}

export type LodProps = { group: Group; update(camera: { position: { x: number; z: number } }): void };

/**
 * 近くは lod0、遠くは lod1 の 2 組の InstancedMesh に、カメラからの距離で置き場所を振り分ける (設計 §8 の三角形の予算)。
 * 鐘樹の成木は 1 本 3,600 三角形あり、200 本を全部 lod0 で描くと予算 150 万を超える。振り分けは 0.25 秒ごとで足りる
 */
export function lodProps(lod0: Object3D, lod1: Object3D, placements: Matrix4[], nearM: number): LodProps {
  const near = instanceProps(lod0, placements);
  const far = instanceProps(lod1, placements);
  const group = new Group();
  group.add(near, far);
  const xs = placements.map((p) => p.elements[12]);
  const zs = placements.map((p) => p.elements[14]);
  const nearMeshes = near.children as InstancedMesh[];
  const farMeshes = far.children as InstancedMesh[];
  const nearLocal = nearMeshes.map((_, k) => localOf(lod0, k));
  const farLocal = farMeshes.map((_, k) => localOf(lod1, k));
  const m = new Matrix4();
  let last = -1;
  return {
    group,
    update(camera) {
      const now = performance.now();
      if (now - last < 250) return;
      last = now;
      let n = 0;
      let f = 0;
      for (let i = 0; i < placements.length; i++) {
        const d = Math.hypot(xs[i] - camera.position.x, zs[i] - camera.position.z);
        if (d < nearM) {
          nearMeshes.forEach((im, k) => im.setMatrixAt(n, m.multiplyMatrices(placements[i], nearLocal[k])));
          n++;
        } else {
          farMeshes.forEach((im, k) => im.setMatrixAt(f, m.multiplyMatrices(placements[i], farLocal[k])));
          f++;
        }
      }
      for (const im of nearMeshes) {
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
      }
      for (const im of farMeshes) {
        im.count = f;
        im.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

/** instanceProps と同じ順でメッシュを数え、k 番目のメッシュのノード内の行列を返す */
function localOf(node: Object3D, k: number): Matrix4 {
  node.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(node.matrixWorld).invert();
  let i = 0;
  let out = new Matrix4();
  node.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    if (i++ === k) out = new Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
  });
  return out;
}
