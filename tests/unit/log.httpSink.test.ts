import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decodeLogBatch, LOG_BATCH_LIMITS, type LogBatch } from '../../src/core/log/batch';
import { createHttpSink, shipsToServer } from '../../src/core/log/httpSink';
import { createAppLogSink } from '../../src/core/log/appSink';
import type { LogRecord } from '../../src/core/log/types';

const URL_ = 'https://example.test/api/v1/logs';

function rec(i: number, over: Partial<LogRecord> = {}): LogRecord {
  return { ts: '2026-01-01T00:00:00.000Z', tick: i, year: 0, level: 'warn', event: 'cmd.rejected', i, ...over };
}

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (n: number) => Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(calls.length);
  });
  const bodies = (): LogBatch[] => calls.map((c) => JSON.parse(String(c.init.body)) as LogBatch);
  return { fetch: fn as unknown as typeof fetch, calls, bodies };
}

const ok = (status = 200) => Promise.resolve(new Response(null, { status }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createHttpSink: バッチ', () => {
  it('N 件たまったら 1 バッチで POST する', async () => {
    const f = fakeFetch(() => ok());
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 3, maxWaitMs: 10_000 });
    sink.write(rec(1));
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(0);
    sink.write(rec(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe(URL_);
    expect(f.calls[0].init.method).toBe('POST');
    expect(new Headers(f.calls[0].init.headers).get('content-type')).toBe('application/json');
    expect(f.bodies()[0]).toEqual({ records: [rec(1), rec(2), rec(3)], dropped: 0 });
  });

  it('N 件に満たなくても T 秒で送る', async () => {
    const f = fakeFetch(() => ok());
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 20, maxWaitMs: 5_000 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(1);
    expect(f.bodies()[0].records).toEqual([rec(1)]);
  });

  it('1 バッチは N 件まで。残りは次のバッチに回る', async () => {
    const f = fakeFetch(() => ok());
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 2, maxWaitMs: 5_000 });
    for (let i = 1; i <= 5; i++) sink.write(rec(i));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.bodies().map((b) => b.records.map((r) => r.i))).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('送るものが無ければ POST しない', async () => {
    const f = fakeFetch(() => ok());
    createHttpSink(URL_, { fetch: f.fetch, maxWaitMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls).toHaveLength(0);
  });
});

describe('createHttpSink: 絞り込み', () => {
  it('既定では warn/error と年ごとの要約 (sim.tick.summary) だけを送る', async () => {
    const f = fakeFetch(() => ok());
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxWaitMs: 1_000 });
    sink.write(rec(1, { level: 'info', event: 'cmd.received' }));
    sink.write(rec(2, { level: 'info', event: 'sim.tick.summary' }));
    sink.write(rec(3, { level: 'warn', event: 'sim.species.extinct' }));
    sink.write(rec(4, { level: 'error', event: 'persist.save.failed' }));
    sink.write(rec(5, { level: 'info', event: 'sim.disaster' }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.bodies()[0].records.map((r) => r.i)).toEqual([2, 3, 4]);
  });

  it('shipsToServer は既定の絞り込みそのもの', () => {
    expect(shipsToServer(rec(1, { level: 'info', event: 'sim.tick.summary' }))).toBe(true);
    expect(shipsToServer(rec(1, { level: 'info', event: 'sim.tick' }))).toBe(false);
    expect(shipsToServer(rec(1, { level: 'warn' }))).toBe(true);
    expect(shipsToServer(rec(1, { level: 'error' }))).toBe(true);
  });

  it('絞り込みは設定で差し替えられる', async () => {
    const f = fakeFetch(() => ok());
    const sink = createHttpSink(URL_, {
      fetch: f.fetch,
      maxWaitMs: 1_000,
      filter: (r) => r.event === 'cmd.received',
    });
    sink.write(rec(1, { level: 'info', event: 'cmd.received' }));
    sink.write(rec(2, { level: 'warn', event: 'cmd.rejected' }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.bodies()[0].records.map((r) => r.i)).toEqual([1]);
  });
});

