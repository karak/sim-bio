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
};

export type ProbeSources = {
  scene(): SceneInspect | null;
  observe(): ObserveInspect | null;
};

export function installProbe(target: object, sources: ProbeSources): void {
  const probe: Probe = {
    get scene() {
      return sources.scene();
    },
    get observe() {
      return sources.observe();
    },
  };
  Object.defineProperty(target, '__probe', { value: probe, enumerable: true });
}
