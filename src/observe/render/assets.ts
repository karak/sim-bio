import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { toonFromStandard } from './toon';

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
  });
}

export function findNode(gltf: GLTF | null, name: string): Object3D | null {
  return gltf?.scene.getObjectByName(name) ?? null;
}
