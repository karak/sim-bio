#!/usr/bin/env node
/**
 * 観察画面の計測の台 (M23-01) の、前後の 2 つの JSON を並べて差を出す。JSON は tools/bench-observe.ts が書く。
 *
 * 使い方:
 *   npm run bench:observe:compare -- <前.json> <後.json>
 *   node tools/bench-observe-compare.ts <前.json> <後.json>
 * 出力: Markdown の表 2 つ (画ごとの三角形・draw call・fps と、画ごと区分ごとの drawn / inView / shadow)。単位は千三角形
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** __observeBreakdown() の 1 行 (src/observe/render/breakdown.ts の BreakdownRow と同じ形) */
export type BenchBreakdownRow = { drawn: number; inView: number; shadow: number; beyond30: number; beyond60: number; instances: number };

/** 1 つの画の測り */
export type BenchShot = {
  name: string;
  /** 測りの間の __observeStats の値 (0.5 s ごとに更新される)。三角形と draw call は台の時計で測った最後の値、fps は実時間で測った平均 */
  calls: number;
  triangles: number;
  fps: number;
  /** 測りの間に見た値 (揺れの確かめ用) */
  samples: { calls: number[]; triangles: number[]; fps: number[] };
  camera: string;
  at: number[];
  breakdown: Record<string, BenchBreakdownRow>;
};

export type BenchResult = {
  meta: {
    date: string;
    commit: string;
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    settleMs: number;
    browser: string;
    gpu: string;
    note: string;
  };
  shots: BenchShot[];
};

const k = (n: number) => (n / 1000).toFixed(1);
const signed = (n: number, digits = 1) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(digits);
const pct = (a: number, b: number) => (a === 0 ? '' : `, ${signed(((b - a) / a) * 100, 0)}%`);
/** 前 → 後 (差)。単位は千三角形 */
const kDiff = (a: number, b: number) => (a === b ? `${k(a)}` : `${k(a)} → ${k(b)} (${signed((b - a) / 1000)})`);

/** 前後の 2 つの測りを Markdown の表にする。片方にしか無い画・区分は 0 として並べる */
export function compareBench(before: BenchResult, after: BenchResult): string {
  const names = [...new Set([...before.shots.map((s) => s.name), ...after.shots.map((s) => s.name)])];
  const find = (r: BenchResult, n: string) => r.shots.find((s) => s.name === n);
  const lines: string[] = [];
  lines.push(`前: ${before.meta.date} ${before.meta.commit}  後: ${after.meta.date} ${after.meta.commit}`);
  lines.push('');
  lines.push('| 画 | 三角形 (千) | draw call | fps |');
  lines.push('|---|---|---|---|');
  for (const n of names) {
    const a = find(before, n);
    const b = find(after, n);
    const ta = a?.triangles ?? 0;
    const tb = b?.triangles ?? 0;
    const ca = a?.calls ?? 0;
    const cb = b?.calls ?? 0;
    const tri = ta === tb ? k(ta) : `${k(ta)} → ${k(tb)} (${signed((tb - ta) / 1000)}${pct(ta, tb)})`;
    const calls = ca === cb ? `${ca}` : `${ca} → ${cb} (${signed(cb - ca, 0)})`;
    const fps = `${a ? a.fps.toFixed(0) : '—'} → ${b ? b.fps.toFixed(0) : '—'}`;
    lines.push(`| ${n} | ${tri} | ${calls} | ${fps} |`);
  }
  lines.push('');
  lines.push('区分ごと (千三角形、前 → 後)');
  lines.push('');
  lines.push('| 画 | 区分 | drawn | inView | shadow |');
  lines.push('|---|---|---|---|---|');
  for (const n of names) {
    const a = find(before, n)?.breakdown ?? {};
    const b = find(after, n)?.breakdown ?? {};
    const cats = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => (b[y]?.drawn ?? a[y]?.drawn ?? 0) - (b[x]?.drawn ?? a[x]?.drawn ?? 0));
    for (const c of cats) {
      const ra = a[c];
      const rb = b[c];
      const col = (f: 'drawn' | 'inView' | 'shadow') => kDiff(ra?.[f] ?? 0, rb?.[f] ?? 0);
      lines.push(`| ${n} | ${c} | ${col('drawn')} | ${col('inView')} | ${col('shadow')} |`);
    }
  }
  return lines.join('\n');
}

/** 1 つの測りの要約 (作業ログに貼る用)。単位は千三角形 */
export function summarizeBench(r: BenchResult): string {
  const lines = [`${r.meta.date} ${r.meta.commit} ${r.meta.viewport.width}×${r.meta.viewport.height} @${r.meta.viewport.deviceScaleFactor}x  GPU: ${r.meta.gpu}`, ''];
  lines.push('| 画 | 三角形 (千) | draw call | fps |');
  lines.push('|---|---|---|---|');
  for (const s of r.shots) lines.push(`| ${s.name} | ${k(s.triangles)} | ${s.calls} | ${s.fps.toFixed(0)} |`);
  return lines.join('\n');
}

const main = (argv: string[]) => {
  const files = argv.filter((a) => !a.startsWith('-'));
  const read = (p: string) => JSON.parse(readFileSync(resolve(p), 'utf8')) as BenchResult;
  if (files.length === 1) return console.log(summarizeBench(read(files[0])));
  if (files.length !== 2) {
    console.error('使い方: node tools/bench-observe-compare.ts <前.json> <後.json>  (1 つだけ渡すと要約)');
    process.exit(2);
  }
  console.log(compareBench(read(files[0]), read(files[1])));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
