import type { WorldSnapshot } from '../simulation/types';
import type { ScenarioRunner } from './ScenarioRunner';

type SteppableWorld = { step(n: number): void; snapshot(): WorldSnapshot };

/**
 * シナリオ中に rAF の runner が n tick 進める入口 (M19-04、設計書 2026-09-26-cloudflare-architecture.md §1.3 C6)。
 * 1 回の world.step は年の境目を越えない。境目に着くたびに、その snapshot で runner.update を呼ぶ。
 * tests/slow の台本 (年の境目ごとに update → 1 年分 step) と同じ刻みになり、予定コマンドが本体に入る tick と
 * 年次評価 (力の増減・警告・判定) の snapshot が、速度とフレームの間隔に依らなくなる。
 * 判定が出たら残りの tick は進めない (島は判定の年の境目で止まる)。判定の後に呼ばれたら、そのまま n tick 進める
 */
export function stepByYear(world: SteppableWorld, runner: ScenarioRunner, n = 1): void {
  if (runner.verdict().status !== 'running') {
    world.step(n);
    return;
  }
  let left = n;
  while (left > 0) {
    const toYear = runner.ticksToNextYear(world.snapshot());
    const k = Math.min(left, toYear);
    world.step(k);
    left -= k;
    if (k === toYear && runner.update(world.snapshot()).status !== 'running') return;
  }
}
