import { describe, it, expect } from 'vitest';
import { describeEvent } from '../../src/ui/Tablet';

const names = { deer: '鹿' };
const alive = { status: 'alive', reason: 'x' } as const;

describe('describeEvent (年表の文)', () => {
  it('介入・予定イベント・力切れ・警告・勝敗をそれぞれ人が読める文にする', () => {
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'spawn_species', speciesId: 'deer', cell: 0, amount: 0.5 } }, names)).toBe('鹿を放った');
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'disaster', kind: 'plague', cell: 0, radius: 4 } }, names)).toBe('疫病を送った');
    expect(describeEvent({ year: 3, kind: 'scheduled', command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 46 } }, names)).toBe('予言どおり隕石が起きた');
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'set_climate', rainScale: 1.25 } }, names)).toBe('雨 ×1.25');
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'set_climate', rainScale: 1, tempOffset: -2 } }, names)).toBe('雨 ×1.00、気温 -2.0');
    expect(describeEvent({ year: 3, kind: 'power_exhausted' }, names)).toBe('力が尽き、気候が元に戻った');
    expect(describeEvent({ year: 3, kind: 'warning', warning: { kind: 'power_low', key: 'power_low', text: '力が足りない(残り 0)' } }, names)).toBe('⚠ 力が足りない(残り 0)');
    expect(describeEvent({ year: 3, kind: 'verdict', verdict: alive }, names)).toBe('島は生き延びた');
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'spawn_species', speciesId: 'unknown', cell: 0, amount: 0.5 } }, names)).toBe('unknownを放った');
  });
  it('文明の段階の上下・崩壊を人が読める文にする (M8-04)', () => {
    expect(describeEvent({ year: 5, kind: 'civ_stage', from: 2, to: 3 }, names)).toBe('文明が 火 → 歌 に上がった');
    expect(describeEvent({ year: 5, kind: 'civ_stage', from: 3, to: 2 }, names)).toBe('文明が 歌 → 火 に下がった');
    expect(describeEvent({ year: 5, kind: 'civ_stage', from: 1, to: 0 }, names)).toBe('文明が崩壊した');
  });
  it('信仰の上下を人が読める文にする (M9-01)', () => {
    expect(describeEvent({ year: 5, kind: 'civ_faith', from: 0.4, to: 0.62 }, names)).toBe('信仰が 0.40 → 0.62 に上がった');
    expect(describeEvent({ year: 5, kind: 'civ_faith', from: 0.62, to: 0.48 }, names)).toBe('信仰が 0.62 → 0.48 に下がった');
  });
  it('勅令 (M9-03): 石板の言葉と、民が従ったか聞かなかったかを人が読める文にする', () => {
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'civ_edict', edict: 'stop_mining' } }, names)).toBe('石板が告げた: 採掘を止めよ');
    expect(describeEvent({ year: 3, kind: 'intervene', command: { type: 'civ_edict', edict: 'resume_mining' } }, names)).toBe('石板が告げた: 採掘を再開せよ');
    expect(describeEvent({ year: 3, kind: 'civ_edict', edict: 'stop_mining', obeyed: true, faith: 0.7 }, names)).toBe('民は採掘を止めた');
    expect(describeEvent({ year: 3, kind: 'civ_edict', edict: 'resume_mining', obeyed: true, faith: 0.7 }, names)).toBe('民は採掘を再開した');
    expect(describeEvent({ year: 3, kind: 'civ_edict', edict: 'stop_mining', obeyed: false, faith: 0.45 }, names)).toBe('民は聞かなかった(信仰 0.45。0.6 に足りない)');
  });
  it('祈りの issued/answered/ignored を人が読める文にする (M9-02)', () => {
    expect(describeEvent({ year: 3, kind: 'prayer', phase: 'issued', prayer: 'rain' }, names)).toBe('民が祈った: 雨を');
    expect(describeEvent({ year: 3, kind: 'prayer', phase: 'answered', prayer: 'rain' }, names)).toBe('祈りに応えた: 雨を');
    expect(describeEvent({ year: 3, kind: 'prayer', phase: 'ignored', prayer: 'rain' }, names)).toBe('祈りを無視した: 雨を');
    expect(describeEvent({ year: 3, kind: 'prayer', phase: 'issued', prayer: 'wolves' }, names)).toBe('民が祈った: 狼を減らして');
    expect(describeEvent({ year: 3, kind: 'prayer', phase: 'issued', prayer: 'crystal' }, names)).toBe('民が祈った: 星の砂を');
  });
});
