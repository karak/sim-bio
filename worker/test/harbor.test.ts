import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/chronicle/digest';
import { chronicleId, type BrowseCursor, type ChronicleId, type HarborCatalog, type InscriptionId } from '../../src/harbor/contract';
import { MAX_BODY_BYTES, readResponse, writeRequest } from '../../src/harbor/wire';
import { BOT, captureLogs, chronicleOf, digestFor, freshIp, HUMAN, keyOf, ORIGIN, publishReq, refusalOf, send, stubSiteverify } from './helpers';

const catalog: HarborCatalog = { scenarios: new Set(['sinking', 'volcano']), species: new Set(['deer', 'wolf', 'rabbit']), inscriptions: new Set(['still-here', 'we-tried']) };

let siteverify: ReturnType<typeof stubSiteverify>;
beforeEach(() => {
  siteverify = stubSiteverify();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function publish(seed: number, ip = freshIp()) {
  const req = await publishReq(seed);
  const res = await send(req, { ip });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return { req, id: await chronicleId(req.chronicle) };
}

const browse = async (q: { scenarioId?: string; before?: BrowseCursor } = {}) => {
  const res = await send({ kind: 'browse', scenarioId: q.scenarioId ?? null, before: q.before ?? null });
  expect(res.status).toBe(200);
  const body = readResponse('browse', await res.text(), catalog);
  if (!body.ok) throw new Error(JSON.stringify(body.error));
  return body.value;
};
const count = async (table: string) => (await env.HARBOR.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

describe('出港 POST /api/v1/chronicles', () => {
  it('出港すると 201 で id (Worker が chronicleId で計算した値) を返し、D1 には取り下げ鍵の SHA-256 だけを置く', async () => {
    const req = await publishReq(1);
    const res = await send(req, { ip: '203.0.113.77' });

    expect(res.status).toBe(201);
    const id = await chronicleId(req.chronicle);
    expect(readResponse('publish', await res.text(), catalog)).toEqual({ ok: true, value: { id } });
    const row = await env.HARBOR.prepare('SELECT * FROM chronicles WHERE id = ?').bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ scenario_id: 'sinking', seed: 1, inscription: 'still-here', verdict: 'alive', year: 3, digest_hash: req.digest.hash, withdraw_hash: await sha256Hex(req.key), reports: 0, hidden_at: null });
    const everything = JSON.stringify(await env.HARBOR.prepare('SELECT * FROM chronicles').all());
    expect(everything).not.toContain(req.key);
    expect(everything).not.toContain('203.0.113.77');
    expect(siteverify.calls).toEqual([{ secret: '1x0000000000000000000000000000000AA', response: HUMAN }]);
  });

  it('同じ年代記の出港は 2 回で 1 件 (INSERT OR IGNORE)。2 回目は 200 で同じ id を返し、鍵は最初のものだけが効く', async () => {
    const first = await publishReq(2);
    const again = { ...first, key: keyOf('someone-else') };

    const a = await send(first, { ip: freshIp() });
    const b = await send(again, { ip: freshIp() });

    expect([a.status, b.status]).toEqual([201, 200]);
    const id = await chronicleId(first.chronicle);
    expect(readResponse('publish', await b.text(), catalog)).toEqual({ ok: true, value: { id } });
    expect(await count('chronicles')).toBe(1);
    expect(await refusalOf(await send({ kind: 'withdraw', id, key: again.key }))).toEqual({ error: 'forbidden' });
    expect((await send({ kind: 'withdraw', id, key: first.key })).status).toBe(204);
  });

  it('形の誤り (カタログに無い石板) は 400 で場所を返し、人間確認に問い合わせず、何も置かない', async () => {
    const req = await publishReq(3, { chronicle: chronicleOf(3, { scenarioId: 'nowhere' }) });
    const res = await send(req);

    expect(res.status).toBe(400);
    expect(await refusalOf(res)).toEqual({ error: 'bad_request', path: 'chronicle.scenarioId', reason: 'unknown_scenario' });
    expect(siteverify.calls).toEqual([]);
    expect(await count('chronicles')).toBe(0);
  });

  it('人間確認の札が無ければ 400、取り下げ鍵が無ければ 400', async () => {
    const w = writeRequest(await publishReq(4));
    const post = (headers: Record<string, string>) => exports.default.fetch(`${ORIGIN}${w.path}`, { method: 'POST', headers: { origin: ORIGIN, ...headers }, body: w.body });

    expect(await refusalOf(await post({ authorization: w.headers.authorization }))).toEqual({ error: 'bad_request', path: 'headers.cf-turnstile-response', reason: 'invalid' });
    expect(await refusalOf(await post({ 'cf-turnstile-response': HUMAN }))).toEqual({ error: 'bad_request', path: 'headers.authorization', reason: 'invalid' });
  });

  it('要約の hash が中身と合わなければ 422 (mismatch)', async () => {
    const digest = { ...(await digestFor()), hash: 'f'.repeat(64) };
    const res = await send(await publishReq(5, { digest }));

    expect(res.status).toBe(422);
    expect(await refusalOf(res)).toEqual({ error: 'mismatch', path: 'digest.hash' });
    expect(await count('chronicles')).toBe(0);
  });

  it('人間確認に落ちれば 422 (not_human) で、何も置かない', async () => {
    const res = await send(await publishReq(6, { turnstile: BOT }));

    expect(res.status).toBe(422);
    expect(await refusalOf(res)).toEqual({ error: 'not_human' });
    expect(siteverify.calls).toHaveLength(1);
    expect(await count('chronicles')).toBe(0);
  });

  it('siteverify に届かなければ 503 で閉港 (unavailable)。人のせいにはしない', async () => {
    vi.restoreAllMocks();
    stubSiteverify('down');
    const res = await send(await publishReq(7));

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await refusalOf(res)).toEqual({ error: 'closed', reason: 'unavailable' });
  });

  it('申告の Content-Length が MAX_BODY_BYTES を越えれば、読まずに 413', async () => {
    const res = await send(await publishReq(8), { headers: { 'content-length': String(MAX_BODY_BYTES + 1) } });

    expect(res.status).toBe(413);
    expect(await refusalOf(res)).toEqual({ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES });
  });

  it('よその Origin からの出港は 403 で、人間確認にも問い合わせない', async () => {
    const res = await send(await publishReq(9), { headers: { origin: 'https://evil.example' } });

    expect(res.status).toBe(403);
    expect(await refusalOf(res)).toEqual({ error: 'forbidden_origin' });
    expect(siteverify.calls).toEqual([]);
  });
});

