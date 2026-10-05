import type { ScenarioStatus } from '../scenario/types';
import type { ChronicleCard } from './contract';

/**
 * 港の口の判断 (M21-07)。判定の後に港へ出すもの・港の口に並べる判定の出た島・石碑の札を、DOM から離して決める
 */

/** 判定の出た島。chronicle は年代記を記録している (自分の石板の島) か、forced は開発の板の近道で出した判定か (本番のビルドに近道の名を残さない) */
export type VerdictAt = { visiting: boolean; forced: boolean; chronicle: boolean };

/** hold は持ち出しを書き出すか。harbor は港へ出す (出港・回避率) ときの結末と、積荷を流すか (cargo) */
export type AfterVerdict = { hold: boolean; harbor: { status: Exclude<ScenarioStatus, 'running'>; cargo: boolean } | null };

export function afterVerdictOf(status: ScenarioStatus, at: VerdictAt): AfterVerdict {
  const escaped = status === 'escaped';
  if (status === 'running' || !at.chronicle || at.visiting || at.forced) return { hold: escaped, harbor: null };
  return { hold: escaped, harbor: { status, cargo: escaped } };
}

/** scenarioId は自分の島の石板 (自由モードと訪問では null) */
export function finishedScopeOf<S extends { id: string; title: string }>(scenarios: readonly S[], at: { visiting: boolean; scenarioId: string | null }): { def: S; label: string }[] {
  // 石板ではその石板の島だけ。自由モードの港の口には、どの石板の判定の出た島も並べる (M19-15、石板を選び直さなくても港へ出せる)。訪問では並べない
  const scope = at.visiting ? [] : scenarios.filter((d) => at.scenarioId === null || d.id === at.scenarioId);
  return scope.map((def) => ({ def, label: at.scenarioId ? 'この石板で最後に判定の出た島' : `『${def.title}』で最後に判定の出た島` }));
}

export type CardActions = { visit: boolean; withdraw: boolean; report: true };

/** 石碑の札。版違いの島は回し直せないので訪れる札を出さない。own は自分が出港した島か */
export function cardActionsOf(card: Pick<ChronicleCard, 'simVersion'>, at: { simVersion: string; own: boolean }): CardActions {
  return { visit: card.simVersion === at.simVersion, withdraw: at.own, report: true };
}
