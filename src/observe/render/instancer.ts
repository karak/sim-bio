import { Group, InstancedMesh, Matrix4, Sphere, type Camera, type Mesh, type Object3D } from 'three';
import { ViewCull, packVisible, splitCount, uploadFront } from './cull';

/**
 * 同じ形の静物 (鐘樹・株・草むら・岩) を、GLB のノードごとに InstancedMesh へまとめる (設計 §8 の draw call 予算)。
 * ノードの中のメッシュ 1 つにつき InstancedMesh 1 つ。置き場所の行列 × メッシュのノード内の行列 を各インスタンスに入れる。
 */
/** castShadow = false は小さな下草など、影を落としても見えないもの (影の draw call を増やさない) */
/** capacity は後から置き場所を増やせる上限 (M22-03: 本体の密度に合わせて木を植え直すため)。省略時は placements の数 */
export function instanceProps(node: Object3D, placements: Matrix4[], castShadow = true, capacity = placements.length): Group {
  const group = new Group();
  if (capacity === 0) return group;
  node.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(node.matrixWorld).invert();
  const local = new Matrix4();
  const m = new Matrix4();
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    local.multiplyMatrices(rootInv, mesh.matrixWorld);
    const inst = new InstancedMesh(mesh.geometry, mesh.material, capacity);
    placements.forEach((p, i) => inst.setMatrixAt(i, m.multiplyMatrices(p, local)));
    inst.count = placements.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = castShadow;
    inst.receiveShadow = true;
    // (木の磨き上げで追加) 葉のカード (assets.ts の toToon が印を付ける) は切り抜いた影の材質を引き継ぎ、光線の当たり判定から外す
    inst.customDepthMaterial = mesh.customDepthMaterial;
    if (mesh.userData.foliage) inst.raycast = () => {};
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}

export type LodProps = {
  group: Group;
  /** (M23-02) カメラ (Camera) を渡すと、視錐台で見える木だけを本の描画に回す。位置だけなら近い・遠いの振り分けだけ */
  update(camera: { position: { x: number; z: number } } | Camera): void;
  /** 置き場所を入れ替える (capacity まで)。次の update で近い・遠いに振り分け直す */
  setPlacements(placements: Matrix4[]): void;
};

/**
 * 近くは lod0、遠くは lod1 の 2 組の InstancedMesh に、カメラからの距離で置き場所を振り分ける (設計 §8 の三角形の予算)。
 * 鐘樹の成木は 1 本 3,600 三角形あり、200 本を全部 lod0 で描くと予算 150 万を超える。振り分けは 0.25 秒ごとで足りる
 */
