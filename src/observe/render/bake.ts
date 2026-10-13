import {
  BufferAttribute,
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  ShaderChunk,
  type BufferGeometry,
  type Material,
  type MeshToonMaterial,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial } from './toon';
import { BARK_TILE_V, barkDetailTexture } from './barkDetail';

/**
 * 材質ごとに分かれたメッシュを 1 つに焼く (M22-03 の draw call 予算)。
 * glTF は材質ごとにメッシュを分けるので、月鹿 1 頭で 5 材質 × (本描画 + 影) = 10 draw call になる。
 * 不透明で絵 (map) を持たない材質は、色を頂点色に、発光を頂点の属性 aEmissive に移し、全体で共有する 1 つのトゥーン材質で描く。
 * 共有の材質は発光に uGlow を掛けるので、夜に灯り・鐘・ムーの光をまとめて強められる (M22-07)。
 * 半透明・絵つき・モーフつきのメッシュは焼かずに残す。
 */
export const glow = { value: 1 };

const shared = new Map<number, MeshToonMaterial>();
// (遠距離版の追加で追加) 薄い葉の両面の材質 (THIN_LEAF)。キーは side と別に持つ
const sharedLeaf = new Map<number, MeshToonMaterial>();

/**
 * (遠距離版の追加で追加) 薄い葉 (羊歯の小葉・小花の花弁、材質の名前が flora_under で始まる) は、両面でも裏の面の法線を裏返さない。
 * 法線は Blender で上へ寄せてあるので、裏から見ても上向きの法線で陰る。裏返すと下向きの法線になって縁の光が一面に掛かり、
 * 立ち上がった小葉が白茶けて見えた (葉のカード foliage.ts と同じ扱い)
 */
export const THIN_LEAF = /^flora_under/;
const NORMAL_NO_FLIP = ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

/**
 * (M22-11 で追加) 樹皮と木口の材質。名前で見分け、焼いた形の頂点に aWood = (u, v, 種類) を持たせる (種類 1 = 樹皮、2 = 木口、0 = それ以外)。
 * 樹皮の UV は Blender が付ける (u = 周りの割合 × 繰り返し、v = 軸に沿った m)、木口の UV は髄を原点に半径で割った位置
 * (tools/blender/observe_kit.py の wrap_uv・ring_disc)。共有の材質は aWood を見て、樹皮には筆の筋 (barkDetail.ts) の明暗・色と
 * 法線の揺れを、木口には細かい年輪を足す。draw call は増えない (種類は頂点の属性で、材質は今までと同じ共有の 1 つ)
 */
export const BARK_MATERIAL = /^(belltree_(trunk|bark)|flora_forest_(trunk|bark))$/;
export const ENDGRAIN_MATERIAL = /^belltree_endgrain$/;

function woodKind(name: string): number {
  if (BARK_MATERIAL.test(name)) return 1;
  if (ENDGRAIN_MATERIAL.test(name)) return 2;
  return 0;
}

const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const WOOD_PARS = [
  'uniform sampler2D uBark;',
  'varying vec3 vWood;',
  // 樹皮の升の高さ (m): 筋の盛り上がり 12 mm、裂け目の溝 12 mm (20 mm では裂け目の縁が細く白く光った)
  'float woodBarkH(vec4 t) { return t.r * 0.012 - t.a * 0.012; }',
].join('\n');
// 色: 樹皮は筋の溝を青灰に、筋の上を暖かく、大きな斑で暖 / 寒に振り、裂け目を暗い青灰に。木口は細い年輪の線と髄のまわりの濃さ。
// 20〜55 m で薄れる (遠くはミップで均され、頂点色だけに戻る)
const WOOD_COLOR = [
  'float wFade = 1.0 - smoothstep(20.0, 55.0, length(vViewPosition));',
  `vec2 wUv = vec2(vWood.x, vWood.y / ${glslFloat(BARK_TILE_V)});`,
  'vec2 wDx = dFdx(wUv);',
  'vec2 wDy = dFdy(wUv);',
  'float wBark = step(0.5, vWood.z) * step(vWood.z, 1.5) * wFade;',
  'vec4 wT = vec4(0.5, 0.5, 0.5, 0.0);',
  'if (vWood.z > 0.5 && vWood.z < 1.5) {',
  '  wT = textureGrad(uBark, wUv, wDx, wDy);',
  '  vec3 wTone = mix(vec3(0.84, 0.86, 0.95), vec3(1.05, 1.03, 0.97), wT.r);',
  '  wTone *= mix(vec3(0.96, 0.98, 1.03), vec3(1.04, 1.01, 0.95), wT.g);',
  '  wTone = mix(wTone, vec3(0.68, 0.68, 0.78), wT.a * 0.75);',
  '  diffuseColor.rgb *= mix(vec3(1.0), wTone, wFade);',
  '} else if (vWood.z > 1.5) {',
  '  float wR = length(vWood.xy);',
  '  float wAng = atan(vWood.y, vWood.x) / 6.2831853 + 0.5;',
  '  float wWob = textureGrad(uBark, vec2(wAng, wR * 0.5), vec2(0.0), vec2(0.0)).b;',
  '  float wRings = wR * 15.0 + (wWob - 0.5) * 1.2;',
  '  float wLine = (1.0 - smoothstep(0.05, 0.14, abs(fract(wRings) - 0.5))) * (1.0 - smoothstep(0.25, 0.6, fwidth(wRings)));',
  '  float wHeart = 1.0 - smoothstep(0.05, 0.3, wR);',
  '  vec3 wTone = mix(vec3(1.0), vec3(0.8, 0.72, 0.62), wLine * 0.55) * mix(vec3(1.0), vec3(0.85, 0.78, 0.7), wHeart * 0.4);',
  '  diffuseColor.rgb *= mix(vec3(1.0), wTone, wFade);',
  '}',
].join('\n');
// 法線: 樹皮の升の高さを画面の隣の画素の UV で読み、高さの差で揺らす (three の bumpmap の perturbNormalArb と同じ式)
const WOOD_NORMAL = [
  'if (wBark > 0.0) {',
  '  float wH0 = woodBarkH(wT);',
  '  vec2 wDH = vec2(woodBarkH(textureGrad(uBark, wUv + wDx, wDx, wDy)) - wH0, woodBarkH(textureGrad(uBark, wUv + wDy, wDx, wDy)) - wH0) * wBark;',
  '  vec3 wSx = dFdx(-vViewPosition);',
  '  vec3 wSy = dFdy(-vViewPosition);',
  '  vec3 wR1 = cross(wSy, normal);',
  '  vec3 wR2 = cross(normal, wSx);',
  '  float wDet = dot(wSx, wR1) * faceDirection;',
  '  normal = normalize(abs(wDet) * normal - sign(wDet) * (wDH.x * wR1 + wDH.y * wR2));',
  '}',
].join('\n');

