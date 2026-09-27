import { fail, isObject, under, type Parsed } from '../core/parse';
import {
  HARBOR_LIMITS,
  parseCard,
  parseCargo,
  parseCargoId,
  parseChronicleId,
  parseCursor,
  parseDigest,
  parseInscription,
  parsePublicChronicle,
  parseScenarioId,
  parseTurnstile,
  parseVerdict,
  parseWithdrawKey,
  type Cargo,
  type ChronicleCard,
  type HarborCatalog,
  type HarborRequest,
  type HarborResponses,
  type WithdrawKey,
} from './contract';
import type { Chronicle, Digest } from './chronicle';

/**
 * 港の HTTP の形 (設計書 §5.2)。道・header・本文の JSON はこのファイルの中に閉じ、外へはドメインの型 (contract.ts) だけを出す。
 * クライアント (M19-09) は writeRequest で書いて readResponse で読み、Worker (M19-08) は readRequest で読んで writeResponse で書く
 */

/** fetch と Worker の Request の間に置く、HTTP の要求の最小の形。header の名前は小文字 */
export type WireRequest = { method: 'GET' | 'POST' | 'DELETE'; path: string; headers: Readonly<Record<string, string>>; body: string | null };

/** Worker は Content-Length をこれと比べてから本文を読む。出港 (年代記 16 KB と要約) が最も大きい。道ごとのもっと狭い上限は readRequest が見る */
/** 手元で別の見守り手として振る舞う (M19-16) ときの名乗りの header。港は wrangler dev のときだけ、送り手の IP の代わりに数える */
export const DEV_SENDER_HEADER = 'x-dev-sender';
export const MAX_BODY_BYTES = HARBOR_LIMITS.chronicleBytes + 4 * 1024;
const SMALL_BODY_BYTES = 2 * 1024;
const NO_BODY = 0;
/** 一覧の 1 頁 (50 件) と訪問 (年代記とカード) が収まる大きさ。クライアントが読む応答の上限 */
const MAX_RESPONSE_BYTES = 64 * 1024;

const PREFIX = '/api/v1/';
const PARAM = ':param';
const TURNSTILE_HEADER = 'cf-turnstile-response';
const BEARER = /^Bearer (\S+)$/;

/** 本文の JSON の形 (wire 型)。人間確認の札と取り下げ鍵は header に、年代記の id と石板の id は道に載るので、本文には無い */
type WireBody =
  | { chronicle: Chronicle; digest: Digest; inscription: string }
  | { digest: Digest }
  | { cargo: Cargo }
  | { scenarioId: string; verdict: Digest['verdict'] };

type Kind = HarborRequest['kind'];
type Req<K extends Kind> = Extract<HarborRequest, { kind: K }>;
type Outgoing = { param?: string; query?: Record<string, string>; headers?: Record<string, string>; body?: WireBody };
type Incoming = { param: string | null; query: URLSearchParams; headers: Readonly<Record<string, string>>; body: unknown };
type Route<K extends Kind> = {
  method: WireRequest['method'];
  /** PARAM の位置に、年代記の id か石板の id が 1 つ入る */
  path: readonly string[];
  maxBytes: number;
  write(req: Req<K>): Outgoing;
  read(m: Incoming, catalog: HarborCatalog): Parsed<Req<K>>;
};

