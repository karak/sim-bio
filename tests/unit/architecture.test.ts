import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { ALLOWED, ENTRY, PACKAGES } from '../../layering.config.mjs';

/**
 * アーキテクチャの柵 (M27-01、docs/design/2026-10-10-architecture-review.md §6 R1・R2)。
 * 設計書 2026-09-19 §4「依存の向きは一方向」と「main.ts は配線のみ」を、文書でなく試験で守る。
 * 層ごとの import の可否は eslint.config.js の no-restricted-imports が静的な import について見る。ここでは同じ表 (layering.config.mjs) を
 * 動的 import と深い相対パスにも当て、循環と大きさを見る。
 * 大きさの上限は「今より増やさない」ラチェット。下げるときはこの表を書き換える (M27-03・M27-04)
 */

const ROOT = resolve(__dirname, '../..');
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');

/** src の下のディレクトリを層にまとめる。core/log は core、observe/render は observe。入口 (main.ts・観察画面の試作) は何でも読んでよい */
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
const SOURCES = new Map(FILES.map((f) => [f, ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.ES2022, true)]));

type Edge = { from: string; to: string; spec: string; typeOnly: boolean };

/** 1 ファイルの import の辺。型だけの import (import type、全部 type の named import) は typeOnly */
function edgesOf(file: string): Edge[] {
  const sf = SOURCES.get(file)!;
  const out: Edge[] = [];
  const push = (spec: string, typeOnly: boolean) => out.push({ from: file, to: spec.startsWith('.') ? resolve(dirname(file), spec) + '.ts' : spec, spec, typeOnly });
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      const typeOnly = !!c?.isTypeOnly || (!!named && !c?.name && named.every((e) => e.isTypeOnly));
      push(n.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      push(n.moduleSpecifier.text, !!n.isTypeOnly);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      push(n.arguments[0].text, false);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const EDGES = FILES.flatMap(edgesOf);
/** このリポジトリの中を指す辺 (型だけの辺も) */
const INTERNAL_EDGES = EDGES.filter((e) => e.spec.startsWith('.'));
/** 値の辺のうち、このリポジトリの中を指すもの */
const VALUE_EDGES = INTERNAL_EDGES.filter((e) => !e.typeOnly);

/** 外部パッケージの名前 (three/addons/… は three、@scope/name はそのまま) */
const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

const LONG_FUNCTION = 150;

/** 層の間の値の辺 (同じ層の中と、型だけの辺は除く)。入口と dev は上に載るだけなので循環の検査から外す */
function layerGraph(): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  for (const e of VALUE_EDGES) {
    const a = layerOf(e.from);
    const b = layerOf(e.to);
    if (a === b || a === 'entry' || a === 'dev') continue;
    if (!g.has(a)) g.set(a, new Set());
    g.get(a)!.add(b);
  }
  return g;
}

/** 深さ優先で閉路を 1 つずつ集める (a → b → a の形で返す) */
function cycles(g: Map<string, Set<string>>): string[] {
  const found = new Set<string>();
  const dfs = (start: string, node: string, path: string[]) => {
    for (const next of g.get(node) ?? []) {
      if (next === start) found.add([...path, next].join(' → '));
      else if (!path.includes(next)) dfs(start, next, [...path, next]);
    }
  };
  for (const start of g.keys()) dfs(start, start, [start]);
  return [...found].sort();
}

/** wc -l と同じ数え方 (改行の数) */
function lines(file: string): number {
  return SOURCES.get(file)!.text.split('\n').length - 1;
}

/** 本体 150 行を超える関数 (名前は宣言か、代入先の変数) */
function longFunctions(file: string): { name: string; lines: number }[] {
  const sf = SOURCES.get(file)!;
  const out: { name: string; lines: number }[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) && n.body) {
      const len = sf.getLineAndCharacterOfPosition(n.body.getEnd()).line - sf.getLineAndCharacterOfPosition(n.body.getStart()).line + 1;
      const parent = n.parent;
      const name = (n as ts.FunctionDeclaration).name?.getText() ?? (ts.isVariableDeclaration(parent) ? parent.name.getText() : '(anon)');
      if (len > LONG_FUNCTION) out.push({ name, lines: len });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** ファイルの行数の既定の上限 */
const DEFAULT_LINES = 700;
/** 既定と違う上限を持つファイル (今の行数。減らしたら下げる)。main.ts は配線だけ (設計書 §4) なので既定より低く置く */
const FILE_LINES: Record<string, number> = { 'src/main.ts': 265, 'src/simulation/World.ts': 985 };
/** 150 行を超えてよい関数と、その上限 (今の長さ)。表に無い関数が 150 行を超えたら落ちる */
const LONG_FUNCTIONS: Record<string, Record<string, number>> = {
  'src/main.ts': { boot: 225 },
  'src/ui/Hud.ts': { createHud: 447 },
  'src/scenario/ScenarioRunner.ts': { createScenarioRunner: 424 },
  'src/observe/render/motes.ts': { createMotes: 365, update: 187 },
  'src/render/SceneView.ts': { createSceneView: 355 },
  'src/observe/render/grass.ts': { createGrass: 280 },
  'src/simulation/World.ts': { stepCivYearly: 271 },
  'src/harbor/client.ts': { createHarbor: 219 },
  'src/observe/render/creatures.ts': { createSpeciesView: 207 },
  'src/observe/render/shotCamera.ts': { createShotCamera: 151 },
  'src/ui/Harbor.ts': { mountHarbor: 151 },
};

describe('アーキテクチャの柵 (M27-01): 依存の向き', () => {
  it('src の層の間に、値の import の循環が無い (設計書 2026-09-19 §4「依存の向きは一方向」)', () => {
    expect(cycles(layerGraph())).toEqual([]);
  });

  it('層の向きは動的 import と深い相対パスでも守る (eslint は静的な import しか見ない)', () => {
    const bad = INTERNAL_EDGES.filter((e) => layerOf(e.from) !== layerOf(e.to) && !(ALLOWED[layerOf(e.from)] ?? []).includes(layerOf(e.to))).map((e) => `${rel(e.from)} → ${e.spec}`);
    expect(bad).toEqual([]);
  });

  it('知らない層は置けない: 表 (ALLOWED) に無いディレクトリ・src 直下のファイル・表に名指しの無い入口は落ちる (M27-05 段 6)', () => {
    const unknown = [...new Set(FILES.map(layerOf))].filter((layer) => !(layer in ALLOWED)).sort();
    expect(unknown).toEqual([]);
  });

  it('three.js を読むのは render と observe だけ (World・UI・保存・港は描画ライブラリを知らない)', () => {
    const users = [...new Set(EDGES.filter((e) => packageOf(e.spec) === 'three').map((e) => layerOf(e.from)))].sort();
    expect(users).toEqual(Object.keys(PACKAGES).filter((layer) => PACKAGES[layer].includes('three')).sort());
  });

  it('simulation が読む外部パッケージは simplex-noise だけ', () => {
    const pkgs = [...new Set(EDGES.filter((e) => layerOf(e.from) === 'simulation' && !e.spec.startsWith('.')).map((e) => e.spec))].sort();
    expect(pkgs).toEqual([...PACKAGES.simulation].sort());
  });

  it('層ごとに読んでよい外部パッケージは表 (PACKAGES) のものだけ (M27-05 段 6)', () => {
    const bad = EDGES.filter((e) => !e.spec.startsWith('.') && !(PACKAGES[layerOf(e.from)] ?? []).includes(packageOf(e.spec))).map((e) => `${rel(e.from)} → ${e.spec}`);
    expect(bad).toEqual([]);
  });

  it('worker が src から読むのは契約 (harbor)・年代記 (chronicle)・core だけ (本体・UI・保存を Worker に持ち込まない)', () => {
    const layers = [...new Set(EDGES.filter((e) => layerOf(e.from) === 'worker' && rel(e.to).startsWith('src/')).map((e) => layerOf(e.to)))].sort();
    expect(layers).toEqual(['chronicle', 'core', 'harbor']);
  });
});

describe('アーキテクチャの柵 (M27-01): 大きさのラチェット', () => {
  it('ファイルは上限の内 (既定 700 行。main.ts は配線だけなので 265 行。名指しの上限は今の行数で、増やさない)', () => {
    const over = FILES.map((f) => ({ file: rel(f), lines: lines(f) })).filter((r) => r.lines > (FILE_LINES[r.file] ?? DEFAULT_LINES));
    expect(over).toEqual([]);
  });

  it(`本体 ${LONG_FUNCTION} 行を超える関数は表のものだけで、表の上限を超えない`, () => {
    const over: string[] = [];
    for (const f of FILES) {
      for (const fn of longFunctions(f)) {
        const cap = LONG_FUNCTIONS[rel(f)]?.[fn.name];
        if (cap === undefined || fn.lines > cap) over.push(`${rel(f)} ${fn.name} ${fn.lines} 行 (上限 ${cap ?? LONG_FUNCTION})`);
      }
    }
    expect(over).toEqual([]);
  });
});

/** 識別子 (変数・引数・プロパティの名前。文字列とコメントは除く) name を使うファイル */
function filesUsingIdentifier(name: string, files: readonly string[]): string[] {
  return files.filter((f) => {
    let hit = false;
    const visit = (n: ts.Node) => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === name) hit = true;
      else ts.forEachChild(n, visit);
    };
    visit(SOURCES.get(f)!);
    return hit;
  }).map(rel);
}