function leafOf(m: Bakeable): boolean {
  return m.material.side === DoubleSide && THIN_LEAF.test(m.material.name);
}

function bakedMaterial(side: number, leaf = false): MeshToonMaterial {
  const cache = leaf ? sharedLeaf : shared;
  const hit = cache.get(side);
  if (hit) return hit;
  const m = createToonMaterial({ vertexColors: true, side: side as typeof FrontSide });
  m.name = side === DoubleSide ? 'observe-baked-double' : 'observe-baked';
  if (leaf) m.name = 'observe-baked-leaf';
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.uniforms.uGlow = glow;
    // (M22-11 で変更: 樹皮と木口の aWood を渡し、樹皮の升 uBark で色と法線を足す)
    shader.uniforms.uBark = { value: barkDetailTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aEmissive;\nvarying vec3 vEmissive;\nattribute vec3 aWood;\nvarying vec3 vWood;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmissive = aEmissive;\nvWood = aWood;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGlow;\nvarying vec3 vEmissive;\n${WOOD_PARS}`)
      .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vEmissive * uGlow;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WOOD_COLOR}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${WOOD_NORMAL}`);
    if (leaf) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', NORMAL_NO_FLIP);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `baked-${leaf ? 'leaf-' : ''}${key.call(m)}`;
  cache.set(side, m);
  return m;
}

type Bakeable = Mesh & { material: MeshToonMaterial };

function bakeable(o: Object3D): o is Bakeable {
  const m = o as Mesh;
  if (!m.isMesh || Array.isArray(m.material)) return false;
  const mat = m.material as MeshToonMaterial;
  return !mat.transparent && !mat.map && Object.keys(m.geometry.morphAttributes).length === 0;
}

/** 1 つのメッシュの形を、色と発光を頂点に持つ形に直す (位置は parentSpace ? 親の座標 : そのまま) */
function bakeGeometry(mesh: Bakeable, parentSpace: boolean): BufferGeometry {
  const src = mesh.geometry.clone();
  if (parentSpace) src.applyMatrix4(mesh.matrix);
  if (!src.getAttribute('normal')) src.computeVertexNormals();
  const n = src.getAttribute('position').count;
  const mat = mesh.material;
  const vc = mat.vertexColors ? src.getAttribute('color') : undefined;
  const base = mat.color ?? new Color(1, 1, 1);
  const em = (mat.emissive ?? new Color(0, 0, 0)).clone().multiplyScalar(mat.emissiveIntensity ?? 1);
  const col = new Float32Array(n * 3);
  const emi = new Float32Array(n * 3);
  // (M22-11 で追加) 樹皮と木口は UV と種類を aWood に。glTF の UV は v が 1 - v で来るので戻す (樹皮の v は m、木口は髄からの位置)
  const kind = woodKind(mat.name);
  const uv = kind > 0 ? src.getAttribute('uv') : undefined;
  const wood = new Float32Array(n * 3);
  if (uv) {
    for (let i = 0; i < n; i++) {
      wood[i * 3] = uv.getX(i);
      wood[i * 3 + 1] = 1 - uv.getY(i);
      wood[i * 3 + 2] = kind;
    }
  }
  for (let i = 0; i < n; i++) {
    const r = vc ? vc.getX(i) : 1;
    const g = vc ? vc.getY(i) : 1;
    const b = vc ? vc.getZ(i) : 1;
    col[i * 3] = base.r * r;
    col[i * 3 + 1] = base.g * g;
    col[i * 3 + 2] = base.b * b;
    emi[i * 3] = em.r;
    emi[i * 3 + 1] = em.g;
    emi[i * 3 + 2] = em.b;
  }
  for (const name of Object.keys(src.attributes)) {
    if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) src.deleteAttribute(name);
  }
  src.setAttribute('color', new BufferAttribute(col, 3));
  src.setAttribute('aEmissive', new BufferAttribute(emi, 3));
  src.setAttribute('aWood', new BufferAttribute(wood, 3));
  // skinIndex は glTF では整数の型のまま来るが、形によって型が違うと結合できないので揃える
  const si = src.getAttribute('skinIndex');
  if (si) src.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from({ length: si.count * 4 }, (_, k) => si.getComponent(Math.floor(k / 4), k % 4)), 4));
  const sw = src.getAttribute('skinWeight');
  if (sw) src.setAttribute('skinWeight', new BufferAttribute(Float32Array.from({ length: sw.count * 4 }, (_, k) => sw.getComponent(Math.floor(k / 4), k % 4)), 4));
  return src;
}

