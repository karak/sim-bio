import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeLogBatch } from '../../src/core/log/batch';
import { chronicleId, type ChronicleId } from '../../src/harbor/contract';
import { writeRequest } from '../../src/harbor/wire';
import { serve } from '../src/harbor';
import { BUDGETS, HARBOR_CONFIG, type Bucket } from '../src/policy';
import worker from '../src/index';
import { captureLogs, digestFor, freshIp, ORIGIN, publishReq, refusalOf, send, stubSiteverify, utcDay } from './helpers';

beforeEach(() => {
  stubSiteverify();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = Date.UTC(2026, 8, 26, 21, 0, 0);
const seed = (bucket: Bucket, used: number, day = utcDay(Date.now())) =>
  env.HARBOR.prepare('INSERT INTO daily_budget (day, bucket, used) VALUES (?, ?, ?) ON CONFLICT (day, bucket) DO UPDATE SET used = excluded.used').bind(day, bucket, used).run();
const used = async (bucket: Bucket) =>
  (await env.HARBOR.prepare('SELECT used FROM daily_budget WHERE day = ? AND bucket = ?').bind(utcDay(Date.now()), bucket).first<{ used: number }>())?.used ?? 0;

async function published(n: number): Promise<ChronicleId> {
  const req = await publishReq(n);
  expect((await send(req, { ip: freshIp() })).status).toBe(201);
  return chronicleId(req.chronicle);
}

describe('日次予算 (設計書 §6.1)', () => {
  it('出港の予算 (2,000 件) を使い切ると 503 で閉港 (budget)。Retry-After は UTC の 0 時まで', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await seed('publish', BUDGETS.publish.cap);

    const res = await send(await publishReq(1), { ip: freshIp() });

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe(String(3 * 60 * 60));
    expect(await refusalOf(res)).toEqual({ error: 'closed', reason: 'budget' });
    expect(await env.HARBOR.prepare('SELECT COUNT(*) AS n FROM chronicles').first('n')).toBe(0);
  });

  it('使った分だけ数える。形の誤り・人間確認の失敗では数えない', async () => {
    await send(await publishReq(2), { ip: freshIp() });
    await send({ ...(await publishReq(3)), turnstile: 'bot' as never }, { ip: freshIp() });
    await send({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'dragon', amount: 1 }] } });

    expect(await used('publish')).toBe(1);
    expect(await used('cast_cargo')).toBe(0);
  });

  it('捨てる順: 日の合計が一覧の段を越えると、ログ・確認・一覧は閉じ、積荷・出港・訪問は開いている', async () => {
    const id = await published(4);
    await seed('draw_cargo', BUDGETS.browse.shedAt);

    const logs = captureLogs();
    const logRes = await exports.default.fetch(`${ORIGIN}/api/v1/logs`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: encodeLogBatch({ records: [{ ts: '2026-09-26T00:00:00.000Z', tick: 1, year: 0, level: 'info', event: 'sim.tick.summary' }], dropped: 0 }),
    });
    expect(logRes.status).toBe(204);
    expect(logs.filter((l) => l.event === 'harbor.logs.record')).toEqual([]);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'harbor.budget.dropped', bucket: 'logs' }));

    expect((await send({ kind: 'confirm', id, digest: await digestFor() })).status).toBe(204);
    expect(await env.HARBOR.prepare('SELECT confirms FROM chronicles WHERE id = ?').bind(id).first('confirms')).toBe(0);
    expect(await refusalOf(await send({ kind: 'browse', scenarioId: null, before: null }))).toEqual({ error: 'closed', reason: 'budget' });

    expect((await send({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'deer', amount: 1 }] } }, { ip: freshIp() })).status).toBe(204);
    expect((await send(await publishReq(5), { ip: freshIp() })).status).toBe(201);
    expect((await send({ kind: 'visit', id })).status).toBe(200);
  });

  it('捨てる順: 日の合計が出港の段を越えても、訪問 (共有リンク) は最後まで開いている', async () => {
    const id = await published(6);
    await seed('draw_cargo', BUDGETS.publish.shedAt);

    expect(await refusalOf(await send(await publishReq(7), { ip: freshIp() }))).toEqual({ error: 'closed', reason: 'budget' });
    expect((await send({ kind: 'visit', id })).status).toBe(200);
  });

  it('段は下から ログ < 確認 < 一覧 < 積荷 < 出港 < 訪問 の順に閉じる', () => {
    const order: Bucket[] = ['logs', 'confirm', 'browse', 'cast_cargo', 'publish', 'visit'];
    const shed = order.map((b) => BUDGETS[b].shedAt);
    expect(shed).toEqual([...shed].sort((a, b) => a - b));
    expect(new Set(shed).size).toBe(shed.length);
  });

  it('前の日の使用は今日の予算に数えない', async () => {
    await seed('publish', BUDGETS.publish.cap, '2000-01-01');
    await seed('visit', BUDGETS.visit.shedAt, '2000-01-01');

    expect((await send(await publishReq(8), { ip: freshIp() })).status).toBe(201);
  });
});

