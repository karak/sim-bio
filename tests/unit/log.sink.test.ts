import { describe, it, expect } from 'vitest';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createConsoleSink } from '../../src/core/log/consoleSink';

const rec = { ts: '2026-01-01T00:00:00.000Z', tick: 3, year: 0, level: 'info' as const, event: 'sim.test', x: 1 };

describe('memorySink', () => {
  it('stores records and finds by event', () => {
    const s = createMemorySink();
    s.write(rec);
    s.write({ ...rec, event: 'other' });
    expect(s.records).toHaveLength(2);
    expect(s.find('sim.test')).toEqual([rec]);
    s.clear();
    expect(s.records).toHaveLength(0);
  });
});

describe('consoleSink', () => {
  it('writes one JSON line per record', () => {
    const lines: string[] = [];
    const s = createConsoleSink((l) => lines.push(l));
    s.write(rec);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(rec);
  });
});
