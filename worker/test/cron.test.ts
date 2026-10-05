import { env } from 'cloudflare:workers';
import { createScheduledController } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { captureLogs, utcDay } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 27, 0, 10, 0);
const hex = (c: string) => c.repeat(64);

async function chronicle(id: string, hiddenAt: number | null) {
  await env.HARBOR.prepare(
    `INSERT INTO chronicles (id, sim_version, scenario_id, seed, inscription, verdict, year, digest_hash, body, bytes, published_at, withdraw_hash, hidden_at)
     VALUES (?, '1', 'sinking', 1, 'still-here', 'alive', 3, ?, '{}', 2, ?, ?, ?)`,
  )
    .bind(id, hex('0'), NOW - 40 * DAY, hex('1'), hiddenAt)
    .run();
}

const ids = async (sql: string) => (await env.HARBOR.prepare(sql).all<Record<string, string>>()).results.map((r) => Object.values(r).join('|'));

describe('Cron (毎日 00:10 UTC): 掃除と保存量の集計', () => {
  it('昨日までの通報の送り手・7 日より古い積荷と予算の行・隠して 30 日たった年代記を消し、見える年代記と通報の数は残す', async () => {
    await chronicle(hex('a'), null);
    await chronicle(hex('b'), NOW - 31 * DAY);
    await chronicle(hex('c'), NOW - 2 * DAY);
    await env.HARBOR.prepare('UPDATE chronicles SET reports = 2 WHERE id = ?').bind(hex('a')).run();
    await env.HARBOR.batch([
      env.HARBOR.prepare('INSERT INTO reports VALUES (?, ?, ?)').bind(hex('a'), utcDay(NOW - DAY), 'yesterday'),
      env.HARBOR.prepare('INSERT INTO reports VALUES (?, ?, ?)').bind(hex('a'), utcDay(NOW), 'today'),
      env.HARBOR.prepare('INSERT INTO reports VALUES (?, ?, ?)').bind(hex('b'), utcDay(NOW), 'today-on-hidden'),
      env.HARBOR.prepare("INSERT INTO cargo (id, items, cast_at) VALUES ('old', '[]', ?)").bind(NOW - 8 * DAY),
      env.HARBOR.prepare("INSERT INTO cargo (id, items, cast_at) VALUES ('new', '[]', ?)").bind(NOW - 6 * DAY),
      env.HARBOR.prepare("INSERT INTO daily_budget VALUES (?, 'publish', 5)").bind(utcDay(NOW - 8 * DAY)),
      env.HARBOR.prepare("INSERT INTO daily_budget VALUES (?, 'publish', 7)").bind(utcDay(NOW - 7 * DAY)),
    ]);
    const logs = captureLogs();

    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '10 0 * * *' }), env);

    expect(await ids('SELECT id FROM chronicles ORDER BY id')).toEqual([hex('a'), hex('c')]);
    expect(await ids('SELECT reports FROM chronicles WHERE id = ' + `'${hex('a')}'`)).toEqual(['2']);
    expect(await ids('SELECT sender FROM reports')).toEqual(['today']);
    expect(await ids('SELECT id FROM cargo')).toEqual(['new']);
    expect(await ids('SELECT day FROM daily_budget')).toEqual([utcDay(NOW - 7 * DAY)]);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'harbor.cron.swept', chronicles: 1, reports: 1, cargo: 1, budget: 1 }));
  });

  it('保存量を harbor_stats に書き、Workers Logs にも 1 行残す', async () => {
    await chronicle(hex('d'), null);
    await chronicle(hex('e'), NOW - DAY);
    await env.HARBOR.prepare("INSERT INTO cargo (id, items, cast_at) VALUES ('x', '[]', ?)").bind(NOW).run();
    const logs = captureLogs();

    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '10 0 * * *' }), env);

    const row = await env.HARBOR.prepare('SELECT * FROM harbor_stats WHERE day = ?').bind(utcDay(NOW)).first<Record<string, number>>();
    expect(row).toMatchObject({ chronicles: 2, hidden: 1, cargo: 1, measured_at: NOW });
    expect(row?.stored_bytes).toBeGreaterThan(0);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'harbor.cron.stats', chronicles: 2, hidden: 1, cargo: 1, storedBytes: row?.stored_bytes }));
  });

  it('D1 が落ちていても例外を投げず、失敗を 1 行残す', async () => {
    const logs = captureLogs();
    const broken = new Proxy(env.HARBOR, { get: (t, p) => (p === 'prepare' || p === 'batch' ? () => { throw new Error("Your account has exceeded D1's free tier daily row write limit."); } : Reflect.get(t, p)) });

    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: '10 0 * * *' }), { ...env, HARBOR: broken });

    expect(logs).toContainEqual(expect.objectContaining({ event: 'harbor.d1.failed', reason: 'd1_write_limit' }));
  });
});
