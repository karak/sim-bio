import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { WorldSnapshot } from '../../simulation/types';
import { mulberry32 } from '../../simulation/rng';
import { extractArea, type Area, type Landmarks } from '../area';
import { K_DEFAULT, BUDGET_PER_SECOND, folkRuleFor, reconcile, targetCounts, type Targets } from '../population';
import { applyPlan, stepAgents, type AgentWorld } from '../agents';
import { createCreatureView, type CreatureView } from '../render/creatures';
import { AREA_R, OPT } from './options';
import type { Stage } from './stage';
import type { ViewState } from './state';

export type AgentLayerInput = {
  s: WorldSnapshot;
  area: Area;
  hasSettlement: boolean;
  home: number;
  marks: Landmarks;
  deerGlb: GLTF | null;
  wolfGlb: GLTF | null;
  rabbitGlb: GLTF | null;
  stage: Stage;
};

export type AgentLayer = {
  creatures: CreatureView;
  targets: Targets;
  agents: AgentWorld;
  retarget(state: ViewState): void;
  flow(state: ViewState, dt: number): void;
  step(state: ViewState, dt: number, night: boolean): void;
};

export function createAgentLayer({ s, area, hasSettlement, home, marks, deerGlb, wolfGlb, rabbitGlb, stage: { scene, shadowOnly } }: AgentLayerInput): AgentLayer {
  // 月鹿: 近い OPT.near 頭は SkinnedMesh、残りは VAT の InstancedMesh (設計 §8 の群れの LOD)
  // (M22-04 の後: 近くの振り分けと VAT は render/creatures.ts に移し、頭数は個体層が決める)
  // 個体層 (M22-04): 区域の密度 → 目標頭数 → 出入りの計画 → 状態機械。民は集落の近く (半径 3 セル) の鹿だけにする
  // (設計どおり支え半径 8 にすると区域の鹿が全部民になり、夜は全頭が灯りに寄り、飛び立ちで群れが消える。M22-04 の申し送り)
  const folk = folkRuleFor(hasSettlement ? s.civ : null, 3);
  let K = { ...K_DEFAULT };
  if (OPT.deer > 0) {
    const sum = area.cells.reduce((acc, c) => acc + (c.isLand ? (c.density['deer'] ?? 0) : 0), 0);
    if (sum > 0) K = { ...K, deer: OPT.deer / sum };
  }
  const targets = targetCounts(area, K, folk);
  // (M23-04 で変更: 近くの骨入りの個体の影は群れ LOD で落とす)
  // (M23-08 で変更: 遠い段に替える距離 OPT.cfar を渡す)
  const creatures = createCreatureView({ deer: deerGlb, wolf: wolfGlb, rabbit: rabbitGlb }, Math.max(400, targets.totals.deer * 2 + 50), (o) => shadowOnly.add(o), OPT.cfar);
  scene.add(creatures.group);
  let agents: AgentWorld = { agents: [], nextId: 1 };
  let credit = 0;
  const arng = mulberry32(23);
  // 開いた瞬間から群れが見えるよう、最初の 1 回だけ目標頭数ぶんを上限なしで出す
  {
    const plan = reconcile(agents.agents, targets, 1e6, 1, arng, 0);
    agents = applyPlan(agents, plan);
  }
  return {
    creatures,
    targets,
    agents,
    retarget(state) {
      state.area = extractArea(state.snap, home, AREA_R);
      state.targets = targetCounts(state.area, K, folkRuleFor(hasSettlement ? state.snap.civ : null, 3));
      state.building = !!state.snap.ship && state.snap.ship.launchedYear === undefined && (state.snap.civ?.stage ?? 0) >= 5;
    },
    flow(state, dt) {
      const plan = reconcile(state.agents.agents, state.targets, BUDGET_PER_SECOND, dt, arng, credit);
      credit = plan.credit;
      state.agents = applyPlan(state.agents, plan);
    },
    step(state, dt, night) {
      state.agents = stepAgents(state.agents, { area: state.area, marks, night, building: state.building, launched: false, targets: state.targets }, dt, arng);
    },
  };
}
