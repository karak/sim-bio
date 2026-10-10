import type { World } from '../simulation/World';
import type { Chronicle } from '../chronicle/chronicle';
import type { ChronicleRecorder } from '../chronicle/recorder';
import type { InterveneResult, RunnerState, ScenarioRunner } from '../scenario/ScenarioRunner';
import { stepByYear } from '../scenario/stepByYear';
import type { ScenarioAutosave } from '../persist/scenarioSave';

/**
 * 起動から閉じるまでに差し替わる島の状態 (M27-03)。main.ts の let をここに 1 つにまとめ、src/app の部品 (効果・介入・石板) が同じものを読み書きする
 */
export type Session = {
  world: World;
  /** 地図で選んだセル。島を差し替えたら解く */
  selected: number | null;
  runner: ScenarioRunner | null;
  /** シナリオ中の介入の年代記 (M19-06)。runner と一緒に作り、runner.intervene を包む */
  recorder: ChronicleRecorder<InterveneResult> | null;
  /** 石板の途中の島の自動保存 (M19-14)。runner と一緒に作る */
  scenarioAutosave: ScenarioAutosave | null;
  /** 石板を今の島で始め直す (M19-17)。枠を読んだとき (枠の runner の状態と年代記から) と、石板を初めからにしたとき。石板を開いたときに作る */
  restartScenario: (from: { runner: RunnerState; chronicle: Chronicle } | null) => void;
  /** 判定の前の石板の島の進め方。訪問では港から年代記が届くまで止め、届いたら記録の tick で打ち直す (M19-09) */
  scenarioStep: (n?: number) => void;
  /** 直近に知らせた見ている種。石板を始め直したとき (restartScenario) に新しい runner へ渡し直す */
  viewing: string | null;
};

export function sessionOf(world: World, visiting: boolean): Session {
  const session: Session = {
    world,
    selected: null,
    runner: null,
    recorder: null,
    scenarioAutosave: null,
    restartScenario: () => {},
    scenarioStep: visiting
      ? () => {}
      : (n) => {
          if (session.runner) stepByYear(session.world, session.runner, n);
        },
    viewing: null,
  };
  return session;
}
