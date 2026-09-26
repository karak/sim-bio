import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson, digestOf } from '../../src/chronicle/digest';
import {
  HARBOR_LIMITS,
  chronicleId,
  parseCard,
  parseCargo,
  parseDigest,
  parsePublicChronicle,
  type ChronicleCard,
  type ChronicleId,
  type HarborCatalog,
  type InscriptionId,
} from '../../src/harbor/contract';
import { CHRONICLE_LIMITS, parseChronicle, type Chronicle } from '../../src/harbor/chronicle';
import { FIXTURE_CHRONICLE, FIXTURE_CHRONICLE_ID } from '../fixtures/chronicle';

const ids = (file: string) => new Set((JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]).map((d) => d.id));
const catalog: HarborCatalog = { scenarios: ids('assets/data/scenarios.json'), species: ids('assets/data/species.json'), inscriptions: new Set(['still-here', 'we-tried']) };

const bytes = (c: Chronicle) => new TextEncoder().encode(canonicalJson(c)).length;
const refused = <T>(p: { ok: true; value: T } | { ok: false; error: { path: string; reason: string } }) => {
  if (p.ok) throw new Error(`受け入れてしまった: ${JSON.stringify(p.value)}`);
  return p.error;
};
/** 放流を n 件積んだ年代記 (1 件 90 B ほど) */
const withSpawns = (n: number): Chronicle => ({
  ...FIXTURE_CHRONICLE,
  commands: Array.from({ length: n }, (_, i) => ({ tick: i, command: { type: 'spawn_species', speciesId: 'deer', cell: 1000 + i, amount: 0.5, radius: 1 } })),
});

