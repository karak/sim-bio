import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson, digestOf } from '../../src/chronicle/digest';
import {
  HARBOR_LIMITS,
  type BrowseCursor,
  type CargoId,
  type ChronicleCard,
  type ChronicleId,
  type HarborCatalog,
  type HarborRequest,
  type HarborResponses,
  type InscriptionId,
  type TurnstileToken,
  type WithdrawKey,
} from '../../src/harbor/contract';
import type { Chronicle, TimedCommand } from '../../src/harbor/chronicle';
import { bodyLimitOf, MAX_BODY_BYTES, readRefusal, readRequest, readResponse, writeRefusal, writeRequest, writeResponse, type Refusal, type WireRequest } from '../../src/harbor/wire';
import { FIXTURE_CHRONICLE, FIXTURE_CHRONICLE_ID } from '../fixtures/chronicle';

const ids = (file: string) => new Set((JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]).map((d) => d.id));
const catalog: HarborCatalog = { scenarios: ids('assets/data/scenarios.json'), species: ids('assets/data/species.json'), inscriptions: new Set(['still-here']) };

const id = FIXTURE_CHRONICLE_ID as ChronicleId;
const turnstile = 'XXXX.DUMMY.TOKEN.XXXX' as TurnstileToken;
const key = 'k'.repeat(43) as WithdrawKey;
const digest = await digestOf({ year: 3, totals: { deer: 12.5, wolf: 0 } }, 'alive');
const card: ChronicleCard = { simVersion: '1', scenarioId: 'sinking', seed: 42, id, inscription: 'still-here' as InscriptionId, verdict: 'alive', year: 3, publishedAt: 1_790_000_000_000, confirms: 2, mismatches: 0 };
const utf8 = (s: string) => new TextEncoder().encode(s).length;

const REQUESTS: { [K in HarborRequest['kind']]: Extract<HarborRequest, { kind: K }> } = {
  publish: { kind: 'publish', chronicle: FIXTURE_CHRONICLE, digest, inscription: 'still-here' as InscriptionId, turnstile, key },
  browse: { kind: 'browse', scenarioId: 'sinking', before: 'c-1790000000000' as BrowseCursor },
  visit: { kind: 'visit', id },
  confirm: { kind: 'confirm', id, digest },
  report: { kind: 'report', id, turnstile },
  withdraw: { kind: 'withdraw', id, key },
  cast_cargo: { kind: 'cast_cargo', cargo: { items: [{ speciesId: 'deer', amount: 2 }] } },
  draw_cargo: { kind: 'draw_cargo' },
  report_outcome: { kind: 'report_outcome', scenarioId: 'sinking', verdict: 'dead' },
  avoidance: { kind: 'avoidance', scenarioId: 'sinking' },
};

const RESPONSES: { [K in keyof HarborResponses]: HarborResponses[K] } = {
  publish: { id },
  browse: { cards: [card], next: 'c-1' as BrowseCursor },
  visit: { chronicle: FIXTURE_CHRONICLE, card },
  draw_cargo: { drawn: { id: 'cargo-7' as CargoId, cargo: { items: [{ speciesId: 'wolf', amount: 0.5 }] } } },
  avoidance: { finished: 10, avoided: 4 },
};

const refused = <T>(p: { ok: true; value: T } | { ok: false; error: { path: string; reason: string } }) => {
  if (p.ok) throw new Error(`受け入れてしまった: ${JSON.stringify(p.value)}`);
  return p.error;
};
const wire = (over: Partial<WireRequest>): WireRequest => ({ method: 'GET', path: '/api/v1/chronicles', headers: {}, body: null, ...over });