const ROUTES: { readonly [K in Kind]: Route<K> } = {
  publish: {
    method: 'POST',
    path: ['chronicles'],
    maxBytes: MAX_BODY_BYTES,
    write: ({ chronicle, digest, inscription, turnstile, key }) => ({ headers: { [TURNSTILE_HEADER]: turnstile, ...bearer(key) }, body: { chronicle, digest, inscription } }),
    read: (m, catalog) => {
      const turnstile = under(`headers.${TURNSTILE_HEADER}`, parseTurnstile(m.headers[TURNSTILE_HEADER]));
      if (!turnstile.ok) return turnstile;
      const key = readBearer(m.headers);
      if (!key.ok) return key;
      if (!isObject(m.body)) return fail('', 'not_object');
      const chronicle = under('chronicle', parsePublicChronicle(m.body.chronicle, catalog));
      if (!chronicle.ok) return chronicle;
      const digest = under('digest', parseDigest(m.body.digest, catalog));
      if (!digest.ok) return digest;
      const inscription = under('inscription', parseInscription(m.body.inscription, catalog));
      if (!inscription.ok) return inscription;
      return { ok: true, value: { kind: 'publish', chronicle: chronicle.value, digest: digest.value, inscription: inscription.value, turnstile: turnstile.value, key: key.value } };
    },
  },
  browse: {
    method: 'GET',
    path: ['chronicles'],
    maxBytes: NO_BODY,
    write: ({ scenarioId, before }) => ({ query: { ...(scenarioId === null ? {} : { scenario: scenarioId }), ...(before === null ? {} : { before }) } }),
    read: (m, catalog) => {
      const scenario = m.query.get('scenario');
      const scenarioId = scenario === null ? null : under('query.scenario', parseScenarioId(scenario, catalog));
      if (scenarioId && !scenarioId.ok) return scenarioId;
      const cursor = m.query.get('before');
      const before = cursor === null ? null : under('query.before', parseCursor(cursor));
      if (before && !before.ok) return before;
      return { ok: true, value: { kind: 'browse', scenarioId: scenarioId?.value ?? null, before: before?.value ?? null } };
    },
  },
  visit: {
    method: 'GET',
    path: ['chronicles', PARAM],
    maxBytes: NO_BODY,
    write: ({ id }) => ({ param: id }),
    read: (m) => {
      const id = under('id', parseChronicleId(m.param));
      return id.ok ? { ok: true, value: { kind: 'visit', id: id.value } } : id;
    },
  },
  withdraw: {
    method: 'DELETE',
    path: ['chronicles', PARAM],
    maxBytes: NO_BODY,
    write: ({ id, key }) => ({ param: id, headers: bearer(key) }),
    read: (m) => {
      const id = under('id', parseChronicleId(m.param));
      if (!id.ok) return id;
      const key = readBearer(m.headers);
      return key.ok ? { ok: true, value: { kind: 'withdraw', id: id.value, key: key.value } } : key;
    },
  },
  confirm: {
    method: 'POST',
    path: ['chronicles', PARAM, 'confirm'],
    maxBytes: SMALL_BODY_BYTES,
    write: ({ id, digest }) => ({ param: id, body: { digest } }),
    read: (m, catalog) => {
      const id = under('id', parseChronicleId(m.param));
      if (!id.ok) return id;
      if (!isObject(m.body)) return fail('', 'not_object');
      const digest = under('digest', parseDigest(m.body.digest, catalog));
      return digest.ok ? { ok: true, value: { kind: 'confirm', id: id.value, digest: digest.value } } : digest;
    },
  },
  report: {
    method: 'POST',
    path: ['chronicles', PARAM, 'report'],
    maxBytes: NO_BODY,
    write: ({ id, turnstile }) => ({ param: id, headers: { [TURNSTILE_HEADER]: turnstile } }),
    read: (m) => {
      const id = under('id', parseChronicleId(m.param));
      if (!id.ok) return id;
      const turnstile = under(`headers.${TURNSTILE_HEADER}`, parseTurnstile(m.headers[TURNSTILE_HEADER]));
      return turnstile.ok ? { ok: true, value: { kind: 'report', id: id.value, turnstile: turnstile.value } } : turnstile;
    },
  },
  cast_cargo: {
    method: 'POST',
    path: ['cargo'],
    maxBytes: SMALL_BODY_BYTES,
    write: ({ cargo }) => ({ body: { cargo } }),
    read: (m, catalog) => {
      if (!isObject(m.body)) return fail('', 'not_object');
      const cargo = under('cargo', parseCargo(m.body.cargo, catalog));
      return cargo.ok ? { ok: true, value: { kind: 'cast_cargo', cargo: cargo.value } } : cargo;
    },
  },
  draw_cargo: {
    method: 'GET',
    path: ['cargo'],
    maxBytes: NO_BODY,
    write: () => ({}),
    read: () => ({ ok: true, value: { kind: 'draw_cargo' } }),
  },
  report_outcome: {
    method: 'POST',
    path: ['outcomes'],
    maxBytes: SMALL_BODY_BYTES,
    write: ({ scenarioId, verdict }) => ({ body: { scenarioId, verdict } }),
    read: (m, catalog) => {
      if (!isObject(m.body)) return fail('', 'not_object');
      const scenarioId = under('scenarioId', parseScenarioId(m.body.scenarioId, catalog));
      if (!scenarioId.ok) return scenarioId;
      const verdict = under('verdict', parseVerdict(m.body.verdict));
      return verdict.ok ? { ok: true, value: { kind: 'report_outcome', scenarioId: scenarioId.value, verdict: verdict.value } } : verdict;
    },
  },
  avoidance: {
    method: 'GET',
    path: ['outcomes', PARAM],
    maxBytes: NO_BODY,
    write: ({ scenarioId }) => ({ param: scenarioId }),
    read: (m, catalog) => {
      const scenarioId = under('scenarioId', parseScenarioId(m.param, catalog));
      return scenarioId.ok ? { ok: true, value: { kind: 'avoidance', scenarioId: scenarioId.value } } : scenarioId;
    },
  },
};

