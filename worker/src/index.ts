import { decodeLogBatch, LOG_BATCH_LIMITS } from '../../src/core/log/batch';
import type { LogLevel } from '../../src/core/log/types';
import { bodyLimitOf, MAX_BODY_BYTES, writeRefusal, type Refusal, type WireRequest } from '../../src/harbor/wire';
import { devSenderOf } from './guard';
import { retryAfterOf, serve, type Outcome } from './harbor';
import * as ledger from './ledger';
import { HARBOR_CONFIG } from './policy';

/**
 * 港の Worker (設計書 §3・§4.2)。wrangler.jsonc の run_worker_first で /api/* だけがここへ来る。静的アセットと SPA の fallback は Worker を起こさない。
 * 今あるのはログの受け口 (M19-02) だけ。年代記・積荷などのルートは M19-08 で ROUTES に足す。
 * ROUTES は道の完全一致なので、/api/v1/chronicles/:id のような道を足すときは URLPattern などに替える。
 * M19-08: 港の道 (年代記・積荷・回避率) は ROUTES に足さず、ROUTES に無い道をすべて harbor へ渡す。道の照合は src/harbor/wire.ts の readRequest がする。
 * scheduled は毎日の Cron (wrangler.jsonc の triggers) で、帳簿の掃除と保存量の集計をする
 */

type Handler = (request: Request, url: URL, env: Env) => Promise<Response>;

/** 道 → (method → handler)。Map にするのは、`constructor` のような Object の鍵を道と取り違えないため */
const ROUTES: ReadonlyMap<string, ReadonlyMap<string, Handler>> = new Map([['/api/v1/logs', new Map([['POST', receiveLogs]])]]);

