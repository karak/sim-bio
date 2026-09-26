import type { HumanAnswer } from './client';
import { parseTurnstile } from './contract';

/**
 * Turnstile の widget (設計書 §3.1、出港と通報だけ)。script は初めて確かめるときに読む (起動を challenges.cloudflare.com に頼らない)。
 * explicit render: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 * 開発とテストは常に通るテストの sitekey (https://developers.cloudflare.com/turnstile/troubleshooting/testing/)。
 * Worker 側のテストの secret (1x0000000000000000000000000000000AA) と組になり、ダミーの札を返す
 */
export const TEST_SITEKEY = '1x00000000000000000000AA';
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** script が読めない・札が来ないまま待つ上限。越えたら網が無いものとして閉港と同じに扱う */
const WAIT_MS = 60_000;

type RenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
};
type TurnstileApi = { render(el: HTMLElement, opts: RenderOptions): string; remove(widgetId: string): void };

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi | null> | null = null;

function loadApi(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi | null>((resolve) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  }).then((api) => {
    // 読めなければ次の確かめで読み直す (網が戻ったあとに)
    if (!api) loading = null;
    return api;
  });
  return loading;
}

/**
 * 1 回の確かめ。host の中に widget を出し、札か失敗が来たら消す。
 * 札は 1 回きり・300 秒で切れるので、出港と再送のたびに新しく取る
 */
export function createTurnstile(opts: { sitekey: string; host: (show: boolean) => HTMLElement }): () => Promise<HumanAnswer> {
  return async () => {
    const api = await loadApi();
    if (!api) return { kind: 'unavailable' };
    const host = opts.host(true);
    const slot = document.createElement('div');
    host.appendChild(slot);
    let widget: string | undefined;
    const answer = await new Promise<HumanAnswer>((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'unavailable' }), WAIT_MS);
      const done = (a: HumanAnswer) => {
        clearTimeout(timer);
        resolve(a);
      };
      try {
        widget = api.render(slot, {
          sitekey: opts.sitekey,
          callback: (raw) => {
            const token = parseTurnstile(raw);
            done(token.ok ? { kind: 'token', token: token.value } : { kind: 'failed' });
          },
          'error-callback': () => done({ kind: 'failed' }),
          'expired-callback': () => done({ kind: 'failed' }),
          'timeout-callback': () => done({ kind: 'failed' }),
        });
      } catch {
        done({ kind: 'unavailable' });
      }
    });
    if (widget !== undefined) api.remove(widget);
    slot.remove();
    opts.host(false);
    return answer;
  };
}
