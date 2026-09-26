import { canonicalJson, sha256Hex } from '../chronicle/digest';
import { fail, isFiniteNumber, isInt, isObject, under, type Parsed } from '../core/parse';
import { MAX_AMOUNT, MAX_SPECIES, parseChronicle, type Chronicle, type ChronicleHead, type Digest } from './chronicle';

/**
 * 港の契約 (M19-07、設計書 2026-09-26-cloudflare-architecture.md §5.1・§5.2・§6.3)。クライアントと Worker が同じこのファイルを import する。
 * 年代記の形そのものは ./chronicle、HTTP の形 (道・header・本文) は ./wire に置き、ここはドメインの型と parse だけ。
 * 自由文を受ける項目は作らない。石板・種・碑文は HarborCatalog の id だけを受ける。
 * parse の拒否の場所は parseChronicle と同じく、その値から見た相対の道 (外側の鍵は呼び手が core/parse の under で前置する)。
 * id と大きさの検査のため chronicle/digest の canonicalJson・sha256Hex に依る (digest.ts は ./chronicle から型だけを読むので、実行時の循環は無い)
 */

/** 年代記の id。正規化 JSON (鍵を辞書順) の SHA-256 の 16 進 64 文字。同じ中身は誰がいつ出港しても同じ id になり、出港と outbox の再送が冪等になる */
export type ChronicleId = string & { readonly __brand: 'ChronicleId' };
/** 碑文 (島に添えるひとこと) のカタログの id。自由文の代わり */
export type InscriptionId = string & { readonly __brand: 'InscriptionId' };
/** 以下は港が発行し、手元では中身を読まない札 */
export type CargoId = string & { readonly __brand: 'CargoId' };
export type WithdrawKey = string & { readonly __brand: 'WithdrawKey' };
export type BrowseCursor = string & { readonly __brand: 'BrowseCursor' };
export type TurnstileToken = string & { readonly __brand: 'TurnstileToken' };

/** 港が受ける id の集まり。石板・種・碑文は、ここにある id だけを受ける (id の形の文字列でも、自由文の抜け道にしない) */
export type HarborCatalog = { scenarios: ReadonlySet<string>; species: ReadonlySet<string>; inscriptions: ReadonlySet<string> };

export const HARBOR_LIMITS = {
  /** 出港できる年代記の正規化 JSON の UTF-8 の大きさ。手元の年代記 (maxCommands まで) より狭い */
  chronicleBytes: 16 * 1024,
  cargoItems: 5,
  cardsPerPage: 50,
} as const;

/** 一覧に出す 1 件。島の名前は seed から作り、ひとことは碑文の id。自由文の項目は無い */
export type ChronicleCard = ChronicleHead & {
  id: ChronicleId;
  inscription: InscriptionId;
  verdict: Digest['verdict'];
  year: number;
  /** 出港の時刻 (epoch ms) */
  publishedAt: number;
  confirms: number;
  mismatches: number;
};

export type CargoItem = { speciesId: string; amount: number };
/** 空の舟の積荷。1〜5 件、量は (0, 10]、種はカタログのみで重ねない (同じ種を 5 件並べて量の上限を越えさせない)。受け取れば放流の命令として年代記に載るので、量の上限は放流と同じ MAX_AMOUNT */
export type Cargo = { items: readonly CargoItem[] };
export type DrawnCargo = { id: CargoId; cargo: Cargo };

/** 港への要求。wire.ts が HTTP の形 (道・header・本文) と行き来する */
export type HarborRequest =
  | { kind: 'publish'; chronicle: Chronicle; digest: Digest; inscription: InscriptionId; turnstile: TurnstileToken }
  | { kind: 'browse'; scenarioId: string | null; before: BrowseCursor | null }
  | { kind: 'visit'; id: ChronicleId }
  | { kind: 'confirm'; id: ChronicleId; digest: Digest }
  | { kind: 'report'; id: ChronicleId; turnstile: TurnstileToken }
  | { kind: 'withdraw'; id: ChronicleId; key: WithdrawKey }
  | { kind: 'cast_cargo'; cargo: Cargo }
  | { kind: 'draw_cargo' }
  | { kind: 'report_outcome'; scenarioId: string; verdict: Digest['verdict'] }
  | { kind: 'avoidance'; scenarioId: string };

