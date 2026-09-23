import { Group, InstancedMesh, Matrix4, type Mesh, type Object3D } from 'three';

/**
 * 同じ形の静物 (鐘樹・株・草むら・岩) を、GLB のノードごとに InstancedMesh へまとめる (設計 §8 の draw call 予算)。
 * ノードの中のメッシュ 1 つにつき InstancedMesh 1 つ。置き場所の行列 × メッシュのノード内の行列 を各インスタンスに入れる。
 */
export function instanceProps(node: Object3D, placements: Matrix4[]): Group {
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
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}
