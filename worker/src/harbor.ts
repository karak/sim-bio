import scenarios from '../../assets/data/scenarios.json';
import species from '../../assets/data/species.json';
import inscriptions from '../../assets/data/inscriptions.json';
import { hashOfDigest, sha256Hex } from '../../src/chronicle/digest';
import type { ParseError } from '../../src/core/parse';
import { chronicleId, type HarborCatalog, type HarborRequest } from '../../src/harbor/contract';
import { bodyLimitOf, MAX_BODY_BYTES, readRequest, writeResponse, type ClosedReason, type Refusal, type WireRequest } from '../../src/harbor/wire';
import { rateOf, senderOf, verifyHuman } from './guard';
import * as ledger from './ledger';
import { RATE_LIMITERS, type HarborConfig } from './policy';

/**
 * 港の道 (M19-08、設計書 §3・§6)。HTTP の形は wire.ts の readRequest に任せ、ここは要求 (HarborRequest) を答え (Outcome) にする。
 * 門の順: 形 (400/413) → 要約の検算 (422) → 回数制限 (429) → 人間確認 (422) → 日次予算 (503 か、黙って 204) → 帳簿。
 * 安い門を先に置き、siteverify (外への subrequest) と D1 の書きを、形の正しい・回数の内の要求にだけ使う
 */

/** 石板・種はゲームと同じ assets/data、碑文は assets/data/inscriptions.json。ここにある id だけを受ける */
export const CATALOG: HarborCatalog = {
  scenarios: new Set(scenarios.map((d) => d.id)),
  species: new Set(species.map((d) => d.id)),
  inscriptions: new Set(inscriptions.map((d) => d.id)),
};

/** Worker の fetch が Response に書く答え。refused の detail は Workers Logs にだけ書き、呼び手へは返さない */
export type Outcome =
  | { kind: 'ok'; status: 200 | 201; body: string }
  | { kind: 'empty' }
  | { kind: 'refused'; refusal: Refusal; detail: Record<string, unknown> };

export type ServeContext = { env: Env; now: number; ip: string; config: HarborConfig };

const RETRY_SOON_S = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const empty: Outcome = { kind: 'empty' };
const refused = (refusal: Refusal, detail: Record<string, unknown> = {}): Outcome => ({ kind: 'refused', refusal, detail });
const closed = (reason: ClosedReason, detail: Record<string, unknown> = {}) => refused({ error: 'closed', reason }, detail);
const ok = (status: 200 | 201, body: string): Outcome => ({ kind: 'ok', status, body });

/**
 * 断りに添える Retry-After (秒)。回数制限と一時の失敗は 1 分、日次の枠 (港の予算・D1 の上限・満杯) は UTC の 0 時まで。
 * ほかの断りは、同じ要求を送り直しても通らないので付けない
 */
export function retryAfterOf(refusal: Refusal, now: number): number | null {
  if (refusal.error === 'slow_down') return RETRY_SOON_S;
  if (refusal.error !== 'closed') return null;
  return refusal.reason === 'unavailable' ? RETRY_SOON_S : Math.ceil((DAY_MS - (now % DAY_MS)) / 1000);
}

function refusedByParse(error: ParseError, wire: WireRequest): Outcome {
  if (error.reason === 'no_route') return refused({ error: 'not_found' });
  if (error.reason === 'too_large') return refused({ error: 'payload_too_large', maxBytes: bodyLimitOf(wire) ?? MAX_BODY_BYTES });
  return refused({ error: 'bad_request', ...error });
}

