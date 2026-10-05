import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import type { WireRequest } from '../../src/harbor/wire';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN } from '../fixtures/fakeHarbor';

const data = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
export const catalog = catalogFrom({ scenarios: data('scenarios'), species: data('species'), inscriptions: data('inscriptions') });

/** Turnstile の script の代わり。widget を置いて、少し待ってからテストの札を返す (本物のテストの sitekey と同じ札) */
export const fakeTurnstile = (delayMs: number, widget: boolean) =>
  widget
    ? `window.turnstile = {
  render(el, o) { const d = document.createElement('div'); d.className = 'fake-turnstile'; d.textContent = '確認中'; el.appendChild(d); setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), ${delayMs}); return 'w' + Math.random(); },
  remove() {},
};`
    : `window.turnstile = { render(el, o) { setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), ${delayMs}); return 'w'; }, remove() {} };`;

export const wireOf = (route: Route): WireRequest => {
  const req = route.request();
  const url = new URL(req.url());
  return { method: req.method() as WireRequest['method'], path: url.pathname + url.search, headers: req.headers(), body: req.postData() };
};

export type HarborRoute = {
  fake: ReturnType<typeof createFakeHarbor>;
  sent: WireRequest[];
  state: { closed: boolean; abortWith: 'failed' | 'blockedbyclient' };
};

export type HarborRouteOptions = {
  /** 1 つの港の写しを、見守り手の page すべてで分け合う (手元で別の人として同じ港に当たる) */
  fake?: HarborRoute['fake'];
  sent?: WireRequest[];
  /** Turnstile の写しがテストの札を返すまでの時間と、widget を置くか */
  turnstile?: { delayMs: number; widget?: boolean };
};

/** 港の API を港の写しで答える。closed の間は網の失敗 (abort) にする。送られた要求を順に残す */
export async function routeHarbor(page: Page, opts: HarborRouteOptions = {}): Promise<HarborRoute> {
  const fake = opts.fake ?? createFakeHarbor(catalog);
  const sent = opts.sent ?? [];
  // abortWith: DevTools の Network request blocking は ERR_BLOCKED_BY_CLIENT (M19-15)
  const state: HarborRoute['state'] = { closed: false, abortWith: 'failed' };
  const script = fakeTurnstile(opts.turnstile?.delayMs ?? 50, opts.turnstile?.widget ?? false);
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: script }));
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs',
    async (route) => {
      const wire = wireOf(route);
      sent.push(wire);
      if (state.closed) return route.abort(state.abortWith);
      const r = await fake.serve(wire);
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body ?? '' });
    },
  );
  await page.route('**/api/v1/logs', (route) => route.fulfill({ status: 204 }));
  return { fake, sent, state };
}
