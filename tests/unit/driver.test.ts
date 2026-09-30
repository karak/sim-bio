import { describe, expect, it } from 'vitest';
import type { Page, Route } from '@playwright/test';
import { writeRequest } from '../../src/harbor/wire';
import { DUMMY_TOKEN } from '../fixtures/fakeHarbor';
import { fakeTurnstile, routeHarbor, wireOf } from '../driver/harbor';
import { shownTick, tickFromHud, TICKS_PER_YEAR } from '../driver/island';

type Handler = (route: Route) => Promise<unknown> | unknown;
type Fulfilled = { status?: number; contentType?: string; headers?: Record<string, string>; body?: string };

/** page.route を記録するだけの Page。pattern と handler の対を順に残す */
function recordingPage() {
  const routes: { pattern: unknown; handler: Handler }[] = [];
  const page = { route: async (pattern: unknown, handler: Handler) => void routes.push({ pattern, handler }) } as unknown as Page;
  return { page, routes };
}

function fakeRoute(url: string, init: { method?: string; body?: string | null } = {}) {
  const out: { fulfilled?: Fulfilled; aborted?: string } = {};
  const route = {
    request: () => ({ url: () => url, method: () => init.method ?? 'GET', headers: () => ({ 'x-test': '1' }), postData: () => init.body ?? null }),
    fulfill: async (r: Fulfilled) => void (out.fulfilled = r),
    abort: async (code: string) => void (out.aborted = code),
  } as unknown as Route;
  return { route, out };
}

/** 港の写しが 200 で答える一覧の要求 (道は本物の writeRequest が書く) */
const BROWSE = writeRequest({ kind: 'browse', scenarioId: null, before: null });
const browse = () => fakeRoute(`http://localhost${BROWSE.path}`, { method: BROWSE.method });

const byKind = (routes: { pattern: unknown; handler: Handler }[]) => ({
  turnstile: routes.find((r) => r.pattern === 'https://challenges.cloudflare.com/turnstile/**')!,
  logs: routes.find((r) => r.pattern === '**/api/v1/logs')!,
  api: routes.find((r) => typeof r.pattern === 'function')!,
});

describe('tickFromHud (HUD の年と日の文から tick を読む)', () => {
  it('Year N と Day D から N * ticksPerYear + D', () => {
    expect(tickFromHud('Year 0', '春 · Day 0')).toBe(0);
    expect(tickFromHud('Year 2', '夏 · Day 45')).toBe(2 * TICKS_PER_YEAR + 45);
  });
  it('読めない文は NaN (待ちの poll が通らない)', () => {
    expect(tickFromHud(null, null)).toBeNaN();
  });
  it('shownTick は #hud-year と #hud-season の文を読む', async () => {
    const texts: Record<string, string> = { '#hud-year': 'Year 1', '#hud-season': '秋 · Day 7' };
    const page = { locator: (sel: string) => ({ textContent: async () => texts[sel] }) } as unknown as Page;
    expect(await shownTick(page)).toBe(TICKS_PER_YEAR + 7);
  });
});

describe('fakeTurnstile', () => {
  it('テストの札を指定の待ちで返す。widget は指定のときだけ置く', () => {
    expect(fakeTurnstile(50, false)).toContain(`setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), 50)`);
    expect(fakeTurnstile(50, false)).not.toContain('fake-turnstile');
    expect(fakeTurnstile(300, true)).toContain('fake-turnstile');
    expect(fakeTurnstile(300, true)).toContain('), 300)');
  });
});

describe('wireOf', () => {
  it('route の要求を港の写しが読む形 (method・path と query・headers・body) に直す', () => {
    const { route } = fakeRoute('http://localhost:5458/api/v1/browse?scenario=test-civ', { method: 'POST', body: '{}' });
    expect(wireOf(route)).toEqual({ method: 'POST', path: '/api/v1/browse?scenario=test-civ', headers: { 'x-test': '1' }, body: '{}' });
  });
});

describe('routeHarbor', () => {
  it('Turnstile の script を写しで答え、/logs は 204、港の API は写しが答える。送られた要求を順に残す', async () => {
    const { page, routes } = recordingPage();
    const harbor = await routeHarbor(page, { turnstile: { delayMs: 100 } });
    const r = byKind(routes);

    const ts = fakeRoute('https://challenges.cloudflare.com/turnstile/v0/api.js');
    await r.turnstile.handler(ts.route);
    expect(ts.out.fulfilled).toMatchObject({ status: 200, contentType: 'text/javascript', body: fakeTurnstile(100, false) });

    const log = fakeRoute('http://localhost/api/v1/logs', { method: 'POST', body: '[]' });
    await r.logs.handler(log.route);
    expect(log.out.fulfilled).toEqual({ status: 204 });

    const api = browse();
    await r.api.handler(api.route);
    expect(api.out.fulfilled?.status).toBe(200);
    expect(harbor.sent.map((w) => w.path)).toEqual([BROWSE.path]);
  });

  it('/api/v1/ の道だけを港の API とみなし、/logs は含めない', async () => {
    const { page, routes } = recordingPage();
    await routeHarbor(page);
    const match = byKind(routes).api.pattern as (url: URL) => boolean;
    expect(match(new URL('http://x/api/v1/visit'))).toBe(true);
    expect(match(new URL('http://x/api/v1/logs'))).toBe(false);
    expect(match(new URL('http://x/assets/app.js'))).toBe(false);
  });

  it('closed の間は abortWith の網の失敗にする (要求は残る)。開ければ写しが答える', async () => {
    const { page, routes } = recordingPage();
    const harbor = await routeHarbor(page);
    const api = byKind(routes).api;

    harbor.state.closed = true;
    const shut = browse();
    await api.handler(shut.route);
    expect(shut.out).toEqual({ aborted: 'failed' });

    harbor.state.abortWith = 'blockedbyclient';
    const blocked = browse();
    await api.handler(blocked.route);
    expect(blocked.out.aborted).toBe('blockedbyclient');
    expect(harbor.sent).toHaveLength(2);

    harbor.state.closed = false;
    const open = browse();
    await api.handler(open.route);
    expect(open.out.fulfilled?.status).toBe(200);
  });

  it('渡した港の写しと送信の記録を分け合える (別の見守り手の page が同じ港に当たる)', async () => {
    const first = await routeHarbor(recordingPage().page);
    const shared = recordingPage();
    const second = await routeHarbor(shared.page, { fake: first.fake, sent: first.sent });
    await byKind(shared.routes).api.handler(browse().route);
    expect(second.fake).toBe(first.fake);
    expect(first.sent).toHaveLength(1);
  });
});