/** 本文のある応答。ほかの要求 (照合・通報・取り下げ・積荷を流す・結末の報告) は本文の無い 204 で答える */
export type HarborResponses = {
  publish: { id: ChronicleId; withdrawKey: WithdrawKey };
  browse: { cards: readonly ChronicleCard[]; next: BrowseCursor | null };
  visit: { chronicle: Chronicle; card: ChronicleCard };
  draw_cargo: { drawn: DrawnCargo | null };
  avoidance: { finished: number; avoided: number };
};

const brand = <B extends string>(v: string) => v as B;
const token =
  <B extends string>(pattern: RegExp) =>
  (v: unknown): Parsed<B> =>
    typeof v === 'string' && pattern.test(v) ? { ok: true, value: brand<B>(v) } : fail('', 'invalid');
export const parseChronicleId = token<ChronicleId>(/^[0-9a-f]{64}$/);
export const parseWithdrawKey = token<WithdrawKey>(/^[A-Za-z0-9_-]{32,128}$/);
export const parseCargoId = token<CargoId>(/^[A-Za-z0-9_-]{1,64}$/);
export const parseCursor = token<BrowseCursor>(/^[A-Za-z0-9_-]{1,64}$/);
/** Turnstile の札は siteverify へ渡すだけで、保存も表示もしない */
export const parseTurnstile = token<TurnstileToken>(/^[\x21-\x7e]{1,2048}$/);
/** 公開の面に出る版は数字と点だけ (文字の版で言葉を載せさせない)。SIM_VERSION はこの形で上げる */
const isPublicSimVersion = (v: string) => /^[0-9][0-9.]{0,15}$/.test(v);
const hash = token<string>(/^[0-9a-f]{64}$/);

const VERDICTS = { alive: true, dead: true, escaped: true } as const satisfies Record<Digest['verdict'], true>;
const isVerdict = (v: unknown): v is Digest['verdict'] => typeof v === 'string' && Object.hasOwn(VERDICTS, v);
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

export async function chronicleId(c: Chronicle): Promise<ChronicleId> {
  return brand<ChronicleId>(await sha256Hex(canonicalJson(c)));
}

export function parseScenarioId(v: unknown, catalog: HarborCatalog): Parsed<string> {
  return typeof v === 'string' && catalog.scenarios.has(v) ? { ok: true, value: v } : fail('', 'unknown_scenario');
}

export function parseInscription(v: unknown, catalog: HarborCatalog): Parsed<InscriptionId> {
  return typeof v === 'string' && catalog.inscriptions.has(v) ? { ok: true, value: brand<InscriptionId>(v) } : fail('', 'unknown_inscription');
}

export function parseVerdict(v: unknown): Parsed<Digest['verdict']> {
  return isVerdict(v) ? { ok: true, value: v } : fail('', 'invalid');
}

/** 港に出す年代記の検査。parseChronicle に、カタログの id だけであることと chronicleBytes を足す。クライアントも出港の前に同じ関数で先に断る */
export function parsePublicChronicle(input: unknown, catalog: HarborCatalog, limits: { chronicleBytes: number } = HARBOR_LIMITS): Parsed<Chronicle> {
  const parsed = parseChronicle(input);
  if (!parsed.ok) return parsed;
  const c = parsed.value;
  if (!isPublicSimVersion(c.simVersion)) return fail('simVersion', 'invalid');
  if (!catalog.scenarios.has(c.scenarioId)) return fail('scenarioId', 'unknown_scenario');
  const stray = c.commands.findIndex(({ command }) => command.type === 'spawn_species' && !catalog.species.has(command.speciesId));
  if (stray >= 0) return fail(`commands[${stray}].command.speciesId`, 'unknown_species');
  for (const [i, row] of c.yearly.entries()) {
    const unknown = Object.keys(row).find((id) => !catalog.species.has(id));
    if (unknown !== undefined) return fail(`yearly[${i}].${unknown}`, 'unknown_species');
  }
  if (utf8Bytes(canonicalJson(c)) > limits.chronicleBytes) return fail('', 'too_large');
  return parsed;
}

