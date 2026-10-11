// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getByRole } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { createHud, type Chip, type HudHandlers } from '../../src/ui/Hud';
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
  const handlers = {
    onCommand: () => undefined,
    onSpeed: () => undefined,
    onLayer: () => undefined,
    onSave: () => ({}) as ReturnType<HudHandlers['onSave']>,
    onLoad: () => undefined,
    onSlotSave: () => undefined,
    onSlotLoad: () => undefined,
    onNewIsland: () => undefined,
    onTitle: () => undefined,
    onArm,
  } satisfies HudHandlers;
  const hud = createHud(root, handlers);
  const snap = World.create(island.config, { log: createMemorySink() }).snapshot();
  hud.update(snap);
  const firstSpawn = snap.species.find((d) => d.spawnable !== false)!;
  return { root, hud, onArm, firstSpawn };
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
});
