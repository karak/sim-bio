import type { WorldSnapshot } from '../simulation/types';
import type { ScenarioRunner } from './ScenarioRunner';

type SteppableWorld = { step(n: number): void; snapshot(): WorldSnapshot };

/**
 * シナリオ中に n tick 進める (M19-04、設計書 2026-09-26-cloudflare-architecture.md §1.3 C6)。
 * 1 回の world.step は年の境目を越えない。境目に着くたびに、その snapshot で runner.update を呼ぶ。
 * 予定コマンドが本体に入る tick と年次評価 (力の増減・警告・判定) の snapshot が、tests/slow の台本と同じく
 * 境目ちょうどになり、速度とフレームの間隔に依らなくなる。
 * 判定が出たらそこで止まり、判定の後に呼ばれても進めない (判定の後も島を回すかは呼び手が決める)
 */
export function stepByYear(world: SteppableWorld, runner: ScenarioRunner, n = 1): void {
  let left = n;
  while (left > 0 && runner.verdict().status === 'running') {
    const toYear = runner.ticksToNextYear(world.snapshot());
    const k = Math.min(left, toYear);
    world.step(k);
    left -= k;
    if (k === toYear) runner.update(world.snapshot());
  }
}
