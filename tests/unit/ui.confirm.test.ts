import { describe, it, expect } from 'vitest';
import { confirmKeyOf } from '../../src/ui/confirm';

describe('confirmKeyOf (M21-09): 確かめの板が受けるキー', () => {
  it('Esc は取り消し (どの札に focus があっても)', () => {
    expect(confirmKeyOf('Escape', 'cancel')).toEqual({ kind: 'cancel' });
    expect(confirmKeyOf('Escape', 'ok')).toEqual({ kind: 'cancel' });
    expect(confirmKeyOf('Escape', null)).toEqual({ kind: 'cancel' });
  });

  it('Tab は 2 つの札を回る。やめるからは確かめの札へ、それ以外 (確かめの札・板の外) からはやめるへ', () => {
    expect(confirmKeyOf('Tab', 'cancel')).toEqual({ kind: 'focus', to: 'ok' });
    expect(confirmKeyOf('Tab', 'ok')).toEqual({ kind: 'focus', to: 'cancel' });
    expect(confirmKeyOf('Tab', null)).toEqual({ kind: 'focus', to: 'cancel' });
  });

  it('ほかのキー (Enter・矢印・文字) は受けない (札の既定の動きに任せる)', () => {
    for (const key of ['Enter', ' ', 'ArrowRight', 'a']) expect(confirmKeyOf(key, 'cancel')).toBeNull();
  });
});
