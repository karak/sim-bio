import type { Command, WorldSnapshot } from '../simulation/types';
import { judgeScenario, startStats } from './judge';
import type { ScenarioDef, StartStats, Verdict } from './types';

type RunnerWorld = { dispatch(cmd: Command): void; snapshot(): WorldSnapshot };

export type ScenarioRunner = {
  readonly def: ScenarioDef;
  /** 毎フレーム呼ぶ。予定コマンドの発火と年次判定を行う */
  update(s: WorldSnapshot): Verdict;
  /** プレイヤーの介入。回数を数えて world に流す */
  intervene(cmd: Command): void;
  /** 開始からの年 */
  yearOf(s: WorldSnapshot): number;
  verdict(): Verdict;
  interventions(): number;
};

/**
 * 石板の予言を実行する。予定コマンド (滅びの進行) を年に合わせて dispatch し、年が変わるたびに判定する。
 * 判定が確定したら以後は何もしない。
 */
export function createScenarioRunner(
  def: ScenarioDef,
  world: RunnerWorld,
  opts: { onVerdict?: (v: Verdict) => void; ticksPerYear?: number } = {},
): ScenarioRunner {
  const first = world.snapshot();
  const startTick = first.tick;
  const ticksPerYear = opts.ticksPerYear ?? 360;
  let start: StartStats = startStats(first);
  const size = first.size;
  const baselineYear = def.baselineYear ?? 0;
  const scale = size / (def.referenceSize ?? 128);
  const fired = new Set<string>();
  let lastYear = -1;
  let interventions = 0;
  let verdict: Verdict = { status: 'running', reason: `${def.years} 年` };

  const yearOf = (s: WorldSnapshot) => Math.floor((s.tick - startTick) / ticksPerYear);

  const resolve = (cmd: Command): Command => {
    let c = cmd;
    // cell = -1 は島の中心
    if ('cell' in c && c.cell === -1) c = { ...c, cell: Math.floor(size / 2) * size + Math.floor(size / 2) };
    // 半径は referenceSize 基準なので size に比例させる
    if (c.type === 'disaster') c = { ...c, radius: Math.max(0, Math.round(c.radius * scale)) };
    return c;
  };

  const fireDue = (year: number) => {
    for (const [idx, sc] of def.schedule.entries()) {
      const last = sc.untilYear ?? sc.atYear;
      for (let y = sc.atYear; y <= Math.min(year, last); y += sc.everyYears ?? Number.POSITIVE_INFINITY) {
        const key = `${idx}@${y}`;
        if (fired.has(key)) continue;
        fired.add(key);
        world.dispatch(resolve(sc.command));
        if (!sc.everyYears) break;
      }
    }
  };

  return {
    def,
    yearOf,
    interventions: () => interventions,
    verdict: () => verdict,
    intervene(cmd) {
      if (verdict.status !== 'running') return;
      interventions++;
      world.dispatch(cmd);
    },
    update(s) {
      if (verdict.status !== 'running') return verdict;
      const year = yearOf(s);
      fireDue(year);
      if (year !== lastYear) {
        lastYear = year;
        if (year === baselineYear) start = startStats(s);
        verdict = judgeScenario(def, { snapshot: s, start, year, interventions });
        if (verdict.status !== 'running') opts.onVerdict?.(verdict);
      }
      return verdict;
    },
  };
}