export async function serve(wire: WireRequest, ctx: ServeContext): Promise<Outcome> {
  const parsed = readRequest(wire, CATALOG);
  if (!parsed.ok) return refusedByParse(parsed.error, wire);
  const req = parsed.value;
  if (req.kind === 'publish' && (await hashOfDigest(req.digest)) !== req.digest.hash) return refused({ error: 'mismatch', path: 'digest.hash' });

  const { env, now } = ctx;
  const day = ledger.utcDay(now);
  const sender = await senderOf(env.SENDER_SECRET, day, ctx.ip);
  const limiter = RATE_LIMITERS[req.kind];
  const rate = await rateOf(env[limiter], `${req.kind}:${sender}`);
  if (rate.kind === 'limited') return refused({ error: 'slow_down' });
  if (rate.kind === 'unavailable') console.warn(JSON.stringify({ event: 'harbor.rate.unavailable', binding: limiter, message: rate.message }));

  if ('turnstile' in req) {
    const human = await verifyHuman(env.TURNSTILE_SECRET_KEY, req.turnstile);
    if (human.kind === 'bot') return refused({ error: 'not_human' }, { codes: human.codes });
    if (human.kind === 'unavailable') return closed('unavailable', { cause: 'siteverify' });
  }

  try {
    const budget = ctx.config.budgets[req.kind];
    const admission = await ledger.admit(env.HARBOR, day, req.kind, budget);
    if (!admission.admitted) {
      if (budget.over === 'close') return closed('budget', { bucket: req.kind });
      console.info(JSON.stringify({ event: 'harbor.budget.dropped', bucket: req.kind }));
      return empty;
    }
    return await operate(req, { db: env.HARBOR, now, day, sender, sizeAfter: admission.sizeAfter, config: ctx.config });
  } catch (e) {
    const reason = ledger.closedReasonOf(e);
    console.error(JSON.stringify({ event: 'harbor.d1.failed', reason, kind: req.kind, message: e instanceof Error ? e.message : String(e) }));
    return closed(reason);
  }
}

type Kind = HarborRequest['kind'];
type Req<K extends Kind> = Extract<HarborRequest, { kind: K }>;
type OpContext = { db: D1Database; now: number; day: string; sender: string; sizeAfter: number; config: HarborConfig };
type Operations = { readonly [K in Kind]: (req: Req<K>, op: OpContext) => Promise<Outcome> };

const OPERATIONS: Operations = {
  publish: async (req, op) => {
    if (op.sizeAfter >= op.config.storageCapBytes) return closed('full', { sizeAfter: op.sizeAfter });
    const id = await chronicleId(req.chronicle);
    const created = await ledger.insertChronicle(op.db, {
      id,
      chronicle: req.chronicle,
      digest: req.digest,
      inscription: req.inscription,
      publishedAt: op.now,
      withdrawHash: await sha256Hex(req.key),
    });
    console.info(JSON.stringify({ event: 'harbor.chronicle.published', id, created }));
    return ok(created ? 201 : 200, writeResponse('publish', { id }));
  },
  browse: async (req, op) => {
    const before = req.before === null ? null : ledger.decodeCursor(req.before);
    if (req.before !== null && before === null) return refused({ error: 'bad_request', path: 'query.before', reason: 'invalid' });
    const page = await ledger.browse(op.db, { scenarioId: req.scenarioId, before, pageSize: op.config.pageSize }, CATALOG);
    return ok(200, writeResponse('browse', page));
  },
  visit: async (req, op) => {
    const found = await ledger.visit(op.db, req.id, CATALOG);
    return found === null ? refused({ error: 'not_found' }) : ok(200, writeResponse('visit', found));
  },
  confirm: async (req, op) => {
    await ledger.confirm(op.db, req.id, req.digest.hash);
    return empty;
  },
  report: async (req, op) => {
    const r = await ledger.report(op.db, { id: req.id, day: op.day, sender: op.sender, now: op.now, hideAt: op.config.reportsToHide });
    if (r.kind === 'missing') return refused({ error: 'not_found' });
    if (r.kind === 'counted' && r.hidden) console.warn(JSON.stringify({ event: 'harbor.chronicle.hidden', id: req.id, by: 'reports' }));
    return empty;
  },
  withdraw: async (req, op) => {
    const r = await ledger.withdraw(op.db, req.id, await sha256Hex(req.key));
    if (r === 'ok') console.info(JSON.stringify({ event: 'harbor.chronicle.withdrawn', id: req.id }));
    return r === 'ok' ? empty : refused({ error: r === 'forbidden' ? 'forbidden' : 'not_found' });
  },
  cast_cargo: async (req, op) => {
    await ledger.castCargo(op.db, { cargo: req.cargo, now: op.now });
    return empty;
  },
  draw_cargo: async (_req, op) => ok(200, writeResponse('draw_cargo', { drawn: await ledger.drawCargo(op.db, CATALOG) })),
  report_outcome: async (req, op) => {
    await ledger.recordOutcome(op.db, req.scenarioId, req.verdict);
    return empty;
  },
  avoidance: async (req, op) => ok(200, writeResponse('avoidance', await ledger.avoidance(op.db, req.scenarioId))),
};

function operate<K extends Kind>(req: Req<K>, op: OpContext): Promise<Outcome> {
  const run: Operations[K] = OPERATIONS[req.kind];
  return run(req, op);
}