export function lodProps(lod0: Object3D, lod1: Object3D, placements: Matrix4[], nearM: number, capacity = placements.length): LodProps {
  const near = instanceProps(lod0, placements, true, capacity);
  const far = instanceProps(lod1, placements, true, capacity);
  const group = new Group();
  group.add(near, far);
  let xs = placements.map((p) => p.elements[12]);
  let zs = placements.map((p) => p.elements[14]);
  const nearMeshes = near.children as InstancedMesh[];
  const farMeshes = far.children as InstancedMesh[];
  const nearLocal = nearMeshes.map((_, k) => localOf(lod0, k));
  const farLocal = farMeshes.map((_, k) => localOf(lod1, k));
  const m = new Matrix4();
  // (M23-02 で変更: 最初の update で必ず振り分ける。-1 だと台の時計 (performance.now が 0 から) で 250 ms まで振り分けなかった)
  let last = -Infinity;
  // (M23-02) 近い組・遠い組のメッシュ (幹・葉・鐘) ごとに、見えるものを前に、見えないものを後ろに並べる。本の描画は見えるものだけ、影と光線の当たり判定は全部の木
  const sets = [
    ...nearMeshes.map((im, k) => ({ im, local: nearLocal[k], near: 1, count: splitCount(im), ball: meshSphere(im, nearLocal[k]), balls: new Float32Array(0) as Float32Array })),
    ...farMeshes.map((im, k) => ({ im, local: farLocal[k], near: 0, count: splitCount(im), ball: meshSphere(im, farLocal[k]), balls: new Float32Array(0) as Float32Array })),
  ];
  const measure = () => sets.forEach((st) => (st.balls = spheresOf(st.ball, placements)));
  measure();
  let isNear = new Uint8Array(placements.length);
  const view = new ViewCull();
  return {
    group,
    update(camera) {
      const now = performance.now();
      const regroup = now - last >= 250;
      const eye = (camera as Camera).isCamera ? (camera as Camera) : null;
      const turned = eye ? view.update(eye) : false;
      if (!regroup && !turned) return;
      if (regroup) {
        last = now;
        for (let i = 0; i < placements.length; i++) isNear[i] = Math.hypot(xs[i] - camera.position.x, zs[i] - camera.position.z) < nearM ? 1 : 0;
      }
      for (const st of sets) {
        const b = st.balls;
        const r = packVisible(
          placements.length,
          (i) => !eye || view.sees(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]),
          (i, to) => st.im.setMatrixAt(to, m.multiplyMatrices(placements[i], st.local)),
          true,
          (i) => isNear[i] === st.near,
        );
        st.count(r.visible, r.all);
        uploadFront(st.im.instanceMatrix, r.all);
      }
      // 近い・遠いの組み替えで中身が変わるので、描く範囲の判定と光線の当たり判定に使う境界の球を測り直す (M22-03)
      // (M23-02 で変更: 見える・見えないの並べ替えだけなら全部の木の組は変わらないので、測り直すのは組み替えたときだけ)
      if (regroup) for (const im of [...nearMeshes, ...farMeshes]) im.boundingSphere = null;
    },
    setPlacements(next) {
      placements = next.slice(0, capacity);
      xs = placements.map((p) => p.elements[12]);
      zs = placements.map((p) => p.elements[14]);
      measure();
      isNear = new Uint8Array(placements.length);
      last = -Infinity;
    },
  };
}

/**
 * (M23-02) 見えるものだけを本の描画に回す instanceProps。update(camera) を毎コマ呼ぶ (カメラが広げた視錐台の分だけ動いたときだけ詰め直す)。
 * 並べ替えるだけで全部のインスタンスを持つので、影と光線の当たり判定は今までどおり全部で見る
 */
export type CulledProps = { group: Group; update(camera: Camera): void };

export function culledProps(node: Object3D, placements: Matrix4[], castShadow = true): CulledProps {
  const group = instanceProps(node, placements, castShadow);
  const meshes = group.children as InstancedMesh[];
  const all = meshes.map((im) => (im.instanceMatrix.array as Float32Array).slice(0, placements.length * 16));
  const counts = meshes.map(splitCount);
  // メッシュごとの境界の球 (instanceMatrix にはノード内の行列まで掛けてあるので、形の球に掛けるだけ)
  const balls = meshes.map((im) => spheresOf(meshSphere(im, new Matrix4()), placements.map((_, i) => new Matrix4().fromArray(im.instanceMatrix.array, i * 16))));
  const view = new ViewCull();
  return {
    group,
    update(camera) {
      if (!view.update(camera)) return;
      meshes.forEach((im, k) => {
        const dst = im.instanceMatrix.array as Float32Array;
        const src = all[k];
        const b = balls[k];
        const sees = (i: number) => view.sees(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]);
        const r = packVisible(placements.length, sees, (i, to) => dst.set(src.subarray(i * 16, i * 16 + 16), to * 16), true);
        counts[k](r.visible, r.all);
        uploadFront(im.instanceMatrix, r.all);
      });
    },
  };
}

/** InstancedMesh の形の境界の球を、ノード内の行列 local で動かしたもの */
function meshSphere(im: InstancedMesh, local: Matrix4): Sphere {
  if (!im.geometry.boundingSphere) im.geometry.computeBoundingSphere();
  return im.geometry.boundingSphere!.clone().applyMatrix4(local);
}

/** 置き場所ごとの境界の球 (中心 x・y・z と半径を 4 つずつ並べる) */
function spheresOf(local: Sphere, placements: Matrix4[]): Float32Array {
  const out = new Float32Array(placements.length * 4);
  const ball = new Sphere();
  placements.forEach((p, i) => {
    ball.copy(local).applyMatrix4(p);
    out.set([ball.center.x, ball.center.y, ball.center.z, ball.radius], i * 4);
  });
  return out;
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
