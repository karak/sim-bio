import { AddEquation, BufferAttribute, BufferGeometry, Color, CustomBlending, DataTexture, InstancedBufferAttribute, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, OneFactor, Quaternion, RGBAFormat, Sphere, Vector3, ZeroFactor, type BufferGeometry as Geo, type Camera } from 'three';
import { ViewCull, uploadFront } from './cull';
import { mulberry32 } from '../../simulation/rng';
import { createToonMaterial } from './toon';
import { groundColorAt, groundPatch, wearAt, TRAMPLED, type GroundLayers, type TerrainField, type Worn } from './terrain';

/**
 * 草の房の GPU インスタンス (設計 §5)。密度 (本体の grass・moss) に比例して散らし、風で揺らす。
 * 房の形は assets/models/observe/flora.glb の grass_tuft があればそれ、無ければ 3 枚の葉の仮の形。
 * (草の磨き上げ: 房の形は carpetTuft (12 枚の葉を根元に寄せた房) を既定にした。色は根元が地面の色の陰、先が明るい草の色で、
 *  遠くの房は地面の色に溶ける。色の斑・房の寄り集まり・土の見える所は地面と同じ groundPatch から決める)
 */
export type Grass = {
  mesh: InstancedMesh;
  /** (M23-05) 遠距離版 (farTuft、房の輪郭を焼いた 2 三角形の板) の房。mesh の子。置き場所・色・根元の色・距離の間引き・視錐台の判定は mesh と同じ房の組から振り分ける */
  far: InstancedMesh;
  /** (M23-02) eye (カメラ) を渡すと、視錐台で見える房だけを前に詰めて描く (camera は間引きの距離を測る位置) */
  update(t: number, camera?: { x: number; z: number }, eye?: Camera): void;
  /** 海面 (M22-08、沈降)。海面より下の房は描かない */
  setLevel(level: number): void;
  /** (草の磨き上げ) 踏み固めた所 (集落の広場・道) の房を減らし、残りは短く乾いた色に、根元を踏み固めた土の色にする */
  trample(worn: readonly Worn[]): void;
};

/**
 * 距離で間引く (M22-03 の三角形の予算)。房は 1 つ 40 三角形あり、25,000 房を全部描くと 100 万になる。
 * カメラから NEAR_M までは全部、FAR_M までに KEEP_FAR まで、OUT_M までに KEEP_OUT まで減らす。どの房を残すかは房ごとの固定の乱数で決め、カメラが動いても同じ房が残る。
 */
/** 草の丈の倍率 (試作 2 の判断で低くした。房の高さは約 0.35〜0.7 m) */
const GRASS_HEIGHT = 0.5;
const NEAR_M = 28;
const FAR_M = 70;
const KEEP_FAR = 0.3;
const KEEP_OUT = 0.2;
const OUT_M = 110;
/** (草の磨き上げ) 房の色を地面の色へ溶かす距離 (m)。FADE_FAR で FADE_MAX まで地面の色になり、遠くの房が点の模様に見えない */
const FADE_NEAR = 25;
const FADE_FAR = 80;
const FADE_MAX = 0.8;
/**
 * (M23-05) 遠距離版に替える距離 (m)。房ごとの乱数 h (0〜1) で FAR_FROM + h * FAR_BAND より遠い房を遠距離版にし、
 * 切り替わりを FAR_BAND の幅に散らして境目の輪を見せない。FAR_FROM は色を地面へ溶かし始める FADE_NEAR の少し先
 */
const FAR_FROM = 22;
const FAR_BAND = 14;
export function grassIsFar(d: number, h: number): boolean {
  return d > FAR_FROM + h * FAR_BAND;
}
export function grassKeep(d: number): number {
  if (d <= NEAR_M) return 1;
  if (d <= FAR_M) return 1 + ((KEEP_FAR - 1) * (d - NEAR_M)) / (FAR_M - NEAR_M);
  if (d <= OUT_M) return KEEP_FAR + ((KEEP_OUT - KEEP_FAR) * (d - FAR_M)) / (OUT_M - FAR_M);
  return KEEP_OUT;
}

