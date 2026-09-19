# M1 (地形 + 植物 + 季節 + グラフ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** シード付きで生成した島の上で、季節に応じて植物 2 種が増減し、3D 表示・ヒートマップ・折れ線グラフで観察できる状態を作る。

**Architecture:** `World`(純粋な数値計算、型付き配列)を中核に、`Runner`(rAF)、`SceneView`(Three.js)、`Hud`(DOM + Canvas)が `snapshot()` を読むだけの一方向依存。介入は `Command` で `World.dispatch` に入る。ログは `LogSink` ポート経由。

**Tech Stack:** TypeScript 5+, Vite, Three.js 0.186, simplex-noise 4, Vitest, ESLint (typescript-eslint), Playwright。

**Spec:** `docs/specs/2026-09-19-ecosystem-sim-design.md`

## Global Constraints

- `src/simulation/` は Three.js・DOM・fetch を import しない。
- 1 tick = 1 日、`ticksPerYear = 360`。
- グリッドは `size × size`、セル index は `y * size + x`。`elevation < 0.3` は海。
- `World.snapshot()` は内部バッファをコピーせず返す(読み取り専用)。
- `dispatch` はキューに積み、次の `step` の先頭で適用する。
- ログレコードは `{ts, tick, year, level, event, ...}`。`ts` は `WorldDeps.now` で付与。
- テストは Vitest。`npm run check` で `tsc --noEmit` + `eslint` + `vitest run` が通ること。
- 既存コードのコメントは削除しない。

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, eslint.config.js, index.html
src/main.ts                       配線
src/core/log/types.ts             LogSink, LogRecord
src/core/log/consoleSink.ts
src/core/log/memorySink.ts
src/core/runner.ts                createRunner
src/simulation/types.ts           WorldConfig, SpeciesDef, Command, WorldSnapshot, SaveData
src/simulation/rng.ts             mulberry32
src/simulation/grid.ts            index/neighbor helpers
src/simulation/terrain.ts         generateTerrain
src/simulation/climate.ts         stepClimate
src/simulation/vegetation.ts      stepVegetation
src/simulation/feedback.ts        applyFeedback
src/simulation/disaster.ts        applyDisaster, stepFire
src/simulation/World.ts           World
src/render/layerToColors.ts       純粋関数
src/render/scatter.ts             scatterInstances
src/render/assetTable.ts          AssetTable 生成
src/render/SceneView.ts           Three.js
src/ui/timeSeries.ts              TimeSeries
src/ui/graph.ts                   Canvas 折れ線
src/ui/Hud.ts                     DOM
assets/data/world.default.json, assets/data/species.json
tests/unit/*.test.ts, tests/e2e/smoke.spec.ts
```

---

### Task 1: プロジェクト土台

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `src/main.ts`, `tests/unit/sanity.test.ts`

**Interfaces:**
- Produces: `npm run dev` / `npm run check` / `npm test`。パスエイリアスなし(相対 import)。

- [ ] **Step 1: 依存を入れる**

```bash
npm init -y
npm i three simplex-noise
npm i -D typescript vite vitest eslint @eslint/js typescript-eslint @types/three globals
```

- [ ] **Step 2: 設定ファイルを書く**

`package.json` の scripts:
```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "check": "npm run typecheck && npm run lint && npm run test"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": false, "noEmit": true,
    "lib": ["ES2022", "DOM"], "types": ["vite/client"], "skipLibCheck": true,
    "isolatedModules": true, "esModuleInterop": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: 'assets',
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
```
※ `publicDir: 'assets'` により `/data/species.json` で読める。

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'docs', 'tests/e2e/**', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['src/simulation/**'], rules: { 'no-restricted-imports': ['error', { patterns: ['three', 'three/*'] }] } },
);
```

`index.html`:
```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ビオトープ島</title>
<style>html,body{margin:0;height:100%;background:#1B2B3A;font-family:system-ui,sans-serif;color:#E9EFF3}#app{position:relative;width:100%;height:100%}canvas.scene{display:block;width:100%;height:100%}</style>
</head><body><div id="app"><canvas class="scene" id="scene"></canvas></div><script type="module" src="/src/main.ts"></script></body></html>
```

`src/main.ts`(暫定): `console.log('boot');`

- [ ] **Step 3: 動作確認テスト** `tests/unit/sanity.test.ts`

```ts
import { describe, it, expect } from 'vitest';
describe('sanity', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 4: `npm run check` が通ることを確認**、`.gitignore` に `dist/ node_modules/ playwright-report/ test-results/` があることを確認

- [ ] **Step 5: Commit** `chore: Vite + TS + Vitest + ESLint の土台`

---

### Task 2: LogSink ポート

**Files:**
- Create: `src/core/log/types.ts`, `src/core/log/consoleSink.ts`, `src/core/log/memorySink.ts`
- Test: `tests/unit/log.sink.test.ts`

**Interfaces:**
- Produces:
```ts
export type LogLevel = 'info' | 'warn' | 'error';
export type LogRecord = { ts: string; tick: number; year: number; level: LogLevel; event: string } & Record<string, unknown>;
export interface LogSink { write(record: LogRecord): void }
export function createConsoleSink(out?: (line: string) => void): LogSink
export function createMemorySink(): LogSink & { records: LogRecord[]; clear(): void; find(event: string): LogRecord[] }
```

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createConsoleSink } from '../../src/core/log/consoleSink';
const rec = { ts: '2026-01-01T00:00:00.000Z', tick: 3, year: 0, level: 'info' as const, event: 'sim.test', x: 1 };
describe('memorySink', () => {
  it('stores records and finds by event', () => {
    const s = createMemorySink(); s.write(rec); s.write({ ...rec, event: 'other' });
    expect(s.records).toHaveLength(2); expect(s.find('sim.test')).toEqual([rec]);
    s.clear(); expect(s.records).toHaveLength(0);
  });
});
describe('consoleSink', () => {
  it('writes one JSON line per record', () => {
    const lines: string[] = []; const s = createConsoleSink((l) => lines.push(l)); s.write(rec);
    expect(lines).toHaveLength(1); expect(JSON.parse(lines[0])).toEqual(rec);
  });
});
```

- [ ] **Step 2: 失敗を確認** `npx vitest run tests/unit/log.sink.test.ts`
- [ ] **Step 3: 実装**

```ts
// consoleSink.ts
import type { LogSink } from './types';
export function createConsoleSink(out: (line: string) => void = (l) => console.log(l)): LogSink {
  return { write(record) { out(JSON.stringify(record)); } };
}
// memorySink.ts
import type { LogRecord, LogSink } from './types';
export function createMemorySink() {
  const records: LogRecord[] = [];
  return { records, write(r: LogRecord) { records.push(r); }, clear() { records.length = 0; }, find(event: string) { return records.filter((r) => r.event === event); } };
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(log): LogSink ポートと console/memory 実装`

---

### Task 3: 乱数・グリッド・地形生成

**Files:**
- Create: `src/simulation/rng.ts`, `src/simulation/grid.ts`, `src/simulation/terrain.ts`
- Test: `tests/unit/terrain.test.ts`

**Interfaces:**
- Produces:
```ts
export function mulberry32(seed: number): () => number          // [0,1)
export const SEA_LEVEL = 0.3;
export function idx(x: number, y: number, size: number): number
export function forEachNeighbor4(i: number, size: number, fn: (j: number) => void): void
export function generateTerrain(seed: number, size: number): { elevation: Float32Array; moistureBase: Float32Array }
```
- `elevation` は [0,1]、島の縁は海(境界 2 セルは必ず < SEA_LEVEL)。`moistureBase` は [0,1]。

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { generateTerrain, SEA_LEVEL } from '../../src/simulation/terrain';
import { mulberry32 } from '../../src/simulation/rng';
describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) { const v = a(); expect(v).toBe(b()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});
describe('generateTerrain', () => {
  it('same seed gives same terrain', () => {
    const a = generateTerrain(7, 32), b = generateTerrain(7, 32);
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
  });
  it('values in [0,1], border is sea, has land', () => {
    const { elevation, moistureBase } = generateTerrain(1, 64); const n = 64;
    let land = 0;
    for (let i = 0; i < n * n; i++) { expect(elevation[i]).toBeGreaterThanOrEqual(0); expect(elevation[i]).toBeLessThanOrEqual(1); expect(moistureBase[i]).toBeGreaterThanOrEqual(0); expect(moistureBase[i]).toBeLessThanOrEqual(1); if (elevation[i] >= SEA_LEVEL) land++; }
    for (let x = 0; x < n; x++) { expect(elevation[x]).toBeLessThan(SEA_LEVEL); expect(elevation[(n - 1) * n + x]).toBeLessThan(SEA_LEVEL); }
    expect(land / (n * n)).toBeGreaterThan(0.2); expect(land / (n * n)).toBeLessThan(0.8);
  });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
// rng.ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// grid.ts
export const idx = (x: number, y: number, size: number) => y * size + x;
export function forEachNeighbor4(i: number, size: number, fn: (j: number) => void): void {
  const x = i % size, y = (i - x) / size;
  if (x > 0) fn(i - 1); if (x < size - 1) fn(i + 1); if (y > 0) fn(i - size); if (y < size - 1) fn(i + size);
}
// terrain.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';
export const SEA_LEVEL = 0.3;
export function generateTerrain(seed: number, size: number) {
  const rng = mulberry32(seed); const noise = createNoise2D(rng); const noise2 = createNoise2D(mulberry32(seed ^ 0x9e3779b9));
  const elevation = new Float32Array(size * size); const moistureBase = new Float32Array(size * size);
  const fbm = (n: (x: number, y: number) => number, x: number, y: number) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += amp * n(x * f, y * f); amp *= 0.5; f *= 2; } return v; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size - 0.5, ny = y / size - 0.5;
    const d = Math.sqrt(nx * nx + ny * ny) * 2;                  // 0 center .. ~1.41 corner
    const mask = Math.max(0, 1 - d * d);                          // radial falloff
    let e = (fbm(noise, nx * 3, ny * 3) + 1) / 2;                 // [0,1]
    e = e * 0.75 * mask + 0.05;                                   // island
    const border = Math.min(x, y, size - 1 - x, size - 1 - y);
    if (border < 2) e = Math.min(e, SEA_LEVEL - 0.05);
    elevation[y * size + x] = Math.min(1, Math.max(0, e));
    const m = (fbm(noise2, nx * 2 + 10, ny * 2 + 10) + 1) / 2;
    const lowland = 1 - Math.max(0, e - SEA_LEVEL) / (1 - SEA_LEVEL);
    moistureBase[y * size + x] = Math.min(1, Math.max(0, 0.35 * m + 0.45 * lowland + 0.1));
  }
  return { elevation, moistureBase };
}
```

- [ ] **Step 4: 成功を確認**(陸の割合が範囲外なら `0.75`/`0.05` を調整)、**Step 5: Commit** `feat(sim): シード付き地形生成`

---

### Task 4: 型定義と気候

**Files:**
- Create: `src/simulation/types.ts`, `src/simulation/climate.ts`
- Test: `tests/unit/climate.test.ts`

**Interfaces:**
- Produces(`types.ts`、設計書 4.1 と同一):
```ts
export type Trophic = 'plant' | 'herbivore' | 'carnivore';
export type SpeciesDef = { id: string; name: string; trophic: Trophic; growthRate: number; mortality: number; tempRange: [number, number]; moistureRange: [number, number]; diffusion: number; eats?: string[]; assetId: string; color: string };
export type WorldConfig = { seed: number; size: number; ticksPerYear: number; species: SpeciesDef[]; climate: { seasonAmplitudeTemp: number; seasonAmplitudeRain: number; tempOffset: number; rainScale: number }; feedback: { vegetationToRain: number; vegetationToTemp: number; co2ToTemp: number; iceAlbedo: number } };
export type DisasterKind = 'meteor' | 'volcano' | 'wildfire' | 'plague';
export type Command = { type: 'spawn_species'; speciesId: string; cell: number; amount: number } | { type: 'set_climate'; tempOffset?: number; rainScale?: number } | { type: 'disaster'; kind: DisasterKind; cell: number; radius: number };
export type WorldSnapshot = { tick: number; year: number; dayOfYear: number; size: number; layers: { elevation: Float32Array; temperature: Float32Array; moisture: Float32Array; vegetation: Float32Array; populations: Record<string, Float32Array> }; totals: Record<string, number>; meanTemperature: number; co2: number; species: SpeciesDef[] };
export type SaveData = { version: 1; config: WorldConfig; tick: number; elevation: number[]; moistureBase: number[]; heat: number[]; populations: Record<string, number[]> };
```
- `climate.ts`:
```ts
export type ClimateState = { elevation: Float32Array; moistureBase: Float32Array; heat: Float32Array; temperature: Float32Array; moisture: Float32Array; vegetation: Float32Array };
export function stepClimate(s: ClimateState, config: WorldConfig, dayOfYear: number): void
```
  式: `phase = 2π·dayOfYear/ticksPerYear`、`landH = max(0, e−0.3)/0.7`、
  `temperature = 14 + tempOffset + 6·((y/size)−0.5)·2 − 20·landH + seasonAmplitudeTemp·sin(phase) + heat`、
  `moisture = clamp(moistureBase·rainScale + seasonAmplitudeRain·cos(phase) + vegetationToRain·vegetation, 0, 1)`。
  `heat` は毎 tick `×0.998`。海セルの moisture は 1。

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { stepClimate, type ClimateState } from '../../src/simulation/climate';
import type { WorldConfig } from '../../src/simulation/types';
const cfg = (over: Partial<WorldConfig['climate']> = {}, fb = 0): WorldConfig => ({ seed: 1, size: 4, ticksPerYear: 360, species: [], climate: { seasonAmplitudeTemp: 8, seasonAmplitudeRain: 0.1, tempOffset: 0, rainScale: 1, ...over }, feedback: { vegetationToRain: fb, vegetationToTemp: 0, co2ToTemp: 0, iceAlbedo: 0 } });
const state = (): ClimateState => { const n = 16; const s = { elevation: new Float32Array(n), moistureBase: new Float32Array(n).fill(0.5), heat: new Float32Array(n), temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n) }; s.elevation.fill(0.5); s.elevation[0] = 0.1; s.elevation[5] = 0.9; return s; };
describe('stepClimate', () => {
  it('higher elevation is colder', () => { const s = state(); stepClimate(s, cfg(), 0); expect(s.temperature[5]).toBeLessThan(s.temperature[6]); });
  it('south (larger y) is warmer', () => { const s = state(); stepClimate(s, cfg(), 0); expect(s.temperature[14]).toBeGreaterThan(s.temperature[2]); });
  it('season moves temperature', () => { const a = state(), b = state(); stepClimate(a, cfg(), 90); stepClimate(b, cfg(), 270); expect(a.temperature[6]).toBeGreaterThan(b.temperature[6]); });
  it('tempOffset shifts uniformly', () => { const a = state(), b = state(); stepClimate(a, cfg(), 0); stepClimate(b, cfg({ tempOffset: 3 }), 0); expect(b.temperature[6] - a.temperature[6]).toBeCloseTo(3, 5); });
  it('sea cells have moisture 1 and rainScale scales land', () => { const a = state(), b = state(); stepClimate(a, cfg(), 0); stepClimate(b, cfg({ rainScale: 0.5 }), 0); expect(a.moisture[0]).toBe(1); expect(b.moisture[6]).toBeLessThan(a.moisture[6]); });
  it('vegetation feedback raises moisture only when coefficient > 0', () => { const a = state(), b = state(); a.vegetation.fill(1); b.vegetation.fill(1); stepClimate(a, cfg({}, 0), 0); stepClimate(b, cfg({}, 0.2), 0); expect(b.moisture[6]).toBeGreaterThan(a.moisture[6]); });
  it('heat decays', () => { const s = state(); s.heat[6] = 5; stepClimate(s, cfg(), 0); expect(s.heat[6]).toBeCloseTo(5 * 0.998, 6); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
import { SEA_LEVEL } from './terrain';
import type { WorldConfig } from './types';
export type ClimateState = { /* 上記 */ };
export const BASE_TEMP = 14, LAT_AMPLITUDE = 6, LAPSE = 20, HEAT_DECAY = 0.998;
export function stepClimate(s: ClimateState, config: WorldConfig, dayOfYear: number): void {
  const { size, ticksPerYear } = config; const phase = (2 * Math.PI * dayOfYear) / ticksPerYear;
  const seasonT = config.climate.seasonAmplitudeTemp * Math.sin(phase); const seasonR = config.climate.seasonAmplitudeRain * Math.cos(phase);
  const fb = config.feedback.vegetationToRain;
  for (let y = 0; y < size; y++) { const lat = (y / size - 0.5) * 2; for (let x = 0; x < size; x++) {
    const i = y * size + x; const e = s.elevation[i]; const landH = Math.max(0, e - SEA_LEVEL) / (1 - SEA_LEVEL);
    s.temperature[i] = BASE_TEMP + config.climate.tempOffset + LAT_AMPLITUDE * lat - LAPSE * landH + seasonT + s.heat[i];
    s.heat[i] *= HEAT_DECAY;
    if (e < SEA_LEVEL) { s.moisture[i] = 1; continue; }
    const m = s.moistureBase[i] * config.climate.rainScale + seasonR + fb * s.vegetation[i];
    s.moisture[i] = m < 0 ? 0 : m > 1 ? 1 : m;
  } }
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(sim): 型定義と気候ステップ(季節・標高・緯度・植生→降水)`

---

### Task 5: 植生ステップ

**Files:**
- Create: `src/simulation/vegetation.ts`
- Test: `tests/unit/vegetation.test.ts`

**Interfaces:**
```ts
export function suitability(def: SpeciesDef, temp: number, moisture: number): number  // [0,1]
export function stepVegetation(pops: Record<string, Float32Array>, scratch: Float32Array, env: { elevation: Float32Array; temperature: Float32Array; moisture: Float32Array }, plants: SpeciesDef[], size: number): void
export function sumVegetation(pops: Record<string, Float32Array>, plants: SpeciesDef[], out: Float32Array): void
```
- suitability: 範囲内で 1、範囲端から外へ幅 `w`(気温 5℃、水分 0.15)で線形に 0 へ。`tempFit × moistFit`。
- 更新: `p' = p + r·f·p·(1 − total) − m·(1 − f)·p`、その後拡散 `p'' = p' + d·(mean4(p') − p')`、海は常に 0、clamp [0,1]。`total` は全植物種の合計(更新前)。密度 0 のセルには隣接からの拡散で種が入る。

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { stepVegetation, suitability, sumVegetation } from '../../src/simulation/vegetation';
import type { SpeciesDef } from '../../src/simulation/types';
const grass: SpeciesDef = { id: 'grass', name: '草', trophic: 'plant', growthRate: 0.05, mortality: 0.02, tempRange: [0, 30], moistureRange: [0.2, 0.9], diffusion: 0.05, assetId: 'grass', color: '#6FBF7C' };
const env = (n: number, t = 15, m = 0.5) => ({ elevation: new Float32Array(n).fill(0.5), temperature: new Float32Array(n).fill(t), moisture: new Float32Array(n).fill(m) });
describe('suitability', () => {
  it('is 1 inside range, 0 far outside, between at edge', () => { expect(suitability(grass, 15, 0.5)).toBe(1); expect(suitability(grass, -20, 0.5)).toBe(0); const e = suitability(grass, -2.5, 0.5); expect(e).toBeGreaterThan(0); expect(e).toBeLessThan(1); });
});
describe('stepVegetation', () => {
  it('grows toward capacity in good conditions', () => { const n = 9; const p = { grass: new Float32Array(n).fill(0.1) }; const s = new Float32Array(n); for (let k = 0; k < 500; k++) stepVegetation(p, s, env(n), [grass], 3); expect(p.grass[4]).toBeGreaterThan(0.5); expect(p.grass[4]).toBeLessThanOrEqual(1); });
  it('declines in bad conditions', () => { const n = 9; const p = { grass: new Float32Array(n).fill(0.5) }; const s = new Float32Array(n); for (let k = 0; k < 200; k++) stepVegetation(p, s, env(n, -20), [grass], 3); expect(p.grass[4]).toBeLessThan(0.05); });
  it('sea stays 0, diffusion spreads to empty land', () => { const n = 9; const e = env(n); e.elevation[0] = 0.1; const p = { grass: new Float32Array(n) }; p.grass[4] = 0.8; p.grass[0] = 0.8; const s = new Float32Array(n); stepVegetation(p, s, e, [grass], 3); expect(p.grass[0]).toBe(0); expect(p.grass[1]).toBeGreaterThan(0); });
  it('two species share capacity', () => { const n = 1; const forest = { ...grass, id: 'forest' }; const p = { grass: new Float32Array([0.6]), forest: new Float32Array([0.6]) }; const s = new Float32Array(n); stepVegetation(p, s, env(n), [grass, forest], 1); expect(p.grass[0] + p.forest[0]).toBeLessThan(1.2); const out = new Float32Array(1); sumVegetation(p, [grass, forest], out); expect(out[0]).toBeCloseTo(p.grass[0] + p.forest[0], 6); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import type { SpeciesDef } from './types';
const TEMP_EDGE = 5, MOIST_EDGE = 0.15;
const ramp = (v: number, lo: number, hi: number, w: number) => v < lo ? Math.max(0, 1 - (lo - v) / w) : v > hi ? Math.max(0, 1 - (v - hi) / w) : 1;
export function suitability(def: SpeciesDef, temp: number, moisture: number): number { return ramp(temp, def.tempRange[0], def.tempRange[1], TEMP_EDGE) * ramp(moisture, def.moistureRange[0], def.moistureRange[1], MOIST_EDGE); }
export function sumVegetation(pops: Record<string, Float32Array>, plants: SpeciesDef[], out: Float32Array): void { out.fill(0); for (const d of plants) { const p = pops[d.id]; for (let i = 0; i < out.length; i++) out[i] += p[i]; } }
export function stepVegetation(pops: Record<string, Float32Array>, scratch: Float32Array, env: { elevation: Float32Array; temperature: Float32Array; moisture: Float32Array }, plants: SpeciesDef[], size: number): void {
  const n = size * size; const total = new Float32Array(n); sumVegetation(pops, plants, total);
  for (const d of plants) {
    const p = pops[d.id];
    for (let i = 0; i < n; i++) { if (env.elevation[i] < SEA_LEVEL) { scratch[i] = 0; continue; } const f = suitability(d, env.temperature[i], env.moisture[i]); const v = p[i]; scratch[i] = v + d.growthRate * f * v * (1 - total[i]) - d.mortality * (1 - f) * v; }
    for (let i = 0; i < n; i++) { if (env.elevation[i] < SEA_LEVEL) { p[i] = 0; continue; } let sum = 0, c = 0; forEachNeighbor4(i, size, (j) => { if (env.elevation[j] >= SEA_LEVEL) { sum += scratch[j]; c++; } }); const mean = c ? sum / c : scratch[i]; const v = scratch[i] + d.diffusion * (mean - scratch[i]); p[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  }
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(sim): 植生の成長・死亡・拡散`

---

### Task 6: 災害

**Files:**
- Create: `src/simulation/disaster.ts`
- Test: `tests/unit/disaster.test.ts`

**Interfaces:**
```ts
export type DisasterState = { elevation: Float32Array; heat: Float32Array; fire: Uint8Array; burnt: Uint16Array; populations: Record<string, Float32Array> };
export function applyDisaster(s: DisasterState, cmd: Extract<Command, { type: 'disaster' }>, species: SpeciesDef[], size: number): { affectedCells: number }
export function stepFire(s: DisasterState, vegetation: Float32Array, plants: SpeciesDef[], size: number): number   // 返り値: この tick に燃えたセル数
```
- meteor: 半径内の全種 0、中心 `elevation −= 0.05`(下限 0)。volcano: 半径内の植物 0、`heat += 6`。wildfire: 中心 `fire=1`。plague: 半径内の動物種 `×0.1`。半径は円(ユークリッド距離 ≤ radius)。
- stepFire: `fire=1` のセルは植物を 0 にし `burnt=30`、隣接で `vegetation > 0.3` かつ `burnt=0` かつ海でないセルに延焼(次 tick から燃える)。`burnt` は毎 tick −1。

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { applyDisaster, stepFire, type DisasterState } from '../../src/simulation/disaster';
import type { SpeciesDef } from '../../src/simulation/types';
const grass: SpeciesDef = { id: 'grass', name: '草', trophic: 'plant', growthRate: 0.05, mortality: 0.02, tempRange: [0, 30], moistureRange: [0.2, 0.9], diffusion: 0.05, assetId: 'grass', color: '#6FBF7C' };
const deer: SpeciesDef = { ...grass, id: 'deer', trophic: 'herbivore', eats: ['grass'] };
const mk = (size = 5): DisasterState => { const n = size * size; return { elevation: new Float32Array(n).fill(0.5), heat: new Float32Array(n), fire: new Uint8Array(n), burnt: new Uint16Array(n), populations: { grass: new Float32Array(n).fill(0.8), deer: new Float32Array(n).fill(0.5) } }; };
describe('applyDisaster', () => {
  it('meteor clears everything in radius and lowers center', () => { const s = mk(); applyDisaster(s, { type: 'disaster', kind: 'meteor', cell: 12, radius: 1 }, [grass, deer], 5); expect(s.populations.grass[12]).toBe(0); expect(s.populations.deer[7]).toBe(0); expect(s.populations.grass[0]).toBe(0.8); expect(s.elevation[12]).toBeCloseTo(0.45, 6); });
  it('volcano clears plants and adds heat', () => { const s = mk(); applyDisaster(s, { type: 'disaster', kind: 'volcano', cell: 12, radius: 1 }, [grass, deer], 5); expect(s.populations.grass[12]).toBe(0); expect(s.populations.deer[12]).toBe(0.5); expect(s.heat[12]).toBe(6); });
  it('plague hits animals only', () => { const s = mk(); applyDisaster(s, { type: 'disaster', kind: 'plague', cell: 12, radius: 1 }, [grass, deer], 5); expect(s.populations.deer[12]).toBeCloseTo(0.05, 6); expect(s.populations.grass[12]).toBe(0.8); });
  it('wildfire ignites center and spreads through dense vegetation', () => { const s = mk(); applyDisaster(s, { type: 'disaster', kind: 'wildfire', cell: 12, radius: 0 }, [grass], 5); expect(s.fire[12]).toBe(1); const veg = s.populations.grass; const b1 = stepFire(s, veg, [grass], 5); expect(b1).toBe(1); expect(veg[12]).toBe(0); expect(s.fire[7]).toBe(1); const b2 = stepFire(s, veg, [grass], 5); expect(b2).toBe(4); expect(s.fire[12]).toBe(0); });
  it('wildfire does not spread into sparse vegetation', () => { const s = mk(); s.populations.grass.fill(0.1); s.populations.grass[12] = 0.8; applyDisaster(s, { type: 'disaster', kind: 'wildfire', cell: 12, radius: 0 }, [grass], 5); stepFire(s, s.populations.grass, [grass], 5); expect(s.fire[7]).toBe(0); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import type { Command, SpeciesDef } from './types';
export type DisasterState = { /* 上記 */ };
export const VOLCANO_HEAT = 6, METEOR_CRATER = 0.05, FIRE_THRESHOLD = 0.3, BURNT_TICKS = 30, PLAGUE_SURVIVAL = 0.1;
function forEachInRadius(cell: number, radius: number, size: number, fn: (i: number) => void) { const cx = cell % size, cy = (cell - cx) / size; const r = Math.ceil(radius); for (let y = Math.max(0, cy - r); y <= Math.min(size - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(size - 1, cx + r); x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= radius * radius) fn(y * size + x); } }
export function applyDisaster(s: DisasterState, cmd: Extract<Command, { type: 'disaster' }>, species: SpeciesDef[], size: number) {
  let affected = 0; const plants = species.filter((d) => d.trophic === 'plant'), animals = species.filter((d) => d.trophic !== 'plant');
  switch (cmd.kind) {
    case 'meteor': forEachInRadius(cmd.cell, cmd.radius, size, (i) => { affected++; for (const d of species) s.populations[d.id][i] = 0; }); s.elevation[cmd.cell] = Math.max(0, s.elevation[cmd.cell] - METEOR_CRATER); break;
    case 'volcano': forEachInRadius(cmd.cell, cmd.radius, size, (i) => { affected++; for (const d of plants) s.populations[d.id][i] = 0; s.heat[i] += VOLCANO_HEAT; }); break;
    case 'plague': forEachInRadius(cmd.cell, cmd.radius, size, (i) => { affected++; for (const d of animals) s.populations[d.id][i] *= PLAGUE_SURVIVAL; }); break;
    case 'wildfire': if (s.elevation[cmd.cell] >= SEA_LEVEL) { s.fire[cmd.cell] = 1; affected = 1; } break;
  }
  return { affectedCells: affected };
}
export function stepFire(s: DisasterState, vegetation: Float32Array, plants: SpeciesDef[], size: number): number {
  const n = size * size; const next: number[] = []; let burned = 0;
  for (let i = 0; i < n; i++) { if (s.burnt[i] > 0) s.burnt[i]--; if (s.fire[i] !== 1) continue; burned++; for (const d of plants) s.populations[d.id][i] = 0; s.burnt[i] = BURNT_TICKS; s.fire[i] = 0; forEachNeighbor4(i, size, (j) => { if (s.fire[j] === 0 && s.burnt[j] === 0 && s.elevation[j] >= SEA_LEVEL && vegetation[j] > FIRE_THRESHOLD) next.push(j); }); }
  for (const j of next) s.fire[j] = 1;
  return burned;
}
```
※ `stepFire` 内で `burnt` を先に減らすため、着火セル自身の `burnt=30` は同 tick で再着火されない。

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(sim): 災害 4 種と山火事の延焼`

---

### Task 7: World

**Files:**
- Create: `src/simulation/World.ts`
- Test: `tests/unit/world.determinism.test.ts`, `tests/unit/world.properties.test.ts`, `tests/unit/world.commands.test.ts`, `tests/unit/world.save.test.ts`, `tests/unit/world.log.test.ts`

**Interfaces:**
```ts
export type WorldDeps = { log: LogSink; now?: () => Date };
export class World {
  static create(config: WorldConfig, deps: WorldDeps): World
  static restore(save: SaveData, deps: WorldDeps): World
  dispatch(cmd: Command): void
  step(ticks?: number): void
  snapshot(): WorldSnapshot
  serialize(): SaveData
}
```
- 初期状態: 陸の全セルに各植物種 0.05。動物種は 0(M2 で spawn)。
- `step` の順序(1 tick): コマンド適用 → `stepClimate` → `stepFire` → `stepVegetation` → `sumVegetation` → totals 更新 → 絶滅判定 → tick++ → 年境界なら `sim.tick.summary`。
- `set_climate` は `config.climate` を書き換える(serialize に含まれる)。
- `cmd.rejected`: セル範囲外、未知の種 ID、`amount<=0`、`radius<0`。
- 絶滅: 前 tick の total > 0 かつ今 0 → `sim.species.extinct`(種ごとに 1 回、再 spawn 後にまた 0 になれば再度出る)。

- [ ] **Step 1: テスト(5 ファイル)**

`tests/unit/helpers.ts`:
```ts
import type { WorldConfig, SpeciesDef } from '../../src/simulation/types';
export const grass: SpeciesDef = { id: 'grass', name: '草', trophic: 'plant', growthRate: 0.04, mortality: 0.02, tempRange: [-2, 32], moistureRange: [0.15, 0.85], diffusion: 0.05, assetId: 'grass', color: '#6FBF7C' };
export const forest: SpeciesDef = { id: 'forest', name: '森', trophic: 'plant', growthRate: 0.015, mortality: 0.01, tempRange: [2, 26], moistureRange: [0.45, 1], diffusion: 0.02, assetId: 'forest', color: '#2E6B37' };
export const testConfig = (over: Partial<WorldConfig> = {}): WorldConfig => ({ seed: 42, size: 32, ticksPerYear: 360, species: [grass, forest], climate: { seasonAmplitudeTemp: 8, seasonAmplitudeRain: 0.1, tempOffset: 0, rainScale: 1 }, feedback: { vegetationToRain: 0.1, vegetationToTemp: 0, co2ToTemp: 0, iceAlbedo: 0 }, ...over });
export const fixedNow = () => new Date('2026-01-01T00:00:00.000Z');
```

`world.determinism.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';
describe('World determinism', () => {
  it('same config → identical snapshots after 2 years', () => {
    const a = World.create(testConfig(), { log: createMemorySink() }), b = World.create(testConfig(), { log: createMemorySink() });
    a.step(720); b.step(720);
    expect(Array.from(a.snapshot().layers.vegetation)).toEqual(Array.from(b.snapshot().layers.vegetation));
    expect(a.snapshot().totals).toEqual(b.snapshot().totals);
  });
  it('different seed → different terrain', () => { const a = World.create(testConfig({ seed: 1 }), { log: createMemorySink() }), b = World.create(testConfig({ seed: 2 }), { log: createMemorySink() }); expect(Array.from(a.snapshot().layers.elevation)).not.toEqual(Array.from(b.snapshot().layers.elevation)); });
});
```

`world.properties.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';
describe('World properties (seed 42, 100 years)', () => {
  const w = World.create(testConfig(), { log: createMemorySink() }); w.step(360 * 100); const s = w.snapshot();
  it('no NaN/Infinity anywhere', () => { for (const arr of [s.layers.temperature, s.layers.moisture, s.layers.vegetation]) for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true); });
  it('vegetation within [0,1]', () => { for (let i = 0; i < s.layers.vegetation.length; i++) { expect(s.layers.vegetation[i]).toBeGreaterThanOrEqual(0); expect(s.layers.vegetation[i]).toBeLessThanOrEqual(1); } });
  it('vegetation ratio between 5% and 95% of land', () => { let land = 0, veg = 0; for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) { land++; veg += s.layers.vegetation[i]; } const ratio = veg / land; expect(ratio).toBeGreaterThan(0.05); expect(ratio).toBeLessThan(0.95); });
  it('tick/year bookkeeping', () => { expect(s.tick).toBe(36000); expect(s.year).toBe(100); expect(s.dayOfYear).toBe(0); });
  it('with feedback 0, mean temperature repeats yearly', () => { const w0 = World.create(testConfig({ feedback: { vegetationToRain: 0, vegetationToTemp: 0, co2ToTemp: 0, iceAlbedo: 0 } }), { log: createMemorySink() }); w0.step(360 + 100); const t1 = w0.snapshot().meanTemperature; w0.step(360); expect(w0.snapshot().meanTemperature).toBeCloseTo(t1, 6); });
});
```

`world.commands.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';
const landCell = (w: World) => { const s = w.snapshot(); for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) return i; throw new Error('no land'); };
describe('World commands', () => {
  it('disaster lowers vegetation at the cell after next step', () => { const w = World.create(testConfig(), { log: createMemorySink() }); w.step(360 * 5); const c = landCell(w); const before = w.snapshot().layers.vegetation[c]; expect(before).toBeGreaterThan(0.05); w.dispatch({ type: 'disaster', kind: 'meteor', cell: c, radius: 2 }); w.step(1); expect(w.snapshot().layers.vegetation[c]).toBeLessThan(before * 0.2); });
  it('spawn_species raises totals', () => { const w = World.create(testConfig(), { log: createMemorySink() }); const c = landCell(w); const before = w.snapshot().totals.forest; w.dispatch({ type: 'spawn_species', speciesId: 'forest', cell: c, amount: 0.9 }); w.step(1); expect(w.snapshot().totals.forest).toBeGreaterThan(before); });
  it('set_climate changes temperature next step', () => { const w = World.create(testConfig(), { log: createMemorySink() }); w.step(1); const t = w.snapshot().meanTemperature; w.dispatch({ type: 'set_climate', tempOffset: 5 }); w.step(1); expect(w.snapshot().meanTemperature).toBeGreaterThan(t + 4); });
  it('rejects invalid commands with a log record', () => { const log = createMemorySink(); const w = World.create(testConfig(), { log }); w.dispatch({ type: 'spawn_species', speciesId: 'nope', cell: 0, amount: 1 }); w.dispatch({ type: 'disaster', kind: 'meteor', cell: 999999, radius: 1 }); w.step(1); expect(log.find('cmd.rejected')).toHaveLength(2); });
});
```

`world.save.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';
describe('World save/restore', () => {
  it('round-trips snapshot exactly and continues identically', () => {
    const a = World.create(testConfig(), { log: createMemorySink() }); a.step(400); a.dispatch({ type: 'set_climate', tempOffset: 2 }); a.step(10);
    const json = JSON.stringify(a.serialize()); const b = World.restore(JSON.parse(json), { log: createMemorySink() });
    expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation)); expect(b.snapshot().tick).toBe(a.snapshot().tick);
    a.step(100); b.step(100); expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation)); expect(b.snapshot().meanTemperature).toBeCloseTo(a.snapshot().meanTemperature, 5);
  });
});
```

`world.log.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig, fixedNow, grass } from './helpers';
describe('World logging', () => {
  it('emits created, yearly summary, and stamps ts/tick/year', () => { const log = createMemorySink(); const w = World.create(testConfig(), { log, now: fixedNow }); w.step(720); expect(log.find('sim.world.created')).toHaveLength(1); const s = log.find('sim.tick.summary'); expect(s).toHaveLength(2); expect(s[0].ts).toBe('2026-01-01T00:00:00.000Z'); expect(s[1].year).toBe(2); expect(typeof s[1].totals).toBe('object'); });
  it('emits cmd.received and sim.disaster', () => { const log = createMemorySink(); const w = World.create(testConfig(), { log }); w.dispatch({ type: 'disaster', kind: 'wildfire', cell: 16 * 32 + 16, radius: 0 }); w.step(1); expect(log.find('cmd.received')).toHaveLength(1); expect(log.find('sim.disaster')).toHaveLength(1); });
  it('emits sim.species.extinct once when a species dies out', () => { const log = createMemorySink(); const cold = { ...grass, tempRange: [50, 60] as [number, number] }; const w = World.create(testConfig({ species: [cold] }), { log }); w.step(360 * 3); expect(log.find('sim.species.extinct')).toHaveLength(1); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装** `src/simulation/World.ts`

```ts
import type { LogSink, LogLevel } from '../core/log/types';
import type { Command, SaveData, SpeciesDef, WorldConfig, WorldSnapshot } from './types';
import { generateTerrain, SEA_LEVEL } from './terrain';
import { stepClimate } from './climate';
import { stepVegetation, sumVegetation } from './vegetation';
import { applyDisaster, stepFire } from './disaster';
export type WorldDeps = { log: LogSink; now?: () => Date };
const INITIAL_PLANT = 0.05;
export class World {
  private queue: Command[] = []; private tick = 0; private prevTotals: Record<string, number> = {};
  private readonly n: number; private readonly plants: SpeciesDef[]; private readonly byId: Map<string, SpeciesDef>;
  private readonly elevation: Float32Array; private readonly moistureBase: Float32Array; private readonly heat: Float32Array;
  private readonly temperature: Float32Array; private readonly moisture: Float32Array; private readonly vegetation: Float32Array;
  private readonly fire: Uint8Array; private readonly burnt: Uint16Array; private readonly scratch: Float32Array;
  private readonly populations: Record<string, Float32Array> = {}; private readonly totals: Record<string, number> = {};
  private meanTemperature = 0; private readonly co2 = 280;
  private constructor(private readonly config: WorldConfig, private readonly deps: WorldDeps, terrain: { elevation: Float32Array; moistureBase: Float32Array }) {
    this.n = config.size * config.size; this.byId = new Map(config.species.map((d) => [d.id, d])); this.plants = config.species.filter((d) => d.trophic === 'plant');
    this.elevation = terrain.elevation; this.moistureBase = terrain.moistureBase;
    this.heat = new Float32Array(this.n); this.temperature = new Float32Array(this.n); this.moisture = new Float32Array(this.n); this.vegetation = new Float32Array(this.n);
    this.fire = new Uint8Array(this.n); this.burnt = new Uint16Array(this.n); this.scratch = new Float32Array(this.n);
    for (const d of config.species) { this.populations[d.id] = new Float32Array(this.n); this.totals[d.id] = 0; }
  }
  static create(config: WorldConfig, deps: WorldDeps): World {
    const w = new World(structuredClone(config), deps, generateTerrain(config.seed, config.size));
    for (const d of w.plants) { const p = w.populations[d.id]; for (let i = 0; i < w.n; i++) if (w.elevation[i] >= SEA_LEVEL) p[i] = INITIAL_PLANT; }
    w.refresh(); w.log('info', 'sim.world.created', { seed: config.seed, size: config.size, speciesCount: config.species.length }); return w;
  }
  static restore(save: SaveData, deps: WorldDeps): World {
    if (save.version !== 1) throw new Error(`unsupported save version ${String(save.version)}`);
    const w = new World(structuredClone(save.config), deps, { elevation: Float32Array.from(save.elevation), moistureBase: Float32Array.from(save.moistureBase) });
    w.heat.set(save.heat); w.tick = save.tick; for (const d of w.config.species) w.populations[d.id].set(save.populations[d.id] ?? []);
    w.refresh(); w.prevTotals = { ...w.totals }; w.log('info', 'sim.world.created', { seed: save.config.seed, size: save.config.size, speciesCount: save.config.species.length, restored: true }); return w;
  }
  dispatch(cmd: Command): void { this.queue.push(cmd); }
  step(ticks = 1): void { for (let k = 0; k < ticks; k++) this.stepOnce(); }
  snapshot(): WorldSnapshot { const { ticksPerYear } = this.config; return { tick: this.tick, year: Math.floor(this.tick / ticksPerYear), dayOfYear: this.tick % ticksPerYear, size: this.config.size, layers: { elevation: this.elevation, temperature: this.temperature, moisture: this.moisture, vegetation: this.vegetation, populations: this.populations }, totals: this.totals, meanTemperature: this.meanTemperature, co2: this.co2, species: this.config.species }; }
  serialize(): SaveData { const populations: Record<string, number[]> = {}; for (const d of this.config.species) populations[d.id] = Array.from(this.populations[d.id]); return { version: 1, config: structuredClone(this.config), tick: this.tick, elevation: Array.from(this.elevation), moistureBase: Array.from(this.moistureBase), heat: Array.from(this.heat), populations }; }
  private stepOnce(): void {
    const cmds = this.queue; this.queue = []; for (const c of cmds) this.apply(c);
    const { ticksPerYear, size } = this.config; const dayOfYear = this.tick % ticksPerYear;
    stepClimate(this, this.config, dayOfYear);
    stepFire(this, this.vegetation, this.plants, size);
    stepVegetation(this.populations, this.scratch, this, this.plants, size);
    this.refresh();
    for (const d of this.config.species) { const was = this.prevTotals[d.id] ?? 0; if (was > 0 && this.totals[d.id] === 0) this.log('warn', 'sim.species.extinct', { speciesId: d.id }); }
    this.prevTotals = { ...this.totals };
    this.tick++;
    if (this.tick % ticksPerYear === 0) this.log('info', 'sim.tick.summary', { totals: { ...this.totals }, meanTemperature: this.meanTemperature, co2: this.co2, vegetationRatio: this.vegetationRatio() });
  }
  private apply(cmd: Command): void {
    const reason = this.validate(cmd); this.log('info', 'cmd.received', { cmd });
    if (reason) { this.log('warn', 'cmd.rejected', { cmd, reason }); return; }
    switch (cmd.type) {
      case 'spawn_species': { const p = this.populations[cmd.speciesId]; p[cmd.cell] = Math.min(1, p[cmd.cell] + cmd.amount); break; }
      case 'set_climate': { if (cmd.tempOffset !== undefined) this.config.climate.tempOffset = cmd.tempOffset; if (cmd.rainScale !== undefined) this.config.climate.rainScale = cmd.rainScale; break; }
      case 'disaster': { const r = applyDisaster(this, cmd, this.config.species, this.config.size); this.log('info', 'sim.disaster', { kind: cmd.kind, cell: cmd.cell, radius: cmd.radius, affectedCells: r.affectedCells }); break; }
    }
  }
  private validate(cmd: Command): string | null {
    if ('cell' in cmd && (!Number.isInteger(cmd.cell) || cmd.cell < 0 || cmd.cell >= this.n)) return 'cell out of range';
    if (cmd.type === 'spawn_species') { if (!this.byId.has(cmd.speciesId)) return 'unknown species'; if (!(cmd.amount > 0)) return 'amount must be > 0'; if (this.elevation[cmd.cell] < SEA_LEVEL) return 'cell is sea'; }
    if (cmd.type === 'disaster' && !(cmd.radius >= 0)) return 'radius must be >= 0';
    return null;
  }
  private refresh(): void {
    sumVegetation(this.populations, this.plants, this.vegetation);
    for (const d of this.config.species) { let t = 0; const p = this.populations[d.id]; for (let i = 0; i < this.n; i++) t += p[i]; this.totals[d.id] = t; }
    let land = 0, t = 0; for (let i = 0; i < this.n; i++) if (this.elevation[i] >= SEA_LEVEL) { land++; t += this.temperature[i]; } this.meanTemperature = land ? t / land : 0;
  }
  private vegetationRatio(): number { let land = 0, v = 0; for (let i = 0; i < this.n; i++) if (this.elevation[i] >= SEA_LEVEL) { land++; v += this.vegetation[i]; } return land ? v / land : 0; }
  private log(level: LogLevel, event: string, payload: Record<string, unknown>): void { const now = this.deps.now ?? (() => new Date()); this.deps.log.write({ ts: now().toISOString(), tick: this.tick, year: Math.floor(this.tick / this.config.ticksPerYear), level, event, ...payload }); }
}
```
※ `World` 自身が `ClimateState` / `DisasterState` の構造的部分型を満たすので `this` を渡す。`stepVegetation` の env も同様。

- [ ] **Step 4: 成功を確認**。`vegetation ratio` テストが落ちる場合は helpers の `growthRate` / `mortality` / 地形の陸割合を調整し、調整値を `assets/data/species.json`(Task 11)にも反映する。
- [ ] **Step 5: Commit** `feat(sim): World(create/dispatch/step/snapshot/serialize)とログ`

---

### Task 8: Runner

**Files:**
- Create: `src/core/runner.ts`
- Test: `tests/unit/runner.test.ts`

**Interfaces:**
```ts
export type Speed = 0 | 1 | 10 | 100;
export type Runner = { setSpeed(s: Speed): void; getSpeed(): Speed; start(): void; stop(): void; frame(nowMs: number): void };
export function createRunner(world: { step(n?: number): void; snapshot(): WorldSnapshot }, opts: { onFrame: (s: WorldSnapshot) => void; raf?: (cb: (t: number) => void) => number; caf?: (id: number) => void; maxTicksPerFrame?: number }): Runner
```
- 速度 s のとき 1 秒に s tick。`frame(now)` は経過 ms を蓄積し `floor(acc·s/1000)` tick 実行(上限 `maxTicksPerFrame`=200)、`onFrame` は毎回呼ぶ。`raf` 省略時は `requestAnimationFrame`。

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/core/runner';
const fakeWorld = () => { let t = 0; return { step(n = 1) { t += n; }, snapshot: () => ({ tick: t }) as never, ticks: () => t }; };
describe('createRunner', () => {
  it('advances ticks proportional to speed and elapsed time', () => { const w = fakeWorld(); let frames = 0; const r = createRunner(w, { onFrame: () => frames++, raf: () => 0, caf: () => {} }); r.setSpeed(10); r.frame(0); r.frame(1000); expect(w.ticks()).toBe(10); r.frame(1500); expect(w.ticks()).toBe(15); expect(frames).toBe(3); });
  it('speed 0 still calls onFrame but does not step', () => { const w = fakeWorld(); let frames = 0; const r = createRunner(w, { onFrame: () => frames++, raf: () => 0, caf: () => {} }); r.setSpeed(0); r.frame(0); r.frame(5000); expect(w.ticks()).toBe(0); expect(frames).toBe(2); });
  it('caps ticks per frame', () => { const w = fakeWorld(); const r = createRunner(w, { onFrame: () => {}, raf: () => 0, caf: () => {}, maxTicksPerFrame: 50 }); r.setSpeed(100); r.frame(0); r.frame(10000); expect(w.ticks()).toBe(50); });
  it('start schedules frames via raf and stop cancels', () => { const w = fakeWorld(); const cbs: ((t: number) => void)[] = []; let cancelled = -1; const r = createRunner(w, { onFrame: () => {}, raf: (cb) => { cbs.push(cb); return cbs.length; }, caf: (id) => { cancelled = id; } }); r.setSpeed(1); r.start(); expect(cbs).toHaveLength(1); cbs[0](0); expect(cbs).toHaveLength(2); r.stop(); expect(cancelled).toBe(2); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
import type { WorldSnapshot } from '../simulation/types';
export type Speed = 0 | 1 | 10 | 100;
export type Runner = { setSpeed(s: Speed): void; getSpeed(): Speed; start(): void; stop(): void; frame(nowMs: number): void };
export function createRunner(world: { step(n?: number): void; snapshot(): WorldSnapshot }, opts: { onFrame: (s: WorldSnapshot) => void; raf?: (cb: (t: number) => void) => number; caf?: (id: number) => void; maxTicksPerFrame?: number }): Runner {
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb)); const caf = opts.caf ?? ((id) => cancelAnimationFrame(id)); const cap = opts.maxTicksPerFrame ?? 200;
  let speed: Speed = 1, last: number | null = null, acc = 0, handle: number | null = null, running = false;
  const frame = (now: number) => { if (last !== null && speed > 0) { acc += now - last; const ticks = Math.floor((acc * speed) / 1000); if (ticks > 0) { world.step(Math.min(ticks, cap)); acc -= (ticks * 1000) / speed; } } else if (speed === 0) acc = 0; last = now; opts.onFrame(world.snapshot()); };
  const loop = (t: number) => { if (!running) return; frame(t); handle = raf(loop); };
  return { setSpeed(s) { speed = s; }, getSpeed: () => speed, start() { if (running) return; running = true; last = null; handle = raf(loop); }, stop() { running = false; if (handle !== null) caf(handle); handle = null; }, frame };
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(core): Runner(rAF ループと速度倍率)`

---

### Task 9: 描画の純粋関数

**Files:**
- Create: `src/render/layerToColors.ts`, `src/render/scatter.ts`
- Test: `tests/unit/render.layerToColors.test.ts`, `tests/unit/render.scatter.test.ts`

**Interfaces:**
```ts
export type LayerKind = 'terrain' | 'temperature' | 'moisture' | 'vegetation' | `species:${string}`;
export function layerToColors(snapshot: Pick<WorldSnapshot, 'size' | 'layers' | 'species'>, layer: LayerKind, out?: Float32Array): Float32Array  // 長さ size²×3、RGB [0,1]
export function scatterInstances(density: Float32Array, elevation: Float32Array, size: number, maxPerCell: number, seed: number, out: Float32Array): number  // out に [x,y(高さ),z] を書き、書いた個数を返す
```
- terrain: 海 = 標高で濃淡の青、陸 = 砂色→緑(植生で補間)→灰(標高 0.8 以上)→白(0.9 以上)。temperature: 青(−5)→黄(15)→赤(30)。moisture: 砂→青。vegetation: 砂→濃緑。species: 黒→種の `color`。海は常に青系で塗る。
- scatter: セルごとに `count = round(density·maxPerCell)`、位置はセル内の決定論的な擬似乱数(seed + cell から `mulberry32`)。`out` の容量を超えたら打ち切る。座標系: x = cx − size/2 + u、z = cy − size/2 + v、y = elevation。

- [ ] **Step 1: テスト**

```ts
// render.layerToColors.test.ts
import { describe, it, expect } from 'vitest';
import { layerToColors } from '../../src/render/layerToColors';
import { grass } from './helpers';
const snap = () => { const n = 4; const elevation = new Float32Array(n).fill(0.5); elevation[0] = 0.1; return { size: 2, species: [grass], layers: { elevation, temperature: new Float32Array([10, -5, 15, 30]), moisture: new Float32Array([1, 0, 0.5, 1]), vegetation: new Float32Array([0, 0, 0.5, 1]), populations: { grass: new Float32Array([0, 0, 0.5, 1]) } } }; };
describe('layerToColors', () => {
  it('returns size²×3 for every layer', () => { for (const l of ['terrain', 'temperature', 'moisture', 'vegetation', 'species:grass'] as const) { const c = layerToColors(snap(), l); expect(c.length).toBe(12); for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); } } });
  it('sea is bluish on terrain, vegetation makes land greener', () => { const c = layerToColors(snap(), 'terrain'); expect(c[2]).toBeGreaterThan(c[0]); expect(c[3 * 3 + 1]).toBeGreaterThan(c[1 * 3 + 1]); });
  it('temperature: cold is blue, hot is red', () => { const c = layerToColors(snap(), 'temperature'); expect(c[1 * 3 + 2]).toBeGreaterThan(c[1 * 3 + 0]); expect(c[3 * 3 + 0]).toBeGreaterThan(c[3 * 3 + 2]); });
  it('reuses provided buffer', () => { const out = new Float32Array(12); expect(layerToColors(snap(), 'moisture', out)).toBe(out); });
});
// render.scatter.test.ts
import { describe, it, expect } from 'vitest';
import { scatterInstances } from '../../src/render/scatter';
describe('scatterInstances', () => {
  it('writes round(density*max) per cell, deterministic, inside cell', () => { const d = new Float32Array([0, 0.5, 1, 0.25]); const e = new Float32Array([0.5, 0.5, 0.5, 0.5]); const out = new Float32Array(100 * 3); const n = scatterInstances(d, e, 2, 4, 1, out); expect(n).toBe(0 + 2 + 4 + 1); const out2 = new Float32Array(100 * 3); scatterInstances(d, e, 2, 4, 1, out2); expect(Array.from(out2.subarray(0, n * 3))).toEqual(Array.from(out.subarray(0, n * 3))); for (let k = 0; k < n; k++) { expect(out[k * 3 + 1]).toBe(0.5); expect(Math.abs(out[k * 3])).toBeLessThanOrEqual(1); } });
  it('stops at buffer capacity', () => { const d = new Float32Array(4).fill(1); const e = new Float32Array(4).fill(0.5); const out = new Float32Array(5 * 3); expect(scatterInstances(d, e, 2, 4, 1, out)).toBe(5); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
// layerToColors.ts
import type { WorldSnapshot } from '../simulation/types';
import { SEA_LEVEL } from '../simulation/terrain';
export type LayerKind = 'terrain' | 'temperature' | 'moisture' | 'vegetation' | `species:${string}`;
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const SEA_DEEP = hex('#244D6B'), SEA_SHALLOW = hex('#3E7FA8'), SAND = hex('#C7B67A'), GREEN = hex('#2F6B37'), ROCK = hex('#8F8A7A'), SNOW = hex('#E8E6DF');
const COLD = hex('#4C7BC9'), MILD = hex('#E8D66B'), HOT = hex('#D9563C'), DRY = hex('#F2E7C6'), WET = hex('#2F6EA8'), DARK = hex('#1A1A1A');
function seaColor(e: number): RGB { return lerp(SEA_DEEP, SEA_SHALLOW, clamp01(e / SEA_LEVEL)); }
export function layerToColors(s: Pick<WorldSnapshot, 'size' | 'layers' | 'species'>, layer: LayerKind, out?: Float32Array): Float32Array {
  const n = s.size * s.size; const o = out ?? new Float32Array(n * 3); const L = s.layers;
  const speciesId = layer.startsWith('species:') ? layer.slice(8) : null; const def = speciesId ? s.species.find((d) => d.id === speciesId) : undefined; const tint = def ? hex(def.color) : GREEN; const pop = speciesId ? L.populations[speciesId] : undefined;
  for (let i = 0; i < n; i++) {
    const e = L.elevation[i]; let c: RGB;
    if (e < SEA_LEVEL) c = seaColor(e);
    else switch (layer) {
      case 'terrain': { const h = (e - SEA_LEVEL) / (1 - SEA_LEVEL); c = lerp(SAND, GREEN, clamp01(L.vegetation[i])); if (e > 0.8) c = lerp(c, ROCK, clamp01((e - 0.8) / 0.1)); if (e > 0.9) c = lerp(c, SNOW, clamp01((e - 0.9) / 0.1)); void h; break; }
      case 'temperature': { const t = L.temperature[i]; c = t < 15 ? lerp(COLD, MILD, clamp01((t + 5) / 20)) : lerp(MILD, HOT, clamp01((t - 15) / 15)); break; }
      case 'moisture': c = lerp(DRY, WET, clamp01(L.moisture[i])); break;
      case 'vegetation': c = lerp(SAND, GREEN, clamp01(L.vegetation[i])); break;
      default: c = lerp(DARK, tint, clamp01(pop ? pop[i] : 0));
    }
    o[i * 3] = c[0]; o[i * 3 + 1] = c[1]; o[i * 3 + 2] = c[2];
  }
  return o;
}
// scatter.ts
import { mulberry32 } from '../simulation/rng';
export function scatterInstances(density: Float32Array, elevation: Float32Array, size: number, maxPerCell: number, seed: number, out: Float32Array): number {
  const cap = Math.floor(out.length / 3); let k = 0; const half = size / 2;
  for (let i = 0; i < density.length && k < cap; i++) { const count = Math.round(density[i] * maxPerCell); if (count <= 0) continue; const rng = mulberry32((seed * 7919 + i) >>> 0); const cx = i % size, cy = (i - cx) / size; for (let c = 0; c < count && k < cap; c++, k++) { out[k * 3] = cx - half + rng(); out[k * 3 + 1] = elevation[i]; out[k * 3 + 2] = cy - half + rng(); } }
  return k;
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(render): レイヤー着色と個体散布の純粋関数`

---

### Task 10: TimeSeries と Canvas グラフ

**Files:**
- Create: `src/ui/timeSeries.ts`, `src/ui/graph.ts`
- Test: `tests/unit/ui.timeSeries.test.ts`

**Interfaces:**
```ts
export class TimeSeries { constructor(capacity: number); push(x: number, values: Record<string, number>): void; get length(): number; keys(): string[]; series(key: string): { x: number; y: number }[]; latest(key: string): number | undefined; xRange(): [number, number] }
export type GraphLine = { key: string; color: string; label: string; axis?: 'left' | 'right' };
export function drawGraph(ctx: CanvasRenderingContext2D, ts: TimeSeries, lines: GraphLine[], markers: { x: number; label: string; color: string }[], w: number, h: number): void
```
- TimeSeries は容量到達で最古を捨てる。`series` は古い順。

- [ ] **Step 1: テスト**

```ts
import { describe, it, expect } from 'vitest';
import { TimeSeries } from '../../src/ui/timeSeries';
describe('TimeSeries', () => {
  it('keeps at most capacity points, oldest dropped, in order', () => { const t = new TimeSeries(3); for (let i = 0; i < 5; i++) t.push(i, { a: i * 10, b: -i }); expect(t.length).toBe(3); expect(t.series('a').map((p) => p.x)).toEqual([2, 3, 4]); expect(t.series('a').map((p) => p.y)).toEqual([20, 30, 40]); expect(t.latest('b')).toBe(-4); expect(t.keys().sort()).toEqual(['a', 'b']); expect(t.xRange()).toEqual([2, 4]); });
  it('handles missing keys', () => { const t = new TimeSeries(2); t.push(0, { a: 1 }); expect(t.series('zzz')).toEqual([]); expect(t.latest('zzz')).toBeUndefined(); expect(new TimeSeries(2).xRange()).toEqual([0, 0]); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: 実装**

```ts
// timeSeries.ts
export class TimeSeries {
  private xs: number[] = []; private data = new Map<string, number[]>();
  constructor(private readonly capacity: number) {}
  push(x: number, values: Record<string, number>): void { this.xs.push(x); for (const k of Object.keys(values)) { if (!this.data.has(k)) this.data.set(k, new Array(this.xs.length - 1).fill(NaN)); } for (const [k, arr] of this.data) arr.push(values[k] ?? NaN); if (this.xs.length > this.capacity) { this.xs.shift(); for (const arr of this.data.values()) arr.shift(); } }
  get length() { return this.xs.length; }
  keys() { return [...this.data.keys()]; }
  series(key: string) { const arr = this.data.get(key); if (!arr) return []; return this.xs.map((x, i) => ({ x, y: arr[i] })); }
  latest(key: string) { const arr = this.data.get(key); return arr && arr.length ? arr[arr.length - 1] : undefined; }
  xRange(): [number, number] { return this.xs.length ? [this.xs[0], this.xs[this.xs.length - 1]] : [0, 0]; }
}
// graph.ts
import type { TimeSeries } from './timeSeries';
export type GraphLine = { key: string; color: string; label: string; axis?: 'left' | 'right' };
export function drawGraph(ctx: CanvasRenderingContext2D, ts: TimeSeries, lines: GraphLine[], markers: { x: number; label: string; color: string }[], w: number, h: number): void {
  ctx.clearRect(0, 0, w, h); const pad = { l: 36, r: 36, t: 18, b: 18 }; const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b; const [x0, x1] = ts.xRange(); const xs = (x: number) => pad.l + (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * iw);
  const range = (axis: 'left' | 'right') => { let lo = Infinity, hi = -Infinity; for (const l of lines) if ((l.axis ?? 'left') === axis) for (const p of ts.series(l.key)) if (Number.isFinite(p.y)) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } if (!Number.isFinite(lo)) return [0, 1] as const; if (hi === lo) hi = lo + 1; return [lo, hi] as const; };
  const rl = range('left'), rr = range('right'); const ys = (v: number, r: readonly [number, number]) => pad.t + ih - ((v - r[0]) / (r[1] - r[0])) * ih;
  ctx.strokeStyle = 'rgba(159,179,194,.25)'; ctx.lineWidth = 1; for (let g = 0; g <= 2; g++) { const y = pad.t + (ih * g) / 2; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
  ctx.fillStyle = '#9FB3C2'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillText(rl[1].toFixed(0), pad.l - 4, pad.t + 4); ctx.fillText(rl[0].toFixed(0), pad.l - 4, pad.t + ih); ctx.textAlign = 'left'; ctx.fillText(`${rr[1].toFixed(1)}℃`, w - pad.r + 4, pad.t + 4); ctx.fillText(`${rr[0].toFixed(1)}℃`, w - pad.r + 4, pad.t + ih);
  ctx.textAlign = 'center'; ctx.fillText(`Y${x0}`, pad.l, h - 4); ctx.fillText(`Y${x1}`, w - pad.r, h - 4);
  for (const m of markers) { if (m.x < x0 || m.x > x1) continue; const x = xs(m.x); ctx.strokeStyle = m.color; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ih); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = m.color; ctx.fillText(m.label, x, pad.t - 6); }
  for (const l of lines) { const r = (l.axis ?? 'left') === 'left' ? rl : rr; ctx.strokeStyle = l.color; ctx.lineWidth = l.axis === 'right' ? 1 : 2; if (l.axis === 'right') ctx.setLineDash([4, 3]); ctx.beginPath(); let first = true; for (const p of ts.series(l.key)) { if (!Number.isFinite(p.y)) continue; const x = xs(p.x), y = ys(p.y, r); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); } ctx.stroke(); ctx.setLineDash([]); }
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(ui): TimeSeries と折れ線グラフ描画`

---

### Task 11: データファイルと AssetTable

**Files:**
- Create: `assets/data/species.json`, `assets/data/world.default.json`, `src/render/assetTable.ts`
- Test: `tests/unit/data.test.ts`

**Interfaces:**
```ts
export type AssetTable = Record<string, { geometry: BufferGeometry; material: Material; scale: number }>;
export function buildAssetTable(species: SpeciesDef[]): AssetTable   // plant: ConeGeometry、herbivore: BoxGeometry、carnivore: 細長い Box。色は def.color
```

- [ ] **Step 1: テスト** `tests/unit/data.test.ts`(JSON が型に合い、World.create できる)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';
describe('assets/data', () => {
  const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
  const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
  it('has two plant species with required fields', () => { expect(species.filter((s) => s.trophic === 'plant').length).toBeGreaterThanOrEqual(2); for (const s of species) { expect(s.id).toBeTruthy(); expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/); expect(s.tempRange[0]).toBeLessThan(s.tempRange[1]); } });
  it('default world runs 20 years with vegetation between 5% and 95%', () => { const w = World.create({ ...base, species }, { log: createMemorySink() }); w.step(360 * 20); const s = w.snapshot(); let land = 0, veg = 0; for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) { land++; veg += s.layers.vegetation[i]; } expect(veg / land).toBeGreaterThan(0.05); expect(veg / land).toBeLessThan(0.95); });
});
```

- [ ] **Step 2: 失敗を確認**、**Step 3: データを書く**

`assets/data/species.json`:
```json
[
  { "id": "grass", "name": "草", "trophic": "plant", "growthRate": 0.04, "mortality": 0.02, "tempRange": [-2, 32], "moistureRange": [0.15, 0.85], "diffusion": 0.05, "assetId": "grass", "color": "#6FBF7C" },
  { "id": "forest", "name": "森", "trophic": "plant", "growthRate": 0.015, "mortality": 0.01, "tempRange": [2, 26], "moistureRange": [0.45, 1.0], "diffusion": 0.02, "assetId": "forest", "color": "#2E6B37" }
]
```
`assets/data/world.default.json`:
```json
{ "seed": 42, "size": 128, "ticksPerYear": 360, "climate": { "seasonAmplitudeTemp": 8, "seasonAmplitudeRain": 0.1, "tempOffset": 0, "rainScale": 1 }, "feedback": { "vegetationToRain": 0.1, "vegetationToTemp": 0, "co2ToTemp": 0, "iceAlbedo": 0 } }
```
`src/render/assetTable.ts`:
```ts
import { BoxGeometry, ConeGeometry, MeshLambertMaterial, type BufferGeometry, type Material } from 'three';
import type { SpeciesDef } from '../simulation/types';
export type AssetTable = Record<string, { geometry: BufferGeometry; material: Material; scale: number }>;
export function buildAssetTable(species: SpeciesDef[]): AssetTable {
  const t: AssetTable = {};
  for (const d of species) { const material = new MeshLambertMaterial({ color: d.color }); const geometry = d.trophic === 'plant' ? new ConeGeometry(0.18, 0.6, 5) : d.trophic === 'herbivore' ? new BoxGeometry(0.3, 0.2, 0.2) : new BoxGeometry(0.4, 0.2, 0.15); t[d.assetId] = { geometry, material, scale: d.id === 'forest' ? 1.6 : 1 }; }
  return t;
}
```

- [ ] **Step 4: 成功を確認**、**Step 5: Commit** `feat(data): 種と世界のデフォルト定義、AssetTable`

---

### Task 12: SceneView(Three.js)

**Files:**
- Create: `src/render/SceneView.ts`

**Interfaces:**
```ts
export type SceneView = { update(s: WorldSnapshot): void; setLayer(l: LayerKind): void; getLayer(): LayerKind; pickCell(clientX: number, clientY: number): number | null; resize(): void; dispose(): void };
export function createSceneView(canvas: HTMLCanvasElement, opts: { assets: AssetTable; size: number; heightScale?: number; maxInstances?: number }): SceneView
```
- 地形: `PlaneGeometry(size, size, size−1, size−1)` を X 軸回転 −90°、頂点 y = `max(e, SEA_LEVEL)·heightScale`(海面は平ら)、`color` 属性を `layerToColors` で毎 update 更新(`needsUpdate`)。
- 植物: 種ごとに `InstancedMesh(geometry, material, maxInstances)`。`scatterInstances` で位置を作り `setMatrixAt`、`count` を更新。`maxPerCell` = 2。
- 海面: 別の平面(y = SEA_LEVEL·heightScale、半透明青)。
- ライト: `HemisphereLight` + `DirectionalLight`。カメラ: `PerspectiveCamera`、`OrbitControls`(`three/addons/controls/OrbitControls.js`)、`target` を島の範囲に clamp、`maxPolarAngle = π/2 − 0.05`。
- `pickCell`: `Raycaster` で地形メッシュに当て、交点の x,z からセル index。
- update は毎フレーム。頂点色の更新は tick が進んだ時だけ(前回 tick を記憶)。
- 単体テスト対象外(E2E で確認)。

- [ ] **Step 1: 実装**

```ts
import { AmbientLight, BufferAttribute, Color, DirectionalLight, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldSnapshot } from '../simulation/types';
import { SEA_LEVEL } from '../simulation/terrain';
import { layerToColors, type LayerKind } from './layerToColors';
import { scatterInstances } from './scatter';
import type { AssetTable } from './assetTable';
export type SceneView = { /* 上記 */ };
export function createSceneView(canvas: HTMLCanvasElement, opts: { assets: AssetTable; size: number; heightScale?: number; maxInstances?: number }): SceneView {
  const size = opts.size, hs = opts.heightScale ?? 12, maxInst = opts.maxInstances ?? 20000;
  const renderer = new WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new Scene(); scene.background = new Color('#1B2B3A');
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000); camera.position.set(0, size * 0.9, size * 0.9);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.05; controls.minDistance = 5; controls.maxDistance = size * 2.5;
  scene.add(new AmbientLight(0xffffff, 0.6)); const sun = new DirectionalLight(0xffffff, 1.2); sun.position.set(size, size, size * 0.5); scene.add(sun);
  const geo = new PlaneGeometry(size, size, size - 1, size - 1); geo.rotateX(-Math.PI / 2); const n = size * size; geo.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3));
  const terrain = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true })); scene.add(terrain);
  const sea = new Mesh(new PlaneGeometry(size * 3, size * 3), new MeshLambertMaterial({ color: '#2E6F9E', transparent: true, opacity: 0.55, side: DoubleSide })); sea.rotateX(-Math.PI / 2); sea.position.y = SEA_LEVEL * hs + 0.02; scene.add(sea);
  const inst: Record<string, InstancedMesh> = {}; for (const [id, a] of Object.entries(opts.assets)) { const m = new InstancedMesh(a.geometry, a.material, maxInst); m.count = 0; m.frustumCulled = false; inst[id] = m; scene.add(m); }
  const pos = new Float32Array(maxInst * 3); const dummy = new Object3D(); const mat = new Matrix4(); void mat;
  let layer: LayerKind = 'terrain', lastTick = -1, lastLayer: LayerKind | null = null; const colorBuf = new Float32Array(n * 3);
  const resize = () => { const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }; resize(); window.addEventListener('resize', resize);
  const clampTarget = () => { const lim = size / 2; controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x)); controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z)); controls.target.y = 0; };
  const update = (s: WorldSnapshot) => {
    if (s.tick !== lastTick || layer !== lastLayer) {
      const p = geo.getAttribute('position') as BufferAttribute; for (let i = 0; i < n; i++) p.setY(i, Math.max(s.layers.elevation[i], SEA_LEVEL) * hs); p.needsUpdate = true; geo.computeVertexNormals();
      (geo.getAttribute('color') as BufferAttribute).set(layerToColors(s, layer, colorBuf)); (geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
      for (const d of s.species) { const m = inst[d.assetId]; if (!m) continue; const a = opts.assets[d.assetId]; const count = scatterInstances(s.layers.populations[d.id], s.layers.elevation, size, 2, 1, pos); for (let k = 0; k < count; k++) { dummy.position.set(pos[k * 3], pos[k * 3 + 1] * hs, pos[k * 3 + 2]); dummy.scale.setScalar(a.scale); dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix); } m.count = count; m.instanceMatrix.needsUpdate = true; }
      lastTick = s.tick; lastLayer = layer;
    }
    clampTarget(); controls.update(); renderer.render(scene, camera);
  };
  const ray = new Raycaster(); const ndc = new Vector2();
  const pickCell = (cx: number, cy: number) => { const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const hit = ray.intersectObject(terrain, false)[0]; if (!hit) return null; const x = Math.floor(hit.point.x + size / 2), y = Math.floor(hit.point.z + size / 2); if (x < 0 || y < 0 || x >= size || y >= size) return null; return y * size + x; };
  return { update, setLayer: (l) => { layer = l; }, getLayer: () => layer, pickCell, resize, dispose: () => { window.removeEventListener('resize', resize); controls.dispose(); renderer.dispose(); geo.dispose(); } };
}
```
※ `PlaneGeometry` の頂点順は行優先(y=0 が奥)なので、`pickCell` の z→y 対応が上下反転していたら `size − 1 − y` に直す。E2E スモーク時に手動で確認。

- [ ] **Step 2: `npm run typecheck` と `npm run lint` が通ることを確認**
- [ ] **Step 3: Commit** `feat(render): SceneView(地形メッシュ・頂点色・インスタンス・オービット)`

---

### Task 13: Hud

**Files:**
- Create: `src/ui/Hud.ts`, `src/ui/hud.css`

**Interfaces:**
```ts
export type HudHandlers = { onCommand(cmd: Command): void; onSpeed(s: Speed): void; onLayer(l: LayerKind): void; onSave(): SaveData; onLoad(save: SaveData): void; onDisasterArm(kind: DisasterKind | null): void };
export type Hud = { update(s: WorldSnapshot): void; showCell(cell: number | null, s: WorldSnapshot): void; addMarker(x: number, label: string, color: string): void; setArmed(kind: DisasterKind | null): void };
export function createHud(root: HTMLElement, handlers: HudHandlers): Hud
```
- 要素(すべて `id` 付き): `#hud-year`, `#hud-season`, `#speed-0/1/10/100`, `#layer-terrain/...`, `#graph`(canvas 640×200 論理)、`#temp-offset`(range −10..10 step 0.5)、`#rain-scale`(range 0.3..2 step 0.1)、`#disaster-meteor/volcano/wildfire/plague`(押すと「次に島をクリックした場所に落とす」armed 状態)、`#cell-panel`、`#save-btn`、`#load-input`(file)。
- update: 年・季節(dayOfYear を 4 分割: 春夏秋冬)、年が変わったら `TimeSeries.push(year, {...totals, temp: meanTemperature})` しグラフ再描画。グラフ線は種ごとに `color`、平均気温は右軸。
- save: `JSON.stringify(handlers.onSave())` を Blob にして `<a download>` クリック。load: `FileReader` で読み `handlers.onLoad(JSON.parse(...))`。
- 単体テスト対象外(TimeSeries は Task 10 で済み)。

- [ ] **Step 1: 実装**(`hud.css` は最小限: 半透明の暗いパネル、固定配置。左上 HUD、右上レイヤー、右グラフ、下ツールバー、左下セル詳細)

```ts
import type { Command, DisasterKind, SaveData, WorldSnapshot } from '../simulation/types';
import type { Speed } from '../core/runner';
import type { LayerKind } from '../render/layerToColors';
import { TimeSeries } from './timeSeries';
import { drawGraph, type GraphLine } from './graph';
import { SEA_LEVEL } from '../simulation/terrain';
import './hud.css';
export type HudHandlers = { /* 上記 */ }; export type Hud = { /* 上記 */ };
const SEASONS = ['春', '夏', '秋', '冬'];
const SPEEDS: Speed[] = [0, 1, 10, 100];
const DISASTERS: { kind: DisasterKind; label: string }[] = [{ kind: 'meteor', label: '隕石' }, { kind: 'volcano', label: '火山' }, { kind: 'wildfire', label: '山火事' }, { kind: 'plague', label: '疫病' }];
export function createHud(root: HTMLElement, h: HudHandlers): Hud {
  root.insertAdjacentHTML('beforeend', `
  <div class="hud hud-tl"><div><span id="hud-year" class="mono">Year 0</span> <span id="hud-season" class="dim">春 · Day 0</span></div>
    <div class="row" id="speed-row">${SPEEDS.map((s) => `<button id="speed-${s}" class="chip${s === 1 ? ' on' : ''}">${s === 0 ? '⏸' : s + 'x'}</button>`).join('')}</div></div>
  <div class="hud hud-tr row" id="layer-row"><button id="layer-terrain" class="chip on">地形</button><button id="layer-temperature" class="chip">気温</button><button id="layer-moisture" class="chip">降水</button><button id="layer-vegetation" class="chip">植生</button><span id="layer-species"></span></div>
  <div class="hud hud-r"><div class="dim">個体数の推移</div><canvas id="graph" width="640" height="200"></canvas><div id="legend" class="row"></div>
    <div class="stats"><span id="stat-temp" class="mono">--℃</span><span class="dim">平均気温</span><span id="stat-veg" class="mono">--%</span><span class="dim">植生率</span></div></div>
  <div class="hud hud-b">
    <label>気温 <input id="temp-offset" type="range" min="-10" max="10" step="0.5" value="0"><span id="temp-offset-v" class="mono">+0.0</span></label>
    <label>降水 <input id="rain-scale" type="range" min="0.3" max="2" step="0.1" value="1"><span id="rain-scale-v" class="mono">×1.0</span></label>
    <span class="sep"></span>${DISASTERS.map((d) => `<button id="disaster-${d.kind}" class="chip">${d.label}</button>`).join('')}
    <span class="sep"></span><button id="save-btn" class="chip">保存</button><label class="chip">読込<input id="load-input" type="file" accept="application/json" hidden></label></div>
  <div class="hud hud-bl" id="cell-panel" hidden></div>`);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const ts = new TimeSeries(500); const markers: { x: number; label: string; color: string }[] = []; let lines: GraphLine[] = []; let lastYear = -1; let armed: DisasterKind | null = null;
  const setOn = (rowId: string, id: string) => { for (const b of $(rowId).querySelectorAll('.chip')) b.classList.toggle('on', b.id === id); };
  for (const s of SPEEDS) $(`speed-${s}`).addEventListener('click', () => { h.onSpeed(s); setOn('speed-row', `speed-${s}`); });
  for (const l of ['terrain', 'temperature', 'moisture', 'vegetation'] as const) $(`layer-${l}`).addEventListener('click', () => { h.onLayer(l); setOn('layer-row', `layer-${l}`); });
  const tempEl = $<HTMLInputElement>('temp-offset'), rainEl = $<HTMLInputElement>('rain-scale');
  tempEl.addEventListener('input', () => { const v = Number(tempEl.value); $('temp-offset-v').textContent = (v >= 0 ? '+' : '') + v.toFixed(1); h.onCommand({ type: 'set_climate', tempOffset: v }); });
  rainEl.addEventListener('input', () => { const v = Number(rainEl.value); $('rain-scale-v').textContent = '×' + v.toFixed(1); h.onCommand({ type: 'set_climate', rainScale: v }); });
  const setArmed = (k: DisasterKind | null) => { armed = k; for (const d of DISASTERS) $(`disaster-${d.kind}`).classList.toggle('armed', d.kind === k); h.onDisasterArm(k); };
  for (const d of DISASTERS) $(`disaster-${d.kind}`).addEventListener('click', () => setArmed(armed === d.kind ? null : d.kind));
  $('save-btn').addEventListener('click', () => { const blob = new Blob([JSON.stringify(h.onSave())], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `biotope-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href); });
  $<HTMLInputElement>('load-input').addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; f.text().then((t) => h.onLoad(JSON.parse(t) as SaveData)); });
  const canvas = $<HTMLCanvasElement>('graph'); const ctx = canvas.getContext('2d')!;
  const redraw = () => drawGraph(ctx, ts, lines, markers, canvas.width, canvas.height);
  const ensureSpecies = (s: WorldSnapshot) => { if (lines.length === s.species.length + 1) return; lines = [...s.species.map((d) => ({ key: d.id, color: d.color, label: d.name })), { key: 'temp', color: '#A79CE0', label: '平均気温', axis: 'right' as const }]; $('legend').innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join(''); $('layer-species').innerHTML = s.species.map((d) => `<button id="layer-species-${d.id}" class="chip">${d.name}</button>`).join(''); for (const d of s.species) $(`layer-species-${d.id}`).addEventListener('click', () => { h.onLayer(`species:${d.id}`); setOn('layer-row', `layer-species-${d.id}`); }); };
  const vegRatio = (s: WorldSnapshot) => { let land = 0, v = 0; for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= SEA_LEVEL) { land++; v += s.layers.vegetation[i]; } return land ? v / land : 0; };
  const update = (s: WorldSnapshot) => { ensureSpecies(s); $('hud-year').textContent = `Year ${s.year}`; $('hud-season').textContent = `${SEASONS[Math.floor((s.dayOfYear / 360) * 4) % 4]} · Day ${s.dayOfYear}`; if (s.year !== lastYear) { lastYear = s.year; ts.push(s.year, { ...s.totals, temp: s.meanTemperature }); redraw(); $('stat-temp').textContent = `${s.meanTemperature.toFixed(1)}℃`; $('stat-veg').textContent = `${(vegRatio(s) * 100).toFixed(0)}%`; } };
  const showCell = (cell: number | null, s: WorldSnapshot) => { const p = $('cell-panel'); if (cell === null) { p.hidden = true; return; } const x = cell % s.size, y = (cell - x) / s.size; const L = s.layers; const sea = L.elevation[cell] < SEA_LEVEL; p.hidden = false; p.innerHTML = `<div class="mono">セル (${x}, ${y}) ${sea ? '· 海' : ''}</div><div>標高 <span class="mono">${Math.round(L.elevation[cell] * 1000)} m</span></div><div>気温 / 水分 <span class="mono">${L.temperature[cell].toFixed(1)}℃ / ${L.moisture[cell].toFixed(2)}</span></div>${s.species.map((d) => `<div>${d.name} <span class="mono">${L.populations[d.id][cell].toFixed(2)}</span></div>`).join('')}`; };
  return { update, showCell, addMarker: (x, label, color) => { markers.push({ x, label, color }); redraw(); }, setArmed };
}
```

`hud.css`:
```css
.hud{position:absolute;background:rgba(15,26,36,.85);color:#E9EFF3;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.5;pointer-events:auto}
.hud-tl{top:12px;left:12px}.hud-tr{top:12px;right:12px}.hud-r{top:64px;right:12px;width:320px}.hud-b{bottom:12px;left:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:calc(100% - 24px)}.hud-bl{bottom:80px;left:12px;min-width:200px}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.mono{font-family:ui-monospace,monospace}.dim{color:#9FB3C2;font-size:12px}.sep{width:1px;height:20px;background:#33475A}
.chip{background:#233544;color:#9FB3C2;border:0;border-radius:10px;padding:2px 10px;font-size:12px;cursor:pointer}.chip.on{background:#3C7A4E;color:#fff}.chip.armed{background:#B5502F;color:#fff}
.hud-r canvas{width:320px;height:100px;display:block;margin:4px 0}#legend span{margin-right:10px;font-size:11px;color:#9FB3C2}#legend i{display:inline-block;width:10px;height:3px;margin-right:4px;vertical-align:middle}
.stats{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2px 8px;align-items:baseline;margin-top:4px}
.hud-b label{display:flex;gap:6px;align-items:center;font-size:12px}.hud-b input[type=range]{width:110px}
```

- [ ] **Step 2: typecheck + lint**、**Step 3: Commit** `feat(ui): Hud(速度・レイヤー・グラフ・気候・災害・保存)`

---

### Task 14: main.ts 配線

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 実装**

```ts
import { World } from './simulation/World';
import type { SaveData, SpeciesDef, WorldConfig, DisasterKind } from './simulation/types';
import { createConsoleSink } from './core/log/consoleSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';
async function boot() {
  const [base, species] = await Promise.all([fetch('/data/world.default.json').then((r) => r.json() as Promise<Omit<WorldConfig, 'species'>>), fetch('/data/species.json').then((r) => r.json() as Promise<SpeciesDef[]>)]);
  const config: WorldConfig = { ...base, species }; const log = createConsoleSink();
  let world = World.create(config, { log });
  const canvas = document.getElementById('scene') as HTMLCanvasElement; const app = document.getElementById('app')!;
  let view: SceneView = createSceneView(canvas, { assets: buildAssetTable(species), size: config.size });
  let armed: DisasterKind | null = null; let selected: number | null = null;
  const hud = createHud(app, {
    onCommand: (c) => world.dispatch(c), onSpeed: (s) => runner.setSpeed(s), onLayer: (l) => view.setLayer(l), onSave: () => world.serialize(),
    onLoad: (save: SaveData) => { world = World.restore(save, { log }); if (save.config.size !== config.size) { view.dispose(); view = createSceneView(canvas, { assets: buildAssetTable(save.config.species), size: save.config.size }); } },
    onDisasterArm: (k) => { armed = k; },
  });
  const runner = createRunner({ step: (n) => world.step(n), snapshot: () => world.snapshot() }, { onFrame: (s) => { view.update(s); hud.update(s); if (selected !== null) hud.showCell(selected, s); } });
  canvas.addEventListener('click', (e) => { const cell = view.pickCell(e.clientX, e.clientY); if (cell === null) return; if (armed) { const s = world.snapshot(); world.dispatch({ type: 'disaster', kind: armed, cell, radius: armed === 'wildfire' ? 0 : 4 }); hud.addMarker(s.year, armed, '#E07A55'); hud.setArmed(null); armed = null; return; } selected = cell; hud.showCell(cell, world.snapshot()); });
  runner.start();
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">${String(e)}</pre>`); });
```

- [ ] **Step 2: `npm run dev` で起動し、島が見え、1x で季節が進み、グラフに点が増えることを目視**。上下反転があれば SceneView の `pickCell` を修正。
- [ ] **Step 3: `npm run check`**、**Step 4: Commit** `feat: main.ts で World/Runner/SceneView/Hud を配線`

---

### Task 15: E2E スモーク(Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`
- Modify: `package.json`(`"test:e2e": "playwright test"`)

- [ ] **Step 1: 導入** `npm i -D @playwright/test && npx playwright install chromium`
- [ ] **Step 2: 設定**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', timeout: 60_000, use: { baseURL: 'http://localhost:5173', headless: true }, webServer: { command: 'npm run dev -- --port 5173', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 30_000 } });
```

- [ ] **Step 3: テスト**

```ts
import { test, expect } from '@playwright/test';
test('boots, advances a year at 100x, graph shows values, layer switch works', async ({ page }) => {
  const logs: string[] = []; page.on('console', (m) => logs.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 20_000 });
  await expect(page.locator('#stat-veg')).not.toHaveText('--%');
  await page.click('#layer-temperature');
  await expect(page.locator('#layer-temperature')).toHaveClass(/on/);
  const summaries = logs.filter((l) => l.includes('"event":"sim.tick.summary"'));
  expect(summaries.length).toBeGreaterThanOrEqual(1);
  expect(JSON.parse(summaries[0])).toMatchObject({ event: 'sim.tick.summary', year: 1 });
});
```

- [ ] **Step 4: `npm run test:e2e` が通ることを確認**、**Step 5: Commit** `test(e2e): 起動→1 年進行→グラフ更新のスモーク`

---

### Task 16: README と受入証跡

**Files:**
- Modify: `README.md`(起動方法、`npm run check`、フォルダ構成の更新)
- Modify: `docs/specs/2026-09-19-ecosystem-sim-design.md` §6 M1 の表に commit SHA を追記

- [ ] **Step 1: README に「開発」節を追加**(`npm i`、`npm run dev`、`npm run check`、`npm run test:e2e`)
- [ ] **Step 2: 設計書 §6 M1 の各行に証跡の commit SHA を追記**(`git log --oneline` から)
- [ ] **Step 3: Commit** `docs: M1 の起動手順と受入証跡`

---

## Self-Review

- **Spec coverage(M1 受入基準)**: 100 年 NaN なし/植生 [0,1] → Task 7 properties。決定論 → Task 7 determinism。係数 0 で年平均一致 → Task 7 properties。disaster で植生低下 → Task 7 commands。serialize/restore → Task 7 save。年 1 回 summary → Task 7 log。layerToColors 長さ → Task 9。TimeSeries 上限 → Task 10。E2E → Task 15。ESLint/tsc → Task 1 `npm run check`。
- **設計書との差分**: `SpeciesDef` に `name` と `color` を追加(UI とレイヤー着色に必要)。`WorldSnapshot` に `species` を追加(描画側が種一覧を得るため)。`HudHandlers` に `onDisasterArm` を追加(災害の「次のクリックで落とす」状態のため)。設計書 §4 に反映すること(Task 16 で追記)。
- **型の一貫性**: `LayerKind` は `render/layerToColors.ts` で定義し Hud/SceneView が import。`Speed` は `core/runner.ts` で定義。`SEA_LEVEL` は `simulation/terrain.ts` のみで定義。