describe('createHttpSink: 失敗しても本体は止まらない', () => {
  it('通信の失敗は同じバッチを間をあけて送り直す', async () => {
    const f = fakeFetch((n) => (n === 1 ? Promise.reject(new TypeError('offline')) : ok()));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1, retryBaseDelayMs: 1_000 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(2);
    expect(f.bodies()[1]).toEqual({ records: [rec(1)], dropped: 0 });
  });

  it('5xx と 429 は送り直し、送り直しの間隔は倍々に延びる', async () => {
    const f = fakeFetch((n) => (n === 1 ? ok(503) : n === 2 ? ok(429) : ok()));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1, retryBaseDelayMs: 1_000, maxRetries: 3 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(3);
    expect(f.bodies().map((b) => b.records)).toEqual([[rec(1)], [rec(1)], [rec(1)]]);
  });

  it('送り直しが尽きたらそのバッチを捨て、捨てた数を次のバッチで伝える', async () => {
    const f = fakeFetch((n) => (n <= 3 ? Promise.reject(new TypeError('offline')) : ok()));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 2, retryBaseDelayMs: 100, maxRetries: 2 });
    sink.write(rec(1));
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(100 + 200);
    expect(f.calls).toHaveLength(3);
    sink.write(rec(3));
    sink.write(rec(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(4);
    expect(f.bodies()[3]).toEqual({ records: [rec(3), rec(4)], dropped: 2 });
  });

  it('捨てた数は届いたら数え直す', async () => {
    const f = fakeFetch((n) => (n === 1 ? ok(400) : ok()));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(0);
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    sink.write(rec(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.bodies().map((b) => b.dropped)).toEqual([0, 1, 0]);
  });

  it('4xx (429 を除く) は送り直さずに捨てる', async () => {
    const f = fakeFetch(() => ok(400));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1, retryBaseDelayMs: 100 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls).toHaveLength(1);
  });

  it('204 (受け口が黙って捨てた) は届いたものとして扱い、送り直さない', async () => {
    const f = fakeFetch(() => ok(204));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1, retryBaseDelayMs: 100 });
    sink.write(rec(1));
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.bodies().map((b) => b.records.map((r) => r.i))).toEqual([[1], [2]]);
  });

  it('送っている間に上限を超えた分は古いものから捨てる', async () => {
    let release: (r: Response) => void = () => {};
    const f = fakeFetch((n) => (n === 1 ? new Promise<Response>((res) => (release = res)) : ok()));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1, maxBuffered: 3 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 2; i <= 6; i++) sink.write(rec(i));
    release(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.bodies().map((b) => b.records.map((r) => r.i))).toEqual([[1], [4], [5], [6]]);
    expect(f.bodies()[1].dropped).toBe(2);
  });

  it('返事が来ない送信は requestTimeoutMs で打ち切って送り直し、送信は止まらない', async () => {
    const f = fakeFetch((n) => {
      if (n > 1) return ok();
      const signal = f.calls[0].init.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
      });
    });
    const sink = createHttpSink(URL_, {
      fetch: f.fetch,
      maxBatchSize: 1,
      requestTimeoutMs: 3_000,
      retryBaseDelayMs: 1_000,
    });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1_000);
    expect(f.calls).toHaveLength(2);
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.bodies().map((b) => b.records.map((r) => r.i))).toEqual([[1], [1], [2]]);
  });

  it('fetch は keepalive で送る (タブを閉じても返事待ちの送信を取り消させない)', async () => {
    const f = fakeFetch(() => ok());
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBatchSize: 1 });
    sink.write(rec(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls[0].init.keepalive).toBe(true);
  });

  it('fetch が同期で投げても write は投げない', async () => {
    const fetchThrows = vi.fn(() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const sink = createHttpSink(URL_, { fetch: fetchThrows, maxBatchSize: 1, retryBaseDelayMs: 100, maxRetries: 1 });
    expect(() => sink.write(rec(1))).not.toThrow();
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
    expect(fetchThrows).toHaveBeenCalledTimes(2);
  });
});

