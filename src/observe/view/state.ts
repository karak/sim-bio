import type { WorldSnapshot } from '../../simulation/types';
import type { TimelineEvent } from '../../scenario/ScenarioRunner';
import type { Area } from '../area';
import type { AgentWorld } from '../agents';
import type { Targets } from '../population';
import type { DirectorState } from '../director';

/** 観察画面の部品 (view/*.ts) が組んだ後も書き換え、ほかの部品が読む値。1 つの置き場に集め、部品ごとに写しを持たない */
export type ViewState = {
  snap: WorldSnapshot;
  area: Area;
  targets: Targets;
  building: boolean;
  agents: AgentWorld;
  simSpeed: number;
  director: DirectorState;
  touched: boolean;
  followId: number | null;
  departLeft: number;
  newEvents: TimelineEvent[];
  seenEvents: number;
  baseline: boolean;
};
