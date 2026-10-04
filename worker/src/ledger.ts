import { canonicalJson } from '../../src/chronicle/digest';
import { isObject, type ParseError } from '../../src/core/parse';
import { parseChronicle, type Chronicle, type Digest } from '../../src/harbor/chronicle';
import { parseCard, parseCargo, parseCargoId, parseCursor, type BrowseCursor, type Cargo, type CargoId, type ChronicleCard, type ChronicleId, type HarborCatalog, type InscriptionId } from '../../src/harbor/contract';
import type { ClosedReason } from '../../src/harbor/wire';
import type { Budget, Bucket } from './policy';

/**
 * 港の帳簿 (D1) への問い合わせ (worker/migrations/0001_harbor.sql)。SQL と行の形はこのファイルの外へ出さない。
 * D1 から読んだ行も境界として parse し直す (カタログが変われば、古い行は一覧から落ちる)
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** D1 の誤りを閉港の理由に読む。文言は D1 の誤りの一覧 (https://developers.cloudflare.com/d1/observability/debug-d1/#error-list) */
export function closedReasonOf(error: unknown): ClosedReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/daily row read limit/i.test(message)) return 'd1_read_limit';
  if (/daily row write limit/i.test(message)) return 'd1_write_limit';
  if (/maximum DB size/i.test(message)) return 'd1_storage';
  return 'unavailable';
}

/**
 * 日次予算を 1 つ使う。その道の cap と、日の合計の shedAt の両方の内なら数えて通す。越えていれば何も書かない。
 * 数えと判定を 1 文にして、同時の呼び出しでも上限を越えない。sizeAfter は問い合わせのあとの D1 の大きさ (保存の栓に使う)
 */
export async function admit(db: D1Database, day: string, bucket: Bucket, budget: Budget): Promise<{ admitted: boolean; sizeAfter: number }> {
  const res = await db
    .prepare(
      `INSERT INTO daily_budget (day, bucket, used)
       SELECT ?1, ?2, 1 WHERE (SELECT COALESCE(SUM(used), 0) FROM daily_budget WHERE day = ?1) < ?4
       ON CONFLICT (day, bucket) DO UPDATE SET used = daily_budget.used + 1
       WHERE daily_budget.used < ?3 AND (SELECT COALESCE(SUM(used), 0) FROM daily_budget WHERE day = ?1) < ?4
       RETURNING used`,
    )
    .bind(day, bucket, budget.cap, budget.shedAt)
    .all();
  return { admitted: res.results.length > 0, sizeAfter: res.meta.size_after };
}

export type ChronicleRow = { id: ChronicleId; chronicle: Chronicle; digest: Digest; inscription: InscriptionId; publishedAt: number; withdrawHash: string };

/** 同じ id は INSERT OR IGNORE で 1 件のまま。新しく置いたら true */
export async function insertChronicle(db: D1Database, row: ChronicleRow): Promise<boolean> {
  const { chronicle: c, digest: d } = row;
  const body = canonicalJson(c);
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO chronicles (id, sim_version, scenario_id, seed, inscription, verdict, year, digest_hash, body, bytes, published_at, withdraw_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, c.simVersion, c.scenarioId, c.seed, row.inscription, d.verdict, d.year, d.hash, body, new TextEncoder().encode(body).length, row.publishedAt, row.withdrawHash)
    .run();
  return res.meta.changes === 1;
}

const CARD_COLUMNS = 'id, sim_version, scenario_id, seed, inscription, verdict, year, published_at, confirms, mismatches';
const cardOf = (r: Record<string, unknown>, catalog: HarborCatalog) =>
  parseCard(
    { id: r.id, simVersion: r.sim_version, scenarioId: r.scenario_id, seed: r.seed, inscription: r.inscription, verdict: r.verdict, year: r.year, publishedAt: r.published_at, confirms: r.confirms, mismatches: r.mismatches },
    catalog,
  );

/** 帳簿の行が今のカタログ・形で読めない (カタログから石板や種を外した・手で書き換えた)。その行は出さずに残す */
function unreadable(table: string, id: unknown, error: ParseError): null {
  console.error(JSON.stringify({ event: 'harbor.ledger.unreadable', table, id, ...error }));
  return null;
}

/** 頁の札は「published_at の 36 進」_「id の頭 16 文字」。同じ時刻の年代記は id の逆順に並ぶ */
type Keyset = { publishedAt: number; idPrefix: string };
const CURSOR = /^([0-9a-z]{1,11})_([0-9a-f]{16})$/;
function encodeCursor(card: ChronicleCard): BrowseCursor | null {
  const cursor = parseCursor(`${card.publishedAt.toString(36)}_${card.id.slice(0, 16)}`);
  return cursor.ok ? cursor.value : null;
}
export function decodeCursor(cursor: BrowseCursor): Keyset | null {
  const m = CURSOR.exec(cursor);
  const publishedAt = m ? parseInt(m[1], 36) : NaN;
  return m && Number.isSafeInteger(publishedAt) ? { publishedAt, idPrefix: m[2] } : null;
}
const FIRST_PAGE: Keyset = { publishedAt: Number.MAX_SAFE_INTEGER, idPrefix: 'g' };

