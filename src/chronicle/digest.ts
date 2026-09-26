import type { WorldSnapshot } from '../simulation/types';
import type { Digest } from '../harbor/contract';

type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

/** 鍵を辞書順に並べた JSON。同じ中身なら、作った順・エンジンに依らず同じ文字列になる (年代記の id と Digest の hash の元) */
export function canonicalJson(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** WebCrypto の SHA-256 (ブラウザ・Web Worker・Node・Cloudflare Worker で同じ API) */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 結末の要約 (設計書 §5.1)。総数は toPrecision(6) に丸める: エンジンの違う Math.sin・Math.cos の末尾の桁の差を hash に出さないため
 * (差が年を追って 6 桁まで育つかは実測していない。M19-04 の引き継ぎ)
 */
export async function digestOf(snapshot: Pick<WorldSnapshot, 'year' | 'totals'>, verdict: Digest['verdict']): Promise<Digest> {
  const ids = Object.keys(snapshot.totals).sort();
  const totals = Object.fromEntries(ids.map((id) => [id, Number(snapshot.totals[id].toPrecision(6))]));
  const extinct = ids.filter((id) => totals[id] === 0);
  const body = { year: snapshot.year, verdict, totals, extinct };
  return { ...body, hash: await sha256Hex(canonicalJson(body)) };
}
