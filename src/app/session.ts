import type { World } from '../simulation/World';
import type { Chronicle } from '../chronicle/chronicle';
import type { ChronicleRecorder } from '../chronicle/recorder';
import type { InterveneResult, RunnerState, ScenarioRunner } from '../scenario/ScenarioRunner';
import type { ScenarioAutosave } from '../persist/scenarioSave';

/**
 * 起動から閉じるまでに差し替わる島の状態 (M27-03)。main.ts の let をここに 1 つにまとめ、src/app の部品 (効果・介入・石板) が同じものを読み書きする
 */
export type Session = {
  world: World;
  /** 地図で選んだセル。島を差し替えたら解く */
  selected: number | null;
  /** 石板の手。自由モードでは null。石板を開くとき (createScenarioSession) に作り、main.ts が置く */
  scenario: ScenarioSession | null;
  /** 直近に知らせた見ている種。石板を始め直したとき (restartScenario) に新しい runner へ渡し直す */
  viewing: string | null;
};

/** 石板を開くときに一緒に作る手 (M27-05)。年代記と自動保存は自分の石板だけ持ち、訪問では null */
export type ScenarioSession = {
  /** 石板を始め直すと差し替わる */
  runner: ScenarioRunner;
  /** シナリオ中の介入の年代記 (M19-06)。runner と一緒に作り、runner.intervene を包む */
  recorder: ChronicleRecorder<InterveneResult> | null;
  /** 石板の途中の島の自動保存 (M19-14)。runner と一緒に作る */
  autosave: ScenarioAutosave | null;
  /** 石板を今の島で始め直す (M19-17)。枠を読んだとき (枠の runner の状態と年代記から) と、石板を初めからにしたとき。石板を開いたときに作る */
  restart(from: { runner: RunnerState; chronicle: Chronicle } | null): void;
  /** 判定の前の石板の島の進め方。訪問では港から年代記が届くまで止め、届いたら記録の tick で打ち直す (M19-09)。石板を開いたときに作る */
  step(n?: number): void;
};

export function sessionOf(world: World): Session {
  return { world, selected: null, scenario: null, viewing: null };
}
