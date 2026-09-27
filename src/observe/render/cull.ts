import { Frustum, InstancedMesh, Matrix4, Quaternion, Vector3, type Camera } from 'three';

/**
 * インスタンスごとの視錐台カリング (M23-02、docs/design/2026-09-24-observe-perf.md)。
 * three.js は InstancedMesh を丸ごとでしか視錐台で落とさないので、区域の全インスタンスを毎フレーム描いていた (集落の画で草 512 千のうち画面の中は 105 千)。
 * 見えるインスタンスを前に詰め、count を見える数にする。見えないものは後ろに並べておき、影の描画と光線の当たり判定には全部を使う (splitCount)。
 *
 * 視錐台は角度 marginRad と距離 padM だけ広げて判定し、カメラが広げた分の半分より動くまでは詰め直さない
 * (毎フレーム全部の房を回さない。カメラが止まっている間やゆっくり寄る間は詰め直しが間遠になる)。
 */
export class ViewCull {
  /** 広げた視錐台 */
  readonly frustum = new Frustum();
  private readonly proj = new Matrix4();
  private readonly lastPos = new Vector3(Infinity, Infinity, Infinity);
  private readonly lastQuat = new Quaternion();
  private readonly lastProj = new Matrix4();
  private readonly pos = new Vector3();
  private readonly quat = new Quaternion();
  private readonly scale = new Vector3();
  /**
   * 既定の 0.03 rad (約 1.7°)・0.75 m は計測で決めた (M23-02 の作業ログ)。集落の画で広げない場合 +4% の三角形、
   * 自由カメラを毎秒 24° で回す間の詰め直しは 2 コマに 1 回ほど (広げずに毎コマ詰め直すと、草 3 万房で 1 回約 1.2 ms)
   */
  constructor(
    readonly marginRad = 0.03,
    readonly padM = 0.75,
  ) {}

  /**
   * カメラが前に視錐台を取ったときから「動いた距離 / padM + 回った角度 / marginRad」が 0.5 を超えたか、画角が変わったら、
   * 視錐台を取り直して true を返す (呼び出し側はそのとき詰め直す)。force なら必ず取り直す
   */
  update(camera: Camera, force = false): boolean {
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(this.pos, this.quat, this.scale);
    const moved = this.pos.distanceTo(this.lastPos) / this.padM + this.quat.angleTo(this.lastQuat) / this.marginRad;
    if (!force && moved <= 0.5 && camera.projectionMatrix.equals(this.lastProj)) return false;
    this.lastPos.copy(this.pos);
    this.lastQuat.copy(this.quat);
    this.lastProj.copy(camera.projectionMatrix);
    // 透視の行列の x・y の拡大 (1 / tan(半画角)) を、半画角を marginRad 広げた値にする。平行投影は広げない
    const e = this.proj.copy(camera.projectionMatrix).elements;
    if (e[11] === -1) {
      e[0] = 1 / Math.tan(Math.atan(1 / e[0]) + this.marginRad);
      e[5] = 1 / Math.tan(Math.atan(1 / e[5]) + this.marginRad);
    }
    this.frustum.setFromProjectionMatrix(this.proj.multiply(camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
    return true;
  }

  /** 中心 (x, y, z)・半径 r の球が、広げた視錐台に掛かるか (半径は padM だけ足して見る) */
  sees(x: number, y: number, z: number, r: number): boolean {
    const rr = -(r + this.padM);
    for (const p of this.frustum.planes) if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < rr) return false;
    return true;
  }
}

/**
 * 見えるものを前に、見えないものを後ろに並べる順を決める。copy(元の番号, 並べた先) を順に呼び、見える数と並べた数を返す。
 * rest = false なら見えないものは並べない (影を落とさない草・下草)。keep(i) が false のものは見えても並べない (草の距離の間引き・踏み固め)
 */
export function packVisible(n: number, sees: (i: number) => boolean, copy: (from: number, to: number) => void, rest: boolean, keep: (i: number) => boolean = () => true): { visible: number; all: number } {
  let k = 0;
  const hidden: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue;
    if (sees(i)) copy(i, k++);
    else if (rest) hidden.push(i);
  }
  const visible = k;
  for (const i of hidden) copy(i, k++);
  return { visible, all: k };
}

/**
 * 詰め直す InstancedMesh の count を 2 つに分ける。本の描画は見える数 (visible)、影の描画・光線の当たり判定・境界の球と箱は並べた全部 (all)。
 * 影のカメラは区域全体を覆うので、画面の外でも影を画面の中へ落とすものは今までどおり影を落とす。
 * 自動カメラは寄せ先を決めるときに今の画面の外の木にも光線を当てる (shotCamera の blockers) ので、当たり判定も全部で見る。
 * 返す関数で (visible, all) を渡す
 */
export function splitCount(mesh: InstancedMesh): (visible: number, all: number) => void {
  let visible = mesh.count;
  let all = mesh.count;
  mesh.userData.shadowCount = all;
  const withAll = <T>(f: () => T): T => {
    const c = mesh.count;
    mesh.count = all;
    try {
      return f();
    } finally {
      mesh.count = c;
    }
  };
  // 影の描画は three.js の WebGLShadowMap が onBeforeShadow の直後に count を読んで描く (材質の組ごとに呼ばれる)
  mesh.onBeforeShadow = () => void (mesh.count = all);
  mesh.onAfterShadow = () => void (mesh.count = visible);
  const raycast = mesh.raycast.bind(mesh);
  mesh.raycast = (rc, out) => withAll(() => raycast(rc, out));
  mesh.computeBoundingSphere = () => withAll(() => InstancedMesh.prototype.computeBoundingSphere.call(mesh));
  mesh.computeBoundingBox = () => withAll(() => InstancedMesh.prototype.computeBoundingBox.call(mesh));
  return (v, a) => {
    visible = v;
    all = a;
    mesh.count = v;
    mesh.userData.shadowCount = a;
  };
}

/** 属性の前から n 個だけを GPU へ送り直す (詰め直しのたびに全部の容量を送らない) */
export function uploadFront(
  attr: {
    needsUpdate: boolean;
    itemSize: number;
    clearUpdateRanges(): void;
    addUpdateRange(start: number, count: number): void;
  },
  n: number,
): void {
  attr.clearUpdateRanges();
  if (n > 0) attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}