/** 書き込みの要求は、この Worker 自身の Origin から来たものだけを受ける (よそのページからの送りつけを断る) */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const CONSOLE: Readonly<Record<LogLevel, (line: string) => void>> = {
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.get(url.pathname);
    if (!route) return harbor(request, url, env);
    if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request, url)) {
      return reject({ url, status: 403, body: { error: 'forbidden_origin' }, detail: { origin: request.headers.get('origin') } });
    }
    const handler = route.get(request.method);
    if (!handler) {
      const allow = [...route.keys()].join(', ');
      return reject({ url, status: 405, body: { error: 'method_not_allowed' }, detail: { method: request.method }, headers: { allow } });
    }
    return handler(request, url, env);
  },

  async scheduled(controller, env): Promise<void> {
    try {
      const { swept, stats } = await ledger.sweep(env.HARBOR, controller.scheduledTime, HARBOR_CONFIG);
      console.info(JSON.stringify({ event: 'harbor.cron.swept', ...swept }));
      console.info(JSON.stringify({ event: 'harbor.cron.stats', ...stats }));
    } catch (e) {
      console.error(JSON.stringify({ event: 'harbor.d1.failed', reason: ledger.closedReasonOf(e), kind: 'cron', message: e instanceof Error ? e.message : String(e) }));
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * 書き込みは、この Worker 自身の画面から来たものだけを受ける (よそのページからブラウザで送りつけられるのを断る。認証ではない)。
 * Referrer-Policy: no-referrer の下では same-origin の POST でも Origin が "null" になるので、Sec-Fetch-Site も見る
 */
function isSameOrigin(request: Request, url: URL): boolean {
  return request.headers.get('origin') === url.origin || request.headers.get('sec-fetch-site') === 'same-origin';
}

async function receiveLogs(request: Request, url: URL, env: Env): Promise<Response> {
  const text = await readBounded(request, LOG_BATCH_LIMITS.maxBytes);
  if (text === null) return reject({ url, status: 413, body: { error: 'payload_too_large', maxBytes: LOG_BATCH_LIMITS.maxBytes } });
  const parsed = decodeLogBatch(text);
  if (!parsed.ok) return reject({ url, status: 400, body: { error: 'bad_request', ...parsed.error } });
  if (!(await admitLogs(env))) return new Response(null, { status: 204 });
  for (const record of parsed.value.records) CONSOLE[record.level](JSON.stringify({ event: 'harbor.logs.record', record }));
  if (parsed.value.dropped > 0) console.warn(JSON.stringify({ event: 'harbor.logs.dropped', dropped: parsed.value.dropped }));
  return new Response(null, { status: 204 });
}

/** 本文を UTF-8 で maxBytes まで読む。超えたら (Content-Length の申告でも、読んだ量でも) null。無制限に読んで 128 MB の枠を食わない */
async function readBounded(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

type LogKey = 'event' | 'status' | 'route';

// 固定の鍵 (LogKey) は body・detail に入れられない型にし、spread の後ろにも置く
/** 断った理由は Workers Logs に残す (返す本文と同じ中身に、呼び手へは返さない detail を添える) */
function reject({ url, status, body, detail = {}, headers }: {
  url: URL;
  status: number;
  body: { error: string } & Record<string, unknown> & Partial<Record<LogKey, never>>;
  detail?: Record<string, unknown> & Partial<Record<LogKey, never>>;
  headers?: HeadersInit;
}): Response {
  console.warn(JSON.stringify({ ...body, ...detail, event: 'harbor.api.rejected', status, route: url.pathname }));
  return Response.json(body, { status, headers });
}

/**
 * ログは捨てる順の先頭 (設計書 §6.1)。予算を越えた分は 204 で黙って捨てる (M19-01: 送り手は失敗しても止まらない)。
 * D1 が落ちているときは数えずに受ける。ログは D1 ではなく Workers Logs に書くので、D1 の上限に巻き込まない
 */
async function admitLogs(env: Env): Promise<boolean> {
  try {
    const { admitted } = await ledger.admit(env.HARBOR, ledger.utcDay(Date.now()), 'logs', HARBOR_CONFIG.budgets.logs);
    if (!admitted) console.info(JSON.stringify({ event: 'harbor.budget.dropped', bucket: 'logs' }));
    return admitted;
  } catch (e) {
    console.warn(JSON.stringify({ event: 'harbor.d1.failed', reason: ledger.closedReasonOf(e), kind: 'logs', message: e instanceof Error ? e.message : String(e) }));
    return true;
  }
}

const HARBOR_METHODS = ['GET', 'POST', 'DELETE'] as const satisfies readonly WireRequest['method'][];

/** 港の道 (M19-08)。Origin の門と本文の上限はログの受け口と同じ。答え (Outcome) を Response に書き、断りは Workers Logs に残す */
async function harbor(request: Request, url: URL, env: Env): Promise<Response> {
  const now = Date.now();
  const refuse = (refusal: Refusal, detail: Record<string, unknown> = {}) => render(url, now, { kind: 'refused', refusal, detail });
  const method = HARBOR_METHODS.find((m) => m === request.method);
  if (!method) return refuse({ error: 'not_found' }, { method: request.method });
  if (!SAFE_METHODS.has(method) && !isSameOrigin(request, url)) return refuse({ error: 'forbidden_origin' }, { origin: request.headers.get('origin') });
  const path = url.pathname + url.search;
  const maxBytes = bodyLimitOf({ method, path }) ?? MAX_BODY_BYTES;
  const body = await readBounded(request, maxBytes);
  if (body === null) return refuse({ error: 'payload_too_large', maxBytes });
  const wire: WireRequest = { method, path, headers: Object.fromEntries(request.headers), body };
  const ip = devSenderOf(url, request.headers) ?? request.headers.get('cf-connecting-ip') ?? '';
  return render(url, now, await serve(wire, { env, now, ip, config: HARBOR_CONFIG }));
}

function render(url: URL, now: number, outcome: Outcome): Response {
  if (outcome.kind === 'empty') return new Response(null, { status: 204 });
  if (outcome.kind === 'ok') return new Response(outcome.body, { status: outcome.status, headers: { 'content-type': 'application/json' } });
  const { status } = writeRefusal(outcome.refusal);
  const retryAfter = retryAfterOf(outcome.refusal, now);
  return reject({ url, status, body: outcome.refusal, detail: outcome.detail, headers: retryAfter === null ? undefined : { 'retry-after': String(retryAfter) } });
}
