import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

/**
 * 受入の画面のサーバー (.claude/acceptance/server.mjs) の状態の写しの道 (M19-16)。画面の開発の板が POST した写しを
 * <dir>/<id>.json に置き、id を返す。AI は id から tests/fixtures/devSnapshot.ts で読む。
 * .claude/acceptance は git の外なので、そこにはこの file の写しを置く (docs/operations/acceptance.md)。node 24 は .ts をそのまま読む
 */

const FORMAT = 'biotope-dev-snapshot/1';
/** size 128 の島 (1.6 MB) を枠 4 つ・石板・今の島で持っても収まる */
const MAX_BYTES = 64 * 1024 * 1024;
const ID = /^s-\d{8}-\d{6}-[0-9a-f]{4}$/;
/** 写しを送れるのは手元の画面 (vite dev・wrangler dev) だけ */
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;

const idOf = (now: Date) => `s-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${randomBytes(2).toString('hex')}`;

function reply(res: ServerResponse, origin: string | undefined, status: number, body: unknown) {
  const cors: Record<string, string> = origin && LOCAL_ORIGIN.test(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors });
  res.end(JSON.stringify(body));
}

function receive(req: IncomingMessage, res: ServerResponse, dir: string, now: () => Date) {
  const origin = req.headers.origin;
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size <= MAX_BYTES) chunks.push(c);
  });
  req.on('end', () => {
    if (size > MAX_BYTES) return reply(res, origin, 413, { error: 'payload_too_large', maxBytes: MAX_BYTES });
    let snap: unknown;
    try {
      snap = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(res, origin, 400, { error: 'not_json' });
    }
    if (typeof snap !== 'object' || snap === null || (snap as { format?: unknown }).format !== FORMAT) return reply(res, origin, 400, { error: 'unknown_format' });
    const id = idOf(now());
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(snap));
    renameSync(`${file}.tmp`, file);
    reply(res, origin, 201, { id });
  });
}

/** 写しの道を受けたら true。ほかの道は呼び手 (受入の画面の静的配信・判定の保存) に任せる */
export function snapshotRoutes(dir: string, { now = () => new Date() }: { now?: () => Date } = {}): Route {
  return (req, res, url) => {
    if (url.pathname === '/api/snapshots') {
      const origin = req.headers.origin;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, origin && LOCAL_ORIGIN.test(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {});
        res.end();
      } else if (req.method === 'POST') {
        if (origin !== undefined && !LOCAL_ORIGIN.test(origin)) reply(res, origin, 403, { error: 'forbidden_origin' });
        else receive(req, res, dir, now);
      } else reply(res, origin, 405, { error: 'method_not_allowed' });
      return true;
    }
    const m = /^\/api\/snapshots\/([^/]+)$/.exec(url.pathname);
    if (!m) return false;
    if (!ID.test(m[1])) {
      reply(res, req.headers.origin, 404, { error: 'not_found' });
      return true;
    }
    try {
      const body = readFileSync(join(dir, `${m[1]}.json`));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      reply(res, req.headers.origin, 404, { error: 'not_found' });
    }
    return true;
  };
}
