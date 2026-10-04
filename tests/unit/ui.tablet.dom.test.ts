// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { createTablet, type TabletEnv } from '../../src/ui/Tablet';
import { createConfirm } from '../../src/ui/confirm';
import { atOf, planOp, runPlan, type Effect } from '../../src/app/place';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Cargo } from '../../src/simulation/ship';

/**
 * 石板を部品として組む (M21-09)。update の文・警告のチップ・石板の選び・判定の札・持ち出しの保存・揺れを、happy-dom の上で user-event で押して確かめる。
 * 時計 (揺れを止める) と Blob URL (持ち出し) は env で差し替える。判定の板のドラッグは tests/unit/ui.movable.dom.test.ts、置き場所は tests/e2e/uncovered.spec.ts
 */

const def = {
  id: 's',
  title: '試しの石板',
  kind: 'prevent',
  prophecy: '試しの予言',
  years: 100,
  milestones: [{ atYear: 30, text: '星が落ちる' }],
  budget: { start: 10, max: 30, incomePerYear: 1, costs: {} },
} as unknown as ScenarioDef;
const other = { id: 'o', title: 'ほかの石板', kind: 'endure', prophecy: 'p', years: 50 } as unknown as ScenarioDef;
const hidden = { id: 'h', title: '隠れた石板', kind: 'endure', prophecy: 'p', years: 5, hidden: true } as unknown as ScenarioDef;
const names = { wolf: '狼', deer: '鹿' };
const running = { status: 'running', reason: '42 年' } as const;

/** 時計と Blob URL の差し替え。later は積むだけで、試験が回す */
function fakeEnv() {
  const timers: { fn: () => void; ms: number }[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const env: TabletEnv = {
    later: (fn, ms) => void timers.push({ fn, ms }),
    createObjectURL: (b) => {
      blobs.push(b);
      return `blob:cargo-${blobs.length}`;
    },
    revokeObjectURL: (u) => void revoked.push(u),
  };
  return { env, timers, blobs, revoked };
}

function mount(current: ScenarioDef | null = def) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSelect = vi.fn<(id: string | null) => void>();
  const onShowSpecies = vi.fn<(id: string) => void>();
  const fake = fakeEnv();
  const tablet = createTablet(root, [def, other, hidden], current, onSelect, names, onShowSpecies, fake.env);
  return { root, tablet, onSelect, onShowSpecies, ...fake };
}

const text = (root: HTMLElement, id: string) => root.querySelector(`#${id}`)?.textContent;

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('石板の選び (M21-09)', () => {
  it('自由モードと隠れていない石板を並べ、今の石板を選んだ状態で出す', () => {
    const { root } = mount();
    const select = getByRole<HTMLSelectElement>(root, 'combobox');
    expect([...select.options].map((o) => o.textContent)).toEqual(['自由モード', '試しの石板', 'ほかの石板']);
    expect(select.value).toBe('s');
  });

  it('選んだ石板を知らせ、選びは今の舞台の表示へ戻す (移るときは開き直す。M21-04)', async () => {
    const { root, onSelect } = mount();
    const select = getByRole<HTMLSelectElement>(root, 'combobox');
    const user = userEvent.setup();
    await user.selectOptions(select, 'ほかの石板');
    expect(onSelect).toHaveBeenLastCalledWith('o');
    expect(select.value).toBe('s');
    await user.selectOptions(select, '自由モード');
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(select.value).toBe('s');
  });

  it('自由モードでも、選んだ後は自由モードの表示へ戻す', async () => {
    const { root, onSelect } = mount(null);
    const select = getByRole<HTMLSelectElement>(root, 'combobox');
    await userEvent.setup().selectOptions(select, '試しの石板');
    expect(onSelect).toHaveBeenCalledWith('s');
    expect(select.value).toBe('');
  });
});

