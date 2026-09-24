import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  Sphere,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  type MeshToonMaterial,
  type Object3D,
  type Side,
  type Texture,
} from 'three';
import { glow } from './bake';
import { createToonMaterial } from './toon';

/**
 * 木の遠距離版 (インポスター、M23-06、docs/design/2026-09-24-observe-perf.md)。
 * 鐘樹の成木と森の木を 60 m より先で、カメラへ向く 1 枚の板 (2 三角形) に差し替える (lod1 は鐘樹 1,080・森の木 380 三角形)。
 * 板の絵は、lod1 の形を数方向 (横 8 × 高さ 4 段) から平行投影で描いた絵の帳 (アトラス) から、見る向きに近い 4 枚を混ぜて取る。
 *
 * 焼きは読み込みのときに、観察画面の描き手 (WebGLRenderer) で行う (Blender で焼いた絵を持たない)。
 * - 色は、本の描画の材質と同じ入力 (頂点色 × 葉の絵 × 材質の色、発光は aEmissive) から取るので、遠目の葉の色合いが lod1 とずれない。
 *   Blender の描画 (色の管理・陰影) を観察画面のトゥーンに合わせる手間が無く、belltree.glb・flora.glb を直すと自ずと焼き直る。
 * - 焼くのは光を当てない素の値 (色・法線・奥行き・発光)。光はこの板の材質が本の描画と同じトゥーン (日・空の光・影・縁の光) で当てるので、
 *   朝・夕・夜で lod1 と同じように変わり、夜は鐘の発光に uGlow (bake.ts の glow) を掛けて灯る。
 * - 焼きの手間は 1 種あたり 32 枠 × 3 回 (色・法線と奥行き・発光)、lod1 は 1,080 三角形なので読み込みのうちに収まる。
 *
 * 帳は 3 枚 (8 bit RGBA、同じ並び)。絵の無い所はどれも 0 で、アルファ (覆い) を掛けた形で入れる (縮小・線形補間で縁が黒く滲まない。使うときに覆いで割る)。
 * - 色: rgb = 色の平方根 (暗い所の段を細かく)、a = 覆い (1)
 * - 法線: rgb = 木の座標の法線 × 0.5 + 0.5、a = 奥行き (枠の面 (木の中心を通り枠の向きに垂直) から手前へ、半径で割って -1〜1 を 0〜1 に)
 * - 発光: rgb = 発光 (bake.ts の aEmissive と同じ値。鐘の無い森の木には作らない)
 * 1 枚 2048 × 1024 (縮小の段を含めて約 11 MB)。鐘樹 3 枚・森の木 2 枚で約 56 MB の GPU の記憶を使う。
 *
 * 板は 1 本ごとにカメラの位置へ向ける (木の中心を通り、木からカメラへの向きに垂直)。枠ごとに、板の点から視線に沿って枠の面まで進めた点を
 * 枠の絵に写す (視差の補正)。隣の枠と混ぜるのは枠の間の真ん中だけにする (広く混ぜると鐘や房が二重に見える)。奥行きは深度 (gl_FragDepth) と日の影を引く位置に使い、板の面ではなく樹冠の表で地面・隣の木と前後し、
 * lod1 と同じ所に影が落ちる (板の面は樹冠の中を通るので、そのままだと影の代わりの形の影に沈んで暗くなる)。
 * 板は影を落とさない (鐘樹は影の代わりの形 (M23-04)、森の木は lod1 の組が全部の木の影を落とす)。
 */
export type ImpostorLayout = {
  /** 横の向きの数 (0 から 2π を等分) */
  az: number;
  /** 見上げ・見下ろしの段 (ラジアン、昇順。0 が真横) */
  el: readonly number[];
  /** 1 枠の画素 */
  frame: number;
  /** 枠の半幅を、木の境界の球の半径の何倍にするか (縮小のときに隣の枠が滲まない余白) */
  pad: number;
};

