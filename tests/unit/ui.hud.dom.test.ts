// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getByRole } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { createHud, type Chip, type HudHandlers } from '../../src/ui/Hud';
import type { Speed } from '../../src/core/runner';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { resumeIsland } from '../fixtures/resumeIsland';

/**
 * HUD を部品として組む (M27-05)。持っているチップ (災害・放流・気象塔) は HUD が 1 つの値で持つ。札を押して、値・見た目・main.ts への知らせを確かめる
 */

const island = resumeIsland('test-quick', 5);

/** happy-dom は canvas の 2d を持たない。グラフの描きは見ないので、何を呼んでも何もしない 2d を返す */
const noopContext = (): CanvasRenderingContext2D => {
  const fn = () => undefined;
  return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : fn), set: () => true }) as unknown as CanvasRenderingContext2D;
};

function mount() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noopContext()) as unknown as HTMLCanvasElement['getContext']);
  const root = document.createElement('div');
  document.body.append(root);
  const onArm = vi.fn<(c: Chip | null) => void>();
  /** loop の速さ。札を押すと onSpeed で loop に言い、HUD は loop の速さを追う */
  const loop = { speed: 1 as Speed };
  const handlers = {
    onCommand: () => undefined,
    onSpeed: (s: Speed) => {
      loop.speed = s;
    },
    onLayer: () => undefined,
    onSave: () => ({}) as ReturnType<HudHandlers['onSave']>,
    onLoad: () => undefined,
    onSlotSave: () => undefined,
    onSlotLoad: () => undefined,
    onNewIsland: () => undefined,
    onTitle: () => undefined,
    onArm,
  } satisfies HudHandlers;
  const hud = createHud(root, handlers, { speed: () => loop.speed });
  const snap = World.create(island.config, { log: createMemorySink() }).snapshot();
  hud.update(snap);
  const firstSpawn = snap.species.find((d) => d.spawnable !== false)!;
  return { root, hud, onArm, firstSpawn, loop, snap };
}

