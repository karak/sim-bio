import { World } from '../simulation/World';
import type { LogSink } from '../core/log/types';
import type { Chronicle, ChronicleHead } from '../chronicle/chronicle';
import type { RunnerState } from '../scenario/ScenarioRunner';
import type { IslandStore } from '../persist/islandStore';
import type { LocalSave, SaveLog } from '../persist/localSave';
import { resumeScenario } from '../persist/scenarioSave';
import { checkSlot, type Here, type SlotSave } from '../persist/slotSave';
import type { PendingSlot } from '../persist/slots';
import { seedMatches, type Restore } from './place';

/**
 * 起動の島の戻し方 (M27-03)。bootPlanOf の restore を並びどおりに試し、最初に戻せた島を返す。
 * どの置き場から戻すかは app/place.ts が決め、ここは置き場を読んで World に戻すだけ
 */

/** 置き場から戻した島。石板なら runner の状態と年代記も持つ (続きからの復帰 M19-14 と、枠の読込 M19-17) */
export type Restored = { world: World; runner?: RunnerState; chronicle?: Chronicle };

export type RestoreDeps = {
  localSave: Pick<LocalSave, 'loadSlot' | 'resume'>;
  store: IslandStore | null;
  /** 石板の島の頭。自由モードでは null。訪問でも石板の頭が来るが、訪問では戻す並び (order) が空なので効かない */
  head: ChronicleHead | null;
  log: LogSink;
  persistLog: SaveLog;
  /** URL の seed= (M26-10)。自動の枠の続きは、この seed の島だけ戻す */
  seed: number | null;
  /** 違う舞台の枠を読むために移ってきたときの枠 (M19-17 §4) */
  pending: PendingSlot | null;
};

/** fromSlot は枠から戻したとき (その場で自動の枠と石板の続きに書き直す) */
export async function restoreIsland(order: readonly Restore[], deps: RestoreDeps): Promise<{ resumed: Restored | null; fromSlot: boolean }> {
  const { localSave, store, head, log, persistLog } = deps;
  const here: Here = head ? { stage: 'scenario', head } : { stage: 'free' };
  /** 枠とファイルの包みを、今の舞台の島 (石板なら runner の状態と年代記も) に戻す (M19-17)。違う舞台・読めない包みは投げる */
  const openSlot = (data: SlotSave): Restored => {
    const checked = checkSlot(data, here);
    if (!checked.ok) throw new Error(checked.reason);
    const s = checked.value;
    const world = World.restore(s.save, { log });
    return s.stage === 'scenario' ? { world, runner: s.runner, chronicle: s.chronicle } : { world };
  };
  const restoreFrom = async (r: Restore): Promise<Restored | null> => {
    switch (r.from) {
      case 'slot':
        // 違う舞台の枠を読むために移ってきた (M19-17 §4)。読めなければ、この舞台の自動の続きで開く。訪問では読まない
        return localSave.loadSlot(r.slot, openSlot);
      case 'scenario':
        // 石板の途中で閉じた島の続き (M19-14): 島・runner の状態・年代記を戻す。無い・判定の出た石板・読めない続きなら石板の初めから。
        // 訪問 (M19-09) では戻さない (他人の島を訪れているので、自分の続きを差し込まない)
        return head
          ? resumeScenario({ store, head, log: persistLog }, (s) => ({
              world: World.restore(s.save, { log }),
              runner: s.runner,
              chronicle: s.chronicle,
            }))
          : null;
      case 'auto':
        // 閉じる前の続きから (M19-05)
        return localSave.resume(
          (save) => ({ world: World.restore(save, { log }) }),
          (save) => seedMatches(deps.seed, save.config.seed),
        );
    }
  };
  let found: { resumed: Restored; fromSlot: boolean } | null = null;
  for (const r of order) {
    const resumed = await restoreFrom(r);
    if (resumed) {
      found = { resumed, fromSlot: r.from === 'slot' };
      break;
    }
  }
  if (deps.pending && !found?.fromSlot) persistLog('warn', 'persist.slot.load.failed', 0, { slot: deps.pending });
  return found ?? { resumed: null, fromSlot: false };
}