const DEG = Math.PI / 180;
/**
 * 横 8 × 段 4 (0°・25°・50°・75°)、1 枠 256 px (帳は 2048 × 1024)。
 * 60 m の木は 1280 × 720 の画で約 170 px なので 256 px で足りる。75° より上から見るときは 75° の枠を使う
 */
export const IMPOSTOR_LAYOUT: ImpostorLayout = { az: 8, el: [0, 25 * DEG, 50 * DEG, 75 * DEG], frame: 256, pad: 1.06 };

/** 枠 (横 j・段 k) を描いた向き (木の座標、木からカメラへ) */
export function frameDir(layout: ImpostorLayout, j: number, k: number, out = new Vector3()): Vector3 {
  const az = (j / layout.az) * Math.PI * 2;
  const el = layout.el[k];
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

export type FrameWeight = { j: number; k: number; w: number };

/**
 * 隣の枠と混ぜる幅 (枠の間の真ん中の 3 割)。1 にすると枠の間を全部線形に混ぜ、隣の枠の鐘や房が薄く重なって夜の鐘の灯りが二重に滲んだ (作業ログ)
 */
export const IMPOSTOR_BLEND = 0.3;

/**
 * 見る向き (木の座標、木からカメラへの単位ベクトル) で混ぜる 4 つの枠と重み。横は隣り合う 2 つ、段は挟む 2 つを、間の真ん中の band だけ線形に混ぜる。
 * 板のシェーダー (IMPOSTOR_VERTEX_MAIN) と同じ式
 */
export function frameBlend(layout: ImpostorLayout, dir: Vector3, band = IMPOSTOR_BLEND): FrameWeight[] {
  const turn = Math.atan2(dir.z, dir.x) / (Math.PI * 2);
  const f = (((turn * layout.az) % layout.az) + layout.az) % layout.az;
  const j0 = Math.floor(f) % layout.az;
  const wa = sharpen(f - Math.floor(f), band);
  const j1 = (j0 + 1) % layout.az;
  const el = Math.asin(Math.min(1, Math.max(-1, dir.y)));
  const n = layout.el.length;
  let k0 = 0;
  for (let k = 0; k < n - 1; k++) if (el >= layout.el[k + 1]) k0 = k + 1;
  const k1 = Math.min(k0 + 1, n - 1);
  const we = sharpen(k1 === k0 ? 0 : Math.min(1, Math.max(0, (el - layout.el[k0]) / (layout.el[k1] - layout.el[k0]))), band);
  return [
    { j: j0, k: k0, w: (1 - wa) * (1 - we) },
    { j: j1, k: k0, w: wa * (1 - we) },
    { j: j0, k: k1, w: (1 - wa) * we },
    { j: j1, k: k1, w: wa * we },
  ];
}

/** 0〜1 の混ぜ具合を、真ん中の band の幅だけで 0 から 1 へ変わるようにする */
function sharpen(t: number, band: number): number {
  return Math.min(1, Math.max(0, (t - 0.5) / band + 0.5));
}

/**
 * 板の上の点 q (木の中心から、木の座標、半径 r の球の中) を、視線 v (木からカメラへ) に沿って枠 d の面まで進め、枠の絵の uv (0〜1) にする。
 * 枠の右・上は three.js の lookAt と同じ (右 = 上 (0, 1, 0) × d、上 = d × 右)。板のシェーダー (impAddFrame の 1 段目) と同じ式
 */
export function frameUv(q: Vector3, v: Vector3, d: Vector3, r: number): [number, number] {
  const right = new Vector3(0, 1, 0).cross(d).normalize();
  const up = d.clone().cross(right);
  const t = -q.dot(d) / Math.max(v.dot(d), 0.2);
  const p = q.clone().addScaledVector(v, t);
  return [0.5 + (0.5 * p.dot(right)) / r, 0.5 + (0.5 * p.dot(up)) / r];
}

/** 枠 (横 j・段 k) の帳の中の画素の矩形 (左下が原点、WebGL の viewport と同じ) */
export function frameRect(layout: ImpostorLayout, j: number, k: number): { x: number; y: number; w: number; h: number } {
  return { x: j * layout.frame, y: k * layout.frame, w: layout.frame, h: layout.frame };
}

/**
 * 木ごとの切り替えの距離の揺らぎ (-0.5〜0.5)。置き場所 (x, z) の hash なので、植え直しても同じ木は同じ距離で切り替わる。
 * 全部の木が同じ距離で切り替わると、切り替わる木が輪に並んで見える
 */
export function switchJitter(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 64) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 - 0.5;
}