/** extinct は totals から決まる (0 の種を鍵の順に) ので、食い違えば inconsistent。hash の検算は非同期なのでここではしない */
export function parseDigest(input: unknown, catalog: HarborCatalog): Parsed<Digest> {
  if (!isObject(input)) return fail('', 'not_object');
  const { year, verdict } = input;
  if (!isInt(year, 0)) return fail('year', 'invalid');
  if (!isVerdict(verdict)) return fail('verdict', 'invalid');
  if (!isObject(input.totals)) return fail('totals', 'not_object');
  const entries = Object.entries(input.totals);
  if (entries.length > MAX_SPECIES) return fail('totals', 'too_many_species');
  const totals: Record<string, number> = {};
  for (const [id, n] of entries) {
    if (!catalog.species.has(id)) return fail(`totals.${id}`, 'unknown_species');
    if (!isFiniteNumber(n) || n < 0) return fail(`totals.${id}`, 'invalid');
    totals[id] = n;
  }
  const extinct = Object.keys(totals)
    .sort()
    .filter((id) => totals[id] === 0);
  if (JSON.stringify(input.extinct) !== JSON.stringify(extinct)) return fail('extinct', 'inconsistent');
  const h = under('hash', hash(input.hash));
  if (!h.ok) return h;
  return { ok: true, value: { year, verdict, totals, extinct, hash: h.value } };
}

export function parseCargo(input: unknown, catalog: HarborCatalog): Parsed<Cargo> {
  if (!isObject(input)) return fail('', 'not_object');
  if (!Array.isArray(input.items)) return fail('items', 'not_array');
  if (input.items.length === 0) return fail('items', 'empty');
  if (input.items.length > HARBOR_LIMITS.cargoItems) return fail('items', 'too_many');
  const items: CargoItem[] = [];
  for (const [i, row] of input.items.entries()) {
    if (!isObject(row)) return fail(`items[${i}]`, 'not_object');
    const { speciesId, amount } = row;
    if (typeof speciesId !== 'string' || !catalog.species.has(speciesId)) return fail(`items[${i}].speciesId`, 'unknown_species');
    if (items.some((x) => x.speciesId === speciesId)) return fail(`items[${i}].speciesId`, 'duplicate_species');
    if (!isFiniteNumber(amount) || amount <= 0 || amount > MAX_AMOUNT) return fail(`items[${i}].amount`, 'invalid');
    items.push({ speciesId, amount });
  }
  return { ok: true, value: { items } };
}

export function parseCard(input: unknown, catalog: HarborCatalog): Parsed<ChronicleCard> {
  if (!isObject(input)) return fail('', 'not_object');
  const id = under('id', parseChronicleId(input.id));
  if (!id.ok) return id;
  const { simVersion, seed, verdict, year, publishedAt, confirms, mismatches } = input;
  if (typeof simVersion !== 'string' || !isPublicSimVersion(simVersion)) return fail('simVersion', 'invalid');
  const scenarioId = under('scenarioId', parseScenarioId(input.scenarioId, catalog));
  if (!scenarioId.ok) return scenarioId;
  if (!isInt(seed, Number.MIN_SAFE_INTEGER)) return fail('seed', 'invalid');
  const inscription = under('inscription', parseInscription(input.inscription, catalog));
  if (!inscription.ok) return inscription;
  if (!isVerdict(verdict)) return fail('verdict', 'invalid');
  if (!isInt(year, 0)) return fail('year', 'invalid');
  if (!isInt(publishedAt, 0)) return fail('publishedAt', 'invalid');
  if (!isInt(confirms, 0)) return fail('confirms', 'invalid');
  if (!isInt(mismatches, 0)) return fail('mismatches', 'invalid');
  return { ok: true, value: { id: id.value, simVersion, scenarioId: scenarioId.value, seed, inscription: inscription.value, verdict, year, publishedAt, confirms, mismatches } };
}