/** `{ type: '<kind>' , ... }` の object literal を書くファイル (命令を組む所) */
function filesBuildingLiteral(kinds: readonly string[], files: readonly string[]): string[] {
  return files.filter((f) => {
    let hit = false;
    const visit = (n: ts.Node) => {
      if (hit) return;
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'type' && ts.isStringLiteral(n.initializer) && kinds.includes(n.initializer.text)) hit = true;
      else ts.forEachChild(n, visit);
    };
    visit(SOURCES.get(f)!);
    return hit;
  }).map(rel);
}

/** 文字列 (テンプレートの先頭も) に needle を含むファイル */
function filesWithString(needle: string, files: readonly string[]): string[] {
  return files.filter((f) => {
    let hit = false;
    const visit = (n: ts.Node) => {
      if (hit) return;
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && n.text.includes(needle)) hit = true;
      else ts.forEachChild(n, visit);
    };
    visit(SOURCES.get(f)!);
    return hit;
  }).map(rel);
}

/** 置き場を開く呼び (openIslandStore・openHarborStore など open*Store) を書くファイル */
function filesCallingOpenStore(files: readonly string[]): string[] {
  return files.filter((f) => {
    let hit = false;
    const visit = (n: ts.Node) => {
      if (hit) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^open[A-Z]\w*Store$/.test(n.expression.text)) hit = true;
      else ts.forEachChild(n, visit);
    };
    visit(SOURCES.get(f)!);
    return hit;
  }).map(rel);
}

