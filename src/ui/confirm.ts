import { el } from './el';
import type { Ask } from './confirmAsk';

/**
 * 確かめのダイアログ (M21-04)。やり直しの効かない操作はどれもここを通す (window.confirm は使わない)。
 * alertdialog で、開くと「やめる」に focus を置く (押し間違いの Enter で捨てない)。Esc と背景の押下は取り消し、Tab は板の中を回る。
 * 閉じたら開く前に focus のあった要素へ返す。同時に開くのは 1 つだけで、開いている間の次の問いは取り消しとして答える
 */
export type Confirm = (ask: Ask) => Promise<boolean>;

export function createConfirm(root: HTMLElement): Confirm {
  let open = false;
  return (ask) => {
    if (open) return Promise.resolve(false);
    open = true;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cancel = el('button', { type: 'button', class: 'chip confirm-cancel' }, 'やめる');
    const ok = el('button', { type: 'button', class: 'chip confirm-ok' }, ask.ok);
    const box = el(
      'div',
      { class: 'confirm-box', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-message' },
      el('h2', { class: 'confirm-title', id: 'confirm-title' }, ask.title),
      el('p', { class: 'confirm-message', id: 'confirm-message' }, ask.message),
      el('div', { class: 'row confirm-actions' }, cancel, ok),
    );
    const layer = el('div', { class: 'confirm', id: 'confirm' }, box);
    return new Promise<boolean>((resolve) => {
      const close = (answer: boolean) => {
        document.removeEventListener('keydown', onKey, true);
        layer.remove();
        open = false;
        back?.focus();
        resolve(answer);
      };
      // capture で先に受け、Esc を後ろの画面 (観察画面の Esc など) へ渡さない
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement === cancel ? ok : cancel).focus();
        }
      };
      cancel.addEventListener('click', () => close(false));
      ok.addEventListener('click', () => close(true));
      layer.addEventListener('click', (e) => {
        if (e.target === layer) close(false);
      });
      document.addEventListener('keydown', onKey, true);
      root.append(layer);
      cancel.focus();
    });
  };
}
