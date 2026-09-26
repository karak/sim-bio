import { fail, isObject, type ParseError, type Parsed } from '../core/parse';
import type { ScenarioStatus } from '../scenario/types';
import type { Command, DisasterKind } from '../simulation/types';

/**
 * 年代記の契約 (M19-06、設計書 2026-09-26-cloudflare-architecture.md §5.1・§5.2)。
 * 港の契約 (M19-07) が src/harbor/contract.ts へ移すまで、ここに置く。依存は core/parse と本体の型だけにしてある
 */

/** 見守り手が UI から打ち、受理された命令。予言が出す命令 (fromStar:false) は含めない (再生で同じ ScenarioRunner が再現する) */
export type TimedCommand = { tick: number; command: Command };

/** 年ごとの種の総数 (折れ線用)。間引いて YEARLY_POINTS 点まで */
export type YearlyTotals = Readonly<Record<string, number>>;

export type ChronicleHead = { simVersion: string; scenarioId: string; seed: number };

export type Chronicle = ChronicleHead & {
  /** 不変条件: tick は単調非減少、長さ ≤ CHRONICLE_LIMITS.maxCommands */
  commands: readonly TimedCommand[];
  yearly: readonly YearlyTotals[];
};

/** 結末の要約。hash は hash を除いた 4 つの正規化 JSON の SHA-256。照合はこれ 1 つを比べる */
export type Digest = {
  year: number;
  verdict: Exclude<ScenarioStatus, 'running'>;
  totals: Readonly<Record<string, number>>;
  extinct: readonly string[];
  hash: string;
};

/**
 * 再生の結末。例外を投げず kind で返す。
 * broken は年代記そのものの誤り (形・tick の逆行と上限・再生で弾かれた命令・判定が出ない)、crashed は再生の側の失敗 (Worker が落ちた・本体が投げた)
 */
export type ReplayOutcome =
  | { kind: 'done'; digest: Digest }
  | { kind: 'broken'; error: ParseError }
  | { kind: 'other_version'; simVersion: string }
  | { kind: 'aborted' }
  | { kind: 'crashed'; reason: string };

export type ChronicleLimits = { maxCommands: number };
export const CHRONICLE_LIMITS: ChronicleLimits = { maxCommands: 4000 };
/** 折れ線の点の数の上限。300 年でも 10 種 × 48 点ほどで 5 KB に収まる */
export const YEARLY_POINTS = 48;
const MAX_SPECIES = 32;
/** 半径は referenceSize (128) 基準。島より大きい環は要らない。大きすぎる値は 1 回の適用で重くなる */
const MAX_RADIUS = 128;
const MAX_AMOUNT = 10;

const DISASTER_KINDS: readonly DisasterKind[] = ['meteor', 'volcano', 'wildfire', 'plague'];
const EDICTS = ['stop_mining', 'resume_mining'] as const;

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_-]{1,40}$/.test(v);
const optionalFinite = (o: Record<string, unknown>, key: string): { ok: true; value?: number } | { ok: false } => {
  if (o[key] === undefined) return { ok: true };
  return isFiniteNumber(o[key]) ? { ok: true, value: o[key] } : { ok: false };
};

/**
 * 見守り手が UI から打てる命令だけを読む。sink・tower_power は予言と力の自動処理が出すので年代記には来ない。
 * 知らない鍵は落として作り直す (年代記の id が同じ中身で同じになるように)
 */