const armed = (root: HTMLElement) => [...root.querySelectorAll('.armed')].map((b) => b.id);
const hint = (root: HTMLElement, id: string) => (root.querySelector(`#${id}`) as HTMLElement).hidden;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('HUD の持っているチップ (M27-05 段 4)', () => {
  it('災害・放流・気象塔の札は互いに排他。持ち替えると前の札は外れ、HUD は 1 つのチップを持つ', async () => {
    const { root, hud, onArm, firstSpawn } = mount();
    const user = userEvent.setup();
    expect(hud.chip()).toBeNull();

    await user.click(getByRole(root, 'button', { name: '火山' }));
    expect(hud.chip()).toEqual({ kind: 'disaster', disaster: 'volcano' });
    expect(armed(root)).toEqual(['disaster-volcano']);
    expect(hint(root, 'volcano-hint')).toBe(false);
    expect(onArm).toHaveBeenLastCalledWith({ kind: 'disaster', disaster: 'volcano' });

    await user.click(root.querySelector(`#spawn-${firstSpawn.id}`)!);
    expect(hud.chip()).toEqual({ kind: 'spawn', speciesId: firstSpawn.id });
    expect(armed(root)).toEqual([`spawn-${firstSpawn.id}`]);
    expect(hint(root, 'volcano-hint')).toBe(true);
    expect(onArm).toHaveBeenLastCalledWith({ kind: 'spawn', speciesId: firstSpawn.id });

    await user.click(getByRole(root, 'button', { name: '気象塔' }));
    expect(hud.chip()).toEqual({ kind: 'tower' });
    expect(armed(root)).toEqual(['tower-chip']);
    expect(hint(root, 'tower-hint')).toBe(false);

    await user.click(getByRole(root, 'button', { name: '隕石' }));
    expect(hud.chip()).toEqual({ kind: 'disaster', disaster: 'meteor' });
    expect(armed(root)).toEqual(['disaster-meteor']);
    expect(hint(root, 'tower-hint')).toBe(true);
    expect(hint(root, 'volcano-hint')).toBe(true);
  });

  it('同じ札をもう一度押すと放し、何も持たない', async () => {
    const { root, hud, onArm } = mount();
    const user = userEvent.setup();
    await user.click(getByRole(root, 'button', { name: '気象塔' }));
    await user.click(getByRole(root, 'button', { name: '気象塔' }));
    expect(hud.chip()).toBeNull();
    expect(armed(root)).toEqual([]);
    expect(hint(root, 'tower-hint')).toBe(true);
    expect(onArm).toHaveBeenLastCalledWith(null);
  });

  it('同じ種類のチップの持ち替え (火山から隕石、放流の種 A から種 B) は、放さず新しい方を持つ', async () => {
    const { root, hud, onArm, snap } = mount();
    const user = userEvent.setup();
    await user.click(root.querySelector('#disaster-volcano')!);
    await user.click(root.querySelector('#disaster-meteor')!);
    expect(hud.chip()).toEqual({ kind: 'disaster', disaster: 'meteor' });
    expect(armed(root)).toEqual(['disaster-meteor']);
    expect(onArm).toHaveBeenLastCalledWith({ kind: 'disaster', disaster: 'meteor' });

    const [a, b] = snap.species.filter((d) => d.spawnable !== false);
    expect(b).toBeDefined();
    await user.click(root.querySelector(`#spawn-${a.id}`)!);
    await user.click(root.querySelector(`#spawn-${b.id}`)!);
    expect(hud.chip()).toEqual({ kind: 'spawn', speciesId: b.id });
    expect(armed(root)).toEqual([`spawn-${b.id}`]);
    expect(onArm).toHaveBeenLastCalledWith({ kind: 'spawn', speciesId: b.id });
  });

  it('setChip (地図のクリックで使い終えた時) で外から放すと、見た目も揃え、main.ts に知らせる', async () => {
    const { root, hud, onArm } = mount();
    const user = userEvent.setup();
    await user.click(getByRole(root, 'button', { name: '火山' }));
    hud.setChip(null);
    expect(hud.chip()).toBeNull();
    expect(armed(root)).toEqual([]);
    expect(hint(root, 'volcano-hint')).toBe(true);
    expect(onArm).toHaveBeenLastCalledWith(null);
  });

  it('放流のチップを持っている間に種の列が作り直されても、同じ種の新しい札は光る', async () => {
    const { root, hud, snap, firstSpawn } = mount();
    const user = userEvent.setup();
    await user.click(root.querySelector(`#spawn-${firstSpawn.id}`)!);
    const before = root.querySelector(`#spawn-${firstSpawn.id}`)!;
    expect(before.classList.contains('armed')).toBe(true);

    hud.update({ ...snap, species: [...snap.species, { ...firstSpawn, id: `${firstSpawn.id}-extra`, name: '追加の種' }] });

    const after = root.querySelector(`#spawn-${firstSpawn.id}`)!;
    expect(after).not.toBe(before);
    expect(hud.chip()).toEqual({ kind: 'spawn', speciesId: firstSpawn.id });
    expect(after.classList.contains('armed')).toBe(true);
    expect(armed(root)).toEqual([`spawn-${firstSpawn.id}`]);
  });
});

const lit = (root: HTMLElement) => [...root.querySelectorAll('#speed-row .on')].map((b) => b.id);

describe('HUD の速さの札は loop の速さを追う (M27-05 段 5)', () => {
  it('札を押すと loop に言い、光る札は loop の速さになる', async () => {
    const { root, loop } = mount();
    expect(lit(root)).toEqual(['speed-1']);
    await userEvent.setup().click(getByRole(root, 'button', { name: '100x' }));
    expect(loop.speed).toBe(100);
    expect(lit(root)).toEqual(['speed-100']);
  });

  it('札を押さずに loop の速さが変わっても (判定・観察画面・訪問)、次の update で光る札を揃える', () => {
    const { root, hud, loop, snap } = mount();
    loop.speed = 0;
    expect(lit(root)).toEqual(['speed-1']);
    hud.update(snap);
    expect(lit(root)).toEqual(['speed-0']);
    loop.speed = 10;
    hud.update(snap);
    expect(lit(root)).toEqual(['speed-10']);
  });

  it('観察画面の入口を置く速さの列を出す', () => {
    const { root, hud } = mount();
    expect(hud.speedRow).toBe(root.querySelector('#speed-row'));
  });
});
