import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { digestOf } from '../../src/chronicle/digest';
import { chronicleId, type CargoId, type ChronicleId, type InscriptionId, type TurnstileToken, type WithdrawKey } from '../../src/harbor/contract';
import { writeRefusal, type WireRequest } from '../../src/harbor/wire';
import { createHarbor, type HumanAnswer } from '../../src/harbor/client';
import { createMemoryHarborStore, type HarborStore } from '../../src/persist/harborStore';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN, type FakeReply } from '../fixtures/fakeHarbor';
import { FIXTURE_CHRONICLE, FIXTURE_CHRONICLE_ID } from '../fixtures/chronicle';

const read = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
const catalog = catalogFrom({ scenarios: read('scenarios'), species: read('species'), inscriptions: read('inscriptions') });
const digest = await digestOf({ year: 3, totals: { deer: 12.5, wolf: 0 } }, 'alive');
const island = { chronicle: FIXTURE_CHRONICLE, digest, inscription: 'still-here' as InscriptionId };
const id = FIXTURE_CHRONICLE_ID as ChronicleId;
const KEYS = ['K'.repeat(43), 'L'.repeat(43)] as WithdrawKey[];

type Wire = (w: WireRequest) => Promise<FakeReply> | FakeReply;

/** fetch の偽物。URL と init を本物の Worker と同じ WireRequest に戻して、港の写し (または差し替えの返事) に渡す */
function harness(opts: { store?: HarborStore; human?: HumanAnswer['kind']; baseUrl?: string | undefined } = {}) {
  const fake = createFakeHarbor(catalog);
  const sent: WireRequest[] = [];
  let answer: Wire = (w) => fake.serve(w);
  let keys = 0;
  const store = opts.store ?? createMemoryHarborStore();
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const wire: WireRequest = { method: (init?.method ?? 'GET') as WireRequest['method'], path: url.pathname + url.search, headers, body: typeof init?.body === 'string' ? init.body : null };
    sent.push(wire);
    const r = await answer(wire);
    return new Response(r.body, { status: r.status, headers: r.headers });
  };
  const human = opts.human ?? 'token';
  const harbor = createHarbor({
    baseUrl: 'baseUrl' in opts ? opts.baseUrl : 'https://harbor.test',
    linkBase: 'https://island.test',
    store,
    catalog,
    fetch,
    turnstile: async (): Promise<HumanAnswer> => (human === 'token' ? { kind: 'token', token: DUMMY_TOKEN as TurnstileToken } : { kind: human }),
    newKey: () => KEYS[keys++ % KEYS.length],
  });
  return { harbor, store, fake, sent, answerWith: (w: Wire) => (answer = w), openAgain: () => (answer = (w) => fake.serve(w)) };
}

