// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getByRole } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { titleHarborBody, type HarborPort } from '../../src/ui/Harbor';
import { HARBOR_CLOSED_TEXT } from '../../src/ui/harborText';
import { titleStepOf, type TitleAction } from '../../src/ui/titleMenu';
import { createMemoryHarborStore } from '../../src/persist/harborStore';

/**
 * (M24-03 の続き、審査台 d1020-m24-03-newgame=b) 閉じた港のタイトルの港の板にも「石板を選ぶ」の札を出す。
 * 開発 (VITE_HARBOR_URL 無し) はいつも閉港で、自動の枠も無ければタイトルから石板の板へ行く道が無かった。
 * 押した先は空の港の札と同じ toScenarios で、行き先は titleStepOf の { kind: 'scenarios' } (石板の板)
 */

const port = (baseUrl: string | undefined): HarborPort => ({
  scenarios: [],
  speciesIds: [],
  simVersion: 'test',
  baseUrl,
  store: createMemoryHarborStore(),
  log: () => {},
  guard: { ask: () => Promise.resolve(true), leave: () => {} },
});

const mount = (baseUrl: string | undefined, toScenarios: () => void): HTMLElement => {
  const root = document.createElement('div');
  root.append(...titleHarborBody(port(baseUrl), { toScenarios }));
  document.body.append(root);
  return root;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('タイトルの港の板 titleHarborBody: 閉じた港 (M24-03)', () => {
  it('閉港の板は閉港の文と「石板を選ぶ」の札を出し、押すと空の港の札と同じ toScenarios へ回る (行き先は石板の板)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ json: () => Promise.resolve([]) }));
    const toScenarios = vi.fn();
    const root = mount(undefined, toScenarios);
    await vi.waitFor(() => expect(root.querySelector('#harbor-state')?.textContent).toBe(HARBOR_CLOSED_TEXT));
    const chip = getByRole(root, 'button', { name: '石板を選ぶ' });
    expect(chip.hidden).toBe(false);
    await userEvent.click(chip);
    expect(toScenarios).toHaveBeenCalledTimes(1);
    const action: TitleAction = { kind: 'scenarios' };
    expect(titleStepOf(action, { continuation: null, freeSaved: false, titleOf: (id) => id })).toEqual({ kind: 'panel', panel: 'scenarios' });
  });
});
