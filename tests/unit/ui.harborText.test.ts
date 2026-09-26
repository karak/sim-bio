import { describe, it, expect } from 'vitest';
import { digestOf } from '../../src/chronicle/digest';
import type { ChronicleId } from '../../src/harbor/contract';
import { confirmText, endingText, publishText, readResultOf, readText, readingText, reportText, resentText, withdrawText } from '../../src/ui/harborText';

const id = 'a'.repeat(64) as ChronicleId;

describe('港の画面の言葉 (M19-09)', () => {
  it('結末は判定ごとに石板の名と年で言う', () => {
    expect(endingText({ verdict: 'alive', year: 100 }, '沈む欠片')).toBe('沈む欠片を 100 年、生き延びた');
    expect(endingText({ verdict: 'dead', year: 62 }, '沈む欠片')).toBe('沈む欠片の 62 年目に滅びた');
    expect(endingText({ verdict: 'escaped', year: 120 }, '空の舟')).toBe('空の舟の 120 年目に、次の島へ逃れた');
  });

  it('確かめた人と、違う結末になった人の数', () => {
    expect(confirmText({ confirms: 0, mismatches: 0 })).toBe('まだ誰もたどっていない');
    expect(confirmText({ confirms: 3, mismatches: 0 })).toBe('3 人がたどって確かめた');
    expect(confirmText({ confirms: 2, mismatches: 1 })).toBe('2 人がたどって確かめた。1 人は違う結末になった');
    expect(confirmText({ confirms: 0, mismatches: 1 })).toBe('たどって確かめた人はまだいない。1 人は違う結末になった');
  });

  it('出港の結末ごとに、何が起きて次に何をするかを言う (閉港は預けた、と言う)', () => {
    expect(publishText({ kind: 'published', id, url: 'https://x/' })).toBe('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
    expect(publishText({ kind: 'queued', id })).toBe('港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す');
    expect(publishText({ kind: 'not_human' })).toBe('人の手と確かめられなかった。もう一度「出港する」を押す');
    expect(publishText({ kind: 'slow_down' })).toBe('港が混んでいる。少し待ってから、もう一度「出港する」を押す');
    expect(publishText({ kind: 'rejected', reason: 'chronicle.scenarioId: unknown_scenario' })).toBe('港が受け取れない年代記だった (chronicle.scenarioId: unknown_scenario)');
    expect(resentText(0)).toBeNull();
    expect(resentText(2)).toBe('預けていた年代記 2 件を港へ出した');
  });

  it('通報と取り下げの結末 (閉港は普段の言葉で)', () => {
    expect(reportText('ok')).toBe('通報した。3 件集まると、港から隠れる');
    expect(reportText('closed')).toBe('港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる');
    expect(reportText('not_human')).toBe('人の手と確かめられなかった。もう一度「通報」を押す');
    expect(withdrawText('ok')).toBe('取り下げた。港にはもう並ばない');
    expect(withdrawText('forbidden')).toBe('この島の取り下げ鍵が手元に無いので、取り下げられない');
  });

  it('照合: 判定と年が港の記録と合えば同じ結末、違えば読んだ結末を添える', async () => {
    const card = { verdict: 'alive', year: 3 } as const;
    const same = readResultOf({ kind: 'done', digest: await digestOf({ year: 3, totals: { deer: 1 } }, 'alive') }, card);
    expect(same.kind).toBe('matched');
    expect(readText(same, '沈む欠片')).toBe('読み終えた。港の記録と同じ結末になった');
    const other = readResultOf({ kind: 'done', digest: await digestOf({ year: 2, totals: { deer: 0 } }, 'dead') }, card);
    expect(readText(other, '沈む欠片')).toBe('読み終えた。港の記録と違う結末になった (沈む欠片の 2 年目に滅びた)');
    expect(readText(readResultOf({ kind: 'aborted' }, card), '沈む欠片')).toBe('読むのをやめた。もう一度読むと、初めから読む');
    expect(readText(readResultOf({ kind: 'broken', error: { path: 'commands[1].tick', reason: 'not_monotonic' } }, card), '沈む欠片')).toBe(
      '年代記が壊れていて、読み切れなかった (commands[1].tick: not_monotonic)',
    );
    expect(readingText(37, 100)).toBe('37 / 100 年を読んだ');
    expect(readingText(101, 100)).toBe('100 / 100 年を読んだ');
  });
});
