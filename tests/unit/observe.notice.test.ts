import { describe, it, expect } from 'vitest';
import { initialNotice, noticeKind, noticeText, NOTICE_MIN_S, NOTICE_S, NOTICE_STYLE, pushNotice, stepNotice, toNotice, type Notice, type NoticeState } from '../../src/observe/notice';
import type { TimelineEvent } from '../../src/scenario/ScenarioRunner';

const prayer: TimelineEvent = { year: 10, kind: 'prayer', phase: 'issued', prayer: 'wolves' };
const warning: TimelineEvent = { year: 12, kind: 'warning', warning: { kind: 'ship_late', key: 'ship_late', text: '舟の材が足りない' } };
const verdict: TimelineEvent = { year: 30, kind: 'verdict', verdict: { status: 'escaped', reason: '' } };
const n = (text: string): Notice => ({ kind: 'prayer', text });
/** dt 秒ずつ steps 回進める */
const run = (s: NoticeState, dt: number, steps: number) => Array.from({ length: steps }).reduce<NoticeState>((a) => stepNotice(a, dt), s);

describe('知らせの帯 (M22-08 の手直し): 出す出来事と文言', () => {
  it('祈り・警告・結末だけを帯に出し、介入や文明の段階は出さない', () => {
    expect([prayer, warning, verdict].map(noticeKind)).toEqual(['prayer', 'warning', 'verdict']);
    expect(noticeKind({ year: 3, kind: 'civ_stage', from: 2, to: 3 })).toBeNull();
    expect(noticeKind({ year: 3, kind: 'power_exhausted' })).toBeNull();
    expect(toNotice({ year: 3, kind: 'tower_stopped' }, {})).toBeNull();
  });

  it('文言は石板の年表と同じ文。警告の先頭の ⚠ は帯の印が担うので外す', () => {
    expect(noticeText(prayer, {})).toBe('民が祈った: 狼を減らして');
    expect(noticeText({ ...prayer, phase: 'answered' }, {})).toBe('祈りに応えた: 狼を減らして');
    expect(noticeText(warning, {})).toBe('舟の材が足りない');
    expect(noticeText(verdict, {})).toBe('次の島へ逃れた');
    expect(toNotice(warning, {})).toEqual({ kind: 'warning', text: '舟の材が足りない' });
  });

  it('種類ごとに名前と光の色を分ける (祈りは青緑、警告は橙、結末は金)', () => {
    expect(Object.fromEntries(Object.entries(NOTICE_STYLE).map(([k, v]) => [k, [v.label, v.tone]]))).toEqual({
      prayer: ['祈り', '#8FEADF'],
      warning: ['警告', '#F0A868'],
      verdict: ['結末', '#F2D27A'],
    });
    // 3 つの印は形が違う
    expect(new Set(Object.values(NOTICE_STYLE).map((v) => v.mark)).size).toBe(3);
  });
});

describe('知らせの帯 (M22-08 の手直し): 並びと寿命', () => {
  it('1 件だけなら 8 秒出して消える', () => {
    const s = pushNotice(initialNotice(), n('a'));
    expect(s.current).toEqual(n('a'));
    expect(run(s, 0.5, 15).current).toEqual(n('a'));
    expect(run(s, 0.5, 15).shown).toBeCloseTo(7.5);
    expect(run(s, 0.5, 16)).toEqual({ current: null, shown: 0, queue: [] });
    expect(NOTICE_S).toBe(8);
  });

  it('出ている間に来た知らせは待たせ、今の知らせを 4 秒出したら次へ替える', () => {
    let s = pushNotice(initialNotice(), n('a'));
    s = stepNotice(s, 1);
    s = pushNotice(s, n('b'));
    expect(s.current).toEqual(n('a'));
    expect(s.queue).toEqual([n('b')]);
    s = run(s, 0.5, 5); // 3.5 秒
    expect(s.current?.text).toBe('a');
    s = stepNotice(s, 0.5); // 4 秒
    expect(s).toEqual({ current: n('b'), shown: 0, queue: [] });
    expect(NOTICE_MIN_S).toBe(4);
    // 次が無ければ b は 8 秒出す
    expect(run(s, 1, 7).current?.text).toBe('b');
    expect(run(s, 1, 8).current).toBeNull();
  });

  it('待ちは 2 件まで。あふれたら古いものから捨てる', () => {
    let s = pushNotice(initialNotice(), n('a'));
    for (const t of ['b', 'c', 'd']) s = pushNotice(s, n(t));
    expect(s.current?.text).toBe('a');
    expect(s.queue.map((q) => q.text)).toEqual(['c', 'd']);
  });

  it('何も出ていなければ進めても変わらない', () => {
    const s = initialNotice();
    expect(stepNotice(s, 10)).toBe(s);
  });
});