const BROWSE_ALL = `SELECT ${CARD_COLUMNS} FROM chronicles
  WHERE hidden_at IS NULL AND (published_at < ?1 OR (published_at = ?1 AND id < ?2))
  ORDER BY published_at DESC, id DESC LIMIT ?3`;
const BROWSE_SCENARIO = `SELECT ${CARD_COLUMNS} FROM chronicles
  WHERE hidden_at IS NULL AND scenario_id = ?4 AND (published_at < ?1 OR (published_at = ?1 AND id < ?2))
  ORDER BY published_at DESC, id DESC LIMIT ?3`;

export async function browse(
  db: D1Database,
  q: { scenarioId: string | null; before: Keyset | null; pageSize: number },
  catalog: HarborCatalog,
): Promise<{ cards: ChronicleCard[]; next: BrowseCursor | null }> {
  const at = q.before ?? FIRST_PAGE;
  const stmt = q.scenarioId === null ? db.prepare(BROWSE_ALL).bind(at.publishedAt, at.idPrefix, q.pageSize + 1) : db.prepare(BROWSE_SCENARIO).bind(at.publishedAt, at.idPrefix, q.pageSize + 1, q.scenarioId);
  const rows = (await stmt.all()).results;
  const cards = rows.slice(0, q.pageSize).flatMap((r) => {
    const card = cardOf(r, catalog);
    return card.ok ? [card.value] : (unreadable('chronicles', r.id, card.error) ?? []);
  });
  const last = cards.at(-1);
  return { cards, next: rows.length > q.pageSize && last ? encodeCursor(last) : null };
}

export async function visit(db: D1Database, id: ChronicleId, catalog: HarborCatalog): Promise<{ chronicle: Chronicle; card: ChronicleCard } | null> {
  const row = await db.prepare(`SELECT ${CARD_COLUMNS}, body FROM chronicles WHERE id = ? AND hidden_at IS NULL`).bind(id).first();
  if (row === null || typeof row.body !== 'string') return null;
  const chronicle = parseChronicle(JSON.parse(row.body));
  if (!chronicle.ok) return unreadable('chronicles', id, chronicle.error);
  const card = cardOf(row, catalog);
  return card.ok ? { chronicle: chronicle.value, card: card.value } : unreadable('chronicles', id, card.error);
}

/** 結末の hash が出港のものと同じなら確認、違えば不一致を 1 つ足す。隠れた年代記と無い年代記には何もしない */
export async function confirm(db: D1Database, id: ChronicleId, hash: string): Promise<void> {
  await db
    .prepare('UPDATE chronicles SET confirms = confirms + (digest_hash = ?2), mismatches = mismatches + (digest_hash <> ?2) WHERE id = ?1 AND hidden_at IS NULL')
    .bind(id, hash)
    .run();
}

/**
 * 通報を 1 つ数える。同じ送り手の同じ日の 2 度目は数えない。数が hideAt に届いたら、その時刻で隠す。
 * 通報の行と数を 1 つの batch (1 つのトランザクション) で書く。2 文目の changes() は 1 文目 (通報の行の INSERT) で増えた行の数で、
 * 新しい通報のときだけ数を足す。数えだけが残る・行だけが残る、の半端な状態を作らない
 * @returns counted (数えた)・repeat (同じ送り手の 2 度目)・missing (無い年代記)。hidden は、この通報で隠れたか
 */
export async function report(
  db: D1Database,
  r: { id: ChronicleId; day: string; sender: string; now: number; hideAt: number },
): Promise<{ kind: 'counted'; hidden: boolean } | { kind: 'repeat' | 'missing' }> {
  const [, counted] = await db.batch([
    db.prepare('INSERT INTO reports (chronicle_id, day, sender) SELECT id, ?2, ?3 FROM chronicles WHERE id = ?1 ON CONFLICT DO NOTHING').bind(r.id, r.day, r.sender),
    db
      .prepare('UPDATE chronicles SET reports = reports + 1, hidden_at = CASE WHEN hidden_at IS NULL AND reports + 1 >= ?2 THEN ?3 ELSE hidden_at END WHERE id = ?1 AND changes() = 1 RETURNING hidden_at')
      .bind(r.id, r.hideAt, r.now),
  ]);
  const row = counted.results[0];
  if (isObject(row)) return { kind: 'counted', hidden: row.hidden_at === r.now };
  const exists = await db.prepare('SELECT 1 FROM chronicles WHERE id = ?').bind(r.id).first();
  return { kind: exists === null ? 'missing' : 'repeat' };
}

/** 鍵の SHA-256 が合えば消す。通報の行は外部鍵の ON DELETE CASCADE で消える (meta.changes は消えた通報も数えるので、RETURNING で見る) */
export async function withdraw(db: D1Database, id: ChronicleId, keyHash: string): Promise<'ok' | 'forbidden' | 'missing'> {
  const deleted = await db.prepare('DELETE FROM chronicles WHERE id = ? AND withdraw_hash = ? RETURNING id').bind(id, keyHash).first();
  if (deleted !== null) return 'ok';
  const exists = await db.prepare('SELECT 1 FROM chronicles WHERE id = ?').bind(id).first();
  return exists === null ? 'missing' : 'forbidden';
}

