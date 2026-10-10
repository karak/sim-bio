import { describe, it, expect } from 'vitest';
import { markEntered, putOpenTitle, takeTabMarks } from '../../src/persist/tabMarks';

const fakeStorage = () => {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
};

describe('このタブの印 (M24-01、sessionStorage)', () => {
  it('何も無ければ、舞台に入っていない・タイトルの合図も無い', () => {
    expect(takeTabMarks(fakeStorage())).toEqual({ entered: false, openTitle: false });
  });

  it('舞台に入った印は読んでも消えない (再読み込みでもタイトルへ戻さない)', () => {
    const s = fakeStorage();
    markEntered(s);
    expect(takeTabMarks(s)).toEqual({ entered: true, openTitle: false });
    expect(takeTabMarks(s)).toEqual({ entered: true, openTitle: false });
  });

  it('タイトルを開く合図は一回きり (読んだら消す)。合図を置くと舞台に入った印は消す', () => {
    const s = fakeStorage();
    markEntered(s);
    putOpenTitle(s);
    expect(takeTabMarks(s)).toEqual({ entered: false, openTitle: true });
    expect(takeTabMarks(s)).toEqual({ entered: false, openTitle: false });
  });

  it('知らない値は印にしない', () => {
    const s = fakeStorage();
    s.items.set('biotope-entered-stage', 'yes');
    s.items.set('biotope-open-title', '0');
    expect(takeTabMarks(s)).toEqual({ entered: false, openTitle: false });
  });
});