const refusal = (r: Parameters<typeof writeRefusal>[0]): FakeReply => ({ ...writeRefusal(r), headers: { 'content-type': 'application/json' } });
const CLOSED_REPLIES: [string, Wire][] = [
  ['503 閉港 (予算切れ)', () => refusal({ error: 'closed', reason: 'budget' })],
  ['1027 の画面 (Cloudflare の HTML)', () => ({ status: 503, body: '<!DOCTYPE html><title>Worker exceeded resource limits | 1027</title>', headers: { 'content-type': 'text/html' } })],
  ['網の失敗 (fetch が投げる)', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['港の形でない 200 (静的配信の index.html)', () => ({ status: 200, body: '<!doctype html><html></html>', headers: { 'content-type': 'text/html' } })],
];

describe('港のクライアント createHarbor (M19-09、設計書 §5.2)', () => {
  it('出港すると、港が年代記の id を返し、訪問のリンクが付く。人間確認の札と、手元で作った取り下げ鍵を添える', async () => {
    const h = harness();
    const r = await h.harbor.publish(island);
    expect(r).toEqual({ kind: 'published', id, url: `https://island.test/?scenario=sinking&visit=${id}` });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ method: 'POST', path: '/api/v1/chronicles', headers: { 'cf-turnstile-response': DUMMY_TOKEN, authorization: `Bearer ${KEYS[0]}` } });
    expect(await h.store.keyOf(id)).toBe(KEYS[0]);
    expect(await h.store.queued()).toEqual([]);
    expect(h.fake.ledger.get(id)?.card).toMatchObject({ scenarioId: 'sinking', inscription: 'still-here', verdict: 'alive', year: 3 });
  });

  it.each(CLOSED_REPLIES)('閉港 (%s) は queued に読み替え、outbox に入れる。開いたら同じ id・同じ鍵で送り直す', async (_name, closed) => {
    const h = harness();
    h.answerWith(closed);
    expect(await h.harbor.publish(island)).toEqual({ kind: 'queued', id });
    expect(await h.store.queued()).toEqual([{ id, ...island }]);

    h.openAgain();
    expect(await h.harbor.flushOutbox()).toEqual([{ kind: 'published', id, url: `https://island.test/?scenario=sinking&visit=${id}` }]);
    expect(await h.store.queued()).toEqual([]);
    const auths = h.sent.map((w) => w.headers.authorization);
    expect(auths).toEqual([`Bearer ${KEYS[0]}`, `Bearer ${KEYS[0]}`]);
    expect(h.fake.ledger.size).toBe(1);
  });

  it('baseUrl が無ければ常に閉港: 出港は outbox に入り、ほかも closed で、網には出ない', async () => {
    const h = harness({ baseUrl: undefined });
    expect(await h.harbor.publish(island)).toEqual({ kind: 'queued', id });
    expect(await h.harbor.flushOutbox()).toEqual([{ kind: 'queued', id }]);
    expect(await h.store.queued()).toHaveLength(1);
    expect(await h.harbor.browse({})).toEqual({ kind: 'closed' });
    expect(await h.harbor.visit(id)).toEqual({ kind: 'closed' });
    expect(await h.harbor.report(id)).toBe('closed');
    expect(await h.harbor.withdraw(id)).toBe('closed');
    await h.harbor.confirm(id, digest);
    expect(h.sent).toEqual([]);
  });

  it('人間確認の widget が読めない (網が無い) ときも閉港として outbox に入れる。落ちたら not_human で、港へは送らない', async () => {
    const offline = harness({ human: 'unavailable' });
    expect(await offline.harbor.publish(island)).toEqual({ kind: 'queued', id });
    expect(offline.sent).toEqual([]);

    const bot = harness({ human: 'failed' });
    expect(await bot.harbor.publish(island)).toEqual({ kind: 'not_human' });
    expect(bot.sent).toEqual([]);
    expect(await bot.store.queued()).toEqual([]);
  });

  it('港の断りを kind に写す: 422 は not_human、429 は slow_down、400 は rejected。どれも outbox に残さない', async () => {
    const cases: [FakeReply, unknown][] = [
      [refusal({ error: 'not_human' }), { kind: 'not_human' }],
      [refusal({ error: 'slow_down' }), { kind: 'slow_down' }],
      [refusal({ error: 'bad_request', path: 'chronicle.scenarioId', reason: 'unknown_scenario' }), { kind: 'rejected', reason: 'chronicle.scenarioId: unknown_scenario' }],
      [refusal({ error: 'mismatch', path: 'digest.hash' }), { kind: 'rejected', reason: 'mismatch' }],
    ];
    for (const [reply, expected] of cases) {
      const h = harness();
      h.answerWith(() => reply);
      expect(await h.harbor.publish(island)).toEqual(expected);
      expect(await h.store.queued()).toEqual([]);
    }
  });

  it('契約に合わない年代記は、港へ送る前に同じ parse で断る (カタログに無い石板)', async () => {
    const h = harness();
    const r = await h.harbor.publish({ ...island, chronicle: { ...FIXTURE_CHRONICLE, scenarioId: 'nowhere' } });
    expect(r).toEqual({ kind: 'rejected', reason: 'chronicle.scenarioId: unknown_scenario' });
    expect(h.sent).toEqual([]);
  });

  it('outbox の読めない行 (版を上げてカタログから石板が消えた) は捨て、読める行だけを送り直す', async () => {
    const store = createMemoryHarborStore();
    const h = harness({ store });
    h.answerWith(CLOSED_REPLIES[0][1]);
    await h.harbor.publish(island);
    await store.enqueue({ ...island, id: 'b'.repeat(64) as ChronicleId, chronicle: { ...FIXTURE_CHRONICLE, scenarioId: 'gone' } });
    h.openAgain();
    expect(await h.harbor.flushOutbox()).toEqual([{ kind: 'published', id, url: expect.any(String) }]);
    expect(await store.queued()).toEqual([]);
  });

  it('閉港のあいだの再送は、最初の 1 件が queued に戻った時点でやめる (人間確認を何度も出さない)', async () => {
    const h = harness();
    h.answerWith(CLOSED_REPLIES[0][1]);
    await h.harbor.publish(island);
    const second = { ...FIXTURE_CHRONICLE, seed: 7 };
    await h.harbor.publish({ ...island, chronicle: second });
    const before = h.sent.length;
    const results = await h.harbor.flushOutbox();
    expect(results).toEqual([{ kind: 'queued', id: expect.any(String) }]);
    expect(h.sent.length - before).toBe(1);
    expect(await h.store.queued()).toHaveLength(2);
    expect((await h.store.queued()).map((o) => (o as { id: string }).id).sort()).toEqual([id, await chronicleId(second)].sort());
  });

  it('一覧はカードを新しい順に返し、閉港なら closed', async () => {
    const h = harness();
    await h.harbor.publish(island);
    const listed = await h.harbor.browse({ scenarioId: 'sinking' });
    expect(listed).toEqual({ kind: 'ok', cards: [expect.objectContaining({ id, inscription: 'still-here', verdict: 'alive', year: 3 })], next: null });
    expect(h.sent.at(-1)).toMatchObject({ method: 'GET', path: '/api/v1/chronicles?scenario=sinking' });
    h.answerWith(CLOSED_REPLIES[1][1]);
    expect(await h.harbor.browse({})).toEqual({ kind: 'closed' });
  });

  it('訪問は年代記とカードを返す。無い id は missing、カードの id と年代記が食い違えば (港の形でない) closed', async () => {
    const h = harness();
    await h.harbor.publish(island);
    expect(await h.harbor.visit(id)).toEqual({ kind: 'ok', chronicle: FIXTURE_CHRONICLE, card: expect.objectContaining({ id }) });
    expect(await h.harbor.visit('c'.repeat(64) as ChronicleId)).toEqual({ kind: 'missing' });

    const entry = h.fake.ledger.get(id);
    if (!entry) throw new Error('not published');
    entry.chronicle = { ...FIXTURE_CHRONICLE, seed: 99 };
    expect(await h.harbor.visit(id)).toEqual({ kind: 'closed' });
  });

  it('照合は要約を港へ送り、閉港でも投げない (善意の付加物)', async () => {
    const h = harness();
    await h.harbor.publish(island);
    await h.harbor.confirm(id, digest);
    expect(h.fake.ledger.get(id)?.card).toMatchObject({ confirms: 1, mismatches: 0 });
    h.answerWith(CLOSED_REPLIES[2][1]);
    await expect(h.harbor.confirm(id, digest)).resolves.toBeUndefined();
  });

  it('通報は人間確認の札を添える。閉港は closed、札が落ちれば not_human', async () => {
    const h = harness();
    await h.harbor.publish(island);
    expect(await h.harbor.report(id)).toBe('ok');
    expect(h.sent.at(-1)).toMatchObject({ method: 'POST', path: `/api/v1/chronicles/${id}/report`, headers: { 'cf-turnstile-response': DUMMY_TOKEN } });
    expect(h.fake.ledger.get(id)?.reports).toBe(1);
    h.answerWith(CLOSED_REPLIES[0][1]);
    expect(await h.harbor.report(id)).toBe('closed');
    h.answerWith(CLOSED_REPLIES[3][1]);
    expect(await h.harbor.report(id), '本文の無い道に 200 の index.html が返れば、港に届いていない').toBe('closed');
    expect(await harness({ human: 'failed' }).harbor.report(id)).toBe('not_human');
  });

  it('取り下げは手元の鍵で送り、消えたら鍵も忘れる。鍵が無ければ送らずに forbidden、違う鍵は forbidden で鍵を残す', async () => {
    const h = harness();
    await h.harbor.publish(island);
    expect([...(await h.harbor.ownIds())]).toEqual([id]);
    expect(await h.harbor.withdraw(id)).toBe('ok');
    expect(h.sent.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/v1/chronicles/${id}`, headers: { authorization: `Bearer ${KEYS[0]}` } });
    expect(h.fake.ledger.has(id)).toBe(false);
    expect([...(await h.harbor.ownIds())]).toEqual([]);
    const sent = h.sent.length;
    expect(await h.harbor.withdraw(id)).toBe('forbidden');
    expect(h.sent.length).toBe(sent);

    const other = harness();
    await other.harbor.publish(island);
    other.answerWith(() => refusal({ error: 'forbidden' }));
    expect(await other.harbor.withdraw(id)).toBe('forbidden');
    expect(await other.store.keyOf(id)).toBe(KEYS[0]);
  });

  it('outbox に居るあいだの取り下げは、outbox から出して再送を止める。閉港なら鍵を残し、開いてから取り下げ直せる (応答が失われて港に届いていた場合)', async () => {
    const h = harness();
    h.answerWith(CLOSED_REPLIES[0][1]);
    await h.harbor.publish(island);
    expect(await h.harbor.withdraw(id)).toBe('closed');
    expect(await h.store.queued()).toEqual([]);
    expect(await h.store.keyOf(id)).toBe(KEYS[0]);

    h.openAgain();
    expect(await h.harbor.flushOutbox()).toEqual([]);
    expect(await h.harbor.withdraw(id)).toBe('ok');
    expect(await h.store.keyOf(id)).toBeNull();
    expect(h.fake.ledger.size).toBe(0);
  });
});

describe('港のクライアントの積荷 (M19-10、設計書 B5)', () => {
  const cargo = { items: [{ speciesId: 'rabbit', amount: 2.5 }, { speciesId: 'wolf', amount: 0.3 }] };

  it('積荷を流すと港に 1 件並び、ほかの見守り手が引ける。浜に何も無ければ drawn は null', async () => {
    const h = harness();
    expect(await h.harbor.drawCargo()).toEqual({ kind: 'ok', drawn: null });
    expect(await h.harbor.castCargo(cargo)).toBe('ok');
    expect(h.sent.at(-1)).toMatchObject({ method: 'POST', path: '/api/v1/cargo' });
    const got = await harness().harbor.drawCargo();
    expect(got).toEqual({ kind: 'ok', drawn: null });
    const drawn = await h.harbor.drawCargo();
    expect(drawn).toEqual({ kind: 'ok', drawn: { id: h.fake.cargo[0].id, cargo }, received: false });
  });

  it('契約に合わない積荷は港へ送る前に断る (カタログに無い種・量が 10 を越える)', async () => {
    const h = harness();
    expect(await h.harbor.castCargo({ items: [{ speciesId: 'dragon', amount: 1 }] })).toBe('rejected');
    expect(await h.harbor.castCargo({ items: [{ speciesId: 'wolf', amount: 10.5 }] })).toBe('rejected');
    expect(h.sent).toEqual([]);
  });

  it.each(CLOSED_REPLIES)('閉港 (%s) は流すも引くも closed', async (_name, closed) => {
    const h = harness();
    h.answerWith(closed);
    expect(await h.harbor.castCargo(cargo)).toBe('closed');
    expect(await h.harbor.drawCargo()).toEqual({ kind: 'closed' });
  });

  it('baseUrl が無ければ網に出ずに closed', async () => {
    const h = harness({ baseUrl: undefined });
    expect(await h.harbor.castCargo(cargo)).toBe('closed');
    expect(await h.harbor.drawCargo()).toEqual({ kind: 'closed' });
    expect(h.sent).toEqual([]);
  });

  it('受け取りは 1 つの積荷に 1 回だけ: 二度目は land を呼ばずに already。二度押し (同時) でも land は 1 回', async () => {
    const h = harness();
    const drawn = { id: 'c0ffee' as CargoId, cargo };
    const landed: string[] = [];
    const land = () => (landed.push(drawn.id), true);
    expect(await Promise.all([h.harbor.receiveCargo(drawn, land), h.harbor.receiveCargo(drawn, land)])).toEqual(['received', 'already']);
    expect(await h.harbor.receiveCargo(drawn, land)).toBe('already');
    expect(landed).toEqual(['c0ffee']);
    expect(await h.harbor.receiveCargo({ id: 'beef' as CargoId, cargo }, land)).toBe('received');
  });

  it('島が受け取れなかった (力が足りない・浜が無い) ときは控えを残さず、あとで受け取れる', async () => {
    const h = harness();
    const drawn = { id: 'c0ffee' as CargoId, cargo };
    expect(await h.harbor.receiveCargo(drawn, () => false)).toBe('refused');
    expect(await h.harbor.receiveCargo(drawn, () => true)).toBe('received');
  });

  it('引いた積荷をもう受け取っていれば received を添える (同じ積荷をもう一度引いても、受け取らせない)', async () => {
    const h = harness();
    await h.harbor.castCargo(cargo);
    const first = await h.harbor.drawCargo();
    if (first.kind !== 'ok' || !first.drawn) throw new Error('積荷が無い');
    expect(first.received).toBe(false);
    await h.harbor.receiveCargo(first.drawn, () => true);
    expect(await h.harbor.drawCargo()).toEqual({ kind: 'ok', drawn: first.drawn, received: true });
  });
});

const dead = { chronicle: FIXTURE_CHRONICLE, digest: await digestOf({ year: 3, totals: { deer: 0 } }, 'dead') };

describe('港のクライアントの回避率 (M19-11、設計書 B6)', () => {

  it('終えた石板を 1 回数え、回避率を引ける。同じ年代記は二度数えない (網にも出ない)', async () => {
    const h = harness();
    expect(await h.harbor.avoidance('sinking')).toEqual({ finished: 0, avoided: 0 });
    expect(await h.harbor.reportOutcome(island)).toBe('counted');
    expect(h.sent.at(-1)).toMatchObject({ method: 'POST', path: '/api/v1/outcomes' });
    const sent = h.sent.length;
    expect(await h.harbor.reportOutcome(island)).toBe('already');
    expect(await h.harbor.reportOutcome(dead)).toBe('already');
    expect(h.sent.length).toBe(sent);
    expect(await h.harbor.avoidance('sinking')).toEqual({ finished: 1, avoided: 1 });
  });

  it('ほかの年代記の滅びも数える: 越えた 1 と滅びた 1 で 2 件中 1 件', async () => {
    const h = harness();
    await h.harbor.reportOutcome(island);
    await h.harbor.reportOutcome({ chronicle: { ...FIXTURE_CHRONICLE, seed: 7 }, digest: dead.digest });
    expect(await h.harbor.avoidance('sinking')).toEqual({ finished: 2, avoided: 1 });
  });

  it.each(CLOSED_REPLIES)('閉港 (%s) なら数えられず (控えを外し、開いてから同じ年代記を数えられる)、回避率は null', async (_name, closed) => {
    const h = harness();
    h.answerWith(closed);
    expect(await h.harbor.reportOutcome(island)).toBe('closed');
    expect(await h.harbor.avoidance('sinking')).toBeNull();
    h.openAgain();
    expect(await h.harbor.reportOutcome(island)).toBe('counted');
  });

  it('契約に合わない (カタログに無い石板) は数えずに rejected', async () => {
    const h = harness();
    expect(await h.harbor.reportOutcome({ ...island, chronicle: { ...FIXTURE_CHRONICLE, scenarioId: 'nowhere' } })).toBe('rejected');
    expect(h.sent).toEqual([]);
  });
});
