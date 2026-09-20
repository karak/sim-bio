import { BoxGeometry, ConeGeometry, CylinderGeometry, MeshLambertMaterial, type BufferGeometry, type Material } from 'three';
import type { SpeciesDef } from '../simulation/types';

/** 種 ID → 表示アセット。glTF に差し替えるときはここだけ変える。 */
export type AssetTable = Record<string, { geometry: BufferGeometry; material: Material; scale: number; perCell: number }>;

/** M1: プリミティブ + 単色。植物は円錐、草食獣は箱、肉食獣は細長い箱。 */
export function buildAssetTable(species: SpeciesDef[]): AssetTable {
  const t: AssetTable = {};
  for (const d of species) {
    const material = new MeshLambertMaterial({ color: d.color });
    const geometry =
      // 鐘樹 (M8-10) は他の植物より高く細い円錐にして、塔の材になる立木らしい見た目にする
      d.id === 'belltree'
        ? new ConeGeometry(0.1, 1.1, 5)
        : d.trophic === 'plant'
          ? new ConeGeometry(0.18, 0.6, 5)
          : d.trophic === 'herbivore'
            ? new BoxGeometry(0.3, 0.2, 0.2)
            : d.trophic === 'decomposer'
              ? new CylinderGeometry(0.22, 0.22, 0.06, 6)
              : new BoxGeometry(0.4, 0.2, 0.15);
    // 動物は密度が植物より一桁小さいので、1 セルあたりの最大表示数を多くして見えるようにする
    // 鐘樹は 1 本 1 本が目立つ立木として置きたいので perCell 1
    const perCell = d.id === 'belltree' ? 1 : d.trophic === 'plant' ? 2 : d.trophic === 'decomposer' ? 1 : 10;
    t[d.assetId] = { geometry, material, scale: d.id === 'forest' ? 1.6 : 1, perCell };
  }
  return t;
}
