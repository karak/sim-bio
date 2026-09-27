import { isObject } from '../../src/core/parse';
import type { TurnstileToken } from '../../src/harbor/contract';

/**
 * 港の門 (設計書 §6.3): 送り手の数え方・人間確認・回数制限。
 * IP は保存しない。送り手は「secret と UTC の日付」を鍵にした HMAC で表し、日が替われば同じ IP でも別の値になる (日替わりの salt)。
 * secret を知らなければ、値から IP を戻すことも、日をまたいで同じ人を結ぶこともできない
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 5_000;
const encoder = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** 送り手の札 (16 進 32 文字)。回数制限の鍵と、通報の重複の判定 (その日だけ D1 に置き、Cron が翌日に消す) にだけ使う */
export async function senderOf(secret: string, day: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`${secret}\n${day}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(ip))).slice(0, 32);
}

/** 手元で別の見守り手として振る舞う (M19-16) ときに、送り手の IP の代わりに数える名乗りの header */
export const DEV_SENDER_HEADER = 'x-dev-sender';
const LOOPBACK: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * wrangler dev (loopback の host で受けた要求) のときだけ、x-dev-sender の名乗りを送り手の IP の代わりにする。
 * Cloudflare の網は Host で Worker を選ぶので、本番の Worker に loopback の host の要求は届かない。本番では常に null
 */
export function devSenderOf(url: URL, headers: Headers): string | null {
  if (!LOOPBACK.has(url.hostname)) return null;
  const name = headers.get(DEV_SENDER_HEADER);
  return name ? `dev:${name}` : null;
}

export type HumanCheck = { kind: 'human' } | { kind: 'bot'; codes: readonly string[] } | { kind: 'unavailable' };

/** Turnstile の siteverify (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。札は 1 回きり・300 秒で切れる */
export async function verifyHuman(secret: string, token: TurnstileToken): Promise<HumanCheck> {
  let body: unknown;
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: 'unavailable' };
    body = await res.json();
  } catch {
    return { kind: 'unavailable' };
  }
  if (!isObject(body)) return { kind: 'unavailable' };
  if (body.success === true) return { kind: 'human' };
  const codes = Array.isArray(body['error-codes']) ? body['error-codes'].filter((c): c is string => typeof c === 'string') : [];
  return { kind: 'bot', codes };
}

/**
 * Rate Limiting binding (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。場所ごとに数え、結果整合で緩い。
 * binding が使えない (無料プランで外された・呼び出しが落ちた) ときは通す。締めの最後の砦は D1 の日次予算 (policy.ts)
 */
export async function rateOf(limiter: RateLimit, key: string): Promise<{ kind: 'within' | 'limited' } | { kind: 'unavailable'; message: string }> {
  try {
    return { kind: (await limiter.limit({ key })).success ? 'within' : 'limited' };
  } catch (e) {
    return { kind: 'unavailable', message: e instanceof Error ? e.message : String(e) };
  }
}
