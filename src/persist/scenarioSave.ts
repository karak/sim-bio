import type { Parsed } from '../core/parse';
import type { Chronicle, ChronicleHead } from '../harbor/chronicle';
import { runnerStateMismatch, type RunnerState } from '../scenario/ScenarioRunner';
import type { SaveData } from '../simulation/types';
import type { IslandStore, ScenarioSave } from './islandStore';
import type { SaveLog } from './localSave';

/**
 * 石板の途中で閉じた島の続き (M19-14)。開き直したら、閉じる前に書いた島・runner の状態・年代記の 3 つから続ける。
 * 「シナリオ中の読込は予言と矛盾するので無効」(main.ts) は、別の島を石板の途中に差し込むことを禁じる規則。
 * ここで戻すのは同じ石板・同じ島の同じ tick の続きなので、その規則とは矛盾しない (閉じずに回した結末と同じになる)
 */

/**
 * 閉じる前の続きを読む。無い・判定の出た石板は null (石板の初めから)。
 * 読めない続き (年代記が壊れている・版や石板や seed が違う・restore が投げる) は脇へ退けて null を返し、記録に残す
 */
export async function resumeScenario<W>(deps: { store: IslandStore | null; head: ChronicleHead; log: SaveLog }, restore: (s: ScenarioSave) => W): Promise<W | null> {
  const { store, head, log } = deps;
  if (!store) return null;
  const loaded = await store.loadScenario(head.scenarioId).catch((e: unknown) => {
    log('warn', 'persist.scenario.load.failed', 0, { error: String(e) });
    return null;
  });
  if (!loaded) return null;
  const { save, runner } = loaded;
  const setAside = async (reason: string) => {
    const key = await store.setAsideScenario(head.scenarioId).catch((err: unknown) => `failed: ${String(err)}`);
    log('warn', 'persist.scenario.resume.failed', save.tick, { reason, setAside: key });
    return null;
  };
  const checked = checkScenarioSave(loaded, head);
  if (!checked.ok) return setAside(checked.reason);
  const c = checked.value.chronicle;
  // 判定の出た石板は終わっている。開き直したら次の挑戦 (石板の初め) にする。年代記は港への出港のために残る
  if (runner.verdict.status !== 'running') {
    log('info', 'persist.scenario.finished', save.tick, { status: runner.verdict.status });
    return null;
  }
  try {
    const w = restore({ save, runner, chronicle: c });
    log('info', 'persist.scenario.resumed', save.tick, { scenario: head.scenarioId });
    return w;
  } catch (e) {
    return setAside(String(e));
  }
}

/** 石板の島・runner の状態・年代記が、この版・この石板・この seed のものか。続きからの復帰と枠の読込 (M19-17) が同じ確かめを通す */
export function checkScenarioSave(s: { save: SaveData; runner: RunnerState; chronicle: Parsed<Chronicle> }, head: ChronicleHead): { ok: true; value: ScenarioSave } | { ok: false; reason: string } {
  const { chronicle } = s;
  if (!chronicle.ok) return { ok: false, reason: `chronicle: ${chronicle.error.path} ${chronicle.error.reason}` };
  const c = chronicle.value;
  if (c.simVersion !== head.simVersion || c.scenarioId !== head.scenarioId || c.seed !== head.seed) return { ok: false, reason: 'chronicle head differs' };
  const mismatch = runnerStateMismatch(s.runner, head.scenarioId);
  if (mismatch) return { ok: false, reason: mismatch };
  return { ok: true, value: { save: s.save, runner: s.runner, chronicle: c } };
}

export type ScenarioAutosave = {
  /** 毎フレーム。自由モードの自動保存 (localSave.onTick) と同じ周期で、書き込み中は次を書かない */
  onTick(tick: number): void;
  /** 周期を待たずに書く: 受理された介入の後・判定のとき・タブが隠れたとき */
  flush(): Promise<void>;
};

/** 石板の途中の島を書く。capture は島・runner・年代記を同じ tick で取る。from は数え始める tick (開き直した島ならその tick) */
// (M24-05) onSaved は書き終えたとき (最後に遊んだ舞台の印を書く、persist/lastStage.ts)
export function createScenarioAutosave(deps: {
  store: IslandStore | null;
  scenarioId: string;
  every: number;
  log: SaveLog;
  from: number;
  capture: () => ScenarioSave;
  onSaved?: () => void;
}): ScenarioAutosave {
  const { store, log } = deps;
  let last = deps.from;
  let writing = false;
  const write = (s: IslandStore) => {
    const captured = deps.capture();
    const { tick } = captured.save;
    last = tick;
    writing = true;
    return s
      .saveScenario(deps.scenarioId, captured)
      .then(
        () => {
          log('info', 'persist.scenario.saved', tick, { scenario: deps.scenarioId });
          deps.onSaved?.();
        },
        (e: unknown) => log('warn', 'persist.scenario.save.failed', tick, { scenario: deps.scenarioId, error: String(e) }),
      )
      .finally(() => {
        writing = false;
      });
  };
  return {
    onTick(tick) {
      if (!store || writing || tick - last < deps.every) return;
      void write(store);
    },
    flush() {
      return store ? write(store) : Promise.resolve();
    },
  };
}