function parseCommand(v: unknown, path: string): Parsed<Command> {
  if (!isObject(v)) return fail(path, 'not_object');
  switch (v.type) {
    case 'spawn_species': {
      if (!isId(v.speciesId)) return fail(`${path}.speciesId`, 'invalid');
      if (!isInt(v.cell, -1)) return fail(`${path}.cell`, 'invalid');
      if (!isFiniteNumber(v.amount) || v.amount <= 0 || v.amount > MAX_AMOUNT) return fail(`${path}.amount`, 'invalid');
      if (v.radius !== undefined && !isInt(v.radius, 0, MAX_RADIUS)) return fail(`${path}.radius`, 'invalid');
      const radius = v.radius === undefined ? {} : { radius: v.radius };
      return { ok: true, value: { type: 'spawn_species', speciesId: v.speciesId, cell: v.cell, amount: v.amount, ...radius } };
    }
    case 'set_climate': {
      const t = optionalFinite(v, 'tempOffset');
      const r = optionalFinite(v, 'rainScale');
      if (!t.ok) return fail(`${path}.tempOffset`, 'invalid');
      if (!r.ok) return fail(`${path}.rainScale`, 'invalid');
      return { ok: true, value: { type: 'set_climate', ...(t.value === undefined ? {} : { tempOffset: t.value }), ...(r.value === undefined ? {} : { rainScale: r.value }) } };
    }
    case 'disaster': {
      const kind = DISASTER_KINDS.find((k) => k === v.kind);
      if (!kind) return fail(`${path}.kind`, 'invalid');
      if (!isInt(v.cell, -1)) return fail(`${path}.cell`, 'invalid');
      if (!isInt(v.radius, 0, MAX_RADIUS)) return fail(`${path}.radius`, 'invalid');
      return { ok: true, value: { type: 'disaster', kind, cell: v.cell, radius: v.radius } };
    }
    case 'civ_edict': {
      const edict = EDICTS.find((e) => e === v.edict);
      return edict ? { ok: true, value: { type: 'civ_edict', edict } } : fail(`${path}.edict`, 'invalid');
    }
    case 'build_tower': {
      if (!isInt(v.cell, -1)) return fail(`${path}.cell`, 'invalid');
      const t = optionalFinite(v, 'tempOffset');
      const r = optionalFinite(v, 'rainScale');
      if (!t.ok) return fail(`${path}.tempOffset`, 'invalid');
      if (!r.ok) return fail(`${path}.rainScale`, 'invalid');
      return { ok: true, value: { type: 'build_tower', cell: v.cell, ...(t.value === undefined ? {} : { tempOffset: t.value }), ...(r.value === undefined ? {} : { rainScale: r.value }) } };
    }
    case 'intercept':
      return { ok: true, value: { type: 'intercept' } };
    case 'launch_ship':
      return { ok: true, value: { type: 'launch_ship' } };
    default:
      return fail(`${path}.type`, 'unknown_command');
  }
}

function parseYearly(v: unknown): Parsed<YearlyTotals[]> {
  if (!Array.isArray(v)) return fail('yearly', 'not_array');
  if (v.length > YEARLY_POINTS) return fail('yearly', 'too_long');
  const out: YearlyTotals[] = [];
  for (const [i, row] of v.entries()) {
    if (!isObject(row)) return fail(`yearly[${i}]`, 'not_object');
    const entries = Object.entries(row);
    if (entries.length > MAX_SPECIES) return fail(`yearly[${i}]`, 'too_many_species');
    const totals: Record<string, number> = {};
    for (const [id, n] of entries) {
      if (!isId(id)) return fail(`yearly[${i}]`, 'invalid_species');
      if (!isFiniteNumber(n) || n < 0) return fail(`yearly[${i}].${id}`, 'invalid');
      totals[id] = n;
    }
    out.push(totals);
  }
  return { ok: true, value: out };
}

/** 境界 (IndexedDB から読んだ値・港から引いた値・Worker へ渡す値) で unknown を年代記に読む。tick の逆行と長すぎはここで弾く */
export function parseChronicle(input: unknown, limits: ChronicleLimits = CHRONICLE_LIMITS): Parsed<Chronicle> {
  if (!isObject(input)) return fail('', 'not_object');
  const { simVersion, scenarioId, seed } = input;
  if (typeof simVersion !== 'string' || simVersion.length === 0 || simVersion.length > 16) return fail('simVersion', 'invalid');
  if (!isId(scenarioId)) return fail('scenarioId', 'invalid');
  if (!isInt(seed, Number.MIN_SAFE_INTEGER)) return fail('seed', 'invalid');
  if (!Array.isArray(input.commands)) return fail('commands', 'not_array');
  if (input.commands.length > limits.maxCommands) return fail('commands', 'too_long');
  const commands: TimedCommand[] = [];
  let last = 0;
  for (const [i, row] of input.commands.entries()) {
    const path = `commands[${i}]`;
    if (!isObject(row)) return fail(path, 'not_object');
    if (!isInt(row.tick, 0)) return fail(`${path}.tick`, 'invalid');
    if (row.tick < last) return fail(`${path}.tick`, 'not_monotonic');
    last = row.tick;
    const command = parseCommand(row.command, `${path}.command`);
    if (!command.ok) return command;
    commands.push({ tick: row.tick, command: command.value });
  }
  const yearly = parseYearly(input.yearly);
  if (!yearly.ok) return yearly;
  return { ok: true, value: { simVersion, scenarioId, seed, commands, yearly: yearly.value } };
}
