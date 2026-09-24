import { Frustum, InstancedMesh, Matrix4, Mesh, Sphere, Vector3, type Camera, type Object3D } from 'three';

/**
 * 三角形の内訳 (軽量化の試算)。区分ごとに、いま描いている数と、軽量化の施策を入れたら減る見込みを数える。
 * - drawn: 本の描画で送っている三角形 (InstancedMesh は全インスタンス。three.js は InstancedMesh をまとめてしか視錐台で落とさない)
 *   (M23-02 で変更: 草・下草・木・群れは render/cull.ts で見えるインスタンスだけを前に詰めるので、drawn は詰めた後の数。影は全部 (shadow))
 * - inView: インスタンスごとに視錐台で落としたら残る三角形 (境界球がカメラの視錐台に掛かるものだけ)
 * - shadow: 影の描画で送っている三角形 (影を落とすもの。影のカメラは区域全体を覆うので全インスタンス)
 * - beyond30 / beyond60: カメラから 30 m / 60 m より遠いインスタンスの三角形 (遠距離用の軽量版に差し替える候補)
 */
export type BreakdownRow = { drawn: number; inView: number; shadow: number; beyond30: number; beyond60: number; instances: number };

export function triangleBreakdown(camera: Camera, roots: Readonly<Record<string, readonly Object3D[]>>, scene: Object3D): Record<string, BreakdownRow> {
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const rows: Record<string, BreakdownRow> = {};
  const owner = new Map<Object3D, string>();
  for (const [cat, list] of Object.entries(roots)) for (const root of list) root.traverse((o) => owner.set(o, cat));
  const m = new Matrix4();
  const world = new Matrix4();
  const ball = new Sphere();
  scene.traverseVisible((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const tris = (geo.index ? geo.index.count : (geo.getAttribute('position')?.count ?? 0)) / 3;
    if (!tris) return;
    const cat = owner.get(o) ?? 'other';
    const row = (rows[cat] ??= { drawn: 0, inView: 0, shadow: 0, beyond30: 0, beyond60: 0, instances: 0 });
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const local = geo.boundingSphere!;
    const inst = (o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh) : null;
    const n = inst ? inst.count : 1;
    row.instances += n;
    row.drawn += tris * n;
    // (M23-02 で変更: 視錐台で詰め直す InstancedMesh は、本の描画は見える数 (count)、影の描画は全部 (userData.shadowCount、render/cull.ts の splitCount))
    if (mesh.castShadow) row.shadow += tris * ((inst?.userData.shadowCount as number | undefined) ?? n);
    for (let i = 0; i < n; i++) {
      if (inst) {
        inst.getMatrixAt(i, m);
        world.multiplyMatrices(o.matrixWorld, m);
      } else world.copy(o.matrixWorld);
      ball.copy(local).applyMatrix4(world);
      if (frustum.intersectsSphere(ball)) row.inView += tris;
      const d = ball.center.distanceTo(eye);
      if (d > 30) row.beyond30 += tris;
      if (d > 60) row.beyond60 += tris;
    }
  });
  return rows;
}
