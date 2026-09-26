import { fail, isObject, type Parsed } from '../core/parse';
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
  type HarborCatalog,
  type HarborRequest,
  type HarborResponses,
} from './contract';
import type { Chronicle, Digest } from './chronicle';

/**
 * 港の HTTP の形 (設計書 §5.2)。道・header・本文の JSON はこのファイルの中に閉じ、外へはドメインの型 (contract.ts) だけを出す。
 * クライアント (M19-09) は writeRequest で書いて readResponse で読み、Worker (M19-08) は readRequest で読んで writeResponse で書く
 */

/** fetch と Worker の Request の間に置く、HTTP の要求の最小の形。header の名前は小文字 */
export type WireRequest = { method: 'GET' | 'POST' | 'DELETE'; path: string; headers: Readonly<Record<string, string>>; body: string | null };

/** Worker は Content-Length をこれと比べてから本文を読む。出港 (年代記 16 KB と要約) が最も大きい。道ごとのもっと狭い上限は readRequest が見る */
export const MAX_BODY_BYTES = 20 * 1024;
const SMALL_BODY_BYTES = 2 * 1024;
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
    write: ({ chronicle, digest, inscription, turnstile }) => ({ headers: { [TURNSTILE_HEADER]: turnstile }, body: { chronicle, digest, inscription } }),
    read: (m, catalog) => {
      const turnstile = parseTurnstile(m.headers[TURNSTILE_HEADER], `headers.${TURNSTILE_HEADER}`);
      if (!turnstile.ok) return turnstile;
      if (!isObject(m.body)) return fail('', 'not_object');
      const chronicle = under('chronicle', parsePublicChronicle(m.body.chronicle, catalog));
      if (!chronicle.ok) return chronicle;
      const digest = parseDigest(m.body.digest, catalog, 'digest');
      if (!digest.ok) return digest;
      const inscription = parseInscription(m.body.inscription, catalog, 'inscription');
      if (!inscription.ok) return inscription;
      return { ok: true, value: { kind: 'publish', chronicle: chronicle.value, digest: digest.value, inscription: inscription.value, turnstile: turnstile.value } };
    },
  },
  browse: {
    method: 'GET',
    path: ['chronicles'],
    maxBytes: 0,
    write: ({ scenarioId, before }) => ({ query: { ...(scenarioId === null ? {} : { scenario: scenarioId }), ...(before === null ? {} : { before }) } }),
    read: (m, catalog) => {
      const scenario = m.query.get('scenario');
      const scenarioId = scenario === null ? null : parseScenarioId(scenario, catalog, 'query.scenario');
      if (scenarioId && !scenarioId.ok) return scenarioId;
      const cursor = m.query.get('before');
      const before = cursor === null ? null : parseCursor(cursor, 'query.before');
      if (before && !before.ok) return before;
      return { ok: true, value: { kind: 'browse', scenarioId: scenarioId?.value ?? null, before: before?.value ?? null } };
    },
  },
  visit: {
    method: 'GET',
    path: ['chronicles', PARAM],
    maxBytes: 0,
    write: ({ id }) => ({ param: id }),
    read: (m) => {
      const id = parseChronicleId(m.param, 'id');
      return id.ok ? { ok: true, value: { kind: 'visit', id: id.value } } : id;
    },
  },
  withdraw: {
    method: 'DELETE',
    path: ['chronicles', PARAM],
    maxBytes: 0,
    write: ({ id, key }) => ({ param: id, headers: { authorization: `Bearer ${key}` } }),
    read: (m) => {
      const id = parseChronicleId(m.param, 'id');
      if (!id.ok) return id;
      const key = parseWithdrawKey(BEARER.exec(m.headers.authorization ?? '')?.[1], 'headers.authorization');
      return key.ok ? { ok: true, value: { kind: 'withdraw', id: id.value, key: key.value } } : key;
    },
  },
  confirm: {
    method: 'POST',
    path: ['chronicles', PARAM, 'confirm'],
    maxBytes: SMALL_BODY_BYTES,
    write: ({ id, digest }) => ({ param: id, body: { digest } }),
    read: (m, catalog) => {
      const id = parseChronicleId(m.param, 'id');
      if (!id.ok) return id;
      if (!isObject(m.body)) return fail('', 'not_object');
      const digest = parseDigest(m.body.digest, catalog, 'digest');
      return digest.ok ? { ok: true, value: { kind: 'confirm', id: id.value, digest: digest.value } } : digest;
    },
  },
  report: {
    method: 'POST',
    path: ['chronicles', PARAM, 'report'],
    maxBytes: 0,
    write: ({ id, turnstile }) => ({ param: id, headers: { [TURNSTILE_HEADER]: turnstile } }),
    read: (m) => {
      const id = parseChronicleId(m.param, 'id');
      if (!id.ok) return id;
      const turnstile = parseTurnstile(m.headers[TURNSTILE_HEADER], `headers.${TURNSTILE_HEADER}`);
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
      const cargo = parseCargo(m.body.cargo, catalog, 'cargo');
      return cargo.ok ? { ok: true, value: { kind: 'cast_cargo', cargo: cargo.value } } : cargo;
    },
  },
  draw_cargo: {
    method: 'GET',
    path: ['cargo'],
    maxBytes: 0,
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
      const scenarioId = parseScenarioId(m.body.scenarioId, catalog, 'scenarioId');
      if (!scenarioId.ok) return scenarioId;
      const verdict = parseVerdict(m.body.verdict, 'verdict');
      return verdict.ok ? { ok: true, value: { kind: 'report_outcome', scenarioId: scenarioId.value, verdict: verdict.value } } : verdict;
    },
  },
  avoidance: {
    method: 'GET',
    path: ['outcomes', PARAM],
    maxBytes: 0,
    write: ({ scenarioId }) => ({ param: scenarioId }),
    read: (m, catalog) => {
      const scenarioId = parseScenarioId(m.param, catalog, 'scenarioId');
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
  const url = new URL(wire.path, 'http://harbor.invalid');
  if (!url.pathname.startsWith(PREFIX)) return fail('', 'no_route');
  const segments = url.pathname.slice(PREFIX.length).split('/');
  for (const route of Object.values(ROUTES)) {
    if (route.method !== wire.method || route.path.length !== segments.length) continue;
    if (!route.path.every((s, i) => s === PARAM || s === segments[i])) continue;
    const body = readJson(wire.body, route.maxBytes);
    if (!body.ok) return body;
    const at = route.path.indexOf(PARAM);
    return route.read({ param: at < 0 ? null : segments[at], query: url.searchParams, headers: wire.headers, body: body.value }, catalog);
  }
  return fail('', 'no_route');
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
    const id = parseChronicleId(v.id, 'id');
    if (!id.ok) return id;
    const withdrawKey = parseWithdrawKey(v.withdrawKey, 'withdrawKey');
    return withdrawKey.ok ? { ok: true, value: { id: id.value, withdrawKey: withdrawKey.value } } : withdrawKey;
  },
  browse: (v, catalog) => {
    if (!isObject(v)) return fail('', 'not_object');
    if (!Array.isArray(v.cards)) return fail('cards', 'not_array');
    if (v.cards.length > HARBOR_LIMITS.cardsPerPage) return fail('cards', 'too_many');
    const cards: HarborResponses['browse']['cards'][number][] = [];
    for (const [i, c] of v.cards.entries()) {
      const card = parseCard(c, catalog, `cards[${i}]`);
      if (!card.ok) return card;
      cards.push(card.value);
    }
    const next = v.next === null ? null : parseCursor(v.next, 'next');
    if (next && !next.ok) return next;
    return { ok: true, value: { cards, next: next?.value ?? null } };
  },
  /** card.id が chronicleId(chronicle) と合うかは非同期なので、呼び手 (M19-09) が確かめる */
  visit: (v, catalog) => {
    if (!isObject(v)) return fail('', 'not_object');
    const chronicle = under('chronicle', parsePublicChronicle(v.chronicle, catalog));
    if (!chronicle.ok) return chronicle;
    const card = parseCard(v.card, catalog, 'card');
    return card.ok ? { ok: true, value: { chronicle: chronicle.value, card: card.value } } : card;
  },
  draw_cargo: (v, catalog) => {
    if (!isObject(v)) return fail('', 'not_object');
    if (v.drawn === null) return { ok: true, value: { drawn: null } };
    if (!isObject(v.drawn)) return fail('drawn', 'not_object');
    const id = parseCargoId(v.drawn.id, 'drawn.id');
    if (!id.ok) return id;
    const cargo = parseCargo(v.drawn.cargo, catalog, 'drawn.cargo');
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

/** 入れ子の parse の拒否の場所に、外側の鍵を前置する */
function under<T>(key: string, p: Parsed<T>): Parsed<T> {
  return p.ok ? p : fail(p.error.path === '' ? key : `${key}.${p.error.path}`, p.error.reason);
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