describe('石板の update (M21-09)', () => {
  it('年・残り・祈り・節目・警告・年表・力を文で出す', () => {
    const { root, tablet } = mount();
    tablet.update(
      10,
      running,
      { power: 7.9, max: 30, incomeLastYear: 1.26, upkeepLastYear: 0.5 },
      [{ kind: 'species_low', id: 'wolf', key: 'a', text: '狼が減った' }],
      [{ year: 3, kind: 'intervene', command: { type: 'spawn_species', speciesId: 'deer', cell: 0, amount: 1 } }],
      { kind: 'rain', yearsLeft: 4 },
    );
    expect(text(root, 'tablet-year')).toBe('10 / 100 年');
    expect(text(root, 'tablet-status')).toBe('あと 42 年');
    expect(root.querySelector<HTMLElement>('#tablet-prayer')!.hidden).toBe(false);
    expect(text(root, 'tablet-prayer')).toBe('祈り: 雨を(残り 4 年)');
    expect(text(root, 'tablet-milestones')).toBe('30 年目: 星が落ちる');
    expect(text(root, 'tablet-warnings')).toBe('⚠ 狼が減った 狼を見る');
    expect(text(root, 'tablet-timeline-summary')).toBe('年表 (1)');
    expect(text(root, 'tablet-timeline')).toBe('3 年: 鹿を放った');
    expect(text(root, 'tablet-power')).toBe('7 / 30');
    expect(text(root, 'tablet-power-flow')).toBe('(+1.3/年、維持 −0.5/年)');
  });

  it('祈りが消えれば行を隠し、節目を過ぎれば消え、渡した節目 (迎撃で外したもの) があればそれを出す', () => {
    const { root, tablet } = mount();
    tablet.update(10, running, null, [], [], { kind: 'rain', yearsLeft: 4 });
    tablet.update(31, running, null, [], [], null);
    expect(root.querySelector<HTMLElement>('#tablet-prayer')!.hidden).toBe(true);
    expect(text(root, 'tablet-milestones')).toBe('');
    tablet.update(10, running, null, [], [], null, [{ atYear: 60, text: '二つ目の星' }]);
    expect(text(root, 'tablet-milestones')).toBe('60 年目: 二つ目の星');
  });

  it('自由モードの石板は選びだけで、update は何もしない', () => {
    const { root, tablet } = mount(null);
    expect(() => tablet.update(10, running, null, [{ kind: 'event', key: 'k', text: 't' }])).not.toThrow();
    expect(root.querySelector('#tablet-year')).toBeNull();
    expect(root.querySelector('#tablet-warnings')).toBeNull();
  });
});

describe('警告のチップ (M21-09、M21-02 D5)', () => {
  it('「〜を見る」を押すとその種を開く。update でチップが差し替わっても押せる。警告の文を押しても何もしない', async () => {
    const { root, tablet, onShowSpecies } = mount();
    const user = userEvent.setup();
    tablet.update(10, running, null, [{ kind: 'species_low', id: 'wolf', key: 'a', text: '狼が減った' }]);
    await user.click(getByRole(root, 'button', { name: '狼を見る' }));
    expect(onShowSpecies).toHaveBeenLastCalledWith('wolf');
    tablet.update(11, running, null, [
      { kind: 'power_low', key: 'b', text: '力が足りない' },
      { kind: 'event', id: 'deer', key: 'c', text: '鹿が増えすぎた' },
    ]);
    expect(queryByRole(root, 'button', { name: '狼を見る' })).toBeNull();
    await user.click(getByRole(root, 'button', { name: '鹿を見る' }));
    expect(onShowSpecies).toHaveBeenLastCalledWith('deer');
    await user.click(root.querySelector('.tablet-warning')!);
    expect(onShowSpecies).toHaveBeenCalledTimes(2);
  });
});

