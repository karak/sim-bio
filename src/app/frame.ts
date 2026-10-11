import type { WorldSnapshot } from '../simulation/types';
import type { PrayerKind } from '../simulation/prayer';
import { TOWER_COST } from '../simulation/weatherTower';
import type { BudgetInfo, TimelineEvent } from '../scenario/ScenarioRunner';
import type { ScenarioDef, Verdict } from '../scenario/types';
import type { Warning } from '../scenario/warnings';
import type { LocalSave } from '../persist/localSave';
import type { Session } from './session';

/**
 * 毎フレームの配り (M27-03)。島の snapshot を自動保存・観察画面・地図・HUD・石板へ渡し、石板の判定と星の力で買えるチップを揃える
 */

export type FrameDeps = {
  session: Session;
  scenario: ScenarioDef | null;
  localSave: Pick<LocalSave, 'onTick'>;
  viewedSpecies: { setObserving(on: boolean): void };
  observe: { active(): boolean; push(s: WorldSnapshot, timeline?: readonly TimelineEvent[]): void };
  /** 今の地図。島の大きさが変わると作り直されるので、フレームのたびに引く */
  view: () => { setSelected(cell: number | null): void; update(s: WorldSnapshot): void };
  hud: {
    update(s: WorldSnapshot): void;
    setNextMeteor(year: number | null): void;
    showCell(cell: number | null, s: WorldSnapshot): void;
    setAffordable(a: { spawn: boolean; disaster: boolean; climate: boolean; tower: boolean }): void;
  };
  tablet: {
    update(
      year: number,
      verdict: Verdict,
      budget: BudgetInfo | null,
      warnings: Warning[],
      timeline: TimelineEvent[],
      prayer: { kind: PrayerKind; yearsLeft: number } | null,
      milestones: { atYear: number; text: string }[],
    ): void;
  };
};

/** 自由モードと、予算の無い石板では、どのチップも買える */
const ALL_AFFORDABLE = { spawn: true, disaster: true, climate: true, tower: true } as const;

export function createOnFrame(deps: FrameDeps): (s: WorldSnapshot) => void {
  const { session, scenario, localSave, viewedSpecies, observe, hud, tablet } = deps;
  return (s) => {
    const view = deps.view();
    localSave.onTick(s.tick, () => session.world.serialize());
    session.scenario?.autosave?.onTick(s.tick);
    // 観察画面の間は地図を描かないので、種を選んでいても見ていないとみなす
    viewedSpecies.setObserving(observe.active());
    observe.push(s, session.scenario?.runner.timeline());
    // 選んだセルを 3D の島の上でも示す (M22-10)。選びを解けば (selected = null) 消える
    view.setSelected(session.selected);
    if (!observe.active()) view.update(s);
    hud.update(s);
    // 迎撃の行を畳む判定 (M21-02 D4) に使う。自由モードでは runner が無いので常に null (行は常に隠れる)
    hud.setNextMeteor(session.scenario?.runner.nextMeteorYear() ?? null);
    if (session.selected !== null) hud.showCell(session.selected, s);
    const runner = session.scenario?.runner;
    if (!runner) {
      hud.setAffordable(ALL_AFFORDABLE);
      return;
    }
    const verdict = runner.update(s);
    const budgetInfo = runner.budget();
    tablet.update(runner.yearOf(s), verdict, budgetInfo, runner.warnings(), runner.timeline(), runner.prayer(), runner.milestones());
    const costs = scenario?.budget?.costs;
    hud.setAffordable(
      budgetInfo && costs
        ? {
            spawn: budgetInfo.power >= costs.spawn,
            disaster: budgetInfo.power >= costs.disaster,
            climate: budgetInfo.power >= costs.climate,
            tower: budgetInfo.power >= (costs.tower ?? TOWER_COST),
          }
        : ALL_AFFORDABLE,
    );
  };
}
