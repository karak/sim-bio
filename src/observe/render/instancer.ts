import { Group, InstancedMesh, Matrix4, Sphere, type Camera, type Mesh, type Object3D } from 'three';
import { ViewCull, packVisible, splitCount, uploadFront } from './cull';
import { switchJitter, tierOf } from './impostor';

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
  /** (M23-04) 影の代わりの形の組 (shadow を渡したとき)。呼び出し側が影の描画だけに出す (render/shadowOnly.ts) */
  shadow: Group | null;
  /** (M23-06) インポスターの組 (beyond を渡したとき)。影を落とさず、光線に当たらない */
  impostor: Group | null;
};

/**
 * (M23-06) 遠い段 (lod1) のさらに先の段 (インポスター、render/impostor.ts)。node は板の形と材質 (bakeImpostor の mesh)。
 * farM より先の木を板で描く。木ごとに farM × (1 + spread × 揺らぎ (-0.5〜0.5)) で切り替え、切り替わる木が輪に並ばないようにする
 */
export type FarTier = { node: Object3D; farM: number; spread?: number };

/**
 * 近くは lod0、遠くは lod1 の 2 組の InstancedMesh に、カメラからの距離で置き場所を振り分ける (設計 §8 の三角形の予算)。
 * 鐘樹の成木は 1 本 3,600 三角形あり、200 本を全部 lod0 で描くと予算 150 万を超える。振り分けは 0.25 秒ごとで足りる
 */
/**
 * (M23-04) shadow を渡すと、影は近い・遠いの形ではなく全部の木をこの粗い形で落とす (近い・遠いの組は castShadow = false)。
 * 影の組は視錐台で詰め直さない (影のカメラは区域全体を覆う)。置き場所を入れ替えたときだけ書き直す
 */
/**
 * (M23-06) beyond を渡すと 3 段にする (近い lod0・遠い lod1・インポスター)。インポスターの段の木は、lod1 の組の見えない側 (後ろ) に並べ続けるので、
 * lod1 の組の影 (影の代わりの形が無いとき) と光線の当たり判定 (自動カメラの遮り) は今までどおり近くない全部の木で見る。インポスターの組は本の描画だけ
 */
/**
 * (M23-09) 近い・遠いの切り替えの決め方 (小屋)。
 * - nearSpread: 置き場所ごとに nearM × (1 + nearSpread × 揺らぎ (-0.5〜0.5)) で切り替える (3 棟が同じ距離で替わらない)。既定の 0 は今までどおり全部 nearM
 * - height: 距離をカメラの高さも入れた 3 次元の距離で測る (集落の俯瞰は 30 m の高さから見下ろすので、真下に近い小屋も画面では小さい)。既定は水平の距離 (木)
 */
export type NearOpts = { nearSpread?: number; height?: boolean };

