import type { LogSink } from '../core/log/types';
import type { Chronicle, Digest } from '../chronicle/chronicle';
import { digestOf } from '../chronicle/digest';
import { createPlayback } from '../chronicle/playback';
import { recordChronicle } from '../chronicle/recorder';
import { cargoOfHold } from '../harbor/cargo';
import type { Cargo } from '../harbor/contract';
import { afterVerdictOf } from '../harbor/dock';
import { AUTOSAVE_TICKS } from '../persist/autosave';
import type { IslandStore } from '../persist/islandStore';
import type { SaveLog } from '../persist/localSave';
import { createScenarioAutosave } from '../persist/scenarioSave';
import { createScenarioRunner, type RunnerState } from '../scenario/ScenarioRunner';
import { stepByYear } from '../scenario/stepByYear';
import type { ScenarioDef, Verdict } from '../scenario/types';
import { exportCargo, type Cargo as Hold } from '../simulation/ship';
import type { WorldConfig } from '../simulation/types';
import { SIM_VERSION } from '../simulation/version';
import type { Restored } from './restore';
import type { Session } from './session';

/**
 * 石板の組み立て (M27-03)。runner・介入の年代記・石板の途中の島の自動保存を作って Session に置き、判定の後の港の仕事と、石板を始め直す手順と、訪問の再生を繋ぐ。
 * 作ったものは Session に置くので、何も返さない
 */

export type ScenarioSessionDeps = {
  session: Session;
  config: WorldConfig;
  /** 他人の島を訪れている (M19-09)。介入を受けず、年代記を記録しない */
  visiting: boolean;
  /** 石板の定義。開発用の近道 (M19-16) では打ち切る年を縮めた定義 (URL だけで決まる) */
  def: ScenarioDef;
  /** 開発用の近道で判定を打ち切った (M19-16) */
  forced: boolean;
  log: LogSink;
  persistLog: SaveLog;
  store: IslandStore | null;
  markStage: () => void;
  saveChronicle: () => Promise<void> | undefined;
  resumed: Restored | null;
  fromSlot: boolean;
  loop: { setSpeed(speed: 0): void };
  tablet: { showVerdict(verdict: Verdict, cargo?: Hold): void; hideVerdict(): void; flash(): void };
  harbor: {
    offerPublish(island: { chronicle: Chronicle; digest: Digest }): void;
    settle(island: { chronicle: Chronicle; digest: Digest }, cargo: Cargo | null): void;
    visitChronicle(): Promise<Chronicle | null>;
  };
  observe: { enter(): Promise<void> };
};

export function createScenarioSession(deps: ScenarioSessionDeps): void {
  const { session, config, visiting, def, forced, log, persistLog, store, markStage, saveChronicle, resumed, fromSlot, loop, tablet, harbor, observe } = deps;
  const scenario = def;
  /** 今の島の tick・年を添えた石板のログ */
  const note = (level: 'info' | 'warn', event: string, extra: Record<string, unknown>) => {
    const snap = session.world.snapshot();
    log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level, event, scenario: scenario.id, ...extra });
  };
  session.scenarioStep = visiting
    ? () => {}
    : (n) => {
        if (session.runner) stepByYear(session.world, session.runner, n);
      };
  const newRunner = (restored?: RunnerState) => createScenarioRunner(def, session.world, {
    ticksPerYear: config.ticksPerYear,
    onVerdict: (v) => {
      loop.setSpeed(0);
      saveChronicle();
      const chronicle = session.recorder?.current();
      const after = afterVerdictOf(v.status, { visiting, forced, chronicle: !!chronicle });
      // 持ち出し (M10-03): escaped が確定した瞬間の snapshot から書き出す (石板のダウンロードボタンが使う)
      const hold = after.hold ? exportCargo(session.world.snapshot()) : undefined;
      tablet.showVerdict(v, hold);
      // 空の舟の積荷 (M19-10) は持ち出しと同じ瞬間の snapshot から作り、港に流す
      const cargo = after.harbor?.cargo && hold ? cargoOfHold(hold) : null;
      if (chronicle && after.harbor) {
        void digestOf(session.world.snapshot(), after.harbor.status).then((digest) => {
          harbor.offerPublish({ chronicle, digest });
          harbor.settle({ chronicle, digest }, cargo);
        });
      }
      note('info', `scenario.${v.status}`, { reason: v.reason });
    },
    onWarning: (w) => note('warn', 'scenario.warning', { kind: w.kind, id: w.id, text: w.text }),
    onPrayer: (e) => note('info', 'scenario.prayer', { phase: e.phase, kind: e.prayer }),
    onPowerExhausted: () => {
      tablet.flash();
      note('warn', 'scenario.power.exhausted', {});
    },
  }, restored);
  session.runner = newRunner(resumed?.runner);
  let scenarioRunner = session.runner;
  session.recorder = visiting ? null : recordChronicle(
    { dispatch: (c) => scenarioRunner.intervene(c), snapshot: () => session.world.snapshot() },
    { simVersion: SIM_VERSION, scenarioId: scenario.id, seed: config.seed },
    () => scenarioRunner.totalsByYear(),
  );
  // 石板の途中の島の自動保存 (M19-14) は、記録する島 (自分の島) だけ。訪問している他人の島を自分の続きとして書かない
  const scenarioRecorder = session.recorder;
  if (scenarioRecorder) {
    if (resumed?.chronicle) scenarioRecorder.resume(resumed.chronicle);
    session.scenarioAutosave = createScenarioAutosave({
      store,
      scenarioId: scenario.id,
      every: AUTOSAVE_TICKS,
      log: persistLog,
      from: session.world.snapshot().tick,
      capture: () => ({ save: session.world.serialize(), runner: scenarioRunner.save(), chronicle: scenarioRecorder.current() }),
      onSaved: markStage,
    });
  }
  // 年代記の再生 (runChronicle) と同じく、クリックより前に tick 0 の評価を済ませる。最初のフレームを待つと、その前のクリックが年 0 の予定より先に入る
  scenarioRunner.update(session.world.snapshot());
  // 枠から開いた石板は、その場で石板の続きに書く (開き直してもその時点から)
  if (fromSlot) void saveChronicle();
  session.restartScenario = (from) => {
    session.runner = scenarioRunner = newRunner(from?.runner);
    // HUD のレイヤーは始め直しても変わらないので、見ている種を新しい runner にも知らせる。枠から戻した告知は読んでいないので既読にしない
    scenarioRunner.setViewedSpecies(session.viewing, { acknowledge: false });
    // 記録器は runner を scenarioRunner 越しに包むので、命令の列だけを枠の年代記 (初めからなら空) に差し替える
    scenarioRecorder?.resume(from?.chronicle ?? { ...scenarioRecorder.current(), commands: [] });
    scenarioRunner.update(session.world.snapshot());
    void saveChronicle();
    const verdict = scenarioRunner.verdict();
    if (verdict.status === 'running') tablet.hideVerdict();
    else {
      loop.setSpeed(0);
      tablet.showVerdict(verdict);
    }
  };
  if (visiting) {
    void harbor.visitChronicle().then((c) => {
      if (!c) return;
      session.scenarioStep = createPlayback(session.world, scenarioRunner, c.commands).step;
      document.getElementById('speed-10')?.click();
      requestAnimationFrame(() => void observe.enter());
    });
  }
}
