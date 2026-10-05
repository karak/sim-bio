import { describe, it, expect } from 'vitest';
import { installProbe, type Probe } from '../../src/dev/probe';
import type { SceneInspect } from '../../src/render/inspect';
import type { ObserveInspect } from '../../src/observe/inspect';

const sceneA = { selection: () => 'a' } as unknown as SceneInspect;
const sceneB = { selection: () => 'b' } as unknown as SceneInspect;
const NO_TIME = { tick: () => 0, advance: () => {} };
const obs = { stats: () => null } as unknown as ObserveInspect;

describe('installProbe (M25-09: 試験の口は window.__probe の 1 つだけ)', () => {
  it('target に __probe だけを載せる', () => {
    const w: Record<string, unknown> = {};
    installProbe(w, { ...NO_TIME, scene: () => null, observe: () => null });
    expect(Object.keys(w)).toEqual(['__probe']);
  });

  it('読むたびに今の inspect() を返す (SceneView は島を作り直すと別のものになる)', () => {
    let scene: SceneInspect | null = null;
    const w = {} as { __probe: Probe };
    installProbe(w, { ...NO_TIME, scene: () => scene, observe: () => obs });
    expect(w.__probe.scene).toBeNull();
    scene = sceneA;
    expect(w.__probe.scene).toBe(sceneA);
    scene = sceneB;
    expect(w.__probe.scene).toBe(sceneB);
    expect(w.__probe.observe).toBe(obs);
  });

  it('書き換えられない (試験の側から差し替えて口を壊さない)', () => {
    const w = {} as { __probe: Probe };
    installProbe(w, { ...NO_TIME, scene: () => sceneA, observe: () => null });
    expect(() => {
      (w.__probe as { scene: unknown }).scene = null;
    }).toThrow();
    expect(w.__probe.scene).toBe(sceneA);
    expect(() => {
      (w as { __probe: unknown }).__probe = {};
    }).toThrow();
  });
});

describe('advanceTo (M25-02: tick N まで進める。速さの札と待ちで止めない)', () => {
  const timeSource = (start: number) => {
    let t = start;
    return { tick: () => t, advance: (n: number) => { t += n; }, now: () => t };
  };

  it('今の tick から N まで、ちょうど N - 今 tick を進める', () => {
    const time = timeSource(10);
    const w = {} as { __probe: Probe };
    installProbe(w, { scene: () => null, observe: () => null, tick: time.tick, advance: time.advance });
    w.__probe.advanceTo(400);
    expect(time.now()).toBe(400);
    w.__probe.advanceTo(400);
    expect(time.now()).toBe(400);
  });

  it('戻せない。今より小さい tick・整数でない tick は投げる', () => {
    const time = timeSource(50);
    const w = {} as { __probe: Probe };
    installProbe(w, { scene: () => null, observe: () => null, tick: time.tick, advance: time.advance });
    expect(() => w.__probe.advanceTo(49)).toThrow(/50/);
    expect(() => w.__probe.advanceTo(60.5)).toThrow();
    expect(time.now()).toBe(50);
  });

  it('島を持たないページ (試作) では投げる', () => {
    const w = {} as { __probe: Probe };
    installProbe(w, { scene: () => null, observe: () => null });
    expect(() => w.__probe.advanceTo(10)).toThrow(/口が無い/);
  });
});
