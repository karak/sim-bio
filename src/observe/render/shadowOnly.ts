import type { Object3D, SkinnedMesh } from 'three';

/**
 * 日の影の描画だけに出すもの (M23-04、docs/design/2026-09-24-observe-perf.md)。
 * 影の描画は粗い代わりの形 (鐘樹の成木は belltree_mature_shadow 420 三角形、小屋は hut_lod1、近くの動物は群れ LOD の骨入り) で描き、
 * 本の描画の形 (castShadow = false にする) とは分ける。集落の画で影の描画が 366 千三角形あり、鐘樹の近い形 3,646 三角形が大半だった。
 *
 * three.js には「影にだけ出す」印が無い (layers は影の描画でも本のカメラの layers で見る) ので、
 * 代わりの形はふだん visible = false にしておき、renderer.shadowMap.render の間だけ visible = true にする。
 * WebGLRenderer.render は本の描画の並び (projectObject) を作った後で shadowMap.render を呼ぶので、本の描画には入らず、draw call も増えない。
 * - 骨入りの代わりの形 (動物の群れ LOD) は本の描画の並びに入らないので骨の行列が更新されない。影の描画の前にここで更新する
 *   (同じ骨に結ばれているので、本の描画の形と同じ姿勢になる)
 * - 光線の当たり判定 (自動カメラの遮り・寄せ先の見通し) は visible を見ないので、代わりの形のメッシュは当たらないようにする
 */
export type ShadowOnly = {
  /** root を影の描画だけに出す (root の親が見えないときは出ない: 使っていない動物の枠など) */
  add(root: Object3D): void;
  readonly roots: ReadonlySet<Object3D>;
};

/** three.js の WebGLShadowMap のうち、ここで使う所 */
export type ShadowMapLike = { render(...args: never[]): void };

export function installShadowOnly(shadowMap: ShadowMapLike): ShadowOnly {
  const roots = new Set<Object3D>();
  const render = shadowMap.render;
  shadowMap.render = (...args: never[]) => {
    for (const r of roots) {
      r.visible = true;
      if (shown(r)) r.traverseVisible(updateSkeleton);
    }
    try {
      render.apply(shadowMap, args);
    } finally {
      for (const r of roots) r.visible = false;
    }
  };
  return {
    roots,
    add(root) {
      root.visible = false;
      root.userData.shadowOnly = true;
      root.traverse((o) => {
        o.castShadow = true;
        if ((o as { isMesh?: boolean }).isMesh) o.raycast = () => {};
      });
      roots.add(root);
    },
  };
}

/** o と親がみな見えるか */
function shown(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function updateSkeleton(o: Object3D): void {
  const sk = o as SkinnedMesh;
  if (sk.isSkinnedMesh) sk.skeleton.update();
}
