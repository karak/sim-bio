import type { ParseError } from '../core/parse';
import type { ScenarioRunner } from '../scenario/ScenarioRunner';
import { stepByYear } from '../scenario/stepByYear';
import type { WorldSnapshot } from '../simulation/types';
import type { TimedCommand } from '../harbor/chronicle';

type SteppableWorld = { step(n: number): void; snapshot(): WorldSnapshot };

export type Playback = {
  /** 判定の前だけ呼ぶ (判定の後の進め方は呼び手が決める)。命令の tick で刻みを切り、その tick で打つ */
  step(n?: number): void;
  /** 打てなかった命令があれば、その場所と理由。以後は進めない */
  broken(): ParseError | null;
};

/**
 * 訪問の再生 (M19-09)。他人の年代記の命令を、フレームの刻みに合わせて少しずつ打ち直す。
 * 順序の契約は照合の再生 (replay.ts の runChronicle) と同じ: 呼び手が生成の直後に tick 0 の評価を済ませ、
 * 命令の tick まで stepByYear で進めて (境目ちょうどなら境目の評価の後に) runner.intervene で打つ
 */
export function createPlayback(world: SteppableWorld, runner: ScenarioRunner, commands: readonly TimedCommand[]): Playback {
  let next = 0;
  let broken: ParseError | null = null;
  const applyDue = () => {
    while (broken === null && next < commands.length && commands[next].tick <= world.snapshot().tick) {
      const res = runner.intervene(commands[next].command);
      if (!res.ok) broken = { path: `commands[${next}]`, reason: `rejected:${res.reason}` };
      next += 1;
    }
  };
  return {
    step(n = 1) {
      let left = n;
      applyDue();
      while (left > 0 && broken === null && runner.verdict().status === 'running') {
        const tick = world.snapshot().tick;
        const k = Math.min(left, next < commands.length ? commands[next].tick - tick : left);
        stepByYear(world, runner, k);
        left -= k;
        applyDue();
      }
    },
    broken: () => broken,
  };
}
