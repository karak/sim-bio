/**
 * 境界で unknown を型に読む parse の共通の形 (設計書 2026-09-26-cloudflare-architecture.md §5.1・§5.2)。
 * ログのバッチ (core/log/batch.ts) と港の契約 (M19-07、harbor/contract.ts) が同じ形で拒否理由を返す。
 * path は拒否した場所 (例 records[1].level、いちばん外なら空)
 */
export type ParseError = { path: string; reason: string };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

export function fail(path: string, reason: string): { ok: false; error: ParseError } {
  return { ok: false, error: { path, reason } };
}

/** 配列と null を除いた object */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
