import type { SceneInspect } from '../render/inspect';
import type { ObserveInspect } from '../observe/inspect';

/**
 * 試験の口 (M25-09)。E2E・調整・bench が描いている物を読む window.__probe の 1 つだけ。
 * main.ts と観察画面の試作のページは DEVTOOLS_BUILT のときだけこの module を動的に読み込むので、本番のビルドには入らない。
 * SceneView と観察画面は window に書かず inspect() を返し、ここが window に繋ぐ。読むたびに今の inspect() を引くので、島を作り直しても追いつく。
 */
export type Probe = {
  readonly scene: SceneInspect | null;
  readonly observe: ObserveInspect | null;
  /** 島を tick N まで進める (M25-02)。速さの札と待ちで止めると、止まる tick が回ごとに違って画がずれる。戻せない。進めた後の 1 フレームまで描く */
  advanceTo(tick: number): void;
};

export type ProbeSources = {
  scene(): SceneInspect | null;
  observe(): ObserveInspect | null;
  /** 島の今の tick。島を持たない試作のページには無い */
  tick?(): number;
  /** 速さに関わらずちょうど n tick 進める (Runner.advance) */
  advance?(n: number): void;
};

export function installProbe(target: object, sources: ProbeSources): void {
  const probe: Probe = {
    get scene() {
      return sources.scene();
    },
    get observe() {
      return sources.observe();
    },
    advanceTo(tick) {
      if (!sources.tick || !sources.advance) throw new Error('このページには tick を進める口が無い (島を回すのは操作画面だけ)');
      const now = sources.tick();
      if (!Number.isInteger(tick) || tick < now) throw new Error(`tick ${tick} へは進められない (今 ${now}。戻せず、整数だけ)`);
      sources.advance(tick - now);
    },
  };
  Object.defineProperty(target, '__probe', { value: probe, enumerable: true });
}
