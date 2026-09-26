import { isObject, under, type ParseError, type Parsed } from '../core/parse';
import type { HarborStore, Outbound } from '../persist/harborStore';
import { visitHref } from '../ui/clicks';
import type { Chronicle, Digest } from './chronicle';
import {
  chronicleId,
  parseChronicleId,
  parseDigest,
  parseInscription,
  parsePublicChronicle,
  type BrowseCursor,
  type ChronicleCard,
  type ChronicleId,
  type HarborCatalog,
  type HarborRequest,
  type HarborResponses,
  type InscriptionId,
  type TurnstileToken,
  type WithdrawKey,
} from './contract';
import { readRefusal, readResponse, writeRequest, type ReadRefusal } from './wire';

/**
 * 港のクライアント (M19-09、設計書 §5.2・§6.2)。呼び手は kind で分けるだけ。例外を投げない。
 * 人間確認・閉港の読み替え・outbox・同じ id での再送・取り下げ鍵の保管は、ここに隠す。
 * 閉港は普段の状態: 1027・503・網の失敗・港の形でない返事 (静的配信の index.html など) を、どれも closed に読む
 */

/** 出港の 1 件。ひとことは碑文のカタログの id */
export type PublishInput = { chronicle: Chronicle; digest: Digest; inscription: InscriptionId };

export type PublishResult =
  | { kind: 'published'; id: ChronicleId; url: string }
  /** 閉港・網が無い。outbox に入り、次の起動と 1 時間ごとに同じ id・同じ鍵で送り直す */
  | { kind: 'queued'; id: ChronicleId }
  | { kind: 'not_human' | 'slow_down' }
  /** 契約違反・版違い・満杯など、送り直しても通らないもの。outbox に残さない */
  | { kind: 'rejected'; reason: string };

/** 人間確認 (Turnstile) の答え。unavailable は widget が読めない (網が無い) ので閉港と同じに扱う */
export type HumanAnswer = { kind: 'token'; token: TurnstileToken } | { kind: 'failed' } | { kind: 'unavailable' };

export type Harbor = {
  publish(p: PublishInput): Promise<PublishResult>;
  /** outbox を古い順に送り直す。閉港が続けば 1 件目の queued でやめる (人間確認を何度も出さない) */
  flushOutbox(): Promise<readonly PublishResult[]>;
  browse(q: { scenarioId?: string; before?: BrowseCursor }): Promise<{ kind: 'ok'; cards: readonly ChronicleCard[]; next: BrowseCursor | null } | { kind: 'closed' }>;
  visit(id: ChronicleId): Promise<{ kind: 'ok'; chronicle: Chronicle; card: ChronicleCard } | { kind: 'closed' | 'missing' }>;
  /** 照合の結末を送る。失敗は握りつぶす (照合は善意の付加物) */
  confirm(id: ChronicleId, d: Digest): Promise<void>;
  /** 港に無い (取り下げ済み・隠された) も ok (通報するものがもう無い) */
  report(id: ChronicleId): Promise<'ok' | 'closed' | 'not_human' | 'slow_down'>;
  /** 手元の鍵で取り下げる。港に無い (取り下げ済み) も ok にし、鍵を忘れる */
  withdraw(id: ChronicleId): Promise<'ok' | 'closed' | 'forbidden'>;
  /** 手元に取り下げ鍵のある年代記 (自分が出港したもの) */
  ownIds(): Promise<ReadonlySet<ChronicleId>>;
};

export type HarborLog = (level: 'info' | 'warn', event: string, extra?: Record<string, unknown>) => void;

export type HarborDeps = {
  /** 港の API の置き場 (例 "/" は同じ origin)。無ければ常に閉港 (ローカル開発と E2E の既定) */
  baseUrl?: string;
  /** 訪問のリンクの origin (例 location.origin) */
  linkBase: string;
  store: HarborStore;
  catalog: HarborCatalog;
  turnstile: () => Promise<HumanAnswer>;
  fetch?: typeof fetch;
  /** 取り下げ鍵 (乱数 32 B の base64url)。テストは決まった鍵を渡す */
  newKey?: () => WithdrawKey;
  log?: HarborLog;
};

