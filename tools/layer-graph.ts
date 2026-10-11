#!/usr/bin/env node
/**
 * 層の依存の図 (M27-05)。src と worker/src の import を TypeScript の AST で読み、層 (ディレクトリ) の間の辺を mermaid の flowchart で出す。
 * 値の辺は実線、型だけの辺は破線。入口 (ENTRY) は entry、worker の assets/data の JSON は assets。
 * docs/architecture/overview.md の「層の依存」はこの出力を貼る: `node tools/layer-graph.ts > /tmp/graph.md`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { ALLOWED, ENTRY } from '../layering.config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');

function layerOf(file: string): string {
  const r = rel(file);
  if (ENTRY.includes(r)) return 'entry';
  if (r.startsWith('worker/src/')) return 'worker';
  if (r.startsWith('assets/')) return 'assets';
  const m = /^src\/([^/]+)\//.exec(r);
  return m ? m[1] : r;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const FILES = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'worker/src'))];
/** 層 → 読む層 → 値の辺があるか */
const edges = new Map<string, Map<string, boolean>>();
for (const f of FILES) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.ES2022, true);
  const a = layerOf(f);
  const add = (spec: string, typeOnly: boolean) => {
    if (!spec.startsWith('.')) return;
    const b = layerOf(resolve(dirname(f), spec) + '.ts');
    if (a === b) return;
    const row = edges.get(a) ?? new Map<string, boolean>();
    row.set(b, (row.get(b) ?? false) || !typeOnly);
    edges.set(a, row);
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      add(n.moduleSpecifier.text, !!c?.isTypeOnly || (!!named && !c?.name && named.every((e) => e.isTypeOnly)));
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier.text, !!n.isTypeOnly);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) add(n.arguments[0].text, false);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const ORDER = ['simulation', 'core', 'scenario', 'render', 'chronicle', 'harbor', 'persist', 'app', 'observe', 'ui', 'dev', 'entry', 'worker', 'assets'];
const CLASS: Record<string, string> = { simulation: 'core', core: 'core', scenario: 'core', dev: 'top', entry: 'top', worker: 'ext', assets: 'ext' };
const LABEL: Record<string, string> = { entry: 'entry (main.ts, observe/prototype.ts)', core: 'core / core.log', observe: 'observe / observe.render / observe.view', assets: 'assets/data (JSON)' };
const lines = ['```mermaid', 'flowchart BT', '  classDef core fill:#d4edda,stroke:#3c763d,color:#000', '  classDef mid fill:#e8f1fb,stroke:#2e6295,color:#000', '  classDef top fill:#fff3cd,stroke:#8a6d3b,color:#000', '  classDef ext fill:#eeeeee,stroke:#6b6b6b,color:#000', ''];
const used = new Set<string>([...edges.keys(), ...[...edges.values()].flatMap((m) => [...m.keys()])]);
for (const l of ORDER.filter((l) => used.has(l))) lines.push(`  ${l}["${LABEL[l] ?? l}"]:::${CLASS[l] ?? 'mid'}`);
lines.push('');
const unknown: string[] = [];
for (const a of ORDER.filter((l) => edges.has(l))) {
  for (const b of ORDER.filter((l) => edges.get(a)!.has(l))) {
    const value = edges.get(a)!.get(b)!;
    if (!(ALLOWED[a] ?? []).includes(b)) unknown.push(`${a} → ${b}`);
    lines.push(value ? `  ${a} --> ${b}` : `  ${a} -. "型だけ" .-> ${b}`);
  }
}
lines.push('```');
console.log(lines.join('\n'));
if (unknown.length) {
  console.error(`許可の表 (ALLOWED) に無い辺: ${unknown.join(', ')}`);
  process.exit(1);
}
