import type { LogSink } from '../core/log/types';
import type { Chronicle, Digest } from '../chronicle/chronicle';
import { digestOf } from '../chronicle/digest';
import { createPlayback, type Playback } from '../chronicle/playback';
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
import type { Runner } from '../core/runner';
import { SIM_VERSION } from '../simulation/version';
import type { Restored } from './restore';
import type { ScenarioSession, Session } from './session';
import type { Stage } from './stage';

/**
 * 石板の組み立て (M27-03)。runner・介入の年代記・石板の途中の島の自動保存を作り、判定の後の港の仕事と、石板を始め直す手順と、訪問の再生を繋ぐ。
 * 作ったものは ScenarioSession として返し、入口が Session.scenario に置く (M27-05)
 */

export type ScenarioSessionDeps = {
  session: Session;
  config: WorldConfig;
  /** 今いる舞台 (石板か訪問)。訪問 (他人の島、M19-09) では介入を受けず、年代記を記録しない */
  stage: Exclude<Stage, { kind: 'free' }>;
  /** 石板の定義。開発用の近道 (M19-16) では打ち切る年を縮めた定義 (URL だけで決まる) */
  def: ScenarioDef;
  /** 開発用の近道で判定を打ち切った (M19-16) */
  forced: boolean;
  log: LogSink;
  persistLog: SaveLog;
  store: IslandStore | null;
  markStage: () => void;
  resumed: Restored | null;
  fromSlot: boolean;
  loop: Pick<Runner, 'setSpeed'>;
  tablet: { showVerdict(verdict: Verdict, cargo?: Hold): void; hideVerdict(): void; flash(): void };
  harbor: {
    offerPublish(island: { chronicle: Chronicle; digest: Digest }): void;
    settle(island: { chronicle: Chronicle; digest: Digest }, cargo: Cargo | null): void;
    visitChronicle(): Promise<Chronicle | null>;
  };
  observe: { enter(): Promise<void> };
};

export function createScenarioSession(deps: ScenarioSessionDeps): ScenarioSession {
  const { session, config, stage, def, forced, log, persistLog, store, markStage, resumed, fromSlot, loop, tablet, harbor, observe } = deps;
  const scenario = def;
  /** 今の島の tick・年を添えた石板のログ */
  const note = (level: 'info' | 'warn', event: string, extra: Record<string, unknown>) => {
    const snap = session.world.snapshot();
    log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level, event, scenario: scenario.id, ...extra });
  };
  const newRunner = (restored?: RunnerState) => createScenarioRunner(def, session.world, {
    ticksPerYear: config.ticksPerYear,
    onVerdict: (v) => {
      loop.setSpeed(0);
      saveChronicle();
      const chronicle = recorder?.current();
      const after = afterVerdictOf(v.status, { stage: stage.kind, forced, chronicle: !!chronicle });
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
  let scenarioRunner = newRunner(resumed?.runner);
  const recorder = stage.kind === 'visit' ? null : recordChronicle(
    { dispatch: (c) => scenarioRunner.intervene(c), snapshot: () => session.world.snapshot() },
    { simVersion: SIM_VERSION, scenarioId: scenario.id, seed: config.seed },
    () => scenarioRunner.totalsByYear(),
  );
  if (recorder && resumed?.chronicle) recorder.resume(resumed.chronicle);
  // 石板の途中の島の自動保存 (M19-14) は、記録する島 (自分の島) だけ。訪問している他人の島を自分の続きとして書かない
  const autosave = recorder
    ? createScenarioAutosave({
        store,
        scenarioId: scenario.id,
        every: AUTOSAVE_TICKS,
        log: persistLog,
        from: session.world.snapshot().tick,
        capture: () => ({ save: session.world.serialize(), runner: scenarioRunner.save(), chronicle: recorder.current() }),
        onSaved: markStage,
      })
    : null;
  const saveChronicle = () => autosave?.flush();
  // 年代記の再生 (runChronicle) と同じく、クリックより前に tick 0 の評価を済ませる。最初のフレームを待つと、その前のクリックが年 0 の予定より先に入る
  scenarioRunner.update(session.world.snapshot());
  // 枠から開いた石板は、その場で石板の続きに書く (開き直してもその時点から)
  if (fromSlot) void saveChronicle();
  const restart: ScenarioSession['restart'] = (from) => {
    scenarioRunner = newRunner(from?.runner);
    // HUD のレイヤーは始め直しても変わらないので、見ている種を新しい runner にも知らせる。枠から戻した告知は読んでいないので既読にしない
    scenarioRunner.setViewedSpecies(session.viewing, { acknowledge: false });
    // 記録器は runner を scenarioRunner 越しに包むので、命令の列だけを枠の年代記 (初めからなら空) に差し替える
    recorder?.resume(from?.chronicle ?? { ...recorder.current(), commands: [] });
    scenarioRunner.update(session.world.snapshot());
    void saveChronicle();
    const verdict = scenarioRunner.verdict();
    if (verdict.status === 'running') tablet.hideVerdict();
    else {
      loop.setSpeed(0);
      tablet.showVerdict(verdict);
    }
  };
  /** 訪問の再生。港から年代記が届くまで null で、その間は島を進めない */
  let playback: Playback | null = null;
  const step = stage.kind === 'visit' ? (n?: number) => playback?.step(n) : (n?: number) => stepByYear(session.world, scenarioRunner, n);
  if (stage.kind === 'visit') {
    void harbor.visitChronicle().then((c) => {
      if (!c) return;
      playback = createPlayback(session.world, scenarioRunner, c.commands);
      loop.setSpeed(10);
      requestAnimationFrame(() => void observe.enter());
    });
  }
  return {
    get runner() {
      return scenarioRunner;
    },
    recorder,
    autosave,
    restart,
    step,
  };
}