const REQUEST_TIMEOUT_MS = 10_000;
const CLOSED: ReadRefusal = { error: 'closed', reason: 'unknown' };

/** 港の答え。読めた本文か、断り (網の失敗と港の形でない返事は閉港) */
type Answer<T> = { ok: true; value: T } | { ok: false; refusal: ReadRefusal };
const refused = (refusal: ReadRefusal): { ok: false; refusal: ReadRefusal } => ({ ok: false, refusal });

const reasonOf = (e: ParseError) => (e.path === '' ? e.reason : `${e.path}: ${e.reason}`);

export function randomWithdrawKey(): WithdrawKey {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') as WithdrawKey;
}

export function createHarbor(deps: HarborDeps): Harbor {
  const { store, catalog } = deps;
  const log: HarborLog = deps.log ?? (() => {});
  const newKey = deps.newKey ?? randomWithdrawKey;
  const base = deps.baseUrl?.trim() || null;
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const linkOf = (id: ChronicleId, scenarioId: string) => new URL(visitHref({ id, scenarioId }), deps.linkBase).href;

  /** 港へ 1 回問う。2xx の本文は read で読み、読めなければ港の形でないので閉港 */
  async function call<T>(req: HarborRequest, read: (status: number, text: string) => Answer<T>): Promise<Answer<T>> {
    if (base === null) return refused(CLOSED);
    const wire = writeRequest(req);
    try {
      const res = await fetchImpl(new URL(wire.path, new URL(base, deps.linkBase)).href, {
        method: wire.method,
        headers: wire.headers,
        body: wire.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      return res.ok ? read(res.status, text) : refused(readRefusal(res.status, text));
    } catch (e) {
      log('warn', 'harbor.unreachable', { kind: req.kind, error: String(e) });
      return refused(CLOSED);
    }
  }
  /** 本文のある道 */
  const ask = <K extends keyof HarborResponses>(kind: K, req: Extract<HarborRequest, { kind: K }>) =>
    call(req, (_status, text): Answer<HarborResponses[K]> => {
      const parsed = readResponse(kind, text, catalog);
      if (parsed.ok) return parsed;
      log('warn', 'harbor.unreadable', { kind, ...parsed.error });
      return refused(CLOSED);
    });
  /** 本文の無い道は 204 だけを受ける (200 の index.html は港の形でない) */
  const tell = (req: HarborRequest) => call(req, (status): Answer<null> => (status === 204 ? { ok: true, value: null } : refused(CLOSED)));

  async function deliver(o: Outbound): Promise<PublishResult> {
    const queued: PublishResult = { kind: 'queued', id: o.id };
    if (base === null) return queued;
    const human = await deps.turnstile();
    if (human.kind === 'unavailable') return queued;
    if (human.kind === 'failed') {
      await store.dequeue(o.id);
      return { kind: 'not_human' };
    }
    const key = await store.claimKey(o.id, newKey);
    const result = publishResultOf(o, await ask('publish', { kind: 'publish', chronicle: o.chronicle, digest: o.digest, inscription: o.inscription, turnstile: human.token, key }));
    if (result.kind !== 'queued') await store.dequeue(o.id);
    log(result.kind === 'published' || result.kind === 'queued' ? 'info' : 'warn', `harbor.publish.${result.kind}`, { id: o.id, ...(result.kind === 'rejected' ? { reason: result.reason } : {}) });
    return result;
  }

  const publishResultOf = (o: Outbound, got: Answer<HarborResponses['publish']>): PublishResult => {
    if (got.ok) return got.value.id === o.id ? { kind: 'published', id: o.id, url: linkOf(o.id, o.chronicle.scenarioId) } : { kind: 'rejected', reason: 'id_mismatch' };
    const r = got.refusal;
    switch (r.error) {
      case 'closed':
        return { kind: 'queued', id: o.id };
      case 'not_human':
      case 'slow_down':
        return { kind: r.error };
      case 'bad_request':
        return { kind: 'rejected', reason: reasonOf(r) };
      default:
        return { kind: 'rejected', reason: r.error };
    }
  };

  /** 手元の値 (出港の前・outbox から読んだ行) を港の契約で読む。港と同じ parse なので、同じ拒否理由を先に出せる */
  async function parseOutbound(v: unknown): Promise<Parsed<Outbound>> {
    if (!isObject(v)) return { ok: false, error: { path: '', reason: 'not_object' } };
    const chronicle = under('chronicle', parsePublicChronicle(v.chronicle, catalog));
    if (!chronicle.ok) return chronicle;
    const digest = under('digest', parseDigest(v.digest, catalog));
    if (!digest.ok) return digest;
    const inscription = under('inscription', parseInscription(v.inscription, catalog));
    if (!inscription.ok) return inscription;
    const id = await chronicleId(chronicle.value);
    if (v.id !== undefined && v.id !== id) return { ok: false, error: { path: 'id', reason: 'mismatch' } };
    return { ok: true, value: { id, chronicle: chronicle.value, digest: digest.value, inscription: inscription.value } };
  }

  let flushing: Promise<readonly PublishResult[]> | null = null;
  async function flush(): Promise<readonly PublishResult[]> {
    const results: PublishResult[] = [];
    for (const row of await store.queued()) {
      const o = await parseOutbound(row);
      if (!o.ok) {
        const rowId = isObject(row) ? parseChronicleId(row.id) : null;
        if (rowId?.ok) await store.dequeue(rowId.value);
        log('warn', 'harbor.outbox.unreadable', { ...o.error });
        continue;
      }
      const r = await deliver(o.value);
      results.push(r);
      if (r.kind === 'queued') break;
    }
    return results;
  }

  return {
    async publish(p) {
      const o = await parseOutbound(p);
      if (!o.ok) return { kind: 'rejected', reason: reasonOf(o.error) };
      // outbox の行はどれも鍵を持つ (送る前に取り下げても、鍵で港に問える)
      await store.claimKey(o.value.id, newKey);
      await store.enqueue(o.value);
      return deliver(o.value);
    },
    flushOutbox() {
      flushing ??= flush().finally(() => {
        flushing = null;
      });
      return flushing;
    },
    async browse(q) {
      const got = await ask('browse', { kind: 'browse', scenarioId: q.scenarioId ?? null, before: q.before ?? null });
      return got.ok ? { kind: 'ok', ...got.value } : { kind: 'closed' };
    },
    async visit(id) {
      const got = await ask('visit', { kind: 'visit', id });
      if (!got.ok) return { kind: got.refusal.error === 'not_found' ? 'missing' : 'closed' };
      if (got.value.card.id !== id || (await chronicleId(got.value.chronicle)) !== id) {
        log('warn', 'harbor.unreadable', { kind: 'visit', id, reason: 'id_mismatch' });
        return { kind: 'closed' };
      }
      return { kind: 'ok', ...got.value };
    },
    async confirm(id, digest) {
      const r = await tell({ kind: 'confirm', id, digest });
      if (!r.ok) log('info', 'harbor.confirm.dropped', { id, error: r.refusal.error });
    },
    async report(id) {
      if (base === null) return 'closed';
      const human = await deps.turnstile();
      if (human.kind === 'unavailable') return 'closed';
      if (human.kind === 'failed') return 'not_human';
      const r = await tell({ kind: 'report', id, turnstile: human.token });
      if (r.ok || r.refusal.error === 'not_found') return 'ok';
      return r.refusal.error === 'not_human' || r.refusal.error === 'slow_down' ? r.refusal.error : 'closed';
    },
    async withdraw(id) {
      await store.dequeue(id);
      const key = await store.keyOf(id);
      if (key === null) return 'forbidden';
      const r = await tell({ kind: 'withdraw', id, key });
      if (r.ok || r.refusal.error === 'not_found') {
        await store.forgetKey(id);
        return 'ok';
      }
      return r.refusal.error === 'forbidden' ? 'forbidden' : 'closed';
    },
    ownIds: () => store.ownIds(),
  };
}
