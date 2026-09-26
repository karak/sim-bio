import { fail, isObject, type Parsed } from '../parse';
import type { LogLevel, LogRecord } from './types';

/**
 * LogBatch (M19-01) の書き方と読み方。HTTP LogSink が encodeLogBatch で書き、受け口の Worker (M19-02、worker/src/index.ts) が
 * decodeLogBatch で読む。両方が同じこのファイルを import するので、形の食い違いは単体テストの往復で見つかる。
 */

/** 受け口へ POST する本文。dropped は、このバッチを切るまでに捨てて、まだ誰も運んでいない件数 */
export type LogBatch = { records: LogRecord[]; dropped: number };

/** maxBytes は受け口が本文を読む上限 (UTF-8)。超えたら 413。ほかは形の検査で、超えたら 400 */
export const LOG_BATCH_LIMITS = {
  maxBytes: 64 * 1024,
  maxRecords: 20,
  maxTsLength: 64,
  maxEventLength: 128,
} as const;

const LEVELS: ReadonlySet<string> = new Set<LogLevel>(['info', 'warn', 'error']);
const BATCH_KEYS: ReadonlySet<string> = new Set<keyof LogBatch>(['records', 'dropped']);

export function encodeLogBatch(batch: LogBatch): string {
  return JSON.stringify({ records: batch.records, dropped: batch.dropped } satisfies LogBatch);
}

export function decodeLogBatch(text: string): Parsed<LogBatch> {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return fail('', 'JSON として読めない');
  }
  return parseBatch(input);
}

function parseBatch(input: unknown): Parsed<LogBatch> {
  if (!isObject(input)) return fail('', 'object ではない');
  const unknownKey = Object.keys(input).find((k) => !BATCH_KEYS.has(k));
  if (unknownKey !== undefined) return fail(unknownKey, '知らない鍵');
  const { records, dropped } = input;
  if (!Array.isArray(records)) return fail('records', '配列ではない');
  if (records.length > LOG_BATCH_LIMITS.maxRecords) return fail('records', `${LOG_BATCH_LIMITS.maxRecords} 件を超える`);
  if (typeof dropped !== 'number' || !Number.isSafeInteger(dropped) || dropped < 0) return fail('dropped', '0 以上の整数ではない');
  const parsed: LogRecord[] = [];
  for (const [i, r] of records.entries()) {
    const one = parseRecord(r, `records[${i}]`);
    if (!one.ok) return one;
    parsed.push(one.value);
  }
  return { ok: true, value: { records: parsed, dropped } };
}

function parseRecord(input: unknown, at: string): Parsed<LogRecord> {
  if (!isObject(input)) return fail(at, 'object ではない');
  const { ts, tick, year, level, event } = input;
  if (typeof ts !== 'string') return fail(`${at}.ts`, '文字列ではない');
  const tsProblem = lengthProblem(ts, LOG_BATCH_LIMITS.maxTsLength);
  if (tsProblem) return fail(`${at}.ts`, tsProblem);
  if (!isFiniteNumber(tick)) return fail(`${at}.tick`, '数ではない');
  if (!isFiniteNumber(year)) return fail(`${at}.year`, '数ではない');
  if (!isLevel(level)) return fail(`${at}.level`, 'info・warn・error のどれでもない');
  if (typeof event !== 'string') return fail(`${at}.event`, '文字列ではない');
  const eventProblem = lengthProblem(event, LOG_BATCH_LIMITS.maxEventLength);
  if (eventProblem) return fail(`${at}.event`, eventProblem);
  return { ok: true, value: { ...input, ts, tick, year, level, event } };
}

function lengthProblem(v: string, max: number): string | null {
  if (v.length === 0) return '空の文字列';
  return v.length > max ? `${max} 文字を超える` : null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isLevel = (v: unknown): v is LogLevel => typeof v === 'string' && LEVELS.has(v);