describe('港の要求の往復 (M19-07): クライアントが書き、Worker が読む', () => {
  for (const req of Object.values(REQUESTS)) {
    it(`${req.kind}: readRequest(writeRequest(r)) は同じ要求に戻る`, () => {
      expect(readRequest(writeRequest(req), catalog)).toEqual({ ok: true, value: req });
    });
  }

  it('一覧の石板と頁は省ける', () => {
    const req: HarborRequest = { kind: 'browse', scenarioId: null, before: null };
    expect(writeRequest(req)).toEqual({ method: 'GET', path: '/api/v1/chronicles', headers: {}, body: null });
    expect(readRequest(writeRequest(req), catalog)).toEqual({ ok: true, value: req });
  });

  it('HTTP の形: 人間確認の札と取り下げ鍵は header に載せ、本文には入れない', () => {
    const publish = writeRequest(REQUESTS.publish);
    expect(publish).toEqual({ method: 'POST', path: '/api/v1/chronicles', headers: { 'content-type': 'application/json', 'cf-turnstile-response': turnstile, authorization: `Bearer ${key}` }, body: publish.body });
    expect(JSON.parse(publish.body ?? 'null')).toEqual({ chronicle: FIXTURE_CHRONICLE, digest, inscription: 'still-here' });
    expect(writeRequest(REQUESTS.withdraw)).toEqual({ method: 'DELETE', path: `/api/v1/chronicles/${id}`, headers: { authorization: `Bearer ${key}` }, body: null });
    expect(writeRequest(REQUESTS.report)).toEqual({ method: 'POST', path: `/api/v1/chronicles/${id}/report`, headers: { 'cf-turnstile-response': turnstile }, body: null });
    expect(writeRequest(REQUESTS.browse).path).toBe('/api/v1/chronicles?scenario=sinking&before=c-1790000000000');
    expect(writeRequest(REQUESTS.avoidance).path).toBe('/api/v1/outcomes/sinking');
  });

  it(`出港の本文は、上限いっぱいの年代記と全種の要約を積んでも MAX_BODY_BYTES (${MAX_BODY_BYTES} B) に収まる (Content-Length の先の検査で正しい出港を断らない)`, async () => {
    const spawn = (i: number): TimedCommand => ({ tick: i, command: { type: 'spawn_species', speciesId: 'firelizard', cell: 100_000 + i, amount: 9.87654321, radius: 128 } });
    const commands: TimedCommand[] = [];
    const size = (cs: TimedCommand[]) => utf8(canonicalJson({ ...FIXTURE_CHRONICLE, commands: cs }));
    while (size([...commands, spawn(commands.length)]) <= HARBOR_LIMITS.chronicleBytes) commands.push(spawn(commands.length));
    const chronicle: Chronicle = { ...FIXTURE_CHRONICLE, commands };
    const totals = Object.fromEntries([...catalog.species].map((s) => [s, 123456.789]));
    const full = writeRequest({ ...REQUESTS.publish, chronicle, digest: await digestOf({ year: 99999, totals }, 'escaped') });
    expect(utf8(canonicalJson(chronicle))).toBeGreaterThan(HARBOR_LIMITS.chronicleBytes - 200);
    expect(utf8(full.body ?? '')).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(readRequest(full, catalog).ok).toBe(true);
  });
});

