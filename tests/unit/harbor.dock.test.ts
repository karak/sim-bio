import { describe, it, expect } from 'vitest';
import { afterVerdictOf, cardActionsOf, finishedScopeOf, type VerdictAt } from '../../src/harbor/dock';

const own: VerdictAt = { visiting: false, forced: false, chronicle: true };
const ended = ['alive', 'dead', 'escaped'] as const;

describe('判定の後に港へ出すもの afterVerdictOf (M21-07)', () => {
  it('afterVerdictOf (M21-07): 近道・訪問・年代記の無い島の判定は港へ出さない (出港・回避率・積荷のどれも)', () => {
    for (const status of ended) {
      expect(afterVerdictOf(status, own).harbor, `${status} の自分の島`).not.toBeNull();
      for (const at of [{ ...own, forced: true }, { ...own, visiting: true }, { ...own, chronicle: false }]) {
        expect(afterVerdictOf(status, at), `${status} ${JSON.stringify(at)}`).toEqual({ hold: status === 'escaped', harbor: null });
      }
    }
    expect(afterVerdictOf('running', own)).toEqual({ hold: false, harbor: null });
  });

  it('afterVerdictOf (M21-07): escaped のときだけ持ち出しと積荷を出す', () => {
    expect(afterVerdictOf('escaped', own)).toEqual({ hold: true, harbor: { status: 'escaped', cargo: true } });
    expect(afterVerdictOf('alive', own)).toEqual({ hold: false, harbor: { status: 'alive', cargo: false } });
    expect(afterVerdictOf('dead', own)).toEqual({ hold: false, harbor: { status: 'dead', cargo: false } });
  });
});

describe('港の口と石碑の札 (M21-07)', () => {
  const quick = { id: 'test-quick', title: '試し読み' };
  const sinking = { id: 'sinking', title: '沈む欠片' };
  it('finishedScopeOf (M21-07): 石板ではその石板の島だけ、自由モードではどの石板の判定の出た島も並べ、訪問では並べない', () => {
    expect(finishedScopeOf([quick, sinking], { visiting: false, scenarioId: 'sinking' })).toEqual([{ def: sinking, label: 'この石板で最後に判定の出た島' }]);
    expect(finishedScopeOf([quick, sinking], { visiting: false, scenarioId: null })).toEqual([
      { def: quick, label: '『試し読み』で最後に判定の出た島' },
      { def: sinking, label: '『沈む欠片』で最後に判定の出た島' },
    ]);
    expect(finishedScopeOf([quick, sinking], { visiting: true, scenarioId: null })).toEqual([]);
    expect(finishedScopeOf([quick, sinking], { visiting: true, scenarioId: 'sinking' })).toEqual([]);
  });

  it('cardActionsOf (M21-07): 取り下げは自分が出港した島だけ、訪れるは同じ版の島だけ、通報はどの島にも出す', () => {
    const at = { simVersion: 'v2' };
    expect(cardActionsOf({ simVersion: 'v2' }, { ...at, own: true })).toEqual({ visit: true, withdraw: true, report: true });
    expect(cardActionsOf({ simVersion: 'v2' }, { ...at, own: false })).toEqual({ visit: true, withdraw: false, report: true });
    expect(cardActionsOf({ simVersion: 'v1' }, { ...at, own: true })).toEqual({ visit: false, withdraw: true, report: true });
    expect(cardActionsOf({ simVersion: 'v1' }, { ...at, own: false })).toEqual({ visit: false, withdraw: false, report: true });
  });
});