export function lodProps(lod0: Object3D, lod1: Object3D, placements: Matrix4[], nearM: number, capacity = placements.length, shadow: Object3D | null = null, beyond: FarTier | null = null, opts: NearOpts = {}): LodProps {
  const near = instanceProps(lod0, placements, !shadow, capacity);
  const far = instanceProps(lod1, placements, !shadow, capacity);
  const group = new Group();
  group.add(near, far);
  const proxy = shadow ? instanceProps(shadow, placements, true, capacity) : null;
  if (proxy) group.add(proxy);
  const proxyMeshes = (proxy?.children ?? []) as InstancedMesh[];
  // (M23-06) インポスターの組: 影を落とさず、光線に当たらない (当たり判定は lod1 の組の全部の木が受け持つ)。視錐台はここで詰めるので three.js の丸ごとの判定は切る
  const impostor = beyond ? instanceProps(beyond.node, placements, false, capacity) : null;
  if (impostor) group.add(impostor);
  const impostorMeshes = (impostor?.children ?? []) as InstancedMesh[];
  for (const im of impostorMeshes) {
    im.raycast = () => {};
    im.frustumCulled = false;
  }
  const impostorLocal = beyond ? impostorMeshes.map((_, k) => localOf(beyond.node, k)) : [];
  const spread = beyond?.spread ?? 0.2;
  const farAt = (x: number, z: number) => (beyond ? beyond.farM * (1 + spread * switchJitter(x, z)) : 0);
  // (M23-09) 置き場所ごとの近い・遠いの切り替えの距離
  const nearSpread = opts.nearSpread ?? 0;
  const nearAt = (x: number, z: number) => nearM * (1 + nearSpread * switchJitter(x, z));
  const proxyLocal = shadow ? proxyMeshes.map((_, k) => localOf(shadow, k)) : [];
  let xs = placements.map((p) => p.elements[12]);
  let zs = placements.map((p) => p.elements[14]);
  // (M23-09) 置き場所の高さ (opts.height のとき 3 次元の距離に使う)
  let ys = placements.map((p) => p.elements[13]);
  let farMs = placements.map((p) => farAt(p.elements[12], p.elements[14]));
  let nearMs = placements.map((p) => nearAt(p.elements[12], p.elements[14]));
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
  // (M23-06) インポスターの組 (近い・遠いの組と違い、見えない木は並べない)
  const impostorSets = impostorMeshes.map((im, k) => ({ im, local: impostorLocal[k], ball: meshSphere(im, impostorLocal[k]), balls: new Float32Array(0) as Float32Array }));
  const measure = () => {
    sets.forEach((st) => (st.balls = spheresOf(st.ball, placements)));
    impostorSets.forEach((st) => (st.balls = spheresOf(st.ball, placements)));
  };
  measure();
  // (M23-06 で変更: 近い・遠いの 2 値から、段 (0 = 近い、1 = 遠い、2 = インポスター) に)
  let tier = new Uint8Array(placements.length);
  const view = new ViewCull();
  return {
    group,
    shadow: proxy,
    impostor,
    update(camera) {
      const now = performance.now();
      const regroup = now - last >= 250;
      const eye = (camera as Camera).isCamera ? (camera as Camera) : null;
      const turned = eye ? view.update(eye) : false;
      if (!regroup && !turned) return;
      if (regroup) {
        last = now;
        // (M23-09 で変更: 近い・遠いの切り替えの距離も置き場所ごと (nearMs、nearSpread が 0 なら全部 nearM)。opts.height ならカメラの高さも入れる)
        const cy = opts.height ? (camera.position as { y?: number }).y : undefined;
        for (let i = 0; i < placements.length; i++) {
          const d = Math.hypot(xs[i] - camera.position.x, zs[i] - camera.position.z, cy === undefined ? 0 : ys[i] - cy);
          tier[i] = tierOf(d, nearMs[i], farMs[i]);
        }
      }
      for (const st of sets) {
        const b = st.balls;
        // (M23-06 で変更: 遠い組は段 1 と段 2 の木を並べ、本の描画に回すのは段 1 の見える木だけ。段 2 は見えない側に置き、影と当たり判定に残す)
        const r = packVisible(
          placements.length,
          (i) => (st.near === 1 || tier[i] === 1) && (!eye || view.sees(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3])),
          (i, to) => st.im.setMatrixAt(to, m.multiplyMatrices(placements[i], st.local)),
          true,
          (i) => (tier[i] === 0 ? 1 : 0) === st.near,
        );
        st.count(r.visible, r.all);
        uploadFront(st.im.instanceMatrix, r.all);
      }
      for (const st of impostorSets) {
        const b = st.balls;
        const r = packVisible(
          placements.length,
          (i) => !eye || view.sees(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]),
          (i, to) => st.im.setMatrixAt(to, m.multiplyMatrices(placements[i], st.local)),
          false,
          (i) => tier[i] === 2,
        );
        st.im.count = r.visible;
        uploadFront(st.im.instanceMatrix, r.visible);
      }
      // 近い・遠いの組み替えで中身が変わるので、描く範囲の判定と光線の当たり判定に使う境界の球を測り直す (M22-03)
      // (M23-02 で変更: 見える・見えないの並べ替えだけなら全部の木の組は変わらないので、測り直すのは組み替えたときだけ)
      if (regroup) for (const im of [...nearMeshes, ...farMeshes]) im.boundingSphere = null;
    },
    setPlacements(next) {
      placements = next.slice(0, capacity);
      xs = placements.map((p) => p.elements[12]);
      zs = placements.map((p) => p.elements[14]);
      ys = placements.map((p) => p.elements[13]);
      farMs = placements.map((p) => farAt(p.elements[12], p.elements[14]));
      nearMs = placements.map((p) => nearAt(p.elements[12], p.elements[14]));
      measure();
      tier = new Uint8Array(placements.length);
      last = -Infinity;
      // (M23-04) 影の代わりの形は全部の木を並べ直す
      proxyMeshes.forEach((im, k) => {
        placements.forEach((p, i) => im.setMatrixAt(i, m.multiplyMatrices(p, proxyLocal[k])));
        im.count = placements.length;
        im.instanceMatrix.needsUpdate = true;
        im.boundingSphere = null;
      });
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
