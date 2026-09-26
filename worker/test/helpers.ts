import { exports } from 'cloudflare:workers';
import { vi } from 'vitest';
import { digestOf } from '../../src/chronicle/digest';
import type { Chronicle, Digest } from '../../src/harbor/chronicle';
import type { HarborRequest, InscriptionId, TurnstileToken, WithdrawKey } from '../../src/harbor/contract';
import { readRefusal, writeRequest, type ReadRefusal } from '../../src/harbor/wire';
import { FIXTURE_CHRONICLE } from '../../tests/fixtures/chronicle';

export const ORIGIN = 'https://biotope.example';
export const HUMAN = 'XXXX.DUMMY.TOKEN.XXXX' as TurnstileToken;
export const BOT = 'not-a-human-token' as TurnstileToken;
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

let senders = 0;
/** 回数制限は送り手ごと (IP から作る HMAC) なので、テストごとに別の IP を使って数えを混ぜない */
export const freshIp = () => `203.0.113.${(senders = (senders % 250) + 1)}`;

export const keyOf = (c: string) => c.padEnd(43, 'k') as WithdrawKey;
export const chronicleOf = (seed: number, over: Partial<Chronicle> = {}): Chronicle => ({ ...FIXTURE_CHRONICLE, seed, ...over });
export const digestFor = (verdict: Digest['verdict'] = 'alive', deer = 12.5) => digestOf({ year: 3, totals: { deer, wolf: 0 } }, verdict);

export async function publishReq(seed: number, over: Partial<Extract<HarborRequest, { kind: 'publish' }>> = {}): Promise<Extract<HarborRequest, { kind: 'publish' }>> {
  return { kind: 'publish', chronicle: chronicleOf(seed), digest: await digestFor(), inscription: 'still-here' as InscriptionId, turnstile: HUMAN, key: keyOf(`seed${seed}`), ...over };
}

/** クライアントと同じ writeRequest で書いた要求を、Worker の fetch に当てる */
export function send(req: HarborRequest, { ip = '198.51.100.1', headers = {} }: { ip?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const w = writeRequest(req);
  return exports.default.fetch(`${ORIGIN}${w.path}`, {
    method: w.method,
    headers: { origin: ORIGIN, 'cf-connecting-ip': ip, ...w.headers, ...headers },
    body: w.body,
  });
}

export async function refusalOf(res: Response): Promise<ReadRefusal> {
  return readRefusal(res.status, await res.text());
}

/**
 * siteverify への fetch を止め、テストの鍵のふるまい (ダミーの札だけが通る) を手元で返す。外への通信はほかに無い
 * @returns siteverify に渡った本文
 */
export function stubSiteverify(mode: 'answer' | 'down' = 'answer'): { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== SITEVERIFY) throw new Error(`テストの外への fetch: ${url}`);
    if (mode === 'down') throw new TypeError('network down');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    const success = body.secret === '1x0000000000000000000000000000000AA' && body.response === HUMAN;
    return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] });
  });
  return { calls };
}

/** console への JSON 1 行を拾う (Workers Logs に書く行) */
export function captureLogs(): { event: string; [k: string]: unknown }[] {
  const out: { event: string; [k: string]: unknown }[] = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((text: unknown) => {
      out.push({ level, ...(JSON.parse(String(text)) as { event: string }) });
    });
  }
  return out;
}

export { utcDay } from '../src/ledger';