describe('判定の札 (M21-09)', () => {
  it('判定を出すと題・理由・内訳を出し、「もう一度」は同じ石板を、「自由モードへ」は自由モードを選ぶ。閉じれば隠れる', async () => {
    const { root, tablet, onSelect } = mount();
    tablet.showVerdict({ status: 'dead', reason: '草が絶えた', stats: { interventions: 2, powerSpent: 5.4, landRatio: 0.5, totals: { deer: 3 } } });
    const verdict = root.querySelector<HTMLElement>('#verdict')!;
    expect(verdict.hidden).toBe(false);
    expect(['alive', 'dead', 'escaped'].filter((c) => verdict.classList.contains(c))).toEqual(['dead']);
    expect(text(root, 'verdict-title')).toBe('島は滅びた');
    expect(text(root, 'verdict-reason')).toBe('草が絶えた');
    expect([...root.querySelectorAll('#verdict-stats > div')].map((d) => d.textContent)).toEqual(['介入 2 回 · 使った力 5', '陸地率 50%', '鹿 3']);
    const user = userEvent.setup();
    await user.click(getByRole(root, 'button', { name: 'もう一度' }));
    expect(onSelect).toHaveBeenLastCalledWith('s');
    await user.click(getByRole(root, 'button', { name: '自由モードへ' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    tablet.hideVerdict();
    expect(verdict.hidden).toBe(true);
    expect(queryByRole(root, 'button', { name: 'もう一度' })).toBeNull();
  });

  it('生き延びた・次の島へに出し直すと、色の組 (alive / escaped) を入れ替える', () => {
    const { root, tablet } = mount();
    const verdict = root.querySelector<HTMLElement>('#verdict')!;
    const colors = () => ['alive', 'dead', 'escaped'].filter((c) => verdict.classList.contains(c));
    tablet.showVerdict({ status: 'alive', reason: 'r' });
    expect(colors()).toEqual(['alive']);
    tablet.showVerdict({ status: 'escaped', reason: 'r' });
    expect(colors()).toEqual(['escaped']);
    expect(text(root, 'verdict-title')).toBe('次の島へ');
    expect(text(root, 'verdict-stats')).toBe('');
  });
});

describe('持ち出しの保存 (M21-09、M10-03)', () => {
  const cargo = { species: ['deer'], note: '持ち出し' } as unknown as Cargo;

  it('次の島へ逃れて持ち出しがあれば、持ち出しの JSON を Blob URL で保存させる', async () => {
    const { root, tablet, blobs } = mount();
    tablet.showVerdict({ status: 'escaped', reason: 'r' }, cargo);
    const link = getByRole<HTMLAnchorElement>(root, 'link', { name: '持ち出しを保存' });
    expect(link.getAttribute('href')).toBe('blob:cargo-1');
    expect(link.getAttribute('download')).toBe('cargo.json');
    expect(blobs[0].type).toBe('application/json');
    expect(JSON.parse(await blobs[0].text())).toEqual(cargo);
  });

  it('出し直すたびに前の Blob URL を捨てる。持ち出しが無い・逃れていないなら札を隠す', () => {
    const { root, tablet, blobs, revoked } = mount();
    tablet.showVerdict({ status: 'escaped', reason: 'r' }, cargo);
    tablet.showVerdict({ status: 'escaped', reason: 'r' }, cargo);
    expect(revoked).toEqual(['blob:cargo-1']);
    expect(getByRole(root, 'link', { name: '持ち出しを保存' }).getAttribute('href')).toBe('blob:cargo-2');
    tablet.showVerdict({ status: 'escaped', reason: 'r' });
    expect(revoked).toEqual(['blob:cargo-1', 'blob:cargo-2']);
    expect(queryByRole(root, 'link', { name: '持ち出しを保存' })).toBeNull();
    tablet.showVerdict({ status: 'alive', reason: 'r' }, cargo);
    expect(queryByRole(root, 'link', { name: '持ち出しを保存' })).toBeNull();
    expect(blobs).toHaveLength(2);
  });
});

describe('石板の揺れ (M21-09)', () => {
  it('flash で石板を揺らし、300 ms 後に止める。揺れている間の flash も揺らし直す', () => {
    const { root, tablet, timers } = mount();
    const board = root.querySelector<HTMLElement>('#tablet')!;
    tablet.flash();
    expect(board.classList.contains('shake')).toBe(true);
    expect(timers.map((t) => t.ms)).toEqual([300]);
    tablet.flash();
    expect(board.classList.contains('shake')).toBe(true);
    for (const t of timers) t.fn();
    expect(board.classList.contains('shake')).toBe(false);
  });
});

describe('石板と確かめのダイアログを組む (M21-09、M21-04 の慎重な確かめ。いまの振る舞い)', () => {
  const head = { simVersion: 'v', scenarioId: 's', seed: 1 };
  /** main.ts の run と同じ組み方: 石板の札 → planOp → 確かめ → effects */
  function wire(finished: boolean) {
    const root = document.createElement('div');
    document.body.append(root);
    const confirm = createConfirm(root);
    const done: Effect[] = [];
    const at = atOf(false, head, finished ? 'dead' : 'running');
    const tablet = createTablet(root, [def, other], def, (id) => void runPlan(planOp({ kind: 'select', scenarioId: id }, at, (x) => x), confirm, async (e) => (done.push(e), true)), names, undefined, fakeEnv().env);
    return { root, tablet, done };
  }

  it('判定の出た石板の島で「もう一度」を押すと「判定の出た島を離れる」を確かめ、やめれば移らず、受ければ書き切って同じ石板へ移る', async () => {
    const { root, tablet, done } = wire(true);
    tablet.showVerdict({ status: 'dead', reason: 'r' });
    const user = userEvent.setup();
    await user.click(getByRole(root, 'button', { name: 'もう一度' }));
    const d = getByRole(root, 'alertdialog', { name: '判定の出た島を離れる' });
    await user.click(getByRole(d, 'button', { name: 'やめる' }));
    expect(done).toEqual([]);
    await user.click(getByRole(root, 'button', { name: 'もう一度' }));
    await user.click(getByRole(root, 'button', { name: '離れる' }));
    await vi.waitFor(() => expect(done).toEqual([{ kind: 'flush' }, { kind: 'go', scenarioId: 's' }]));
  });

  it('判定の前の石板の島で石板を選び直すのは確かめずに移る (走っている島は書き切ってから移る)', async () => {
    const { root, done } = wire(false);
    await userEvent.setup().selectOptions(getByRole(root, 'combobox'), 'ほかの石板');
    await vi.waitFor(() => expect(done).toEqual([{ kind: 'flush' }, { kind: 'go', scenarioId: 'o' }]));
    expect(queryByRole(root, 'alertdialog')).toBeNull();
  });

  it('M26-08: onRetry を渡すと「もう一度」はそちらを呼び (石板を選ぶ onSelect は呼ばない)、「自由モードへ」は onSelect(null) のまま', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onSelect = vi.fn<(id: string | null) => void>();
    const onRetry = vi.fn<() => void>();
    const tablet = createTablet(root, [def, other], def, onSelect, names, undefined, fakeEnv().env, onRetry);
    tablet.showVerdict({ status: 'dead', reason: 'r' });
    const user = userEvent.setup();
    await user.click(getByRole(root, 'button', { name: 'もう一度' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(getByRole(root, 'button', { name: '自由モードへ' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