describe('createHttpSink: 隠れたとき (flushViaBeacon)', () => {
  it('flushViaBeacon は送り残しを sendBeacon で送り、同じ記録を fetch では送らない', async () => {
    const f = fakeFetch(() => ok());
    const beacons: { url: string; body: string; type: string }[] = [];
    const sendBeacon = vi.fn((url: string, data: Blob) => {
      void data.text().then((body) => beacons.push({ url, body, type: data.type }));
      return true;
    });
    const sink = createHttpSink(URL_, { fetch: f.fetch, sendBeacon, maxBatchSize: 20, maxWaitMs: 5_000 });
    sink.write(rec(1));
    sink.write(rec(2));
    sink.flushViaBeacon();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(beacons[0].url).toBe(URL_);
    expect(beacons[0].type).toBe('application/json');
    expect(JSON.parse(beacons[0].body)).toEqual({ records: [rec(1), rec(2)], dropped: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('送り直し待ちのバッチも beacon に含め、N 件ずつに分けて送る', async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError('offline')));
    const bodies: LogBatch[] = [];
    const sendBeacon = vi.fn((_url: string, data: Blob) => {
      void data.text().then((b) => bodies.push(JSON.parse(b) as LogBatch));
      return true;
    });
    const sink = createHttpSink(URL_, { fetch: f.fetch, sendBeacon, maxBatchSize: 2, retryBaseDelayMs: 10_000 });
    sink.write(rec(1));
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    sink.write(rec(3));
    sink.flushViaBeacon();
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies.map((b) => b.records.map((r) => r.i))).toEqual([[1, 2], [3]]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.calls).toHaveLength(1);
  });

  it('捨てた数は最初の beacon だけが運び、beacon が断られた分は捨てた数に足す', async () => {
    let release: (r: Response) => void = () => {};
    const f = fakeFetch((n) => (n === 1 ? new Promise<Response>((res) => (release = res)) : ok()));
    const beacons: Promise<LogBatch>[] = [];
    const sendBeacon = vi.fn((_url: string, data: Blob) => {
      beacons.push(data.text().then((b) => JSON.parse(b) as LogBatch));
      return beacons.length < 3;
    });
    const sink = createHttpSink(URL_, { fetch: f.fetch, sendBeacon, maxBatchSize: 2, maxBuffered: 5 });
    sink.write(rec(1));
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 3; i <= 8; i++) sink.write(rec(i));
    sink.flushViaBeacon();
    const sent = await Promise.all(beacons);
    expect(sent.map((b) => [b.records.map((r) => r.i), b.dropped])).toEqual([
      [[4, 5], 1],
      [[6, 7], 0],
      [[8], 0],
    ]);
    release(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    sink.write(rec(9));
    sink.write(rec(10));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.bodies().map((b) => [b.records.map((r) => r.i), b.dropped])).toEqual([
      [[1, 2], 0],
      [[9, 10], 1],
    ]);
  });

  it('返事待ちの fetch が運んでいる捨てた数は beacon で重ねて数えず、その後に捨てた数も失わない', async () => {
    let release: (r: Response) => void = () => {};
    const f = fakeFetch((n) =>
      n === 1 ? ok(400) : n === 2 ? new Promise<Response>((res) => (release = res)) : ok(),
    );
    const beacons: Promise<LogBatch>[] = [];
    const sendBeacon = vi.fn((_url: string, data: Blob) => {
      beacons.push(data.text().then((b) => JSON.parse(b) as LogBatch));
      return true;
    });
    const sink = createHttpSink(URL_, { fetch: f.fetch, sendBeacon, maxBatchSize: 2, maxBuffered: 2 });
    sink.write(rec(1));
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    sink.write(rec(3));
    sink.write(rec(4));
    await vi.advanceTimersByTimeAsync(0);
    sink.write(rec(5));
    sink.flushViaBeacon();
    for (let i = 6; i <= 8; i++) sink.write(rec(i));
    release(new Response(null, { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    const sent = await Promise.all(beacons);
    expect(sent.map((b) => [b.records.map((r) => r.i), b.dropped])).toEqual([[[5], 0]]);
    expect(f.bodies().map((b) => [b.records.map((r) => r.i), b.dropped])).toEqual([
      [[1, 2], 0],
      [[3, 4], 2],
      [[7, 8], 1],
    ]);
  });

  it('beacon のあとも、タブが戻れば通常の送信が続く', async () => {
    const f = fakeFetch(() => ok());
    const sendBeacon = vi.fn(() => true);
    const sink = createHttpSink(URL_, { fetch: f.fetch, sendBeacon, maxBatchSize: 20, maxWaitMs: 5_000 });
    sink.write(rec(1));
    sink.flushViaBeacon();
    sink.write(rec(2));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.bodies()).toEqual([{ records: [rec(2)], dropped: 0 }]);
  });

  it('sendBeacon が投げても flushViaBeacon は投げず、送れなかった分を捨てた数に足す', async () => {
    const f = fakeFetch(() => ok());
    const sendBeacon = vi.fn((): boolean => {
      throw new TypeError('bad url');
    });
    const sink = createHttpSink(URL_, { fetch: f.fetch, sendBeacon, maxBatchSize: 20, maxWaitMs: 5_000 });
    for (let i = 1; i <= 3; i++) sink.write(rec(i));
    expect(() => sink.flushViaBeacon()).not.toThrow();
    sink.write(rec(4));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.bodies()).toEqual([{ records: [rec(4)], dropped: 3 }]);
  });

  it('送り残しが無ければ beacon を打たない', () => {
    const sendBeacon = vi.fn(() => true);
    const sink = createHttpSink(URL_, { fetch: fakeFetch(() => ok()).fetch, sendBeacon });
    sink.flushViaBeacon();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe('createAppLogSink: 設定で出口を選ぶ', () => {
  it('URL が無ければ console のまま。HTTP へは送らない', async () => {
    const lines: string[] = [];
    const f = fakeFetch(() => ok());
    for (const url of [undefined, '', '  ']) {
      const app = createAppLogSink({ url, out: (l) => lines.push(l), fetch: f.fetch });
      app.log.write(rec(1));
      app.flushViaBeacon();
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lines.map((l) => JSON.parse(l) as LogRecord)).toEqual([rec(1), rec(1), rec(1)]);
    expect(f.calls).toHaveLength(0);
  });

  it('絞り込みなどの HTTP の設定はそのまま createHttpSink に渡る', async () => {
    const f = fakeFetch(() => ok());
    const app = createAppLogSink({
      url: '/api/v1/logs',
      out: () => {},
      fetch: f.fetch,
      filter: (r) => r.event === 'cmd.received',
      maxBatchSize: 1,
    });
    app.log.write(rec(1, { level: 'info', event: 'cmd.received' }));
    app.log.write(rec(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.bodies().map((b) => b.records.map((r) => r.i))).toEqual([[1]]);
  });

  it('URL があれば console にも出し、HTTP にも送る', async () => {
    const lines: string[] = [];
    const f = fakeFetch(() => ok());
    const app = createAppLogSink({ url: ' /api/v1/logs ', out: (l) => lines.push(l), fetch: f.fetch });
    app.log.write(rec(1, { level: 'info', event: 'cmd.received' }));
    app.log.write(rec(2));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lines).toHaveLength(2);
    expect(f.calls.map((c) => c.url)).toEqual(['/api/v1/logs']);
    expect(f.bodies()[0].records).toEqual([rec(2)]);
  });
});

describe('createHttpSink: 捨てた数の会計', () => {
  const outcomes = [
    ['2xx', 0, () => ok(200)],
    ['4xx', 0, () => ok(400)],
    ['通信失敗 (送り直さない)', 0, () => Promise.reject(new TypeError('offline'))],
    ['通信失敗のあと送り直しで 2xx', 1, () => Promise.reject(new TypeError('offline'))],
  ] as const;

  it.each(outcomes)(
    '返事待ちの fetch が %s で終わっても、書いた件数 = 届いた件数 + 届いた dropped の和、同じ記録は二度届かない',
    async (_name, maxRetries, finish) => {
      let release: () => void = () => {};
      const delivered: LogBatch[] = [];
      let n = 0;
      const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const batch = JSON.parse(String(init?.body)) as LogBatch;
        n += 1;
        const call = n;
        const respond = (): Promise<Response> => {
          if (call === 1) return ok(400);
          if (call === 2) return new Promise<void>((res) => (release = res)).then(finish);
          return ok();
        };
        return respond().then((r) => {
          if (r.ok) delivered.push(batch);
          return r;
        });
      }) as unknown as typeof fetch;
      const sendBeacon = vi.fn((_url: string, data: Blob) => {
        void data.text().then((b) => delivered.push(JSON.parse(b) as LogBatch));
        return true;
      });
      const sink = createHttpSink(URL_, {
        fetch: fetchFn,
        sendBeacon,
        maxBatchSize: 2,
        maxBuffered: 2,
        maxRetries,
        retryBaseDelayMs: 1_000,
      });
      let written = 0;
      const write = (i: number) => {
        written += 1;
        sink.write(rec(i));
      };
      write(1);
      write(2);
      await vi.advanceTimersByTimeAsync(0);
      write(3);
      write(4);
      await vi.advanceTimersByTimeAsync(0);
      write(5);
      sink.flushViaBeacon();
      for (let i = 6; i <= 8; i++) write(i);
      release();
      await vi.advanceTimersByTimeAsync(5_000);
      write(9);
      write(10);
      await vi.advanceTimersByTimeAsync(0);
      sink.flushViaBeacon();
      await vi.advanceTimersByTimeAsync(0);
      const arrived = delivered.reduce((n, b) => n + b.records.length, 0);
      const reportedDropped = delivered.reduce((n, b) => n + b.dropped, 0);
      expect(arrived + reportedDropped).toBe(written);
      const ids = delivered.flatMap((b) => b.records.map((r) => r.i));
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

describe('createHttpSink: バッチは受け口の件数の上限 (LOG_BATCH_LIMITS.maxRecords) を超えない', () => {
  it.each([
    ['既定', {}],
    ['maxBatchSize を上限より大きく渡したとき', { maxBatchSize: LOG_BATCH_LIMITS.maxRecords * 5 }],
  ])('%s: 上限の 3 倍を書くと、どのバッチも受け口が受ける形で、件数は上限ちょうど', async (_, opts) => {
    const f = fakeFetch(() => ok(204));
    const sink = createHttpSink(URL_, { fetch: f.fetch, maxBuffered: 1_000, ...opts });
    for (let i = 0; i < LOG_BATCH_LIMITS.maxRecords * 3; i++) sink.write(rec(i));
    await vi.advanceTimersByTimeAsync(0);

    const sizes = f.calls.map((c) => {
      const d = decodeLogBatch(String(c.init.body));
      return d.ok ? d.value.records.length : d.error;
    });
    expect(sizes).toEqual([LOG_BATCH_LIMITS.maxRecords, LOG_BATCH_LIMITS.maxRecords, LOG_BATCH_LIMITS.maxRecords]);
  });
});
