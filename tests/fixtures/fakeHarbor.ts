import { sha256Hex } from '../../src/chronicle/digest';
import type { Chronicle } from '../../src/harbor/chronicle';
import { chronicleId, type ChronicleCard, type ChronicleId, parseCargoId, type DrawnCargo, type HarborCatalog } from '../../src/harbor/contract';
import { readRequest, writeRefusal, writeResponse, type Refusal, type WireRequest } from '../../src/harbor/wire';

/**
 * 港の Worker (M19-08) の手元の写し (M19-09 の単体と E2E が使う)。要求は本物と同じ readRequest で読み、
 * 返事は本物と同じ writeResponse・writeRefusal で書く。帳簿は D1 の代わりに Map。人間確認はテストの札 (XXXX.DUMMY.TOKEN.XXXX) だけを通す
 */
export type FakeReply = { status: number; body: string | null; headers: Record<string, string> };
type Entry = { chronicle: Chronicle; card: ChronicleCard; digestHash: string; keyHash: string; reports: number };

export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const JSON_HEADERS = { 'content-type': 'application/json' };

export function catalogFrom(data: { scenarios: readonly { id: string }[]; species: readonly { id: string }[]; inscriptions: readonly { id: string }[] }): HarborCatalog {
  const ids = (rows: readonly { id: string }[]) => new Set(rows.map((d) => d.id));
  return { scenarios: ids(data.scenarios), species: ids(data.species), inscriptions: ids(data.inscriptions) };
}

export function createFakeHarbor(catalog: HarborCatalog, opts: { now?: () => number } = {}) {
  const now = opts.now ?? (() => 1_790_000_000_000);
  const ledger = new Map<ChronicleId, Entry>();
  /** 流れている積荷。漂着は乱数の代わりに順繰りに引く (決定論のため) */
  const cargo: DrawnCargo[] = [];
  let draws = 0;
  /** 石板ごとの結末の数え (D1 の outcomes の代わり)。越えたとみなす判定は Worker の ledger.ts と同じ alive・escaped */
  const outcomes = new Map<string, { finished: number; avoided: number }>();
  const refuse = (refusal: Refusal): FakeReply => {
    const { status, body } = writeRefusal(refusal);
    return { status, body, headers: JSON_HEADERS };
  };
  const ok = (status: number, body: string): FakeReply => ({ status, body, headers: JSON_HEADERS });
  const empty: FakeReply = { status: 204, body: null, headers: {} };

  async function serve(wire: WireRequest): Promise<FakeReply> {
    const parsed = readRequest(wire, catalog);
    if (!parsed.ok) return parsed.error.reason === 'no_route' ? refuse({ error: 'not_found' }) : refuse({ error: 'bad_request', ...parsed.error });
    const req = parsed.value;
    if ('turnstile' in req && req.turnstile !== DUMMY_TOKEN) return refuse({ error: 'not_human' });
    switch (req.kind) {
      case 'publish': {
        const id = await chronicleId(req.chronicle);
        if (ledger.has(id)) return ok(200, writeResponse('publish', { id }));
        const { simVersion, scenarioId, seed } = req.chronicle;
        const card: ChronicleCard = { id, simVersion, scenarioId, seed, inscription: req.inscription, verdict: req.digest.verdict, year: req.digest.year, publishedAt: now(), confirms: 0, mismatches: 0 };
        ledger.set(id, { chronicle: req.chronicle, card, digestHash: req.digest.hash, keyHash: await sha256Hex(req.key), reports: 0 });
        return ok(201, writeResponse('publish', { id }));
      }
      case 'browse': {
        const cards = [...ledger.values()]
          .filter((e) => req.scenarioId === null || e.card.scenarioId === req.scenarioId)
          .map((e) => e.card)
          .sort((a, b) => b.publishedAt - a.publishedAt);
        return ok(200, writeResponse('browse', { cards, next: null }));
      }
      case 'visit': {
        const e = ledger.get(req.id);
        return e ? ok(200, writeResponse('visit', { chronicle: e.chronicle, card: e.card })) : refuse({ error: 'not_found' });
      }
      case 'confirm': {
        const e = ledger.get(req.id);
        if (e) e.card = req.digest.hash === e.digestHash ? { ...e.card, confirms: e.card.confirms + 1 } : { ...e.card, mismatches: e.card.mismatches + 1 };
        return empty;
      }
      case 'report': {
        const e = ledger.get(req.id);
        if (!e) return refuse({ error: 'not_found' });
        e.reports += 1;
        return empty;
      }
      case 'withdraw': {
        const e = ledger.get(req.id);
        if (!e) return refuse({ error: 'not_found' });
        if ((await sha256Hex(req.key)) !== e.keyHash) return refuse({ error: 'forbidden' });
        ledger.delete(req.id);
        return empty;
      }
      case 'cast_cargo': {
        const id = parseCargoId((await sha256Hex(`cargo:${cargo.length}`)).slice(0, 32));
        if (id.ok) cargo.push({ id: id.value, cargo: req.cargo });
        return empty;
      }
      case 'draw_cargo':
        return ok(200, writeResponse('draw_cargo', { drawn: cargo.length === 0 ? null : cargo[draws++ % cargo.length] }));
      case 'report_outcome': {
        const n = outcomes.get(req.scenarioId) ?? { finished: 0, avoided: 0 };
        outcomes.set(req.scenarioId, { finished: n.finished + 1, avoided: n.avoided + (req.verdict === 'dead' ? 0 : 1) });
        return empty;
      }
      case 'avoidance':
        return ok(200, writeResponse('avoidance', outcomes.get(req.scenarioId) ?? { finished: 0, avoided: 0 }));
      default:
        return refuse({ error: 'not_found' });
    }
  }

  return { serve, ledger, cargo, outcomes };
}
