import { describe, it, expect } from 'vitest';
import { decodeLogBatch, encodeLogBatch, LOG_BATCH_LIMITS, type LogBatch } from '../../src/core/log/batch';
import { createHttpSink } from '../../src/core/log/httpSink';
import type { LogRecord } from '../../src/core/log/types';

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return { ts: '2026-09-26T00:00:00.000Z', tick: 360, year: 1, level: 'info', event: 'sim.tick.summary', ...over };
}

const rejects = (body: unknown) => {
  const r = decodeLogBatch(JSON.stringify(body));
  if (r.ok) throw new Error(`受け入れてしまった: ${JSON.stringify(body)}`);
  return r.error;
};

describe('decodeLogBatch: 受け入れる形', () => {
  it('encodeLogBatch で書いた本文は、同じ中身に戻る (クライアントと受け口の往復)', () => {
    const batch: LogBatch = {
      records: [rec(), rec({ level: 'warn', event: 'cmd.rejected', reason: 'no_power', cell: 12 }), rec({ level: 'error', event: 'persist.unavailable', error: 'QuotaExceededError' })],
      dropped: 3,
    };
    expect(decodeLogBatch(encodeLogBatch(batch))).toEqual({ ok: true, value: batch });
  });

  it('records は空でもよく、件数は上限ちょうどまで受ける', () => {
    expect(decodeLogBatch(encodeLogBatch({ records: [], dropped: 5 }))).toEqual({ ok: true, value: { records: [], dropped: 5 } });
    const full = Array.from({ length: LOG_BATCH_LIMITS.maxRecords }, (_, i) => rec({ tick: i }));
    const r = decodeLogBatch(encodeLogBatch({ records: full, dropped: 0 }));
    expect(r.ok && r.value.records).toHaveLength(LOG_BATCH_LIMITS.maxRecords);
  });

  it('event は上限の長さちょうどまで受ける', () => {
    const event = 'e'.repeat(LOG_BATCH_LIMITS.maxEventLength);
    const r = decodeLogBatch(encodeLogBatch({ records: [rec({ event })], dropped: 0 }));
    expect(r.ok && r.value.records[0].event).toBe(event);
  });
});

describe('decodeLogBatch: 拒否する形と、その場所', () => {
  it('JSON でない本文', () => {
    expect(decodeLogBatch('{"records":[')).toEqual({ ok: false, error: { path: '', reason: 'JSON として読めない' } });
  });

  it.each([
    ['null', null],
    ['配列', []],
    ['文字列', 'records'],
  ])('いちばん外が object でない (%s)', (_, body) => {
    expect(rejects(body)).toEqual({ path: '', reason: 'object ではない' });
  });

  it('知らない鍵がいちばん外にある (クライアントとの食い違いを黙って通さない)', () => {
    expect(rejects({ records: [], dropped: 0, sessionId: 'x' })).toEqual({ path: 'sessionId', reason: '知らない鍵' });
  });

  it.each([
    ['無い', { dropped: 0 }, 'records', '配列ではない'],
    ['object', { records: {}, dropped: 0 }, 'records', '配列ではない'],
    ['上限を超える', { records: Array.from({ length: LOG_BATCH_LIMITS.maxRecords + 1 }, () => rec()), dropped: 0 }, 'records', `${LOG_BATCH_LIMITS.maxRecords} 件を超える`],
  ])('records が%s', (_, body, path, reason) => {
    expect(rejects(body)).toEqual({ path, reason });
  });

  it.each([
    ['無い', { records: [] }],
    ['負', { records: [], dropped: -1 }],
    ['小数', { records: [], dropped: 1.5 }],
    ['文字列', { records: [], dropped: '0' }],
  ])('dropped が%s', (_, body) => {
    expect(rejects(body)).toEqual({ path: 'dropped', reason: '0 以上の整数ではない' });
  });

  it.each([
    ['記録が object でない', [rec(), 'warn'], 'records[1]', 'object ではない'],
    ['ts が無い', [{ ...rec(), ts: undefined }], 'records[0].ts', '文字列ではない'],
    ['ts が空', [rec({ ts: '' })], 'records[0].ts', '空の文字列'],
    ['ts が長すぎる', [rec({ ts: '2'.repeat(LOG_BATCH_LIMITS.maxTsLength + 1) })], 'records[0].ts', `${LOG_BATCH_LIMITS.maxTsLength} 文字を超える`],
    ['tick が文字列', [rec({ tick: '360' as unknown as number })], 'records[0].tick', '数ではない'],
    ['year が null', [rec({ year: null as unknown as number })], 'records[0].year', '数ではない'],
    ['level が知らない値', [rec(), rec({ level: 'debug' as LogRecord['level'] })], 'records[1].level', 'info・warn・error のどれでもない'],
    ['event が空', [rec({ event: '' })], 'records[0].event', '空の文字列'],
    ['event が長すぎる', [rec({ event: 'e'.repeat(LOG_BATCH_LIMITS.maxEventLength + 1) })], 'records[0].event', `${LOG_BATCH_LIMITS.maxEventLength} 文字を超える`],
  ])('%s', (_, records, path, reason) => {
    expect(rejects({ records, dropped: 0 })).toEqual({ path, reason });
  });
});

describe('HTTP LogSink のバッチは受け口の件数の上限を超えない', () => {
  it.each([
    ['既定', {}],
    ['maxBatchSize を上限より大きく渡したとき', { maxBatchSize: LOG_BATCH_LIMITS.maxRecords * 5 }],
  ])('%s: 上限の 3 倍を書くと、どのバッチも受け口が受ける形で、件数は上限ちょうど', async (_, opts) => {
    const bodies: string[] = [];
    const send = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      bodies.push(String(init?.body));
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const sink = createHttpSink('https://example.test/api/v1/logs', { fetch: send, maxBuffered: 1_000, ...opts });
    for (let i = 0; i < LOG_BATCH_LIMITS.maxRecords * 3; i++) sink.write(rec({ level: 'warn', event: 'cmd.rejected', tick: i }));
    await new Promise((r) => setTimeout(r, 0));

    const sizes = bodies.map((b) => {
      const d = decodeLogBatch(b);
      return d.ok ? d.value.records.length : d.error;
    });
    expect(sizes[0]).toBe(LOG_BATCH_LIMITS.maxRecords);
  });
});
