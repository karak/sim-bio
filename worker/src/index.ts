import { decodeLogBatch, LOG_BATCH_LIMITS } from '../../src/core/log/batch';
import type { LogLevel } from '../../src/core/log/types';

/**
 * 港の Worker (設計書 §3・§4.2)。wrangler.jsonc の run_worker_first で /api/* だけがここへ来る。静的アセットと SPA の fallback は Worker を起こさない。
 * 今あるのはログの受け口 (M19-02) だけ。年代記・積荷などのルートは M19-08 で ROUTES に足す。
 */

type Handler = (request: Request) => Promise<Response>;

/** 道 → (method → handler)。Map にするのは、`constructor` のような Object の鍵を道と取り違えないため */
const ROUTES: ReadonlyMap<string, ReadonlyMap<string, Handler>> = new Map([['/api/v1/logs', new Map([['POST', receiveLogs]])]]);

/** 書き込みの要求は、この Worker 自身の Origin から来たものだけを受ける (よそのページからの送りつけを断る) */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

const CONSOLE: Readonly<Record<LogLevel, (line: string) => void>> = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.get(url.pathname);
    if (!route) return reject({ url, status: 404, body: { error: 'not_found' } });
    const origin = request.headers.get('origin');
    if (!SAFE_METHODS.has(request.method) && origin !== url.origin) {
      return reject({ url, status: 403, body: { error: 'forbidden_origin' }, detail: { origin } });
    }
    const handler = route.get(request.method);
    if (!handler) {
      const allow = [...route.keys()].join(', ');
      return reject({ url, status: 405, body: { error: 'method_not_allowed' }, detail: { method: request.method }, headers: { allow } });
    }
    return handler(request);
  },
} satisfies ExportedHandler<Env>;

async function receiveLogs(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const text = await readBounded(request, LOG_BATCH_LIMITS.maxBytes);
  if (text === null) return reject({ url, status: 413, body: { error: 'payload_too_large', maxBytes: LOG_BATCH_LIMITS.maxBytes } });
  const parsed = decodeLogBatch(text);
  if (!parsed.ok) return reject({ url, status: 400, body: { error: 'bad_request', ...parsed.error } });
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

/** 断った理由は Workers Logs に残す (返す本文と同じ中身に、呼び手へは返さない detail を添える) */
function reject({ url, status, body, detail = {}, headers }: {
  url: URL;
  status: number;
  body: { error: string } & Record<string, unknown>;
  detail?: Record<string, unknown>;
  headers?: HeadersInit;
}): Response {
  console.warn(JSON.stringify({ event: 'harbor.api.rejected', status, route: url.pathname, ...body, ...detail }));
  return Response.json(body, { status, headers });
}
