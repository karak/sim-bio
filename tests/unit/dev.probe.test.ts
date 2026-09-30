import { describe, it, expect } from 'vitest';
import { installProbe, type Probe } from '../../src/dev/probe';
import type { SceneInspect } from '../../src/render/inspect';
import type { ObserveInspect } from '../../src/observe/inspect';

const sceneA = { selection: () => 'a' } as unknown as SceneInspect;
const sceneB = { selection: () => 'b' } as unknown as SceneInspect;
const obs = { stats: () => null } as unknown as ObserveInspect;

describe('installProbe (M25-09: 試験の口は window.__probe の 1 つだけ)', () => {
  it('target に __probe だけを載せる', () => {
    const w: Record<string, unknown> = {};
    installProbe(w, { scene: () => null, observe: () => null });
    expect(Object.keys(w)).toEqual(['__probe']);
  });

  it('読むたびに今の inspect() を返す (SceneView は島を作り直すと別のものになる)', () => {
    let scene: SceneInspect | null = null;
    const w = {} as { __probe: Probe };
    installProbe(w, { scene: () => scene, observe: () => obs });
    expect(w.__probe.scene).toBeNull();
    scene = sceneA;
    expect(w.__probe.scene).toBe(sceneA);
    scene = sceneB;
    expect(w.__probe.scene).toBe(sceneB);
    expect(w.__probe.observe).toBe(obs);
  });

  it('書き換えられない (試験の側から差し替えて口を壊さない)', () => {
    const w = {} as { __probe: Probe };
    installProbe(w, { scene: () => sceneA, observe: () => null });
    expect(() => {
      (w.__probe as { scene: unknown }).scene = null;
    }).toThrow();
    expect(w.__probe.scene).toBe(sceneA);
    expect(() => {
      (w as { __probe: unknown }).__probe = {};
    }).toThrow();
  });
});