describe('readRequest (M19-07): 拒否の場所と理由', () => {
  it('道が無い・method が違う・版の違う道は no_route', () => {
    for (const w of [wire({ path: '/api/v1/nowhere' }), wire({ method: 'DELETE' }), wire({ path: '/api/v2/chronicles' }), wire({ method: 'POST', path: `/api/v1/chronicles/${id}/confirm/again` })]) {
      expect(refused(readRequest(w, catalog)), `${w.method} ${w.path}`).toEqual({ path: '', reason: 'no_route' });
    }
  });

  it('本文が道の上限を越えれば、JSON を読む前に too_large (照合の道は出港より狭い)', () => {
    const confirm = writeRequest(REQUESTS.confirm);
    expect(refused(readRequest({ ...confirm, body: `${confirm.body}${' '.repeat(4096)}` }, catalog))).toEqual({ path: '', reason: 'too_large' });
    const publish = writeRequest(REQUESTS.publish);
    expect(refused(readRequest({ ...publish, body: 'x'.repeat(MAX_BODY_BYTES + 1) }, catalog))).toEqual({ path: '', reason: 'too_large' });
  });

  it('JSON でない本文は not_json、本文の要る道に本文が無ければ not_object', () => {
    const publish = writeRequest(REQUESTS.publish);
    expect(refused(readRequest({ ...publish, body: '{"chronicle":' }, catalog))).toEqual({ path: '', reason: 'not_json' });
    expect(refused(readRequest({ ...publish, body: null }, catalog))).toEqual({ path: '', reason: 'not_object' });
  });

  it('出港: 碑文の自由文・人間確認の札の欠け・カタログに無い石板・要約の誤りを弾く', () => {
    const publish = writeRequest(REQUESTS.publish);
    const body = JSON.parse(publish.body ?? '{}') as Record<string, unknown>;
    const withBody = (b: unknown) => ({ ...publish, body: JSON.stringify(b) });
    expect(refused(readRequest(withBody({ ...body, inscription: 'visit example.com' }), catalog))).toEqual({ path: 'inscription', reason: 'unknown_inscription' });
    expect(refused(readRequest({ ...publish, headers: { 'content-type': 'application/json' } }, catalog))).toEqual({ path: 'headers.cf-turnstile-response', reason: 'invalid' });
    expect(refused(readRequest({ ...publish, headers: { 'cf-turnstile-response': turnstile } }, catalog))).toEqual({ path: 'headers.authorization', reason: 'invalid' });
    expect(refused(readRequest(withBody({ ...body, chronicle: { ...FIXTURE_CHRONICLE, scenarioId: 'nowhere' } }), catalog))).toEqual({ path: 'chronicle.scenarioId', reason: 'unknown_scenario' });
    expect(refused(readRequest(withBody({ ...body, digest: { ...digest, verdict: 'running' } }), catalog))).toEqual({ path: 'digest.verdict', reason: 'invalid' });
  });

  it('道の id・取り下げ鍵・一覧の石板と頁の誤りを弾く', () => {
    expect(refused(readRequest(wire({ path: '/api/v1/chronicles/not-a-sha' }), catalog))).toEqual({ path: 'id', reason: 'invalid' });
    const withdraw = writeRequest(REQUESTS.withdraw);
    expect(refused(readRequest({ ...withdraw, headers: { authorization: 'Basic abc' } }, catalog))).toEqual({ path: 'headers.authorization', reason: 'invalid' });
    expect(refused(readRequest(wire({ path: '/api/v1/chronicles?scenario=nowhere' }), catalog))).toEqual({ path: 'query.scenario', reason: 'unknown_scenario' });
    expect(refused(readRequest(wire({ path: '/api/v1/chronicles?before=%3Cscript%3E' }), catalog))).toEqual({ path: 'query.before', reason: 'invalid' });
    expect(refused(readRequest(wire({ path: '/api/v1/outcomes/nowhere' }), catalog))).toEqual({ path: 'scenarioId', reason: 'unknown_scenario' });
  });

  it('積荷と結末の報告は、contract の parse の拒否をそのまま返す', () => {
    const cast = writeRequest({ kind: 'cast_cargo', cargo: { items: [{ speciesId: 'dragon', amount: 1 }] } });
    expect(refused(readRequest(cast, catalog))).toEqual({ path: 'cargo.items[0].speciesId', reason: 'unknown_species' });
    const outcome = writeRequest(REQUESTS.report_outcome);
    expect(refused(readRequest({ ...outcome, body: JSON.stringify({ scenarioId: 'sinking', verdict: 'running' }) }, catalog))).toEqual({ path: 'verdict', reason: 'invalid' });
  });
});

