import type { Command, WorldSnapshot } from '../simulation/types';
import type { LogSink } from '../core/log/types';
import type { ScenarioDef } from '../scenario/types';
import { planLanding, type LandResult } from '../harbor/cargo';
import type { DrawnCargo } from '../harbor/contract';
import type { At } from './place';
import type { Session } from './session';
import type { Stage } from './stage';

/**
 * プレイヤーの介入の入口 (M27-03)。自由モードは島へそのまま、石板では年代記の記録器を通し、訪問では受けない。
 * 港の漂着 (M19-10) を浜に放つのも、同じ入口を通す
 */

export type InterveneDeps = {
  session: Session;
  /** 他人の島を訪れている (M19-09)。介入を受けない */
  stage: Stage;
  log: LogSink;
  saveChronicle: () => Promise<void> | undefined;
  /** 石板を短く揺らして、力が足りないことを知らせる */
  flash: () => void;
};

/** プレイヤーの介入はここを通す (シナリオ中は回数を数え、力が足りなければ弾く) */
export function createIntervene(deps: InterveneDeps): (c: Command) => boolean {
  const { session, log, saveChronicle } = deps;
  const toIsland = (c: Command) => {
    session.world.dispatch(c);
    return true;
  };
  // 石板の手は main.ts が介入の入口を作った後に置くので、呼ばれた時に引く
  const record = (c: Command) => {
    const recorder = session.scenario?.recorder;
    if (!recorder) return toIsland(c);
    const result = recorder.dispatch(c);
    if (result.ok) saveChronicle();
    else {
      const snap = session.world.snapshot();
      log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'cmd.rejected', reason: result.reason, cmd: c });
      if (result.reason === 'budget') deps.flash();
    }
    return result.ok;
  };
  switch (deps.stage.kind) {
    case 'free':
      return toIsland;
    case 'scenario':
      return record;
    case 'visit':
      return () => false;
  }
}

export type LandCargoDeps = {
  session: Session;
  scenario: ScenarioDef | null;
  at: () => At;
  speciesNames: Readonly<Record<string, string>>;
  intervene: (c: Command) => boolean;
  /** 石板を短く揺らして、力が足りないことを知らせる */
  flash: () => void;
  hud: { addMarker(x: number, label: string, color: string): void; showCell(cell: number, s: WorldSnapshot): void };
};

/** 受け取った漂着 (M19-10) を浜のセルに放つ。石板では放流の値段を積荷の種の数だけ先に確かめ、足りなければ 1 つも放たない */
export function createLandCargo(deps: LandCargoDeps): (d: DrawnCargo) => LandResult {
  const { session, scenario, at, speciesNames, intervene } = deps;
  return (d) => {
    const s = session.world.snapshot();
    const place = at();
    const power = session.scenario?.runner.budget()?.power;
    const spawnCost = scenario?.budget?.costs.spawn;
    const gate = { finished: place.stage === 'scenario' && place.finished, budget: power !== undefined && spawnCost !== undefined ? { power, spawnCost } : undefined };
    const landing = planLanding(d, { elevation: s.layers.elevation, size: s.size }, gate, speciesNames);
    if (landing.kind === 'budget') deps.flash();
    if (landing.kind !== 'land') return landing.kind;
    if (!landing.commands.every(intervene)) return 'refused';
    deps.hud.addMarker(s.year, landing.marker, '#8FEADF');
    // 積荷は浜の 3×3 に着くので、島の総数ではほとんど動かない (M19-15)。着いた浜のセルを選び、周辺の密度の推移で見せる
    session.selected = landing.cell;
    deps.hud.showCell(landing.cell, s);
    return 'ok';
  };
}
