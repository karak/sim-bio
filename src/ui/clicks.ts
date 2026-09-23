import type { Command, DisasterKind } from '../simulation/types';

/**
 * 災害の半径 (セル)。山火事は 1 点着火で延焼に任せる。
 * 疫病は 4 のまま (M10R-07): 祈りに応えるなの狼の波は谷 (集落から 13 セル、環 3) に落ち、谷への疫病 環 4 で波の 3 か月後まで追える
 * (LD 2026-09-22-level-design-faith-economy.md §8.10。集落に落とす環 6 の波は環 6 の疫病でも波と同じ tick でしか効かず、UI では打てなかった)
 */
export const DISASTER_RADIUS: Record<DisasterKind, number> = { meteor: 4, volcano: 4, wildfire: 0, plague: 4 };
/** 種を放つときに各セルへ加える密度 */
export const SPAWN_AMOUNT = 0.5;
/** 1 セルだけだと見えにくいので半径 1 (3×3 相当) に放つ。1 コマンドなので値段も 1 回分 */
export const SPAWN_RADIUS = 1;

/**
 * プレイヤーの 1 クリックが出すコマンド。通し実行 (tests/slow) の台本もこれで打ち、手で再現できない想定解を作らない (M21-01)。
 * ScenarioRunner の値段は半径に依らないので、台本だけ大きな環で放つと同じ値段で UI の何倍もの量になる
 */
export const spawnClick = (speciesId: string, cell: number): Command => ({ type: 'spawn_species', speciesId, cell, amount: SPAWN_AMOUNT, radius: SPAWN_RADIUS });
export const disasterClick = (kind: DisasterKind, cell: number): Command => ({ type: 'disaster', kind, cell, radius: DISASTER_RADIUS[kind] });
