import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { SaveData } from '../../src/simulation/types';
import type { SaveLog } from '../../src/persist/localSave';
import { createEffects, type EffectsDeps } from '../../src/app/effects';
import { sessionOf } from '../../src/app/session';
import { testConfig } from './helpers';

const config = testConfig({ size: 16 });

/** 効果の行き先を順に残す偽物 (置き場・URL・sessionStorage・地図) */
function setup(over: Partial<EffectsDeps> = {}) {
  const calls: string[] = [];
  const logs: { level: string; event: string; tick: number; extra: Record<string, unknown> }[] = [];
  const persistLog: SaveLog = (level, event, tick, extra = {}) => logs.push({ level, event, tick, extra });
  const session = sessionOf(World.create(config, { log: createMemorySink() }), false);
  let search = '?player=ann&scenario=sinking';
  const deps: EffectsDeps = {
    session,
    scenario: null,
    config,
    seed: null,
    at: () => ({ stage: 'free' }),
    drawSeed: () => 7,
    log: createMemorySink(),
    persistLog,
    store: null,
    localSave: {
      replaced: (save) => calls.push(`replaced ${save.tick}`),
      saveSlot: async (slot) => void calls.push(`saveSlot ${slot}`),
      flush: async () => void calls.push('flush'),
    },
    saveChronicle: () => undefined,
    storage: { setItem: (k) => calls.push(`setItem ${k}`), removeItem: (k) => calls.push(`removeItem ${k}`) },
    nav: {
      search: () => search,
      go: (s) => {
        calls.push(`go ${s}`);
        search = s;
      },
      assign: (href) => calls.push(`assign ${href}`),
      replace: (s) => calls.push(`replace ${s}`),
    },
    remakeView: (size) => calls.push(`remakeView ${size}`),
    setSeed: (seed) => calls.push(`setSeed ${seed}`),
    ...over,
  };
  return { deps, session, calls, logs, effects: createEffects(deps) };
}

describe('確かめを受けた後の効果 createEffects (M27-03)', () => {
  it('refuse は persist.load.failed を残して false (残りの効果を行わない)', async () => {
    const { effects, logs, calls } = setup();
    expect(await effects.perform({ kind: 'refuse', slot: 'manual-1', tick: 120, error: 'stage' })).toBe(false);
    expect(logs).toEqual([{ level: 'warn', event: 'persist.load.failed', tick: 120, extra: { slot: 'manual-1', error: 'stage' } }]);
    expect(calls).toEqual([]);
  });

  it('replace は World.restore が拒む包みなら記録して false、島は差し替えない', async () => {
    const { effects, logs, calls, session } = setup();
    const before = session.world;
    const broken = { ...before.serialize(), version: -1 } as unknown as SaveData;
    expect(await effects.perform({ kind: 'replace', save: broken, slot: null })).toBe(false);
    expect(logs.map((l) => [l.event, l.extra.slot])).toEqual([['persist.load.failed', 'file']]);
    expect(String(logs[0].extra.error)).not.toBe('');
    expect(session.world).toBe(before);
    expect(calls).toEqual([]);
  });

  it('replace は島を差し替え、選びを解き、自動の枠に書き、seed を出す (大きさが同じなら地図は作り直さない)', async () => {
    const { effects, calls, session } = setup();
    const other = World.create({ ...config, seed: 99 }, { log: createMemorySink() });
    other.step(5);
    session.selected = 12;
    expect(await effects.perform({ kind: 'replace', save: other.serialize(), slot: 'manual-1' })).toBe(true);
    expect(session.world.seed).toBe(99);
    expect(session.selected).toBeNull();
    expect(calls).toEqual(['replaced 5', 'setSeed 99', 'replace ?player=ann&scenario=sinking&seed=99']);
  });

  it('大きさの違う島に差し替えると地図を作り直す', async () => {
    const { effects, calls } = setup();
    const bigger = World.create({ ...config, size: 24 }, { log: createMemorySink() });
    await effects.perform({ kind: 'replace', save: bigger.serialize(), slot: null });
    expect(calls[0]).toBe('remakeView 24');
  });

  it('go・assign・to_title は nav へ。to_title は先にタイトルを開く合図を置く', async () => {
    const go = setup();
    expect(await go.effects.perform({ kind: 'go', scenarioId: null })).toBe(true);
    expect(go.calls).toEqual(['go player=ann']);
    const assign = setup();
    await assign.effects.perform({ kind: 'assign', href: '/?visit=abc' });
    expect(assign.calls).toEqual(['assign /?visit=abc']);
    const title = setup();
    await title.effects.perform({ kind: 'to_title' });
    expect(title.calls).toEqual(['removeItem biotope-entered-stage', 'setItem biotope-open-title', 'assign /?player=ann']);
  });

  it('put_pending は移って読む枠を sessionStorage に置き、save_slot は今の島の包みを枠へ書く', async () => {
    const { effects, calls } = setup();
    expect(await effects.perform({ kind: 'put_pending', slot: 'manual-2' })).toBe(true);
    expect(await effects.perform({ kind: 'save_slot', slot: 'manual-3' })).toBe(true);
    expect(calls).toEqual(['setItem biotope-pending-slot', 'saveSlot manual-3']);
  });

  it('showSeed は seed を HUD に出す。URL の seed= は、初めて開いた既定の島 (42、seed= 無し) だけ揃えない。石板では URL を触らない', () => {
    const quiet = setup();
    quiet.effects.showSeed(false);
    expect(quiet.calls).toEqual(['setSeed 42']);
    const always = setup();
    always.effects.showSeed(true);
    expect(always.calls).toEqual(['setSeed 42', 'replace ?player=ann&scenario=sinking&seed=42']);
    const fromUrl = setup({ seed: 42 });
    fromUrl.effects.showSeed(false);
    expect(fromUrl.calls).toEqual(['setSeed 42', 'replace ?player=ann&scenario=sinking&seed=42']);
    const other = setup({ session: sessionOf(World.create({ ...config, seed: 7 }, { log: createMemorySink() }), false) });
    other.effects.showSeed(false);
    expect(other.calls).toEqual(['setSeed 7', 'replace ?player=ann&scenario=sinking&seed=7']);
    const inScenario = setup({ scenario: { id: 'sinking' } as EffectsDeps['scenario'] });
    inScenario.effects.showSeed(true);
    expect(inScenario.calls).toEqual(['setSeed 42']);
  });

  it('flush は手元の島と石板の続きの両方を書き終えるまで待つ', async () => {
    let releaseLocal = () => {};
    let releaseChronicle = () => {};
    const local = new Promise<void>((r) => (releaseLocal = r));
    const chronicle = new Promise<void>((r) => (releaseChronicle = r));
    const { effects } = setup({ localSave: { replaced: () => {}, saveSlot: async () => {}, flush: () => local }, saveChronicle: () => chronicle });
    let done = false;
    const p = effects.perform({ kind: 'flush' }).then((ok) => (done = ok));
    releaseLocal();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    releaseChronicle();
    await p;
    expect(done).toBe(true);
  });
});