describe('港の応答の往復 (M19-07): Worker が書き、クライアントが読む', () => {
  for (const kind of Object.keys(RESPONSES) as (keyof HarborResponses)[]) {
    it(`${kind}: readResponse(writeResponse(v)) は同じ値に戻る`, () => {
      expect(readResponse(kind, writeResponse(kind, RESPONSES[kind]), catalog)).toEqual({ ok: true, value: RESPONSES[kind] });
    });
  }

  it('漂着が無ければ drawn は null、最後の頁なら next は null', () => {
    expect(readResponse('draw_cargo', writeResponse('draw_cargo', { drawn: null }), catalog)).toEqual({ ok: true, value: { drawn: null } });
    expect(readResponse('browse', writeResponse('browse', { cards: [], next: null }), catalog)).toEqual({ ok: true, value: { cards: [], next: null } });
  });

  it('拒否: JSON でない・一頁の件数の上限を越える・越えた数の回避・カタログに無い碑文', () => {
    expect(refused(readResponse('visit', '<html>', catalog))).toEqual({ path: '', reason: 'not_json' });
    const many = { cards: Array.from({ length: HARBOR_LIMITS.cardsPerPage + 1 }, () => card), next: null };
    expect(refused(readResponse('browse', JSON.stringify(many), catalog))).toEqual({ path: 'cards', reason: 'too_many' });
    expect(refused(readResponse('avoidance', JSON.stringify({ finished: 3, avoided: 4 }), catalog))).toEqual({ path: 'avoided', reason: 'invalid' });
    expect(refused(readResponse('visit', JSON.stringify({ chronicle: FIXTURE_CHRONICLE, card: { ...card, inscription: 'lol' } }), catalog))).toEqual({ path: 'card.inscription', reason: 'unknown_inscription' });
  });
});

describe('bodyLimitOf (M19-08): Worker が本文を読む前の道ごとの上限', () => {
  it('出港は MAX_BODY_BYTES、照合は 2 KB、本文の無い道は 0、道が無ければ null', () => {
    expect(bodyLimitOf(writeRequest(REQUESTS.publish))).toBe(MAX_BODY_BYTES);
    expect(bodyLimitOf(writeRequest(REQUESTS.confirm))).toBe(2 * 1024);
    expect(bodyLimitOf(writeRequest(REQUESTS.withdraw))).toBe(0);
    expect(bodyLimitOf({ method: 'GET', path: '/api/v1/nowhere' })).toBeNull();
  });
});

describe('断りの返事 (M19-08): Worker が書き、クライアントが読む', () => {
  const REFUSALS: readonly [Refusal, number][] = [
    [{ error: 'bad_request', path: 'chronicle.scenarioId', reason: 'unknown_scenario' }, 400],
    [{ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES }, 413],
    [{ error: 'forbidden_origin' }, 403],
    [{ error: 'forbidden' }, 403],
    [{ error: 'not_found' }, 404],
    [{ error: 'not_human' }, 422],
    [{ error: 'mismatch', path: 'digest.hash' }, 422],
    [{ error: 'slow_down' }, 429],
    [{ error: 'closed', reason: 'budget' }, 503],
    [{ error: 'closed', reason: 'd1_write_limit' }, 503],
  ];

  it.each(REFUSALS)('%o は %i で書き、同じ断りに読み戻す', (refusal, status) => {
    const out = writeRefusal(refusal);
    expect(out.status).toBe(status);
    expect(readRefusal(out.status, out.body)).toEqual(refusal);
  });

  it.each([
    ['1027 の画面 (Cloudflare の HTML)', 429, '<!DOCTYPE html><title>Error 1027</title>'],
    ['Worker の外の 5xx', 502, 'Bad Gateway'],
    ['JSON だが港の断りの形でない', 500, '{"message":"oops"}'],
    ['断りの名前と status が食い違う', 200, JSON.stringify({ error: 'slow_down' })],
    ['閉港の理由が知らない言葉', 503, JSON.stringify({ error: 'closed', reason: 'visit example.com' })],
    ['断りの鍵が足りない', 400, JSON.stringify({ error: 'bad_request', path: 'x' })],
  ])('読めない返事 (%s) は、閉港 (理由 unknown) に読み替える', (_, status, body) => {
    expect(readRefusal(status, body)).toEqual({ error: 'closed', reason: 'unknown' });
  });
});
