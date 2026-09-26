import type { WorldSnapshot } from '../simulation/types';
import type { ScenarioRunner } from './ScenarioRunner';

type SteppableWorld = { step(n: number): void; snapshot(): WorldSnapshot };

/** シナリオ中に rAF の runner が n tick 進める入口 (M19-04)。今は本体をそのまま n tick 進めるだけ */
export function stepByYear(world: SteppableWorld, _runner: ScenarioRunner, n = 1): void {
  world.step(n);
}