export function writeRequest(req: HarborRequest): WireRequest {
  const route = ROUTES[req.kind];
  const out = writeOf(req.kind, req);
  const path = PREFIX + route.path.map((s) => (s === PARAM ? encodeURIComponent(out.param ?? '') : s)).join('/');
  const query = new URLSearchParams(out.query).toString();
  const json: Record<string, string> = out.body === undefined ? {} : { 'content-type': 'application/json' };
  return { method: route.method, path: query ? `${path}?${query}` : path, headers: { ...json, ...out.headers }, body: out.body === undefined ? null : JSON.stringify(out.body) };
}

/** 道が無い・method が違うは no_route、本文が道の上限を越えれば too_large、JSON でなければ not_json。ほかは形の拒否 */
export function readRequest(wire: WireRequest, catalog: HarborCatalog): Parsed<HarborRequest> {
  const found = findRoute(wire);
  if (found === null) return fail('', 'no_route');
  const { route, url, segments } = found;
  const body = readJson(wire.body, route.maxBytes);
  if (!body.ok) return body;
  const at = route.path.indexOf(PARAM);
  return route.read({ param: at < 0 ? null : segments[at], query: url.searchParams, headers: wire.headers, body: body.value }, catalog);
}

/** 道の本文の上限 (M19-08)。Worker はこれを超える本文を読まずに 413 にする。道が無ければ null */
export function bodyLimitOf(wire: Pick<WireRequest, 'method' | 'path'>): number | null {
  return findRoute(wire)?.route.maxBytes ?? null;
}

function findRoute(wire: Pick<WireRequest, 'method' | 'path'>): { route: (typeof ROUTES)[Kind]; url: URL; segments: string[] } | null {
  const url = new URL(wire.path, 'http://harbor.invalid');
  if (!url.pathname.startsWith(PREFIX)) return null;
  const segments = url.pathname.slice(PREFIX.length).split('/');
  for (const route of Object.values(ROUTES)) {
    if (route.method !== wire.method || route.path.length !== segments.length) continue;
    if (!route.path.every((s, i) => s === PARAM || s === segments[i])) continue;
    return { route, url, segments };
  }
  return null;
}

export function writeResponse<K extends keyof HarborResponses>(_kind: K, value: HarborResponses[K]): string {
  return JSON.stringify(value);
}

export function readResponse<K extends keyof HarborResponses>(kind: K, text: string, catalog: HarborCatalog): Parsed<HarborResponses[K]> {
  const body = readJson(text, MAX_RESPONSE_BYTES);
  if (!body.ok) return body;
  const read: ResponseReaders[K] = RESPONSES[kind];
  return read(body.value, catalog);
}

type ResponseReaders = { readonly [K in keyof HarborResponses]: (v: unknown, catalog: HarborCatalog) => Parsed<HarborResponses[K]> };

const RESPONSES: ResponseReaders = {
  publish: (v) => {
    if (!isObject(v)) return fail('', 'not_object');
    const id = under('id', parseChronicleId(v.id));
    return id.ok ? { ok: true, value: { id: id.value } } : id;
  },
  browse: (v, catalog) => {
    if (!isObject(v)) return fail('', 'not_object');
    if (!Array.isArray(v.cards)) return fail('cards', 'not_array');
    if (v.cards.length > HARBOR_LIMITS.cardsPerPage) return fail('cards', 'too_many');
    const cards: ChronicleCard[] = [];
    for (const [i, c] of v.cards.entries()) {
      const card = under(`cards[${i}]`, parseCard(c, catalog));
      if (!card.ok) return card;
      cards.push(card.value);
    }
    const next = v.next === null ? null : under('next', parseCursor(v.next));
    if (next && !next.ok) return next;
    return { ok: true, value: { cards, next: next?.value ?? null } };
  },
  /** card.id が chronicleId(chronicle) と合うかは非同期なので、呼び手 (M19-09) が確かめる */
  visit: (v, catalog) => {
    if (!isObject(v)) return fail('', 'not_object');
    const chronicle = under('chronicle', parsePublicChronicle(v.chronicle, catalog));
    if (!chronicle.ok) return chronicle;
    const card = under('card', parseCard(v.card, catalog));
    return card.ok ? { ok: true, value: { chronicle: chronicle.value, card: card.value } } : card;
  },
  draw_cargo: (v, catalog) => {
    if (!isObject(v)) return fail('', 'not_object');
    if (v.drawn === null) return { ok: true, value: { drawn: null } };
    if (!isObject(v.drawn)) return fail('drawn', 'not_object');
    const id = under('drawn.id', parseCargoId(v.drawn.id));
    if (!id.ok) return id;
    const cargo = under('drawn.cargo', parseCargo(v.drawn.cargo, catalog));
    return cargo.ok ? { ok: true, value: { drawn: { id: id.value, cargo: cargo.value } } } : cargo;
  },
  avoidance: (v) => {
    if (!isObject(v)) return fail('', 'not_object');
    const { finished, avoided } = v;
    if (!isCount(finished)) return fail('finished', 'invalid');
    if (!isCount(avoided) || avoided > finished) return fail('avoided', 'invalid');
    return { ok: true, value: { finished, avoided } };
  },
};