describe('chronicleId (M19-07): 同じ年代記は同じ id', () => {
  it('JSON の往復・鍵の順・知らない鍵を経ても同じ id になり、固定の年代記は golden の id になる', async () => {
    const reordered = JSON.parse(JSON.stringify({ yearly: FIXTURE_CHRONICLE.yearly, commands: FIXTURE_CHRONICLE.commands, seed: 42, scenarioId: 'sinking', simVersion: '1', extra: 'x' }));
    const parsed = parseChronicle(reordered);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const id = await chronicleId(FIXTURE_CHRONICLE);
    expect(await chronicleId(parsed.value)).toBe(id);
    expect(id, `golden の id: '${id}'`).toBe(FIXTURE_CHRONICLE_ID);
  });

  it('値が undefined の鍵は無い鍵と同じに扱う (記録器の命令と、JSON を往復した命令が同じ id になる)', async () => {
    const recorded: Chronicle = { ...FIXTURE_CHRONICLE, commands: [{ tick: 0, command: { type: 'set_climate', rainScale: 1.25, tempOffset: undefined } }, ...FIXTURE_CHRONICLE.commands.slice(1)] };
    expect(await chronicleId(recorded)).toBe(await chronicleId(JSON.parse(JSON.stringify(recorded))));
    expect(await chronicleId(recorded)).toBe(FIXTURE_CHRONICLE_ID);
  });

  it('中身が 1 か所でも違えば id が変わる (seed・命令の tick・命令の値・系列)', async () => {
    const variants: Chronicle[] = [
      { ...FIXTURE_CHRONICLE, seed: 43 },
      { ...FIXTURE_CHRONICLE, commands: [{ ...FIXTURE_CHRONICLE.commands[0], tick: 1 }, ...FIXTURE_CHRONICLE.commands.slice(1)] },
      { ...FIXTURE_CHRONICLE, commands: [{ tick: 0, command: { type: 'set_climate', rainScale: 1.26 } }, ...FIXTURE_CHRONICLE.commands.slice(1)] },
      { ...FIXTURE_CHRONICLE, yearly: [{ deer: 1 }] },
    ];
    const all = await Promise.all([FIXTURE_CHRONICLE, ...variants].map(chronicleId));
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parsePublicChronicle (M19-07): 港に出せる年代記', () => {
  it('固定の年代記を受け、parseChronicle と同じ中身に作り直す', () => {
    expect(parsePublicChronicle({ ...FIXTURE_CHRONICLE, extra: 1 }, catalog)).toEqual({ ok: true, value: FIXTURE_CHRONICLE });
  });

  it('カタログに無い石板・種 (放流の種と系列の鍵) は、id の形でも自由文として弾く', () => {
    expect(refused(parsePublicChronicle({ ...FIXTURE_CHRONICLE, scenarioId: 'my-lovely-island' }, catalog))).toEqual({ path: 'scenarioId', reason: 'unknown_scenario' });
    const spawn = { tick: 0, command: { type: 'spawn_species', speciesId: 'visit_my_site', cell: 1, amount: 1 } };
    expect(refused(parsePublicChronicle({ ...FIXTURE_CHRONICLE, commands: [spawn] }, catalog))).toEqual({ path: 'commands[0].command.speciesId', reason: 'unknown_species' });
    expect(refused(parsePublicChronicle({ ...FIXTURE_CHRONICLE, yearly: [{ deer: 1 }, { deer: 1, hello_world: 2 }] }, catalog))).toEqual({ path: 'yearly[1].hello_world', reason: 'unknown_species' });
  });

  it('公開の面に出る版は数字と点だけ (手元の parseChronicle は 16 文字までの文字列を読む)', () => {
    const worded = { ...FIXTURE_CHRONICLE, simVersion: 'hello' };
    expect(parseChronicle(worded).ok).toBe(true);
    expect(refused(parsePublicChronicle(worded, catalog))).toEqual({ path: 'simVersion', reason: 'invalid' });
    expect(parsePublicChronicle({ ...FIXTURE_CHRONICLE, simVersion: '2.10' }, catalog).ok).toBe(true);
  });

  it('形の拒否は parseChronicle と同じ場所と理由で返す', () => {
    const back = { ...FIXTURE_CHRONICLE, commands: [FIXTURE_CHRONICLE.commands[1], FIXTURE_CHRONICLE.commands[0]] };
    expect(refused(parsePublicChronicle(back, catalog))).toEqual({ path: 'commands[1].tick', reason: 'not_monotonic' });
    expect(refused(parsePublicChronicle('chronicle', catalog))).toEqual({ path: '', reason: 'not_object' });
  });

  it('正規化 JSON の UTF-8 の大きさは上限ちょうどまで受け、1 B 越えれば too_large', () => {
    const size = bytes(FIXTURE_CHRONICLE);
    expect(parsePublicChronicle(FIXTURE_CHRONICLE, catalog, { chronicleBytes: size }).ok).toBe(true);
    expect(refused(parsePublicChronicle(FIXTURE_CHRONICLE, catalog, { chronicleBytes: size - 1 }))).toEqual({ path: '', reason: 'too_large' });
  });

  it(`既定の上限は ${HARBOR_LIMITS.chronicleBytes} B。手元では読める長さ (${CHRONICLE_LIMITS.maxCommands} 件以内) でも、越えれば港には出せない`, () => {
    const big = withSpawns(200);
    expect(bytes(big)).toBeGreaterThan(HARBOR_LIMITS.chronicleBytes);
    expect(parseChronicle(big).ok).toBe(true);
    expect(refused(parsePublicChronicle(big, catalog))).toEqual({ path: '', reason: 'too_large' });
    const fits = withSpawns(100);
    expect(bytes(fits)).toBeLessThanOrEqual(HARBOR_LIMITS.chronicleBytes);
    expect(parsePublicChronicle(fits, catalog).ok).toBe(true);
  });
});

describe('parseDigest (M19-07)', () => {
  it('digestOf の結末の要約を受ける (年 0 も)', async () => {
    for (const d of [await digestOf({ year: 3, totals: { deer: 12.5, wolf: 0 } }, 'alive'), await digestOf({ year: 0, totals: {} }, 'escaped')]) {
      expect(parseDigest(JSON.parse(JSON.stringify(d)), catalog)).toEqual({ ok: true, value: d });
    }
  });

  it('判定・年・総数・絶滅・hash の誤りを、場所を付けて弾く', async () => {
    const d = await digestOf({ year: 3, totals: { deer: 12.5, wolf: 0 } }, 'dead');
    const cases: [unknown, string, string][] = [
      [null, 'digest', 'not_object'],
      [{ ...d, verdict: 'running' }, 'digest.verdict', 'invalid'],
      [{ ...d, year: 1.5 }, 'digest.year', 'invalid'],
      [{ ...d, year: -1 }, 'digest.year', 'invalid'],
      [{ ...d, totals: { deer: -1 } }, 'digest.totals.deer', 'invalid'],
      [{ ...d, totals: { deer: Infinity } }, 'digest.totals.deer', 'invalid'],
      [{ ...d, totals: { deer: 1, 'free text': 2 } }, 'digest.totals.free text', 'unknown_species'],
      [{ ...d, extinct: [] }, 'digest.extinct', 'inconsistent'],
      [{ ...d, extinct: ['wolf', 'deer'] }, 'digest.extinct', 'inconsistent'],
      [{ ...d, hash: 'not-a-hash' }, 'digest.hash', 'invalid'],
      [{ ...d, hash: d.hash.toUpperCase() }, 'digest.hash', 'invalid'],
    ];
    for (const [input, path, reason] of cases) expect(refused(parseDigest(input, catalog)), JSON.stringify(input)).toEqual({ path, reason });
  });
});

describe('parseCargo (M19-07): 積荷は 1〜5 件、量は (0, 10]、種はカタログのみ', () => {
  const item = (speciesId: string, amount: number) => ({ speciesId, amount });
  const five = ['grass', 'deer', 'rabbit', 'wolf', 'moss'];

  it('1 件と 5 件、量の上限ちょうど (10) と、ごく小さい正の量を受ける。知らない鍵は落とす', () => {
    expect(parseCargo({ items: [item('deer', 10)] }, catalog)).toEqual({ ok: true, value: { items: [item('deer', 10)] } });
    expect(parseCargo({ items: five.map((s) => item(s, Number.MIN_VALUE)) }, catalog)).toEqual({ ok: true, value: { items: five.map((s) => item(s, Number.MIN_VALUE)) } });
    expect(parseCargo({ items: [{ ...item('wolf', 1), note: 'hi' }], note: 'hi' }, catalog)).toEqual({ ok: true, value: { items: [item('wolf', 1)] } });
  });

  it('0 件と 6 件は弾く', () => {
    expect(refused(parseCargo({ items: [] }, catalog))).toEqual({ path: 'cargo.items', reason: 'empty' });
    expect(refused(parseCargo({ items: [...five, 'forest'].map((s) => item(s, 1)) }, catalog))).toEqual({ path: 'cargo.items', reason: 'too_many' });
  });

  it('量の境界: 0・負・10 を越える・数でないものは弾く', () => {
    for (const amount of [0, -1, 10.000001, 11, NaN, Infinity, '5', null]) {
      expect(refused(parseCargo({ items: [{ speciesId: 'deer', amount }] }, catalog)), String(amount)).toEqual({ path: 'cargo.items[0].amount', reason: 'invalid' });
    }
  });

  it('カタログに無い種・自由文・同じ種の重ねは弾く', () => {
    expect(refused(parseCargo({ items: [item('dragon', 1)] }, catalog))).toEqual({ path: 'cargo.items[0].speciesId', reason: 'unknown_species' });
    expect(refused(parseCargo({ items: [item('buy cheap pills at example.com', 1)] }, catalog))).toEqual({ path: 'cargo.items[0].speciesId', reason: 'unknown_species' });
    expect(refused(parseCargo({ items: [item('deer', 10), item('deer', 10)] }, catalog))).toEqual({ path: 'cargo.items[1].speciesId', reason: 'duplicate_species' });
  });

  it('形の誤り (object でない・items が配列でない・品が object でない)', () => {
    expect(refused(parseCargo([], catalog))).toEqual({ path: 'cargo', reason: 'not_object' });
    expect(refused(parseCargo({ items: { deer: 1 } }, catalog))).toEqual({ path: 'cargo.items', reason: 'not_array' });
    expect(refused(parseCargo({ items: ['deer'] }, catalog))).toEqual({ path: 'cargo.items[0]', reason: 'not_object' });
  });
});

describe('parseCard (M19-07): 一覧の 1 件に自由文は無い', () => {
  const card: ChronicleCard = {
    id: FIXTURE_CHRONICLE_ID as ChronicleId,
    simVersion: '1',
    scenarioId: 'sinking',
    seed: 42,
    inscription: 'still-here' as InscriptionId,
    verdict: 'alive',
    year: 300,
    publishedAt: 1_790_000_000_000,
    confirms: 0,
    mismatches: 3,
  };

  it('カードを受け、知らない鍵 (名前・ひとことの自由文) は落とす', () => {
    expect(parseCard({ ...card, name: 'my island', comment: 'hello' }, catalog)).toEqual({ ok: true, value: card });
  });

  it('碑文・石板がカタログに無い、id が SHA-256 の形でない、数が負や小数なら弾く', () => {
    const cases: [unknown, string, string][] = [
      [{ ...card, inscription: 'hello, world' }, 'card.inscription', 'unknown_inscription'],
      [{ ...card, scenarioId: 'nowhere' }, 'card.scenarioId', 'unknown_scenario'],
      [{ ...card, id: 'abc' }, 'card.id', 'invalid'],
      [{ ...card, verdict: 'running' }, 'card.verdict', 'invalid'],
      [{ ...card, confirms: -1 }, 'card.confirms', 'invalid'],
      [{ ...card, mismatches: 0.5 }, 'card.mismatches', 'invalid'],
      [{ ...card, publishedAt: '2026-09-26' }, 'card.publishedAt', 'invalid'],
      [{ ...card, seed: 1.5 }, 'card.seed', 'invalid'],
      [{ ...card, simVersion: 'lol' }, 'card.simVersion', 'invalid'],
    ];
    for (const [input, path, reason] of cases) expect(refused(parseCard(input, catalog)), JSON.stringify(input)).toEqual({ path, reason });
  });
});
