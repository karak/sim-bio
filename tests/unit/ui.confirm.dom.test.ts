// @vitest-environment happy-dom
import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';
import { getByRole, queryByRole } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { createConfirm } from '../../src/ui/confirm';

/**
 * 確かめのダイアログを部品として組む (M21-09)。focus・Esc・Tab の回り・背景の押下・同時に 1 つだけを、happy-dom の上で user-event で押して確かめる。
 * 画面の上での置き場所 (判定の板に覆われない) は tests/e2e/uncovered.spec.ts
 */

const ASK = { title: '新しい島', message: '今の島を捨てて、新しい島を始めますか', ok: '新しい島を始める' };

/** 押すと確かめを開く札を置き、答えを answers に積む */
function mount() {
  document.body.innerHTML = `<div id="app"><button type="button" id="opener">新しい島</button></div>`;
  const root = document.getElementById('app')!;
  const confirm = createConfirm(root);
  const answers: boolean[] = [];
  const opener = getByRole(document.body, 'button', { name: '新しい島' });
  opener.addEventListener('click', () => void confirm(ASK).then((a) => answers.push(a)));
  return { root, confirm, answers, opener };
}

const dialog = () => getByRole(document.body, 'alertdialog');
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('確かめのダイアログ (M21-09)', () => {
  it('開くと題を名前・文を説明に持つ alertdialog (aria-modal) が出て、「やめる」に focus がある', async () => {
    const { opener } = mount();
    const user = userEvent.setup();
    await user.click(opener);
    const d = dialog();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(getByRole(document.body, 'alertdialog', { name: '新しい島', description: '今の島を捨てて、新しい島を始めますか' })).toBe(d);
    expect(getByRole(d, 'heading').textContent).toBe('新しい島');
    expect(document.activeElement).toBe(getByRole(d, 'button', { name: 'やめる' }));
  });

  it('Tab と Shift+Tab は 2 つの札の間を回り、板の外へ出ない', async () => {
    const { opener } = mount();
    const user = userEvent.setup();
    await user.click(opener);
    const cancel = getByRole(dialog(), 'button', { name: 'やめる' });
    const ok = getByRole(dialog(), 'button', { name: '新しい島を始める' });
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(ok);
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(ok);
  });

  it('Esc は取り消しで、板を消し、開く前の札へ focus を返す。Esc も Tab も後ろの画面へは渡さない', async () => {
    const { opener, answers } = mount();
    const behind = vi.fn();
    const listen = (e: KeyboardEvent) => behind(e.key);
    document.addEventListener('keydown', listen);
    onTestFinished(() => document.removeEventListener('keydown', listen));
    const user = userEvent.setup();
    await user.click(opener);
    await user.keyboard('{Tab}{Escape}');
    await settle();
    expect(answers).toEqual([false]);
    expect(queryByRole(document.body, 'alertdialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(behind).not.toHaveBeenCalled();
    // 閉じた後のキーは後ろの画面へ届く
    await user.keyboard('{Escape}');
    expect(behind).toHaveBeenCalledWith('Escape');
  });

  it('「やめる」に focus があるまま Enter は取り消し。確かめの札へ移って Enter で受ける', async () => {
    const { opener, answers } = mount();
    const user = userEvent.setup();
    await user.click(opener);
    await user.keyboard('{Enter}');
    await settle();
    await user.click(opener);
    await user.keyboard('{Tab}{Enter}');
    await settle();
    expect(answers).toEqual([false, true]);
    expect(queryByRole(document.body, 'alertdialog')).toBeNull();
  });

  it('札を押すと答え、背景を押すと取り消す。板の中の文を押しても閉じない', async () => {
    const { opener, answers } = mount();
    const user = userEvent.setup();
    await user.click(opener);
    await user.click(getByRole(dialog(), 'button', { name: '新しい島を始める' }));
    await user.click(opener);
    await user.click(getByRole(dialog(), 'button', { name: 'やめる' }));
    await user.click(opener);
    await user.click(dialog().querySelector('p')!);
    await settle();
    expect(answers).toEqual([true, false]);
    await user.click(document.getElementById('confirm')!);
    await settle();
    expect(answers).toEqual([true, false, false]);
    expect(queryByRole(document.body, 'alertdialog')).toBeNull();
  });

  it('開いている間の次の問いはその場で取り消しとして答え、開いている板はそのまま残って答えられる', async () => {
    const { opener, confirm, answers } = mount();
    const user = userEvent.setup();
    await user.click(opener);
    await expect(confirm({ title: '別の問い', message: 'm', ok: '受ける' })).resolves.toBe(false);
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(getByRole(dialog(), 'heading').textContent).toBe('新しい島');
    await user.click(getByRole(dialog(), 'button', { name: '新しい島を始める' }));
    await settle();
    expect(answers).toEqual([true]);
    // 閉じた後は、また開ける
    await user.click(opener);
    expect(getByRole(dialog(), 'heading').textContent).toBe('新しい島');
  });
});