/** 木の段: 0 = 近い (lod0)、1 = 遠い (lod1)、2 = インポスター。farM は木ごとの切り替えの距離 (揺らぎを入れた後)、0 以下なら段 2 を使わない */
export function tierOf(d: number, nearM: number, farM: number): 0 | 1 | 2 {
  if (d < nearM) return 0;
  return farM > 0 && d >= farM ? 2 : 1;
}

/** node の中の全部のメッシュを包む球 (node の座標)。頂点から測るので、形にぴったり合う */
export function nodeSphere(node: Object3D): Sphere {
  node.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(node.matrixWorld).invert();
  const m = new Matrix4();
  const pts: Vector3[] = [];
  const p = new Vector3();
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    m.multiplyMatrices(rootInv, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pts.push(p.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
  });
  const ball = new Sphere();
  if (!pts.length) return ball;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const q of pts) {
    min.min(q);
    max.max(q);
  }
  ball.center.addVectors(min, max).multiplyScalar(0.5);
  for (const q of pts) ball.radius = Math.max(ball.radius, ball.center.distanceTo(q));
  return ball;
}

/** 焼く 3 枚 */
export const BAKE_PASSES = ['albedo', 'normal', 'emissive'] as const;
export type BakePass = (typeof BAKE_PASSES)[number];

/** 焼きの材質の作り分け (本の描画の材質から読む)。葉のカード (絵で切り抜く) は法線を裏返さない (foliage.ts と同じ) */
export type BakeSource = { color: Color; map: Texture | null; alphaTest: number; vertexColors: boolean; emissive: Color; hasEmissiveAttr: boolean; flipBack: boolean; side: Side };

export function bakeSource(mesh: Mesh): BakeSource {
  const mat = mesh.material as MeshToonMaterial;
  const map = mat.map ?? null;
  const foliage = !!map && mat.alphaTest > 0;
  return {
    color: mat.color?.clone() ?? new Color(1, 1, 1),
    map,
    alphaTest: foliage ? mat.alphaTest : 0,
    vertexColors: !!mat.vertexColors && !!mesh.geometry.getAttribute('color'),
    // 焼いた材質 (bake.ts) の発光は aEmissive が持つ。焼いていない材質は材質の発光 × 強さ
    emissive: (mat.emissive ?? new Color(0, 0, 0)).clone().multiplyScalar(mat.emissiveIntensity ?? 1),
    hasEmissiveAttr: !!mesh.geometry.getAttribute('aEmissive'),
    flipBack: mat.side === DoubleSide && !foliage,
    side: mat.side,
  };
}

/** node に発光があるか (無ければ発光の帳を作らない) */
export function hasEmission(node: Object3D): boolean {
  let lit = false;
  node.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || lit) return;
    const src = bakeSource(mesh);
    if (src.emissive.r + src.emissive.g + src.emissive.b > 0) lit = true;
    const a = mesh.geometry.getAttribute('aEmissive');
    if (a) for (let i = 0; i < a.array.length && !lit; i++) if (a.array[i] > 0) lit = true;
  });
  return lit;
}