describe('保存の内部の栓 (400 MB)', () => {
  it('D1 の大きさが栓を越えたら、出港だけを 503 (full) で閉じ、訪問は開いている', async () => {
    const id = await published(9);
    const ctx = { env, now: Date.now(), ip: freshIp(), config: { ...HARBOR_CONFIG, storageCapBytes: 1 } };
    const w = writeRequest(await publishReq(10));

    expect(await serve({ ...w, headers: { ...w.headers, origin: ORIGIN } }, ctx)).toMatchObject({ kind: 'refused', refusal: { error: 'closed', reason: 'full' } });
    expect(await serve(writeRequest({ kind: 'visit', id }), ctx)).toMatchObject({ kind: 'ok', status: 200 });
    expect(await env.HARBOR.prepare('SELECT COUNT(*) AS n FROM chronicles').first('n')).toBe(1);
    expect(HARBOR_CONFIG.storageCapBytes).toBe(400_000_000);
  });
});

/** D1 の問い合わせを、決まった誤りで落とす D1 (本物の D1 を包む) */
function failingD1(message: string): D1Database {
  const fail = () => Promise.reject(new Error(message));
  return new Proxy(env.HARBOR, {
    get(target, prop) {
      if (prop === 'batch') return fail;
      if (prop !== 'prepare') return Reflect.get(target, prop);
      return (sql: string) =>
        new Proxy(target.prepare(sql), {
          get(stmt, p) {
            if (p === 'bind') return () => failingStatement(stmt);
            if (p === 'first' || p === 'run' || p === 'all' || p === 'raw') return fail;
            return Reflect.get(stmt, p);
          },
        });
    },
  });
  function failingStatement(stmt: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(stmt, { get: (s, p) => (p === 'first' || p === 'run' || p === 'all' || p === 'raw' ? fail : Reflect.get(s, p)) });
  }
}

describe('D1 の上限 (2026-09-01 からの enforcement) を閉港の返事に読み替える', () => {
  it.each([
    ["Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.", 'd1_read_limit'],
    ["D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.", 'd1_write_limit'],
    ['Exceeded maximum DB size.', 'd1_storage'],
    ['D1 DB reset because its code was updated.', 'unavailable'],
  ])('%s → 503 closed (%s)', async (message, reason) => {
    const logs = captureLogs();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/v1/chronicles`), { ...env, HARBOR: failingD1(message) });

    expect(res.status).toBe(503);
    expect(await refusalOf(res)).toEqual({ error: 'closed', reason });
    expect(logs).toContainEqual(expect.objectContaining({ event: 'harbor.d1.failed', reason, message }));
  });

  it('D1 が上限でも、ログの受け口は D1 に頼らず受ける (予算の数えを飛ばす)', async () => {
    const logs = captureLogs();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/logs`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: encodeLogBatch({ records: [{ ts: '2026-09-26T00:00:00.000Z', tick: 1, year: 0, level: 'warn', event: 'cmd.rejected' }], dropped: 0 }),
      }),
      { ...env, HARBOR: failingD1("Your account has exceeded D1's free tier daily row write limit.") },
    );

    expect(res.status).toBe(204);
    expect(logs.filter((l) => l.event === 'harbor.logs.record')).toHaveLength(1);
  });
});
