// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getByRole } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { makeMovable, type MovableEnv, type Offset } from '../../src/ui/movable';
import { createTablet } from '../../src/ui/Tablet';
import type { ScenarioDef } from '../../src/scenario/types';

/**
 * 部品の試験 (M21-05)。makeMovable と判定の板を happy-dom の上に組み、user-event の pointer とキーで動かす。
 * happy-dom には配置が無いので、取っ手の矩形は translate から作る (実の配置・重なりは tests/e2e に残す)
 */

/** 取っ手を translate 0 で (left, top) に w x h で描いたことにする */
function layGrip(board: HTMLElement, grip: HTMLElement, at: { left: number; top: number; w: number; h: number }) {
  vi.spyOn(grip, 'getBoundingClientRect').mockImplementation(() => {
    const [x, y] = (board.style.translate || '0px 0px').split(' ').map((v) => Number.parseFloat(v) || 0);
    const left = at.left + x;
    const top = at.top + y;
    return { left, top, right: left + at.w, bottom: top + at.h, width: at.w, height: at.h, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

function memoryEnv(init: Record<string, string> = {}): MovableEnv & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return { map, view: () => ({ width: 1000, height: 500 }), store: { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) } };
}

const translateOf = (el: HTMLElement): Offset => {
  const [x, y] = el.style.translate.split(' ').map((v) => Number.parseFloat(v));
  return { x, y };
};

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('makeMovable を部品として組む (M21-05)', () => {
  let board: HTMLElement;
  let grip: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = `<div id="board"><button type="button" aria-label="板を動かす"><i></i></button><p>中身</p></div>`;
    board = document.getElementById('board')!;
    grip = getByRole(document.body, 'button', { name: '板を動かす' });
    layGrip(board, grip, { left: 100, top: 10, w: 200, h: 20 });
  });

  it('取っ手を押して動かして離すと、ずれの分だけ translate が動き、離したときに覚えへ書く', async () => {
    const env = memoryEnv();
    makeMovable(board, grip, 'k', env);
    const user = userEvent.setup();
    await user.pointer([{ keys: '[MouseLeft>]', target: grip, coords: { clientX: 150, clientY: 20 } }, { coords: { clientX: 410, clientY: 140 } }]);
    expect(board.style.translate).toBe('260px 120px');
    expect(env.map.has('k')).toBe(false);
    await user.pointer({ keys: '[/MouseLeft]' });
    expect(env.map.get('k')).toBe('{"x":260,"y":120}');
  });

  it('矢印キーで 16 px、Shift で 64 px 動き、そのたびに覚えへ書く', async () => {
    const env = memoryEnv();
    makeMovable(board, grip, 'k', env);
    const user = userEvent.setup();
    grip.focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(translateOf(board)).toEqual({ x: 16, y: 16 });
    expect(env.map.get('k')).toBe('{"x":16,"y":16}');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(board.style.translate).toBe('80px 16px');
    expect(env.map.get('k')).toBe('{"x":80,"y":16}');
  });

  it('取っ手は画面の外へ出ない (左上へ大きく引いても、取っ手が画面の端に残る)', async () => {
    const env = memoryEnv();
    makeMovable(board, grip, 'k', env);
    const user = userEvent.setup();
    await user.pointer([{ keys: '[MouseLeft>]', target: grip, coords: { clientX: 150, clientY: 20 } }, { coords: { clientX: -400, clientY: -400 } }, { keys: '[/MouseLeft]' }]);
    expect(board.style.translate).toBe('-100px -10px');
    expect(grip.getBoundingClientRect()).toMatchObject({ left: 0, top: 0 });
    expect(env.map.get('k')).toBe('{"x":-100,"y":-10}');
  });

  it('覚えた位置から始まり、画面の外なら寄せて出す', () => {
    const env = memoryEnv({ k: '{"x":2000,"y":30}' });
    makeMovable(board, grip, 'k', env);
    expect(board.style.translate).toBe('700px 30px');
  });

  it('ほかの指の動き・離しは今のドラッグを動かさず終えない。キャンセルでも、そこまでの位置を覚える', () => {
    const env = memoryEnv();
    makeMovable(board, grip, 'k', env);
    const fire = (type: string, pointerId: number, x = 0, y = 0) => grip.dispatchEvent(new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true }));
    fire('pointerdown', 7, 150, 20);
    fire('pointermove', 8, 900, 400);
    fire('pointerup', 8);
    expect(board.style.translate).toBe('0px 0px');
    expect(env.map.has('k')).toBe(false);
    fire('pointermove', 7, 170, 50);
    expect(board.style.translate).toBe('20px 30px');
    fire('pointercancel', 7);
    expect(env.map.get('k')).toBe('{"x":20,"y":30}');
    // 終えた後の動きでは動かない
    fire('pointermove', 7, 400, 400);
    expect(board.style.translate).toBe('20px 30px');
  });
});

const def: ScenarioDef = {
  id: 'w',
  title: '試しの石板',
  prophecy: '試しの予言',
  kind: 'prevent',
  schedule: [],
  years: 10,
  alive: { type: 'species_alive', speciesId: 'grass' },
} as unknown as ScenarioDef;

describe('判定の板を部品として組む (M21-05)', () => {
  const KEY = 'biotope.verdict-offset';
  const open = () => {
    const root = document.createElement('div');
    document.body.append(root);
    const tablet = createTablet(root, [def], def, () => {});
    tablet.showVerdict({ status: 'alive', reason: '草が残った' });
    return root;
  };

  it('判定の板は取っ手の pointer のドラッグとキーで動き、動かした位置をタブの間 (sessionStorage) 覚える', async () => {
    const root = open();
    const box = root.querySelector<HTMLElement>('#verdict-box')!;
    expect(root.querySelector('#verdict-title')).toHaveProperty('textContent', '島は生き延びた');
    const grip = getByRole(root, 'button', { name: /^判定の板を動かす/ });
    const user = userEvent.setup();
    await user.pointer([{ keys: '[MouseLeft>]', target: grip, coords: { clientX: 500, clientY: 300 } }, { coords: { clientX: 760, clientY: 420 } }, { keys: '[/MouseLeft]' }]);
    expect(box.style.translate).toBe('260px 120px');
    expect(sessionStorage.getItem(KEY)).toBe('{"x":260,"y":120}');

    grip.focus();
    await user.keyboard('{ArrowLeft}{Shift>}{ArrowUp}{/Shift}');
    expect(box.style.translate).toBe('244px 56px');
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ x: 244, y: 56 });
  });

  it('開き直した (もう一度) 判定の板は、覚えた位置に出る', () => {
    sessionStorage.setItem(KEY, '{"x":244,"y":56}');
    const root = open();
    expect(root.querySelector<HTMLElement>('#verdict-box')!.style.translate).toBe('244px 56px');
  });
});