const BAKE_VERTEX = /* glsl */ `
#ifdef USE_EMISSIVE_ATTR
attribute vec3 aEmissive;
#endif
varying vec3 vN;
varying vec3 vP;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vEm;
uniform mat3 uMapTransform;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = (uMapTransform * vec3(uv, 1.0)).xy;
#ifdef USE_COLOR
  vCol = color.rgb;
#else
  vCol = vec3(1.0);
#endif
#ifdef USE_EMISSIVE_ATTR
  vEm = aEmissive;
#else
  vEm = vec3(0.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BAKE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform sampler2D uMap;
uniform float uAlphaTest;
uniform vec3 uCenter;
uniform vec3 uDir;
uniform float uRadius;
varying vec3 vN;
varying vec3 vP;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vEm;
void main() {
  vec3 albedo = uColor * vCol;
#ifdef USE_LEAF_MAP
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < uAlphaTest) discard;
  albedo *= texel.rgb;
#endif
#if defined(PASS_ALBEDO)
  gl_FragColor = vec4(sqrt(max(albedo, 0.0)), 1.0);
#elif defined(PASS_NORMAL)
  vec3 n = normalize(vN);
#ifdef FLIP_BACK
  if (!gl_FrontFacing) n = -n;
#endif
  float depth = clamp(dot(vP - uCenter, uDir) / uRadius, -1.0, 1.0);
  gl_FragColor = vec4(n * 0.5 + 0.5, depth * 0.5 + 0.5);
#else
  gl_FragColor = vec4(clamp(vEm + uEmissive, 0.0, 1.0), 1.0);
#endif
}
`;

/** 1 つのメッシュ × 1 回の焼きの材質 */
export function bakeMaterial(src: BakeSource, pass: BakePass, center: Vector3, radius: number): ShaderMaterial {
  const defines: Record<string, string> = { [`PASS_${pass.toUpperCase()}`]: '' };
  if (src.map && src.alphaTest > 0) defines.USE_LEAF_MAP = '';
  if (src.hasEmissiveAttr) defines.USE_EMISSIVE_ATTR = '';
  if (src.flipBack) defines.FLIP_BACK = '';
  const mapTransform = new Matrix3();
  if (src.map) {
    src.map.updateMatrix();
    mapTransform.copy(src.map.matrix);
  }
  const m = new ShaderMaterial({
    defines,
    uniforms: {
      uColor: { value: src.color },
      uEmissive: { value: src.emissive },
      uMap: { value: src.map },
      uAlphaTest: { value: src.alphaTest },
      uMapTransform: { value: mapTransform },
      uCenter: { value: center.clone() },
      uDir: { value: new Vector3(0, 0, 1) },
      uRadius: { value: radius },
    },
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    vertexColors: src.vertexColors,
    side: src.side,
  });
  m.name = `impostor-bake-${pass}`;
  return m;
}

/** 焼きに使う描き手の所 (試験では記録するだけの偽物を渡す) */
export type BakeRenderer = {
  getRenderTarget(): WebGLRenderTarget | null;
  setRenderTarget(t: WebGLRenderTarget | null): void;
  getClearColor(target: Color): Color;
  getClearAlpha(): number;
  setClearColor(c: Color | number, alpha?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: Object3D, camera: OrthographicCamera): void;
  autoClear: boolean;
  shadowMap: { autoUpdate: boolean };
};

export type Impostor = {
  /** 板の形 (2 三角形) と材質。instanceProps に渡して置き場所ごとの InstancedMesh にする。境界の球は木の球 */
  mesh: Mesh;
  /** 帳 (色・法線と奥行き・発光。発光の無い木は null) */
  textures: { albedo: Texture; normal: Texture; emissive: Texture | null };
  layout: ImpostorLayout;
  /** 木の座標の境界の球 (半径は余白を掛ける前) */
  sphere: Sphere;
  dispose(): void;
};

