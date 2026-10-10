import type { Mesh } from 'three';
import type { WorldSnapshot } from '../../simulation/types';
import { extractArea, landmarks, type Area, type Landmarks, type Point } from '../area';
import { wearTerrain, type TerrainField, type Worn } from '../render/terrain';
import type { Grass } from '../render/grass';
import { hutPlacements } from '../settlementLayout';
import { AREA_R } from './options';

export type Site = { area: Area; marks: Landmarks; slip: Point; plaza: Point; worn: Worn[] };

export function layOutSite(s: WorldSnapshot, home: number, hasSettlement: boolean, field: TerrainField, terrain: Mesh, grass: Grass): Site {
  // (M22-06: 林の切り開きと株を船台に合わせるため、区域と目印をここで決める。元は集落の一角の直前)
  const area = extractArea(s, home, AREA_R);
  const marks = hasSettlement ? landmarks(area) : { ...landmarks(area), lanterns: [] };
  // (M22-06 試作 2: 船台が 27 m になったので、船台の点 (外海に接する陸のセルの中心) から陸の側へ 6.5 m ずらし、
  //  舳先の端が水際を 2 m ほど越えるところに置く。舟・丸太の山・切り開きはこの中心に合わせる)
  const slip = { x: marks.slipway.x - marks.slipwayBow.x * 6.5, z: marks.slipway.z - marks.slipwayBow.z * 6.5 };
  // (草の磨き上げ) 集落の広場・小屋の戸口への道・船台への道を踏み固めた土にし、そこの草を減らす (小屋の位置は下の集落の一角と同じ)
  const plaza = { x: marks.center.x, z: marks.center.z - 6 };
  const worn: Worn[] = hasSettlement
    ? [
        { ax: plaza.x, az: plaza.z, bx: plaza.x, bz: plaza.z, r: 9 },
        { ax: plaza.x, az: plaza.z, bx: slip.x, bz: slip.z, r: 2.6 },
        ...hutPlacements(marks.center, plaza, field.heightAt).map((h) => ({ ax: plaza.x, az: plaza.z, bx: h.x, bz: h.z, r: 2.2 })),
      ]
    : [];
  wearTerrain(terrain, worn);
  grass.trample(worn);
  return { area, marks, slip, plaza, worn };
}