describe('一覧 GET /api/v1/chronicles と訪問 GET /api/v1/chronicles/:id', () => {
  it('新しい順に 1 頁ずつ返し、next で続きを引く。石板で絞れる', async () => {
    const now = vi.spyOn(Date, 'now');
    const ids: ChronicleId[] = [];
    for (let seed = 1; seed <= 26; seed++) {
      now.mockReturnValue(1_790_000_000_000 + seed * 1000);
      ids.push((await publish(seed)).id);
    }
    now.mockReturnValue(1_790_000_100_000);
    const volcano = await publishReq(99, { chronicle: chronicleOf(99, { scenarioId: 'volcano' }) });
    expect((await send(volcano, { ip: freshIp() })).status).toBe(201);
    now.mockRestore();

    const first = await browse();
    expect(first.cards.map((c) => c.seed)).toEqual([99, ...Array.from({ length: 23 }, (_, i) => 26 - i)]);
    expect(first.next).not.toBeNull();
    const second = await browse({ before: first.next ?? undefined });
    expect(second.cards.map((c) => c.seed)).toEqual([3, 2, 1]);
    expect(second.next).toBeNull();
    expect(first.cards[1]).toEqual({ id: ids[25], simVersion: '1', scenarioId: 'sinking', seed: 26, inscription: 'still-here', verdict: 'alive', year: 3, publishedAt: 1_790_000_026_000, confirms: 0, mismatches: 0 });

    expect((await browse({ scenarioId: 'volcano' })).cards.map((c) => c.seed)).toEqual([99]);
  });

  it('頁の札が壊れていれば 400', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/v1/chronicles?before=zz_zz`);

    expect(res.status).toBe(400);
    expect(await refusalOf(res)).toEqual({ error: 'bad_request', path: 'query.before', reason: 'invalid' });
  });

  it('訪問は、出港した年代記とカードを返す。無い id は 404', async () => {
    const { req, id } = await publish(11);

    const res = await send({ kind: 'visit', id });
    expect(res.status).toBe(200);
    const body = readResponse('visit', await res.text(), catalog);
    expect(body.ok && body.value.chronicle).toEqual(req.chronicle);
    expect(body.ok && body.value.card).toMatchObject({ id, seed: 11, verdict: 'alive' });

    expect(await refusalOf(await send({ kind: 'visit', id: 'a'.repeat(64) as ChronicleId }))).toEqual({ error: 'not_found' });
  });

  it('今のカタログで読めない行 (石板を外した) は、一覧にも訪問にも出さず、黙らずに 1 行残す', async () => {
    const { id } = await publish(12);
    await env.HARBOR.prepare("UPDATE chronicles SET scenario_id = 'retired' WHERE id = ?").bind(id).run();
    const logs = captureLogs();

    expect((await browse()).cards).toEqual([]);
    expect(await refusalOf(await send({ kind: 'visit', id }))).toEqual({ error: 'not_found' });
    expect(logs.filter((l) => l.event === 'harbor.ledger.unreadable')).toEqual([
      expect.objectContaining({ table: 'chronicles', id, path: 'scenarioId', reason: 'unknown_scenario' }),
      expect.objectContaining({ table: 'chronicles', id, path: 'scenarioId', reason: 'unknown_scenario' }),
    ]);
  });
});

describe('照合 POST /api/v1/chronicles/:id/confirm', () => {
  it('結末が合えば確認、違えば不一致を数え、カードに出る。どちらも 204', async () => {
    const { id, req } = await publish(21);

    expect((await send({ kind: 'confirm', id, digest: req.digest })).status).toBe(204);
    expect((await send({ kind: 'confirm', id, digest: req.digest })).status).toBe(204);
    expect((await send({ kind: 'confirm', id, digest: await digestFor('dead', 0) })).status).toBe(204);

    expect((await browse()).cards[0]).toMatchObject({ id, confirms: 2, mismatches: 1 });
  });

  it('無い年代記への照合も 204 (照合は善意の付加物なので、呼び手に違いを見せない)', async () => {
    const res = await send({ kind: 'confirm', id: 'b'.repeat(64) as ChronicleId, digest: await digestFor() });
    expect(res.status).toBe(204);
  });
});

describe('通報 POST /api/v1/chronicles/:id/report', () => {
  it('別の 3 人の通報で自動で隠れ、一覧にも訪問にも出なくなる。同じ人の 2 度目は数えない', async () => {
    const { id } = await publish(31);
    const [a, b, c] = [freshIp(), freshIp(), freshIp()];

    for (const ip of [a, a, b]) expect((await send({ kind: 'report', id, turnstile: HUMAN }, { ip })).status).toBe(204);
    expect((await browse()).cards.map((x) => x.id)).toEqual([id]);

    expect((await send({ kind: 'report', id, turnstile: HUMAN }, { ip: c })).status).toBe(204);
    expect((await browse()).cards).toEqual([]);
    expect(await refusalOf(await send({ kind: 'visit', id }))).toEqual({ error: 'not_found' });
    const row = await env.HARBOR.prepare('SELECT reports, hidden_at FROM chronicles WHERE id = ?').bind(id).first<{ reports: number; hidden_at: number | null }>();
    expect(row?.reports).toBe(3);
    expect(row?.hidden_at).toEqual(expect.any(Number));
    expect(JSON.stringify(await env.HARBOR.prepare('SELECT * FROM reports').all())).not.toContain(a);
  });

  it('wrangler dev (loopback の host) では x-dev-sender で見守り手を分けられ、同じ IP の 3 人の通報で隠れる (M19-16)', async () => {
    const { id } = await publish(33);
    const local = { ip: '127.0.0.1', origin: 'http://localhost:8787' };
    for (const who of ['alice', 'bob']) expect((await send({ kind: 'report', id, turnstile: HUMAN }, { ...local, headers: { 'x-dev-sender': who } })).status).toBe(204);
    expect((await browse()).cards.map((x) => x.id)).toEqual([id]);

    expect((await send({ kind: 'report', id, turnstile: HUMAN }, { ...local, headers: { 'x-dev-sender': 'carol' } })).status).toBe(204);
    expect((await browse()).cards).toEqual([]);
  });

  it('本番の host では x-dev-sender を読まず、同じ IP の通報は名乗りを変えても 1 人に数える (M19-16)', async () => {
    const { id } = await publish(34);
    const ip = freshIp();
    for (const who of ['alice', 'bob', 'carol']) expect((await send({ kind: 'report', id, turnstile: HUMAN }, { ip, headers: { 'x-dev-sender': who } })).status).toBe(204);

    expect((await browse()).cards.map((x) => x.id)).toEqual([id]);
    const row = await env.HARBOR.prepare('SELECT reports FROM chronicles WHERE id = ?').bind(id).first<{ reports: number }>();
    expect(row?.reports).toBe(1);
  });

  it('人間確認に落ちた通報は 422 で数えない。無い年代記は 404', async () => {
    const { id } = await publish(32);

    expect(await refusalOf(await send({ kind: 'report', id, turnstile: BOT }))).toEqual({ error: 'not_human' });
    expect(await count('reports')).toBe(0);
    expect(await refusalOf(await send({ kind: 'report', id: 'c'.repeat(64) as ChronicleId, turnstile: HUMAN }))).toEqual({ error: 'not_found' });
  });
});

describe('取り下げ DELETE /api/v1/chronicles/:id', () => {
  it('出港の鍵なら 204 で消え、通報の行も消える。違う鍵は 403、無い id は 404', async () => {
    const { id, req } = await publish(41);
    await send({ kind: 'report', id, turnstile: HUMAN }, { ip: freshIp() });

    expect(await refusalOf(await send({ kind: 'withdraw', id, key: keyOf('wrong') }))).toEqual({ error: 'forbidden' });
    expect((await send({ kind: 'withdraw', id, key: req.key })).status).toBe(204);
    expect(await count('chronicles')).toBe(0);
    expect(await count('reports')).toBe(0);
    expect(await refusalOf(await send({ kind: 'withdraw', id, key: req.key }))).toEqual({ error: 'not_found' });
  });
});

describe('積荷 POST・GET /api/v1/cargo', () => {
  it('流した積荷のどれかが漂着として引ける。1 件も無ければ drawn は null', async () => {
    const empty = await send({ kind: 'draw_cargo' });
    expect(readResponse('draw_cargo', await empty.text(), catalog)).toEqual({ ok: true, value: { drawn: null } });

    const cast = [{ items: [{ speciesId: 'deer', amount: 2 }] }, { items: [{ speciesId: 'wolf', amount: 0.5 }, { speciesId: 'rabbit', amount: 10 }] }];
    for (const cargo of cast) expect((await send({ kind: 'cast_cargo', cargo }, { ip: freshIp() })).status).toBe(204);

    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const res = await send({ kind: 'draw_cargo' }, { ip: freshIp() });
      const body = readResponse('draw_cargo', await res.text(), catalog);
      if (!body.ok || body.value.drawn === null) throw new Error('漂着が引けない');
      expect(cast).toContainEqual(body.value.drawn.cargo);
      seen.add(JSON.stringify(body.value.drawn.cargo));
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('カタログに無い種は 400', async () => {
    const res = await send({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'dragon', amount: 1 }] } });
    expect(await refusalOf(res)).toEqual({ error: 'bad_request', path: 'cargo.items[0].speciesId', reason: 'unknown_species' });
  });
});

describe('回避率 POST /api/v1/outcomes と GET /api/v1/outcomes/:scenario', () => {
  it('結末を石板ごとに数え、越えた数 (alive と escaped) と終えた数を返す', async () => {
    for (const verdict of ['alive', 'dead', 'dead', 'escaped'] as const) {
      expect((await send({ kind: 'report_outcome', scenarioId: 'sinking', verdict }, { ip: freshIp() })).status).toBe(204);
    }
    await send({ kind: 'report_outcome', scenarioId: 'volcano', verdict: 'dead' });

    const res = await send({ kind: 'avoidance', scenarioId: 'sinking' });
    expect(readResponse('avoidance', await res.text(), catalog)).toEqual({ ok: true, value: { finished: 4, avoided: 2 } });
    const none = await send({ kind: 'avoidance', scenarioId: 'enrichment' });
    expect(readResponse('avoidance', await none.text(), { ...catalog, scenarios: new Set(['enrichment']) })).toEqual({ ok: true, value: { finished: 0, avoided: 0 } });
  });
});

describe('回数制限 (Rate Limiting binding、送り手ごと)', () => {
  it('同じ送り手の書き込みは 1 分に 10 回まで。11 回目は 429 と Retry-After。別の送り手は通る', async () => {
    const ip = freshIp();
    const cast = { kind: 'cast_cargo', cargo: { items: [{ speciesId: 'deer', amount: 1 }] } } as const;
    for (let i = 0; i < 10; i++) expect((await send(cast, { ip })).status).toBe(204);

    const res = await send(cast, { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await refusalOf(res)).toEqual({ error: 'slow_down' });
    expect((await send(cast, { ip: freshIp() })).status).toBe(204);
  });

  it('送り手の数えは IP をそのまま使わない (ログにも出さない)', async () => {
    const logs = captureLogs();
    const ip = freshIp();
    for (let i = 0; i < 11; i++) await send({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'deer', amount: 1 }] } }, { ip });

    expect(logs.some((l) => l.event === 'harbor.api.rejected' && l.error === 'slow_down')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(ip);
  });
});

describe('道', () => {
  it.each([
    ['GET', '/api/v1/nowhere'],
    ['PUT', '/api/v1/chronicles'],
    ['POST', `/api/v1/chronicles/${'d'.repeat(64)}/confirm/again`],
  ])('%s %s は 404', async (method, path) => {
    const res = await exports.default.fetch(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN }, body: method === 'GET' ? null : '{}' });
    expect(res.status).toBe(404);
    expect(await refusalOf(res)).toEqual({ error: 'not_found' });
  });

  it('碑文は assets/data/inscriptions.json のカタログにあるものだけを受ける', async () => {
    const res = await send(await publishReq(51, { inscription: 'hello' as InscriptionId }));
    expect(await refusalOf(res)).toEqual({ error: 'bad_request', path: 'inscription', reason: 'unknown_inscription' });
  });
});