const APP_UI = FILES.filter((f) => ['app', 'ui', 'entry'].includes(layerOf(f)) && rel(f) !== 'src/observe/prototype.ts');
const inLayer = (...layers: string[]) => FILES.filter((f) => layers.includes(layerOf(f)));

describe('アーキテクチャの柵 (M27-05): 舞台・命令・合成の置き場', () => {
  it('訪問かどうか (visiting) を引くのは舞台 (Stage) の射影 1 か所だけ。app・ui・main.ts の部品は舞台を受け、真偽を自分で引かない', () => {
    expect(filesUsingIdentifier('visiting', APP_UI).length).toBeLessThanOrEqual(1);
  });

  it('Session に仮の値 (() => {}) が無い。石板の手 (runner・記録器・始め直し・進め方) は 1 つの値として石板を開くときに作る', () => {
    const session = FILES.find((f) => rel(f) === 'src/app/session.ts')!;
    const empties: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isArrowFunction(n) && ts.isBlock(n.body) && n.body.statements.length === 0) empties.push(n.getText());
      ts.forEachChild(n, visit);
    };
    visit(SOURCES.get(session)!);
    expect(empties).toEqual([]);
  });

  it('放流・災害の命令 (spawn_species・disaster) を組むのは simulation だけ (年代記の読み手は JSON を命令に直す境界なので除く)。ui・harbor・台本は simulation の作り方を読む', () => {
    const outside = FILES.filter((f) => !['simulation', 'chronicle', 'dev'].includes(layerOf(f)));
    expect(filesBuildingLiteral(['spawn_species', 'disaster'], outside)).toEqual([]);
  });

  it('main.ts は HUD の手 (災害・放流・気象塔のチップ) を写さない。持っているチップは HUD が 1 つで持つ', () => {
    const main = FILES.filter((f) => rel(f) === 'src/main.ts');
    const copied = ['armed', 'spawnArmed', 'towerArmed', 'chips'].filter((id) => filesUsingIdentifier(id, main).length > 0);
    expect(copied).toEqual([]);
  });

  it('速さを変えるのに DOM の id (speed-N) を押さない (app と main.ts は loop に言い、HUD が追う)', () => {
    expect(filesWithString('speed-', [...inLayer('app'), ...FILES.filter((f) => rel(f) === 'src/main.ts')])).toEqual([]);
  });

  it('置き場 (open*Store) を開くのは入口 (main.ts) だけ。ui・app の部品は開いた置き場を受ける (合成は入口の外に出さない)', () => {
    const notEntry = FILES.filter((f) => !['entry', 'dev', 'persist'].includes(layerOf(f)));
    expect(filesCallingOpenStore(notEntry)).toEqual([]);
  });
});
