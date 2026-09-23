import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { disasterClick, spawnClick } from '../../src/ui/clicks';

describe('UI の 1 クリック (M21-01)', () => {
  it('放流は環 1・0.5、疫病は環 4', () => {
    expect(spawnClick('grass', 10)).toEqual({ type: 'spawn_species', speciesId: 'grass', cell: 10, amount: 0.5, radius: 1 });
    expect(disasterClick('plague', 10)).toEqual({ type: 'disaster', kind: 'plague', cell: 10, radius: 4 });
  });

  it('通し実行の台本は放流と災害を UI の 1 クリックでしか打たない (手で再現できない想定解を作らない)', () => {
    const dir = 'tests/slow';
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .flatMap((f) => readFileSync(`${dir}/${f}`, 'utf8').split('\n').map((line, i) => ({ at: `${dir}/${f}:${i + 1}`, line })))
      .filter(({ line }) => /type:\s*'(spawn_species|disaster)'/.test(line))
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });
});