const bearer = (key: WithdrawKey) => ({ authorization: `Bearer ${key}` });
const readBearer = (headers: Readonly<Record<string, string>>) => under('headers.authorization', parseWithdrawKey(BEARER.exec(headers.authorization ?? '')?.[1]));

function writeOf<K extends Kind>(kind: K, req: Req<K>): Outgoing {
  const route: Route<K> = ROUTES[kind];
  return route.write(req);
}

/** 本文の無い要求 (null・空) は undefined として読む。maxBytes は UTF-8 の大きさ */
function readJson(text: string | null, maxBytes: number): Parsed<unknown> {
  if (text === null || text === '') return { ok: true, value: undefined };
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) return fail('', 'too_large');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return fail('', 'not_json');
  }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** 閉港の理由。budget は港の日次予算、full は保存の内部の栓 (400 MB)、d1_* は D1 そのものの上限、unavailable は D1 か人間確認の一時の失敗 */
export const CLOSED_REASONS = ['budget', 'full', 'd1_read_limit', 'd1_write_limit', 'd1_storage', 'unavailable'] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

/**
 * 断りの返事 (M19-08、設計書 §6.2)。Worker は writeRefusal で書き、クライアント (M19-09) は readRefusal で読む。
 * 形の誤りは 400、人間確認の失敗と要約の食い違いは 422、回数制限は 429、閉港 (予算切れ・D1 の上限・満杯) はどれも 503
 */
export type Refusal =
  | { error: 'bad_request'; path: string; reason: string }
  | { error: 'payload_too_large'; maxBytes: number }
  | { error: 'forbidden_origin' }
  | { error: 'forbidden' }
  | { error: 'not_found' }
  | { error: 'method_not_allowed' }
  | { error: 'not_human' }
  | { error: 'mismatch'; path: string }
  | { error: 'slow_down' }
  | { error: 'closed'; reason: ClosedReason };

/** 港が書いたと読めない返事 (1027 の画面・Worker の外の 5xx・壊れた本文) は、どれも閉港として扱う */
export type ReadRefusal = Refusal | { error: 'closed'; reason: 'unknown' };

type RefusalOf<E extends Refusal['error']> = Extract<Refusal, { error: E }>;
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;

const REFUSALS: { readonly [E in Refusal['error']]: { status: number; read(v: Record<string, unknown>): RefusalOf<E> | null } } = {
  bad_request: { status: 400, read: ({ path, reason }) => (isText(path) && isText(reason) ? { error: 'bad_request', path, reason } : null) },
  payload_too_large: { status: 413, read: ({ maxBytes }) => (isCount(maxBytes) ? { error: 'payload_too_large', maxBytes } : null) },
  forbidden_origin: { status: 403, read: () => ({ error: 'forbidden_origin' }) },
  forbidden: { status: 403, read: () => ({ error: 'forbidden' }) },
  not_found: { status: 404, read: () => ({ error: 'not_found' }) },
  method_not_allowed: { status: 405, read: () => ({ error: 'method_not_allowed' }) },
  not_human: { status: 422, read: () => ({ error: 'not_human' }) },
  mismatch: { status: 422, read: ({ path }) => (isText(path) ? { error: 'mismatch', path } : null) },
  slow_down: { status: 429, read: () => ({ error: 'slow_down' }) },
  closed: {
    status: 503,
    read: ({ reason }) => {
      const known = CLOSED_REASONS.find((r) => r === reason);
      return known ? { error: 'closed', reason: known } : null;
    },
  },
};

const isRefusalError = (v: unknown): v is Refusal['error'] => typeof v === 'string' && Object.hasOwn(REFUSALS, v);
const UNKNOWN_CLOSED: ReadRefusal = { error: 'closed', reason: 'unknown' };
const MAX_REFUSAL_BYTES = 1024;

export function writeRefusal(refusal: Refusal): { status: number; body: string } {
  return { status: REFUSALS[refusal.error].status, body: JSON.stringify(refusal) };
}

export function readRefusal(status: number, text: string): ReadRefusal {
  const body = readJson(text, MAX_REFUSAL_BYTES);
  if (!body.ok || !isObject(body.value)) return UNKNOWN_CLOSED;
  const { error } = body.value;
  if (!isRefusalError(error)) return UNKNOWN_CLOSED;
  const entry = REFUSALS[error];
  if (entry.status !== status) return UNKNOWN_CLOSED;
  return entry.read(body.value) ?? UNKNOWN_CLOSED;
}
