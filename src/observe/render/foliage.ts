import { DoubleSide, MeshDepthMaterial, RGBADepthPacking, ShaderChunk, type MeshToonMaterial, type Texture } from 'three';
import { createToonMaterial } from './toon';

/**
 * 葉のカードの材質 (木の磨き上げ)。鐘樹と森の木の樹冠は、葉の塊 (暗い内側) の表面に葉の房を描いた絵のカードを散らして、
 * 輪郭と面の中を葉の縁にする (tools/blender/observe_kit.py の scatter_cards、絵は assets/textures/observe/leaf_card.png)。
 * - 絵のアルファで切り抜く (glTF の alphaMode MASK)。alphaToCoverage は使わない: 縁の画素のアルファが 1 未満のまま画面まで届き、
 *   キャンバス (alpha: true) の後ろの白が点々と透けた。
 * - 両面。カードの法線は Blender で房の中心からの向きに揃えてあるので、裏から見ても法線を裏返さない
 *   (裏返すと房の中の向きの法線になり、カードごとに明暗がまだらになる)。
 * - 縁の光は弱くする: 法線が房の中心から外向きなので、輪郭のカードが一斉に白く光って葉が褪せて見えた。
 * - 色は 絵 × 頂点色 (葉の色と陰りは頂点色が持つ)。焼き (bake.ts) は絵つきの材質を焼かないので、この材質は別の draw call になる。
 * - 日の影は、絵のアルファで切り抜く深度の材質 (foliageDepth) で落とす。影にも葉の隙間が出て、光の筋 (atmosphere.ts) が抜ける。
 */
const NORMAL_NO_FLIP = ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

export function createFoliageMaterial(map: Texture, alphaTest: number, name = 'observe-foliage'): MeshToonMaterial {
  const m = createToonMaterial({ map, alphaTest, vertexColors: true, side: DoubleSide, rim: 0.06 });
  m.name = name;
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', NORMAL_NO_FLIP);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `foliage-${key.call(m)}`;
  return m;
}

const depths = new Map<Texture, MeshDepthMaterial>();

/** 葉のカードの日の影の材質 (絵のアルファで切り抜く)。同じ絵には同じ材質を返す */
export function foliageDepth(map: Texture, alphaTest: number): MeshDepthMaterial {
  const hit = depths.get(map);
  if (hit) return hit;
  const d = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map, alphaTest, side: DoubleSide });
  d.name = 'observe-foliage-depth';
  depths.set(map, d);
  return d;
}