/**
 * 草の房の形 (草の磨き上げ)。星形に開いた 8 枚の葉だと上から見て判を押したように見えたので、12 枚の細い葉を根元に寄せて立てる。
 * 内側の 4 枚は高くまっすぐ、外側は低く外へ撓む (sheets/flora の噴水のような房)。葉は四角 + 先の三角の 3 三角形で、房で 36 三角形。
 */
export function carpetTuft(seed = 3): Geo {
  const rng = mulberry32(seed);
  const blades = 12;
  const pos: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = b * 2.39996 + (rng() - 0.5) * 0.4;
    const inner = b % 3 === 0;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const r0 = (inner ? 0.01 : 0.03) + rng() * 0.05;
    const h = inner ? 0.42 + rng() * 0.1 : 0.24 + rng() * 0.16;
    const lean = (inner ? 0.05 : 0.14) + rng() * 0.1;
    const w = 0.028 + rng() * 0.012;
    const tw = a + Math.PI / 2 + (rng() - 0.5) * 0.9;
    const wx = Math.cos(tw) * w;
    const wz = Math.sin(tw) * w;
    const bx = dx * r0;
    const bz = dz * r0;
    const mx = bx + dx * lean * 0.3;
    const mz = bz + dz * lean * 0.3;
    const my = h * 0.55;
    const tx = bx + dx * lean;
    const tz = bz + dz * lean;
    pos.push(bx - wx, 0, bz - wz, bx + wx, 0, bz + wz, mx + wx * 0.7, my, mz + wz * 0.7);
    pos.push(bx - wx, 0, bz - wz, mx + wx * 0.7, my, mz + wz * 0.7, mx - wx * 0.7, my, mz - wz * 0.7);
    pos.push(mx - wx * 0.7, my, mz - wz * 0.7, mx + wx * 0.7, my, mz + wz * 0.7, tx, h, tz);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * (M23-05) 遠距離用の房の形 (2 三角形の板、1 房 36 三角形の 18 分の 1)。近い房 (tuft) を横 (z の向き) から見た輪郭を焼いた板 (tuftSilhouette) を貼る。
 * x は板の横 (シェーダーで縦の軸のまわりにカメラへ向ける)、y は高さ。幅は房の x の広がり、高さは房と同じ
 * (uTop・根元から先への色の混ぜ方・風の撓みが同じになる)。法線は真上 (近い房も法線を上へ寄せている)
 */
export function farTuft(tuft: Geo): Geo {
  const { r, h } = tuftExtent(tuft);
  const g = new BufferGeometry();
  // prettier-ignore
  g.setAttribute('position', new BufferAttribute(new Float32Array([-r, 0, 0, r, 0, 0, r, h, 0, -r, 0, 0, r, h, 0, -r, h, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  return g;
}

/** 房の横の半幅 (x の絶対値の最大) と高さ (y の最大) */
function tuftExtent(tuft: Geo): { r: number; h: number } {
  const pos = tuft.getAttribute('position');
  let r = 0.05;
  let h = 0.05;
  for (let i = 0; i < pos.count; i++) {
    r = Math.max(r, Math.abs(pos.getX(i)));
    h = Math.max(h, pos.getY(i));
  }
  return { r, h };
}

/**
 * (M23-05) 房を横 (z の向き) から見た輪郭を size × size の覆いの割合 (0〜255) に焼く。farTuft の板の uv と同じ範囲 (x は -r〜r、y は 0〜高さ)。
 * 1 画素を 4 × 4 の点で数えて縁をなめらかにする。材質は alphaToCoverage で読むので、遠くで縮めた (mipmap の) 薄い割合は MSAA の点の数になり、葉が消えずに房の濃さが保たれる
 */
export function tuftSilhouette(tuft: Geo, size = 64): DataTexture {
  const { r, h } = tuftExtent(tuft);
  const pos = tuft.getAttribute('position');
  const ss = 4;
  const n = size * ss;
  const hit = new Uint8Array(n * n);
  const px = (x: number) => ((x + r) / (2 * r)) * n;
  const py = (y: number) => (y / h) * n;
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const ax = px(pos.getX(t));
    const ay = py(pos.getY(t));
    const bx = px(pos.getX(t + 1));
    const by = py(pos.getY(t + 1));
    const cx = px(pos.getX(t + 2));
    const cy = py(pos.getY(t + 2));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(n - 1, Math.ceil(Math.max(ay, by, cy))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(n - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const qx = x + 0.5;
        const qy = y + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / area;
        const w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) hit[y * n + x] = 1;
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let c = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) c += hit[(y * ss + j) * n + x * ss + i];
      data.fill(Math.round((c / (ss * ss)) * 255), (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  // 見下ろす画では板が縦に縮むので、異方性の絞りで縮んだ向きだけをぼかす (無いと葉が塊に溶ける)
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** 房の先の色 (草の磨き上げ): 若い草の明るい先、乾いた先、茂った所の濃い先、苔の所 */
const TIP = { fresh: new Color('#97C94C'), dry: new Color('#C7BC68'), lush: new Color('#6FA844'), moss: new Color('#79AE50') };

export function createGrass(field: TerrainField, layers: GroundLayers, max: number, seed: number, tuft?: Geo, radiusM?: number): Grass {
  const geo = (tuft ?? carpetTuft()).clone();
  geo.computeBoundingBox();
  const top = Math.max(0.05, geo.boundingBox?.max.y ?? 0.5);
  // (草の磨き上げ: 縁の光は地面と同じ 0.08。房の法線を上へ寄せて地面と同じ陰りにし、影も受ける)
  const mat = createToonMaterial({ color: '#FFFFFF', rim: 0.08, side: 2 });
  const uniforms = { uTime: { value: 0 }, uTop: { value: top }, uFade: { value: [FADE_NEAR, FADE_FAR] }, uFadeMax: { value: FADE_MAX }, uLean: { value: 0 } };
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(mat, shader, renderer);
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uTop = uniforms.uTop;
    shader.uniforms.uFade = uniforms.uFade;
    shader.uniforms.uFadeMax = uniforms.uFadeMax;
    shader.uniforms.uLean = uniforms.uLean;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uTop;\nuniform float uLean;\nattribute vec3 aRoot;\nvarying vec3 vRoot;\nvarying float vH;\nvarying float vDist;').replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        // 房の上ほど揺れる。位置ごとに位相をずらし、風の帯が野を渡るように見せる
        'vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        // (M23-05) 遠距離版の板 (farTuft) は縦の軸のまわりにカメラへ向け、先をカメラから遠ざかる向きへ uLean だけ倒す。
        // 横から見た輪郭は変わらず、上から見ると房の奥行きの 6 割ほど地面を覆う (立てたままだと見下ろす画で細い線になる)。
        // 房ごとの回転と横の拡大を戻した房の座標で向きを決める (instanceMatrix の横の拡大は x・z で同じ)
        '#ifdef GRASS_FAR',
        'vec3 toEyeL = transpose(mat3(instanceMatrix)) * vec3(cameraPosition.x - (modelMatrix * wp).x, 0.0, cameraPosition.z - (modelMatrix * wp).z);',
        'vec2 fw = normalize(toEyeL.xz + 1e-5);',
        'transformed = vec3(-fw.y * position.x - fw.x * position.y * uLean, position.y, fw.x * position.x - fw.y * position.y * uLean);',
        '#endif',
        // (比較画の撮り直しで追加) カメラの足元 1.5〜5 m の房は根元へ縮める。低い寄りの画で手前の房が画を覆わないように
        'transformed *= smoothstep(1.5, 5.0, distance((modelMatrix * wp).xz, cameraPosition.xz));',
        'float sway = sin(uTime * 1.6 + wp.x * 0.15 + wp.z * 0.07) * 0.5 + sin(uTime * 2.7 + wp.z * 0.3) * 0.2;',
        // (草の磨き上げ) 風向きは世界で揃え (房ごとの回転を戻す)、大きな突風の帯で強弱を付け、葉の先ほど大きく撓ませる
        'float gust = 0.55 + 0.45 * sin(uTime * 0.6 - (wp.x * 0.93 + wp.z * 0.37) * 0.06);',
        'vec3 windL = transpose(mat3(instanceMatrix)) * vec3(0.93, 0.0, 0.37);',
        'vec2 wl = normalize(windL.xz + 1e-5);',
        'float bendW = position.y * position.y / uTop;',
        'transformed.x += (sway + 0.35) * gust * 0.16 * bendW * wl.x;',
        'transformed.z += (sway + 0.35) * gust * 0.16 * bendW * wl.y;',
        'vH = clamp(position.y / uTop, 0.0, 1.0);',
        'vRoot = aRoot;',
      ].join('\n'),
    ).replace(
      '#include <beginnormal_vertex>',
      // (草の磨き上げ) 葉の法線を上へ寄せる。葉ごとに明暗が跳ねず、地面と同じ光で草の絨毯に見える
      '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.8));',
    ).replace('#include <project_vertex>', '#include <project_vertex>\nvDist = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uFade;\nuniform float uFadeMax;\nvarying vec3 vRoot;\nvarying float vH;\nvarying float vDist;')
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          // (草の磨き上げ) 根元は地面の色の陰、先は房の色 (instanceColor)。遠くでは房ごと地面の色に溶かす
          'vec3 grassC = mix(vRoot * 0.55, diffuseColor.rgb, pow(max(vH, 1e-3), 0.75));',
          'diffuseColor.rgb = mix(grassC, vRoot, smoothstep(uFade.x, uFade.y, vDist) * uFadeMax);',
        ].join('\n'),
      )
      // 両面の裏で上向きの法線が下を向かないように、裏返しを戻す
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif')
      // (M23-05) 遠距離版の板: 覆いの割合を縁で鋭くして alphaToCoverage に渡す (縁は画素 1 つ分でなめらか、内は全部覆う)。
      // 遠くで縮めた (mipmap の) 覆いは葉が細って薄くなるので、縮めた段の数だけ割合を持ち上げて房の濃さを保つ
      // (段の数は縮みの小さいほうの向きで数える。異方性の絞りで読むので、縮みの大きい向きで数えると持ち上げすぎて塊になる)
      .replace(
        '#include <alphamap_fragment>',
        [
          '#include <alphamap_fragment>',
          '#ifdef GRASS_FAR',
          'vec2 texel = vAlphaMapUv * 64.0;',
          'float lod = max(0.0, 0.5 * log2(min(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)))));',
          'diffuseColor.a *= 1.0 + lod * 0.3;',
          'diffuseColor.a = clamp((diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);',
          '#endif',
        ].join('\n'),
      );
  };
  mat.customProgramCacheKey = () => 'observe-grass';
  const mesh = new InstancedMesh(geo, mat, max);
  // (M23-05) 遠距離版。材質は同じシェーダーに GRASS_FAR を足したもの (uniforms は近い房と共有)
  const farGeo = farTuft(geo);
  // 板は房の輪郭を焼いた覆い (tuftSilhouette) を alphaToCoverage で抜く (4× MSAA の点の数。discard の閾値は使わない)。
  // 色は置き換え、描画先の不透明度は前のまま残す (覆いの割合が描画先の不透明度に残ると、画の上で背景が透けて房が白く抜ける)
  const farMat = createToonMaterial({
    color: '#FFFFFF',
    rim: 0.08,
    side: 2,
    alphaMap: tuftSilhouette(geo),
    alphaToCoverage: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: ZeroFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  farMat.defines = { GRASS_FAR: '' };
  farMat.onBeforeCompile = mat.onBeforeCompile;
  farMat.customProgramCacheKey = () => 'observe-grass-far';
  // 上から見て房の奥行き (直径) の 6 割ほど地面を覆うように倒す (房の座標で、先の高さあたりの横の量)。
  // 直径の分まで倒すと、見下ろす画 (海岸) で板が四角い塊に見えた
  {
    const b = geo.boundingBox!;
    uniforms.uLean.value = ((b.max.x - b.min.x + b.max.z - b.min.z) / 2 / top) * 0.6;
  }
  const far = new InstancedMesh(farGeo, farMat, max);
  far.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const farRoot = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  farGeo.setAttribute('aRoot', farRoot);
  far.count = 0;
  far.receiveShadow = true;
  far.name = 'observe-grass-far';
  const rng = mulberry32(seed);
  // 草は区域 (半径 radiusM) の中に密に置く。縁の外は地面の色だけで遠景に溶かす
  const half = radiusM ?? field.window * 10;
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3();
  const colA = new Color('#9CC35E');
  const colB = new Color('#C8C66E');
  const colM = new Color('#6FA64E');
  const c = new Color();
  const root = new Color();
  const rootArr = new Float32Array(max * 3);
  const patchDry = new Float32Array(max);
  let k = 0;
  for (let tries = 0; tries < max * 6 && k < max; tries++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    const h = field.heightAt(x, z);
    if (h < 1.0 || Math.hypot(x, z) > half) continue;
    const g = layers.grass ? field.layerAt(layers.grass, x, z) : 0.3;
    const mo = layers.moss ? field.layerAt(layers.moss, x, z) : 0;
    const want = Math.min(1, g * 2.2 + mo * 0.35 + 0.08);
    // (草の磨き上げ) 土の見える斑では疎らに、房の寄り集まる斑では密に置く
    const patch = groundPatch(x, z, g);
    if (rng() > want * (1 - patch.bare * 0.75) * (0.45 + 0.75 * patch.clump)) continue;
    p.set(x, h - 0.02, z);
    q.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
    const s = 1.4 + rng() * 1.2;
    // 丈は低めに (試作 2 の判断: 座高 0.35 m の兎が 0.7〜1.3 m の草に埋もれて見えなかった)。横の広がりはそのまま
    // (草の磨き上げ: 房は根元に寄せた形になったので横は 0.85 倍。丈は横の広がりと切り離し、寄り集まる斑で高く、乾いた斑で低く、平均は前より低い)
    const tall = (0.75 + 0.3 * patch.clump) * (1 - 0.25 * patch.dry) * (1.5 + rng() * 0.5);
    sc.set(s * 0.85, (0.8 + g) * GRASS_HEIGHT * tall, s * 0.85);
    m.compose(p, q, sc);
    mesh.setMatrixAt(k, m);
    // (草の磨き上げ: 房の先の色は地面の色から明るい若草へ寄せ、乾いた斑は黄、茂った斑は濃い緑、苔の所は苔の緑。1 房ずつ明るさを少し揺らす)
    groundColorAt(field, layers, x, z, root);
    c.copy(root).lerp(TIP.fresh, 0.65).lerp(TIP.dry, patch.dry * 0.35).lerp(TIP.lush, (1 - patch.dry) * patch.clump * 0.35).lerp(TIP.moss, Math.min(0.5, mo * 0.5));
    c.multiplyScalar(0.94 + rng() * 0.16);
    if (rng() < 0.08) c.lerp(colA, 0.3).lerp(colB, rng() * 0.3).lerp(colM, Math.min(0.6, mo * 0.5));
    mesh.setColorAt(k, c);
    rootArr.set([root.r, root.g, root.b], k * 3);
    patchDry[k] = patch.dry;
    k++;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // (M23-02) 丸ごとの視錐台の判定に使う境界の球は、詰め直す前の全部の房で測っておく (見える房だけで測ると、向きを変えたときに丸ごと落ちる)
  mesh.computeBoundingSphere();
  const rootAttr = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  rootAttr.array.set(rootArr.subarray(0, k * 3));
  geo.setAttribute('aRoot', rootAttr);
  mesh.receiveShadow = true;
  mesh.name = 'observe-grass';
  // (M23-05) 遠距離版の丸ごとの境界の球は近い房の全部の球に、倒した先の分 (約 1 m) を足したもの
  far.boundingSphere = mesh.boundingSphere!.clone();
  far.boundingSphere.radius += 1;
  mesh.add(far);
  // 全部の房の行列と色を控えておき、カメラが動いたら残す房だけを前に詰め直す
  const allM = mesh.instanceMatrix.array.slice(0, k * 16);
  const allC = mesh.instanceColor ? mesh.instanceColor.array.slice(0, k * 3) : null;
  const allR = rootArr.slice(0, k * 3);
  const keepHash = Float32Array.from({ length: k }, () => rng());
  const wearHash = Float32Array.from({ length: k }, () => rng());
  const gone = new Uint8Array(k);
  // (M23-05) 遠距離版に替える距離を散らす房ごとの乱数 (grassIsFar)
  const farHash = Float32Array.from({ length: k }, () => rng());
  // (M23-02) 房ごとの境界の球 (中心 x・y・z と半径)。風で撓む分 (葉先で最大約 0.2 m) を半径に足す。踏まれて短くなった房も元の球のまま (大きめに見る)
  const balls = new Float32Array(k * 4);
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const ball = new Sphere();
  for (let i = 0; i < k; i++) {
    ball.copy(geo.boundingSphere!).applyMatrix4(m.fromArray(allM, i * 16));
    balls.set([ball.center.x, ball.center.y, ball.center.z, ball.radius + 0.2], i * 4);
  }
  const view = new ViewCull();
  let culling = false;
  let lastX = Infinity;
  let lastZ = Infinity;
  let level = -Infinity;
  const repack = (cx: number, cz: number) => {
    const im = mesh.instanceMatrix.array as Float32Array;
    const ic = mesh.instanceColor?.array as Float32Array | undefined;
    const ir = rootAttr.array as Float32Array;
    const fm = far.instanceMatrix.array as Float32Array;
    const fc = far.instanceColor!.array as Float32Array;
    const fr = farRoot.array as Float32Array;
    let n = 0;
    let nf = 0;
    for (let i = 0; i < k; i++) {
      const d = Math.hypot(allM[i * 16 + 12] - cx, allM[i * 16 + 14] - cz);
      if (gone[i] || keepHash[i] > grassKeep(d) || allM[i * 16 + 13] < level) continue;
      if (culling && !view.sees(balls[i * 4], balls[i * 4 + 1], balls[i * 4 + 2], balls[i * 4 + 3])) continue;
      // (M23-05) 遠い房は遠距離版へ。行列・房の色・根元の色は同じ番号で一緒に写す
      if (grassIsFar(d, farHash[i])) {
        fm.set(allM.subarray(i * 16, i * 16 + 16), nf * 16);
        if (allC) fc.set(allC.subarray(i * 3, i * 3 + 3), nf * 3);
        else fc.fill(1, nf * 3, nf * 3 + 3);
        fr.set(allR.subarray(i * 3, i * 3 + 3), nf * 3);
        nf++;
        continue;
      }
      im.set(allM.subarray(i * 16, i * 16 + 16), n * 16);
      if (ic && allC) ic.set(allC.subarray(i * 3, i * 3 + 3), n * 3);
      ir.set(allR.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    mesh.count = n;
    // (M23-02 で変更: 詰め直しがカメラの向きでも起きるので、前から n 房分だけを送り直す)
    uploadFront(mesh.instanceMatrix, n);
    if (mesh.instanceColor) uploadFront(mesh.instanceColor, n);
    uploadFront(rootAttr, n);
    far.count = nf;
    uploadFront(far.instanceMatrix, nf);
    uploadFront(far.instanceColor!, nf);
    uploadFront(farRoot, nf);
  };
  return {
    mesh,
    far,
    update(t, camera, eye) {
      uniforms.uTime.value = t;
      // (M23-02) カメラが広げた視錐台の分だけ動いたか回ったら詰め直す
      culling = !!eye;
      const turned = eye ? view.update(eye) : false;
      if (camera && (turned || Math.hypot(camera.x - lastX, camera.z - lastZ) > 3)) {
        lastX = camera.x;
        lastZ = camera.z;
        repack(camera.x, camera.z);
      }
    },
    setLevel(l) {
      if (Math.abs(l - level) < 0.05) return;
      level = l;
      if (Number.isFinite(lastX)) repack(lastX, lastZ);
    },
    trample(worn) {
      for (let i = 0; i < k; i++) {
        const x = allM[i * 16 + 12];
        const z = allM[i * 16 + 14];
        const w = wearAt(worn, x, z);
        if (w <= 0) continue;
        if (wearHash[i] < w * 1.15) {
          gone[i] = 1;
          continue;
        }
        // 縁に残る房は短く、先は乾いた色に、根元は踏み固めた土の色に (wearTerrain と同じ混ぜ方)
        for (const e of [4, 5, 6]) allM[i * 16 + e] *= 1 - 0.5 * w;
        if (allC) {
          c.fromArray(allC, i * 3).lerp(TIP.dry, w * 0.5 + patchDry[i] * 0.1);
          c.toArray(allC, i * 3);
        }
        root.fromArray(allR, i * 3).lerp(TRAMPLED, w * 0.7);
        root.toArray(allR, i * 3);
      }
      // 次の update で詰め直す
      lastX = Infinity;
      lastZ = Infinity;
    },
  };
}
