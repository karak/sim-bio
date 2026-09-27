import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { toonFromStandard } from './toon';
import { bakeMaterials } from './bake';
import { createFoliageMaterial, foliageDepth } from './foliage';

/**
 * 観察画面の GLB (assets/models/observe/*.glb) を読む。材質は観察画面のトゥーンに置き換える (設計 §8)。
 * 試作ではまだ無いアセットがあるので、読めなければ null を返し、呼び出し側が仮の形で描く。
 */
export async function loadGlb(url: string): Promise<GLTF | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return null;
    const gltf = await new GLTFLoader().loadAsync(url);
    toToon(gltf.scene);
    // 材質ごとに分かれたメッシュを 1 つに焼き、draw call を減らす (M22-03)
    bakeMaterials(gltf.scene);
    return gltf;
  } catch (e) {
    console.warn(`observe: ${url} を読めなかった`, e);
    return null;
  }
}

const cache = new Map<Material, Material>();

function convert(m: Material): Material {
  const hit = cache.get(m);
  if (hit) return hit;
  const s = m as MeshStandardMaterial;
  // (木の磨き上げで追加) 絵のアルファで切り抜く材質 (葉のカード) は、葉のカードの材質にする (foliage.ts)
  if (s.map && s.alphaTest > 0) {
    const f = createFoliageMaterial(s.map, s.alphaTest, s.name);
    cache.set(m, f);
    return f;
  }
  const t = toonFromStandard({
    color: s.color,
    map: s.map,
    emissive: s.emissive,
    // Blender の書き出しは発光を強く持つ (KHR_materials_emissive_strength) ので、bloom が角を白く飛ばさない強さに抑える
    emissiveIntensity: Math.min(s.emissiveIntensity ?? 1, 0.45),
    vertexColors: s.vertexColors,
    name: s.name,
    transparent: s.transparent,
    opacity: s.opacity,
    side: s.side,
  });
  cache.set(m, t);
  return t;
}

export function toToon(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // (木の磨き上げで追加) 葉のカードは切り抜いた影を落とし、光線の当たり判定 (自動カメラの見通し) からは外す (奥の葉の塊が受け持つ)
    const f = mesh.material as MeshStandardMaterial;
    if (!Array.isArray(mesh.material) && f.map && f.alphaTest > 0) {
      mesh.customDepthMaterial = foliageDepth(f.map, f.alphaTest);
      mesh.userData.foliage = true;
    }
  });
}

export function findNode(gltf: GLTF | null, name: string): Object3D | null {
  return gltf?.scene.getObjectByName(name) ?? null;
}
