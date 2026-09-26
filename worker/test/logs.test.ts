import { exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeLogBatch, LOG_BATCH_LIMITS, type LogBatch } from '../../src/core/log/batch';
import type { LogRecord } from '../../src/core/log/types';

const ORIGIN = 'https://biotope.example';
const LOGS = `${ORIGIN}/api/v1/logs`;

function rec(over: Partial<LogRecord> = {}): LogRecord {
  return { ts: '2026-09-26T00:00:00.000Z', tick: 360, year: 1, level: 'info', event: 'sim.tick.summary', ...over };
}

const post = (body: BodyInit, headers: Record<string, string> = { origin: ORIGIN }) =>
  exports.default.fetch(LOGS, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

type Line = Record<string, unknown>;
let out: { level: 'log' | 'info' | 'warn' | 'error'; line: Line }[] = [];

beforeEach(() => {
  out = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((text: unknown) => {
      out.push({ level, line: JSON.parse(String(text)) as Line });
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

const received = () => out.filter((o) => o.line.event === 'harbor.logs.record');

describe('POST /api/v1/logs: 受け取る', () => {
  it('バッチの記録を 1 件ずつ JSON 1 行にして、level に合う console へ書き、204 を返す', async () => {
    const batch: LogBatch = {
      records: [rec(), rec({ level: 'warn', event: 'cmd.rejected', reason: 'no_power' }), rec({ level: 'error', event: 'persist.unavailable' })],
      dropped: 0,
    };
    const res = await post(encodeLogBatch(batch));

    expect(res.status).toBe(204);
    expect(received()).toEqual([
      { level: 'info', line: { event: 'harbor.logs.record', record: batch.records[0] } },
      { level: 'warn', line: { event: 'harbor.logs.record', record: batch.records[1] } },
      { level: 'error', line: { event: 'harbor.logs.record', record: batch.records[2] } },
    ]);
    expect(out.filter((o) => o.line.event === 'harbor.logs.dropped')).toEqual([]);
  });

  it('クライアントが捨てた数は warn の 1 行で残す', async () => {
    const res = await post(encodeLogBatch({ records: [], dropped: 7 }));

    expect(res.status).toBe(204);
    expect(out).toEqual([{ level: 'warn', line: { event: 'harbor.logs.dropped', dropped: 7 } }]);
  });

  it('本文がちょうど上限の大きさなら受ける', async () => {
    const base = encodeLogBatch({ records: [rec({ pad: '' })], dropped: 0 });
    const body = base.replace('"pad":""', `"pad":"${'x'.repeat(LOG_BATCH_LIMITS.maxBytes - base.length)}"`);
    expect(new TextEncoder().encode(body).byteLength).toBe(LOG_BATCH_LIMITS.maxBytes);

    const res = await post(body);

    expect(res.status).toBe(204);
    expect(received()).toHaveLength(1);
  });
});

describe('POST /api/v1/logs: 断る', () => {
  it('JSON でない本文は 400 で、理由を返す', async () => {
    const res = await post('{"records":[');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', path: '', reason: 'JSON として読めない' });
    expect(received()).toEqual([]);
  });

  it('形が違えば 400 で、どこが違うかを返し、1 件も書かない', async () => {
    const res = await post(JSON.stringify({ records: [rec(), rec({ level: 'debug' as LogRecord['level'] })], dropped: 0 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', path: 'records[1].level', reason: 'info・warn・error のどれでもない' });
    expect(received()).toEqual([]);
    expect(out).toEqual([
      {
        level: 'warn',
        line: { event: 'harbor.api.rejected', status: 400, route: '/api/v1/logs', error: 'bad_request', path: 'records[1].level', reason: 'info・warn・error のどれでもない' },
      },
    ]);
  });

  it('上限を 1 バイト超える本文は 413', async () => {
    const res = await post('x'.repeat(LOG_BATCH_LIMITS.maxBytes + 1));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large', maxBytes: LOG_BATCH_LIMITS.maxBytes });
    expect(received()).toEqual([]);
  });

  it('Content-Length の無い本文 (stream) でも、読みながら上限で止めて 413', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });

    const res = await post(body);

    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(LOG_BATCH_LIMITS.maxBytes * 4);
    expect(received()).toEqual([]);
  });

  it.each([
    ['別の Origin', { origin: 'https://evil.example' }],
    ['Origin が無い', {} as Record<string, string>],
  ])('%s からの POST は 403 で、中身を読まない', async (_, headers) => {
    const res = await post(encodeLogBatch({ records: [rec()], dropped: 0 }), headers);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin' });
    expect(received()).toEqual([]);
    expect(out).toEqual([{ level: 'warn', line: { event: 'harbor.api.rejected', status: 403, route: '/api/v1/logs', error: 'forbidden_origin', origin: headers.origin ?? null } }]);
  });

  it('POST 以外は 405 で、Allow を返す', async () => {
    const res = await exports.default.fetch(LOGS, { headers: { origin: ORIGIN } });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
    expect(out).toEqual([{ level: 'warn', line: { event: 'harbor.api.rejected', status: 405, route: '/api/v1/logs', error: 'method_not_allowed', method: 'GET' } }]);
  });

  it('申告の Content-Length が上限を超えていたら、中身が小さく正しくても読まずに 413', async () => {
    const small = new TextEncoder().encode(encodeLogBatch({ records: [rec()], dropped: 0 }));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(small);
        c.close();
      },
    });

    const res = await post(body, { origin: ORIGIN, 'content-length': String(LOG_BATCH_LIMITS.maxBytes + 1) });

    expect(res.status).toBe(413);
    expect(received()).toEqual([]);
  });
});

describe('Origin の門', () => {
  it('Referrer-Policy: no-referrer で Origin が null になっても、Sec-Fetch-Site: same-origin なら受ける', async () => {
    const res = await post(encodeLogBatch({ records: [rec()], dropped: 0 }), { origin: 'null', 'sec-fetch-site': 'same-origin' });

    expect(res.status).toBe(204);
    expect(received()).toHaveLength(1);
  });

  it.each([
    ['cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['same-site (別のサブドメイン)', { origin: 'https://other.biotope.example', 'sec-fetch-site': 'same-site' }],
  ])('Sec-Fetch-Site が %s なら 403', async (_, headers) => {
    const res = await post(encodeLogBatch({ records: [rec()], dropped: 0 }), headers);

    expect(res.status).toBe(403);
    expect(received()).toEqual([]);
  });

});

describe('/api/* のほか', () => {
  it.each(['/api/v1/chronicles', '/api/v2/logs', '/api/', '/api/v1/logs/extra', '/api/constructor', '/api/__proto__'])(
    '%s はまだ無いので 404',
    async (path) => {
      const res = await exports.default.fetch(`${ORIGIN}${path}`, { method: 'POST', headers: { origin: ORIGIN }, body: '{}' });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    },
  );
});
