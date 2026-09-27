import { describe, it, expect } from 'vitest';
import { askOf } from '../../src/ui/confirmAsk';
import { planSlotLoad, type Here } from '../../src/persist/slotSave';

const head = { simVersion: 'v', scenarioId: 'test-quick', seed: 1 };
const inScenario: Here = { stage: 'scenario', head };
const titleOf = (id: string) => (id === 'test-quick' ? '試し読み' : id);

describe('確かめのダイアログの中身 (M21-04): やり直しの効かない操作だけに確かめを付ける', () => {
  it('新しい島・石板を初めから: 今の島を捨てるので確かめる (文は M19-05 / M19-17 の window.confirm と同じ)', () => {
    expect(askOf({ kind: 'new_island', inScenario: false })).toEqual({
      title: '新しい島',
      message: '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)',
      ok: '新しい島を始める',
    });
    expect(askOf({ kind: 'new_island', inScenario: true })).toEqual({
      title: '石板を初めから',
      message: '今の続きを捨てて、石板を初めからやり直しますか (判定の出た島は港へ出せるまま残ります)',
      ok: '初めからやり直す',
    });
  });

  it('枠とファイルの読込: 同じ舞台は今の島を差し替え、違う舞台は移った先の続きを上書きするので、どちらも確かめる (文は planSlotLoad)', () => {
    const replace = planSlotLoad({ stage: 'free' }, { stage: 'free' }, titleOf);
    expect(askOf({ kind: 'load', plan: replace })).toEqual({ title: '枠の島を読み込む', message: replace.confirm, ok: '読み込む' });
    const back = planSlotLoad({ stage: 'scenario', scenarioId: 'test-quick' }, inScenario, titleOf);
    expect(askOf({ kind: 'load', plan: back })?.message).toBe('石板を枠の時点に戻しますか (今の続きは上書きされます)');
    const move = planSlotLoad({ stage: 'scenario', scenarioId: 'test-quick' }, { stage: 'free' }, titleOf);
    expect(askOf({ kind: 'load', plan: move })).toEqual({ title: '舞台を移って読む', message: '石板『試し読み』の枠です。石板を開いて読みますか', ok: '移って読む' });
  });

  it('枠へ保存: 空きの枠へは確かめず、書いてある枠を上書きするときだけ前の保存の名前を出して確かめる', () => {
    expect(askOf({ kind: 'slot_save', overwrites: null })).toBeNull();
    expect(askOf({ kind: 'slot_save', overwrites: '枠 1 · 試し読み · 0 年' })).toEqual({
      title: '枠を上書きする',
      message: '「枠 1 · 試し読み · 0 年」を今の島で上書きしますか (前の保存には戻せません)',
      ok: '上書きする',
    });
  });

  it('舞台を移る (石板を選ぶ・自由モードへ・もう一度・訪れる): 今の続きは書き切ってから移るので確かめない。判定の出た島だけは開き直すと初めからになるので確かめる', () => {
    expect(askOf({ kind: 'leave', finished: false })).toBeNull();
    expect(askOf({ kind: 'leave', finished: true })).toEqual({
      title: '判定の出た島を離れる',
      message: '判定の出た島を離れますか。枠へ保存していなければ、この島には戻れません (港へ出す島は港に残ります)',
      ok: '離れる',
    });
  });

  it('港から取り下げる: 港の記録 (確かめた人の数ごと) を消すので、島の名前を出して確かめる', () => {
    expect(askOf({ kind: 'withdraw', name: 'アサギの島' })).toEqual({
      title: '港から取り下げる',
      message: 'アサギの島を港から取り下げますか (たどって確かめた人の数ごと消え、戻せません)',
      ok: '取り下げる',
    });
  });
});