const isIdentity = (o: Object3D) => o.matrix.equals(o.matrix.clone().identity());

/**
 * root の中で、同じ親に並ぶ焼けるメッシュを (骨つきか・両面か) ごとに 1 つへまとめる。
 * root の直下のメッシュは別々のノード (草の房・羊歯…) なので、まとめずにその場で焼く。1 つしか無い組もその場で焼く (名前と行列を保つ)。
 * 骨つきのメッシュは、同じ骨に結ばれていて親からの行列が単位行列のものだけまとめる (glTF の材質分割はこの形)。
 */
export function bakeMaterials(root: Object3D): void {
  root.updateMatrixWorld(true);
  const parents = new Set<Object3D>();
  root.traverse((o) => {
    if (bakeable(o) && o.parent) parents.add(o.parent);
  });
  const inPlace = (m: Bakeable) => {
    const side = m.material.side === DoubleSide ? DoubleSide : FrontSide;
    const leaf = leafOf(m);
    m.geometry = bakeGeometry(m, false);
    m.material = bakedMaterial(side, leaf);
  };
  for (const parent of parents) {
    const kids = parent.children.filter(bakeable);
    if (parent === root) {
      kids.forEach(inPlace);
      continue;
    }
    const buckets = new Map<string, Bakeable[]>();
    for (const c of kids) {
      const sk = (c as unknown as SkinnedMesh).isSkinnedMesh;
      // 子のノードを持つメッシュは、まとめると子ごと外れるのでその場で焼く
      if ((sk && !isIdentity(c)) || c.children.length > 0) {
        inPlace(c);
        continue;
      }
      const side = c.material.side === DoubleSide ? DoubleSide : FrontSide;
      // (遠距離版の追加で変更: 薄い葉 (leafOf) は別の組にする)
      const key = `${sk ? `skin:${(c as unknown as SkinnedMesh).skeleton.uuid}` : 'static'}:${side}${leafOf(c) ? ':leaf' : ''}`;
      const list = buckets.get(key) ?? [];
      list.push(c);
      buckets.set(key, list);
    }
    for (const [key, list] of buckets) {
      if (list.length === 1) {
        inPlace(list[0]);
        continue;
      }
      const leaf = key.endsWith(':leaf');
      const side = key.replace(/:leaf$/, '').endsWith(`:${DoubleSide}`) ? DoubleSide : FrontSide;
      const skinned = key.startsWith('skin:');
      // 骨つきは子の行列が単位なので、そのまま結合する。静物は親の座標に直して結合する
      let geos = list.map((m) => bakeGeometry(m, !skinned));
      // 結合は全部に index があるか全部に無いかのどちらか。混ざったら index を外して揃える (VAT の幅が頂点数なので、揃うなら index を保つ)
      if (geos.some((g) => !g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
      const geo = mergeGeometries(geos, false);
      if (!geo) {
        list.forEach(inPlace);
        continue;
      }
      const mat = bakedMaterial(side, leaf);
      const first = list[0];
      let out: Mesh;
      if (skinned) {
        const sk = first as unknown as SkinnedMesh;
        const SkinnedCtor = sk.constructor as new (g: BufferGeometry, m: Material) => SkinnedMesh;
        const merged = new SkinnedCtor(geo, mat);
        merged.bind(sk.skeleton, sk.bindMatrix);
        out = merged;
      } else {
        out = new Mesh(geo, mat);
      }
      out.name = `${parent.name}_baked`;
      out.castShadow = first.castShadow;
      out.receiveShadow = first.receiveShadow;
      for (const m of list) parent.remove(m);
      parent.add(out);
    }
  }
}