/** node (lod1) を帳に焼き、板の形と材質を返す */
export function bakeImpostor(renderer: BakeRenderer, node: Object3D, layout: ImpostorLayout = IMPOSTOR_LAYOUT): Impostor {
  const sphere = nodeSphere(node);
  const r = sphere.radius * layout.pad;
  const emissive = hasEmission(node);
  const passes = BAKE_PASSES.filter((p) => p !== 'emissive' || emissive);
  // 焼く場: node のメッシュを node の座標に置き直す (node の置き場所に依らない)
  node.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(node.matrixWorld).invert();
  const scene = new Scene();
  const parts: { mesh: Mesh; mats: Record<string, ShaderMaterial> }[] = [];
  node.traverse((o) => {
    const src = o as Mesh;
    if (!src.isMesh) return;
    const s = bakeSource(src);
    const mats: Record<string, ShaderMaterial> = {};
    for (const p of passes) mats[p] = bakeMaterial(s, p, sphere.center, r);
    const mesh = new Mesh(src.geometry, mats.albedo);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.multiplyMatrices(rootInv, src.matrixWorld);
    mesh.frustumCulled = false;
    scene.add(mesh);
    parts.push({ mesh, mats });
  });
  scene.updateMatrixWorld(true);
  const width = layout.az * layout.frame;
  const height = layout.el.length * layout.frame;
  const targets: Record<string, WebGLRenderTarget> = {};
  for (const p of passes) {
    const t = new WebGLRenderTarget(width, height, { type: UnsignedByteType, depthBuffer: true, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
    t.texture.name = `impostor-${p}`;
    targets[p] = t;
  }
  const camera = new OrthographicCamera(-r, r, r, -r, 0.01, r * 4);
  const dir = new Vector3();
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.autoClear = false;
  // 焼く場に影を落とす光は無いが、日の影の地図を描き直させない
  renderer.shadowMap.autoUpdate = false;
  try {
    for (const p of passes) {
      const t = targets[p];
      for (const part of parts) part.mesh.material = part.mats[p];
      // (描き手は setRenderTarget のときに描く先の viewport・scissor を読む)
      t.scissorTest = false;
      t.viewport.set(0, 0, width, height);
      renderer.setRenderTarget(t);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      for (let k = 0; k < layout.el.length; k++) {
        for (let j = 0; j < layout.az; j++) {
          frameDir(layout, j, k, dir);
          camera.position.copy(sphere.center).addScaledVector(dir, r * 2);
          camera.up.set(0, 1, 0);
          camera.lookAt(sphere.center);
          camera.updateMatrixWorld(true);
          for (const part of parts) (part.mats[p].uniforms.uDir.value as Vector3).copy(dir);
          const rect = frameRect(layout, j, k);
          t.viewport.set(rect.x, rect.y, rect.w, rect.h);
          t.scissor.set(rect.x, rect.y, rect.w, rect.h);
          t.scissorTest = true;
          renderer.setRenderTarget(t);
          renderer.render(scene, camera);
        }
      }
      t.scissorTest = false;
      t.viewport.set(0, 0, width, height);
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.autoUpdate = prevShadow;
    for (const part of parts) for (const m of Object.values(part.mats)) m.dispose();
  }
  const textures = { albedo: targets.albedo.texture, normal: targets.normal.texture, emissive: targets.emissive?.texture ?? null };
  const material = createImpostorMaterial(textures, layout, sphere);
  const mesh = new Mesh(billboardGeometry(sphere, layout.pad), material);
  mesh.name = `${node.name}_impostor`;
  return {
    mesh,
    textures,
    layout,
    sphere,
    dispose() {
      for (const t of Object.values(targets)) t.dispose();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/** 板 (-1〜1 の四角、2 三角形)。形はシェーダーが木の球の大きさでカメラへ向けて広げるので、境界の球は木の球にしておく */
export function billboardGeometry(sphere: Sphere, pad: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new Sphere(sphere.center.clone(), sphere.radius * pad);
  return g;
}

/** 頂点: 板をカメラへ向け、4 つの枠と重み、板の点と視線 (木の座標)、日の影を引く位置のずれを出す */
const IMPOSTOR_VERTEX_PARS = /* glsl */ `
uniform vec3 uImpCenter;
uniform float uImpRadius;
uniform float uImpBlend;
uniform float uImpEl[IMP_EL];
varying vec4 vImpFrame;
varying vec4 vImpW;
varying vec3 vImpQ;
varying vec3 vImpVl;
varying vec3 vImpWorld;
varying vec3 vImpView;
varying float vImpScale;
varying vec3 vImpRot0;
varying vec3 vImpRot1;
varying vec3 vImpRot2;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
varying vec4 vImpShadowShift;
#endif
`;

const IMPOSTOR_VERTEX_MAIN = /* glsl */ `
  mat4 impM = modelMatrix * instanceMatrix;
  float impS = length(impM[0].xyz);
  mat3 impRot = mat3(impM[0].xyz / impS, impM[1].xyz / impS, impM[2].xyz / impS);
  vec3 impC = (impM * vec4(uImpCenter, 1.0)).xyz;
  vec3 impV = cameraPosition - impC;
  impV = length(impV) > 1e-4 ? normalize(impV) : vec3(0.0, 0.0, 1.0);
  vec3 impR = cross(vec3(0.0, 1.0, 0.0), impV);
  impR = length(impR) > 1e-4 ? normalize(impR) : vec3(1.0, 0.0, 0.0);
  vec3 impU = cross(impV, impR);
  vec3 impP = impC + (position.x * impR + position.y * impU) * uImpRadius * impS;
  // 木の座標の視線と板の点 (大きさを除く)
  mat3 impInv = transpose(impRot);
  vec3 impVl = impInv * impV;
  vec3 impQ = impInv * (impP - impC) / impS;
  // 混ぜる 4 つの枠 (frameBlend と同じ式)
  float impTurn = atan(impVl.z, impVl.x) / 6.28318530718;
  float impF = mod(impTurn * float(IMP_AZ), float(IMP_AZ));
  float impJ0 = mod(floor(impF), float(IMP_AZ));
  float impWa = impF - floor(impF);
  float impJ1 = mod(impJ0 + 1.0, float(IMP_AZ));
  float impEl = asin(clamp(impVl.y, -1.0, 1.0));
  int impK0 = 0;
  for (int k = 0; k < IMP_EL - 1; k++) if (impEl >= uImpEl[k + 1]) impK0 = k + 1;
  int impK1 = min(impK0 + 1, IMP_EL - 1);
  float impWe = impK1 == impK0 ? 0.0 : clamp((impEl - uImpEl[impK0]) / (uImpEl[impK1] - uImpEl[impK0]), 0.0, 1.0);
  vImpFrame = vec4(impJ0, impJ1, float(impK0), float(impK1));
  // 混ぜる幅を真ん中の uImpBlend (0〜1) に狭める (隣の枠の鐘や房が薄く重なって二重に見えるのを減らす)
  impWa = clamp((impWa - 0.5) / uImpBlend + 0.5, 0.0, 1.0);
  impWe = clamp((impWe - 0.5) / uImpBlend + 0.5, 0.0, 1.0);
  vImpW = vec4((1.0 - impWa) * (1.0 - impWe), impWa * (1.0 - impWe), (1.0 - impWa) * impWe, impWa * impWe);
  vImpQ = impQ;
  vImpVl = impVl;
  vImpWorld = impP;
  vImpView = impV;
  vImpScale = uImpRadius * impS;
  vImpRot0 = impRot[0];
  vImpRot1 = impRot[1];
  vImpRot2 = impRot[2];
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  vImpShadowShift = directionalShadowMatrix[0] * vec4(impV * vImpScale, 0.0);
  #endif
`;

const IMPOSTOR_FRAGMENT_PARS = /* glsl */ `
// (樹冠の表の深度を出すため。three.js は射影の行列を頂点の側にしか宣言しない)
uniform mat4 projectionMatrix;
uniform sampler2D uImpAlbedo;
uniform sampler2D uImpNormal;
uniform sampler2D uImpEmissive;
uniform float uImpGlow;
uniform float uImpCut;
uniform float uImpRadius;
uniform float uImpEl[IMP_EL];
varying vec4 vImpFrame;
varying vec4 vImpW;
varying vec3 vImpQ;
varying vec3 vImpVl;
varying vec3 vImpWorld;
varying vec3 vImpView;
varying float vImpScale;
varying vec3 vImpRot0;
varying vec3 vImpRot1;
varying vec3 vImpRot2;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
varying vec4 vImpShadowShift;
#endif
const vec2 IMP_GRID = vec2(float(IMP_AZ), float(IMP_EL));
vec3 impFrameDir(float j, float k) {
  float az = j / float(IMP_AZ) * 6.28318530718;
  float el = uImpEl[int(k)];
  return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
}
// 枠の外 (0〜1 の外) は覆い 0。縮小の段を選ぶ微分が崩れないよう、読むのは常に行い、外は掛けて消す
vec4 impTap(sampler2D tex, float j, float k, vec2 uv) {
  float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  return texture2D(tex, (vec2(j, k) + clamp(uv, 0.0, 1.0)) / IMP_GRID) * inside;
}
vec2 impProject(vec3 p, vec3 r, vec3 u) {
  return 0.5 + 0.5 * vec2(dot(p, r), dot(p, u)) / uImpRadius;
}
// 枠 (j, k) を重み w で足す (覆いを掛けた形)。板の点から視線に沿って枠の面まで進めた点を枠の絵に写す (frameUv と同じ式)。
// along は板の面から樹冠の表までの視線に沿った長さ (木の座標、覆いを掛けた形)。
// (奥行きを読んで写し直す視差の補正も試したが、鐘や葉の縁で奥行きが跳んで絵が千切れ、夜の鐘の灯りが筋になったのでやめた。作業ログ)
void impAddFrame(float j, float k, float w, inout vec4 alb, inout vec4 nrm, inout vec3 em, inout float along) {
  vec3 d = impFrameDir(j, k);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), d));
  vec3 u = cross(d, r);
  vec3 q = vImpQ;
  vec3 v = vImpVl;
  float vd = max(dot(v, d), 0.2);
  vec2 uv = impProject(q - v * (dot(q, d) / vd), r, u);
  vec4 a = impTap(uImpAlbedo, j, k, uv);
  vec4 n = impTap(uImpNormal, j, k, uv);
  float dep = a.a > 0.02 ? (n.a / a.a) * 2.0 - 1.0 : 0.0;
  alb += a * w;
  nrm += n * w;
  along += (dep * uImpRadius - dot(q, d)) / vd * a.a * w;
  #ifdef IMP_EMISSIVE
  em += impTap(uImpEmissive, j, k, uv).rgb * w;
  #endif
}
`;

// 色・覆い・法線・奥行き・発光を帳の 4 枠から取り、深度を樹冠の表に置く (diffuseColor を決めた直後に入れる)
const IMPOSTOR_FRAGMENT_SURFACE = /* glsl */ `
  vec4 impA = vec4(0.0);
  vec4 impN = vec4(0.0);
  vec3 impE = vec3(0.0);
  float impAlong = 0.0;
  impAddFrame(vImpFrame.x, vImpFrame.z, vImpW.x, impA, impN, impE, impAlong);
  impAddFrame(vImpFrame.y, vImpFrame.z, vImpW.y, impA, impN, impE, impAlong);
  impAddFrame(vImpFrame.x, vImpFrame.w, vImpW.z, impA, impN, impE, impAlong);
  impAddFrame(vImpFrame.y, vImpFrame.w, vImpW.w, impA, impN, impE, impAlong);
  if (impA.a < uImpCut) discard;
  float impCov = max(impA.a, 1e-3);
  vec3 impSq = impA.rgb / impCov;
  diffuseColor.rgb = impSq * impSq;
  impN /= impCov;
  impE /= impCov;
  vec3 impNl = impN.xyz * 2.0 - 1.0;
  vec3 impNw = mat3(vImpRot0, vImpRot1, vImpRot2) * impNl;
  vec3 impNormalView = normalize((viewMatrix * vec4(impNw, 0.0)).xyz);
  // 板の面から樹冠の表まで (板の半径で割った値。日の影のずれ vImpShadowShift もこの単位)
  float impDepth = impAlong / impCov / uImpRadius;
  vec3 impSurface = vImpWorld + vImpView * impDepth * vImpScale;
  vec4 impClip = projectionMatrix * viewMatrix * vec4(impSurface, 1.0);
  gl_FragDepth = clamp(impClip.z / impClip.w * 0.5 + 0.5, 0.0, 1.0);
`;

/** 板の材質: 観察画面のトゥーン (日・空の光・影・縁の光) に、帳から取った色・法線・発光を入れる */
export function createImpostorMaterial(textures: { albedo: Texture; normal: Texture; emissive: Texture | null }, layout: ImpostorLayout, sphere: Sphere): MeshToonMaterial {
  // 縁の光は葉のカード (foliage.ts) と同じく弱く。遠目の木は樹冠がほとんどを占める
  const m = createToonMaterial({ rim: 0.06 });
  m.name = 'observe-impostor';
  const base = m.onBeforeCompile;
  const defines = `#define IMP_AZ ${layout.az}\n#define IMP_EL ${layout.el.length}\n${textures.emissive ? '#define IMP_EMISSIVE\n' : ''}`;
  const uniforms = {
    uImpCenter: { value: sphere.center.clone() },
    uImpRadius: { value: sphere.radius * layout.pad },
    uImpEl: { value: [...layout.el] },
    uImpAlbedo: { value: textures.albedo },
    uImpNormal: { value: textures.normal },
    uImpEmissive: { value: textures.emissive ?? textures.albedo },
    uImpGlow: glow,
    // 覆いの切り捨て (葉のカードの絵の切り抜きと同じ 0.5)
    uImpCut: { value: 0.5 },
    // 隣の枠と混ぜる幅 (IMPOSTOR_BLEND)
    uImpBlend: { value: IMPOSTOR_BLEND },
  };
  // (調整用: 開発者ツールから材質の userData.impostor の値を変えられる)
  m.userData.impostor = uniforms;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${defines}#include <common>`)
      .replace('#include <shadowmap_pars_vertex>', `#include <shadowmap_pars_vertex>\n${IMPOSTOR_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${IMPOSTOR_VERTEX_MAIN}`)
      // 板の法線はカメラへ向ける (日の影の法線方向のずれに使う)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(impP, 1.0);\ngl_Position = projectionMatrix * mvPosition;\ntransformedNormal = normalize((viewMatrix * vec4(impV, 0.0)).xyz);\nvNormal = transformedNormal;')
      .replace('#include <worldpos_vertex>', ShaderChunk.worldpos_vertex.replace('worldPosition = modelMatrix * worldPosition;', 'worldPosition = modelMatrix * worldPosition;\n\tworldPosition = vec4(impP, 1.0);'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${defines}#include <common>`)
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${IMPOSTOR_FRAGMENT_PARS}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n${IMPOSTOR_FRAGMENT_SURFACE}`)
      .replace('#include <normal_fragment_begin>', `${ShaderChunk.normal_fragment_begin}\nnormal = impNormalView;\nnonPerturbedNormal = normal;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = impE * uImpGlow;')
      // 日の影は板の面ではなく樹冠の表 (奥行きの分だけ手前) で引く
      .replace('#include <lights_fragment_begin>', IMPOSTOR_LIGHTS_BEGIN);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `impostor-${layout.az}-${layout.el.length}-${textures.emissive ? 1 : 0}-${key.call(m)}`;
  return m;
}

const IMPOSTOR_LIGHTS_BEGIN = ShaderChunk.lights_fragment_begin.replace(
  'vDirectionalShadowCoord[ i ] )',
  '( vDirectionalShadowCoord[ i ] + vImpShadowShift * impDepth ) )',
);

/** 試験用: 板の材質のシェーダーの書き換えで、元の文字列が見つからなかった所が無いか */
export const IMPOSTOR_SHADER_ANCHORS = ['#include <common>', '#include <shadowmap_pars_vertex>', '#include <begin_vertex>', '#include <project_vertex>', '#include <worldpos_vertex>', '#include <shadowmap_pars_fragment>', '#include <alphatest_fragment>', '#include <normal_fragment_begin>', '#include <emissivemap_fragment>', '#include <lights_fragment_begin>'] as const;
