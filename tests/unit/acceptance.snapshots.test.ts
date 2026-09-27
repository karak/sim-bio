import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { snapshotRoutes } from '../../tools/acceptance-snapshots.ts';

const dir = mkdtempSync(join(tmpdir(), 'acceptance-snapshots-'));
let server: Server;
let base = '';

beforeAll(async () => {
  const route = snapshotRoutes(dir, { now: () => new Date(Date.UTC(2026, 8, 27, 5, 6, 7)) });
  server = createServer((req, res) => {
    if (!route(req, res, new URL(req.url ?? '/', 'http://x'))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (body: unknown, origin = 'http://localhost:8787') =>
  fetch(`${base}/api/snapshots`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('受入の画面のサーバーの状態の写し (M19-16)', () => {
  it('手元の画面から送った写しを snapshots/<id>.json に置き、id で同じ中身を返す', async () => {
    const snap = { format: 'biotope-dev-snapshot/1', url: 'http://localhost:8787/?scenario=sinking', db: { name: 'biotope-island', version: 6, stores: {} } };
    const res = await post(snap);
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8787');
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^s-20260927-050607-[0-9a-f]{4}$/);
    expect(readdirSync(dir)).toContain(`${id}.json`);

    const back = await fetch(`${base}/api/snapshots/${id}`);
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual(snap);
  });

  it('よそのページからの写し・形の違う JSON・無い id・道を外れた id は受けない', async () => {
    expect((await post({ format: 'biotope-dev-snapshot/1' }, 'https://evil.example')).status).toBe(403);
    expect((await post({ format: 'other' })).status).toBe(400);
    expect((await fetch(`${base}/api/snapshots/s-20260927-050607-ffff`)).status).toBe(404);
    expect((await fetch(`${base}/api/snapshots/..%2Fresults`)).status).toBe(404);
  });

  it('CORS の下見 (OPTIONS) に、手元の origin だけ POST を許す', async () => {
    const ok = await fetch(`${base}/api/snapshots`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5181' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5181');
    const foreign = await fetch(`${base}/api/snapshots`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });
});
