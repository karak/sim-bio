import type { ChronicleId } from '../harbor/contract';
import type { ScenarioDef } from '../scenario/types';

/**
 * 起動で決まる舞台 (M27-05)。開いている間は変わらない。各部品はこれを受けて自分の振る舞いを選ぶ。
 * 判定が出ているかなど、走っている間に変わる今の舞台は app/place.ts の At (atOf がこれから射影する)
 */
export type Stage = { kind: 'free' } | { kind: 'scenario'; def: ScenarioDef } | { kind: 'visit'; id: ChronicleId; def: ScenarioDef };

export function stageOf(plan: { scenario: ScenarioDef | null; visitId: ChronicleId | null }): Stage {
  if (!plan.scenario) return { kind: 'free' };
  return plan.visitId ? { kind: 'visit', id: plan.visitId, def: plan.scenario } : { kind: 'scenario', def: plan.scenario };
}
