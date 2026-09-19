import { BoxGeometry, ConeGeometry, MeshLambertMaterial, type BufferGeometry, type Material } from 'three';
import type { SpeciesDef } from '../simulation/types';

/** 種 ID → 表示アセット。glTF に差し替えるときはここだけ変える。 */
export type AssetTable = Record<string, { geometry: BufferGeometry; material: Material; scale: number }>;

/** M1: プリミティブ + 単色。植物は円錐、草食獣は箱、肉食獣は細長い箱。 */
export function buildAssetTable(species: SpeciesDef[]): AssetTable {
  const t: AssetTable = {};
  for (const d of species) {
    const material = new MeshLambertMaterial({ color: d.color });
    const geometry =
      d.trophic === 'plant'
        ? new ConeGeometry(0.18, 0.6, 5)
        : d.trophic === 'herbivore'
          ? new BoxGeometry(0.3, 0.2, 0.2)
          : new BoxGeometry(0.4, 0.2, 0.15);
    t[d.assetId] = { geometry, material, scale: d.id === 'forest' ? 1.6 : 1 };
  }
  return t;
}
