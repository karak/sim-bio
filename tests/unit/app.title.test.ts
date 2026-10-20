import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { SlotSave } from '../../src/persist/slotSave';
import { runAtTitle, type TitleEffectsDeps } from '../../src/app/title';
import type { Plan } from '../../src/app/place';
import { resumeIsland } from '../fixtures/resumeIsland';

/** タイトルで planOp の効果を行う (M24-02)。タイトルには島が無いので、新しい seed・ファイルの置き場・読む枠の名・移る先だけを行い、移る先の舞台を返す */
const island = resumeIsland('test-quick', 5);
const freeSlot: SlotSave = { stage: 'free', save: World.create(island.config, { log: createMemorySink() }).serialize() };

function setup(search = '', draws: number[] = []) {
  const calls: string[] = [];
  let q = search;
  const items = new Map<string, string>();
  const stashed: SlotSave[] = [];
  const logs: { level: string; event: string; extra: Record<string, unknown> }[] = [];
  const deps: TitleEffectsDeps = {
    store: {
      stashImport: (d) => {
        stashed.push(d);
        calls.push('stash');
        return Promise.resolve();
      },
    },
    tab: { setItem: (k, v) => void (items.set(k, v), calls.push(`set ${k}=${v}`)) },
    nav: {
      search: () => q,
      replace: (s) => {
        q = s;
        calls.push(`replace ${s}`);
      },
    },
    drawSeed: () => draws.shift() ?? 0,
    log: (level, event, extra) => void logs.push({ level, event, extra }),
  };
  return { deps, calls, items, stashed, logs, search: () => q };
}

const yes = () => Promise.resolve(true);
const no = () => Promise.resolve(false);

describe('タイトルでの効果 runAtTitle (M24-02)', () => {
  it('新しい島: 確かめを受けると、今 (42) と違う seed を引いて URL の seed= に置き、自由モードを返す。ほかの検索語は残す', async () => {
    const t = setup('?player=a', [42, 7]);
    const plan: Plan = { ask: { title: '新しい島', message: 'm', ok: 'ok' }, effects: [{ kind: 'new_world' }, { kind: 'go', scenarioId: null }] };
    expect(await runAtTitle(plan, yes, t.deps)).toEqual({ kind: 'free' });
    expect(t.search()).toBe('?player=a&seed=7');
  });

  it('確かめを断れば何もせず null (タイトルに留まる)', async () => {
    const t = setup('', [7]);
    const plan: Plan = { ask: { title: '新しい島', message: 'm', ok: 'ok' }, effects: [{ kind: 'new_world' }, { kind: 'go', scenarioId: null }] };
    expect(await runAtTitle(plan, no, t.deps)).toBeNull();
    expect(t.calls).toEqual([]);
  });

  it('ファイルの読込: 置き場 (import) に置き、読む枠の名を sessionStorage に置き、石板へ移る検索語にしてからその石板を返す', async () => {
    const t = setup('?dev=1&seed=9');
    const plan: Plan = {
      ask: { title: '舞台を移って読む', message: 'm', ok: '移って読む' },
      effects: [{ kind: 'stash_import', data: freeSlot }, { kind: 'put_pending', slot: 'import' }, { kind: 'flush' }, { kind: 'go', scenarioId: 'test-quick' }],
    };
    expect(await runAtTitle(plan, yes, t.deps)).toEqual({ kind: 'scenario', scenarioId: 'test-quick' });
    expect(t.stashed).toEqual([freeSlot]);
    expect(t.calls).toEqual(['stash', 'set biotope-pending-slot=import', 'replace ?dev=1&scenario=test-quick']);
  });

  it('枠の読込 (自由モード): 読む枠の名を置き、自由モードを返す。検索語が無ければ空のまま', async () => {
    const t = setup('');
    const plan: Plan = { ask: { title: '舞台を移って読む', message: 'm', ok: '移って読む' }, effects: [{ kind: 'put_pending', slot: 'manual-1' }, { kind: 'flush' }, { kind: 'go', scenarioId: null }] };
    expect(await runAtTitle(plan, yes, t.deps)).toEqual({ kind: 'free' });
    expect(t.items.get('biotope-pending-slot')).toBe('manual-1');
    expect(t.search()).toBe('');
  });

  it('タイトルで行えない効果 (島の差し替えなど) は記録に残して止め、null を返す', async () => {
    const t = setup('');
    const plan: Plan = { ask: null, effects: [{ kind: 'replace', save: freeSlot.save, slot: 'manual-1' }, { kind: 'go', scenarioId: null }] };
    expect(await runAtTitle(plan, yes, t.deps)).toBeNull();
    expect(t.logs).toEqual([{ level: 'warn', event: 'title.effect.unexpected', extra: { effect: 'replace' } }]);
    expect(t.calls).toEqual([]);
  });
});