/** 積荷の id は D1 の乱数 (16 B の 16 進)。港が発行し、手元では中身を読まない札 */
export async function castCargo(db: D1Database, c: { cargo: Cargo; now: number }): Promise<void> {
  await db.prepare('INSERT INTO cargo (id, items, cast_at) VALUES (lower(hex(randomblob(16))), ?, ?)').bind(JSON.stringify(c.cargo.items), c.now).run();
}

/** 漂着をランダムに 1 件。rowid の乱数から索引で 1 行だけ読む (消した行の隙間の分だけ偏るが、漂着には十分) */
export async function drawCargo(db: D1Database, catalog: HarborCatalog): Promise<{ id: CargoId; cargo: Cargo } | null> {
  const row = await db
    .prepare('SELECT id, items FROM cargo WHERE rowid >= (SELECT abs(random() % MAX(rowid)) + 1 FROM cargo) ORDER BY rowid LIMIT 1')
    .first();
  if (row === null || typeof row.items !== 'string') return null;
  const id = parseCargoId(row.id);
  if (!id.ok) return unreadable('cargo', row.id, id.error);
  const cargo = parseCargo({ items: JSON.parse(row.items) }, catalog);
  return cargo.ok ? { id: id.value, cargo: cargo.value } : unreadable('cargo', row.id, cargo.error);
}

export async function recordOutcome(db: D1Database, scenarioId: string, verdict: Digest['verdict']): Promise<void> {
  await db
    .prepare('INSERT INTO outcomes (scenario_id, verdict, count) VALUES (?, ?, 1) ON CONFLICT (scenario_id, verdict) DO UPDATE SET count = count + 1')
    .bind(scenarioId, verdict)
    .run();
}

/** 越えた (予言の滅びを避けた) とみなす判定。escaped は空の舟で島を離れた結末 */
const AVOIDED: ReadonlySet<string> = new Set<Digest['verdict']>(['alive', 'escaped']);

export async function avoidance(db: D1Database, scenarioId: string): Promise<{ finished: number; avoided: number }> {
  const rows = (await db.prepare('SELECT verdict, count FROM outcomes WHERE scenario_id = ?').bind(scenarioId).all()).results;
  let finished = 0;
  let avoided = 0;
  for (const { verdict, count } of rows) {
    if (typeof count !== 'number') continue;
    finished += count;
    if (typeof verdict === 'string' && AVOIDED.has(verdict)) avoided += count;
  }
  return { finished, avoided };
}

export type Swept = { chronicles: number; reports: number; cargo: number; budget: number };
export type Stats = { storedBytes: number; chronicles: number; hidden: number; cargo: number };

/** Cron の掃除と集計。消すものを 1 つの batch (1 つのトランザクション) で消し、そのあと保存量を数えて harbor_stats に書く */
export async function sweep(db: D1Database, now: number, days: { cargoDays: number; budgetDays: number; hiddenDays: number }): Promise<{ swept: Swept; stats: Stats }> {
  const [reports, cargo, budget, chronicles] = await db.batch([
    db.prepare('DELETE FROM reports WHERE day < ?').bind(utcDay(now)),
    db.prepare('DELETE FROM cargo WHERE cast_at < ?').bind(now - days.cargoDays * DAY_MS),
    db.prepare('DELETE FROM daily_budget WHERE day < ?').bind(utcDay(now - days.budgetDays * DAY_MS)),
    db.prepare('DELETE FROM chronicles WHERE hidden_at IS NOT NULL AND hidden_at < ? RETURNING id').bind(now - days.hiddenDays * DAY_MS),
  ]);
  const counted = await db
    .prepare('SELECT (SELECT COUNT(*) FROM chronicles) AS chronicles, (SELECT COUNT(*) FROM chronicles WHERE hidden_at IS NOT NULL) AS hidden, (SELECT COUNT(*) FROM cargo) AS cargo')
    .all();
  const row = counted.results[0];
  const count = (v: unknown) => (typeof v === 'number' ? v : 0);
  const stats: Stats = { storedBytes: counted.meta.size_after, chronicles: count(row?.chronicles), hidden: count(row?.hidden), cargo: count(row?.cargo) };
  await db
    .prepare(
      `INSERT INTO harbor_stats (day, stored_bytes, chronicles, hidden, cargo, measured_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (day) DO UPDATE SET stored_bytes = excluded.stored_bytes, chronicles = excluded.chronicles, hidden = excluded.hidden, cargo = excluded.cargo, measured_at = excluded.measured_at`,
    )
    .bind(utcDay(now), stats.storedBytes, stats.chronicles, stats.hidden, stats.cargo, now)
    .run();
  return { swept: { reports: reports.meta.changes, cargo: cargo.meta.changes, budget: budget.meta.changes, chronicles: chronicles.results.length }, stats };
}
