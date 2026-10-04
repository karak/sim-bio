import { describe, expect, it } from 'vitest';
import { chronicleId, type HarborCatalog, type InscriptionId, type TurnstileToken, type WithdrawKey } from '../../src/harbor/contract';
import { readRequest, writeRequest } from '../../src/harbor/wire';
import { FIXTURE_CHRONICLE, FIXTURE_CHRONICLE_ID, FIXTURE_HASH } from '../../tests/fixtures/chronicle';

const catalog: HarborCatalog = { scenarios: new Set(['sinking']), species: new Set(['deer']), inscriptions: new Set(['still-here']) };

describe('港の契約を workerd で読む (M19-07)', () => {
  it('固定の年代記の id が、Node の単体 (tests/unit/harbor.contract.test.ts) と同じ golden になる', async () => {
    expect(await chronicleId(FIXTURE_CHRONICLE)).toBe(FIXTURE_CHRONICLE_ID);
  });

  it('クライアントが書いた出港の要求を、Worker の側で同じ要求に読む', () => {
    const digest = { year: 3, verdict: 'alive', totals: { deer: 1 }, extinct: [], hash: FIXTURE_HASH } as const;
    const req = { kind: 'publish', chronicle: FIXTURE_CHRONICLE, digest, inscription: 'still-here' as InscriptionId, turnstile: 'XXXX.DUMMY' as TurnstileToken, key: 'k'.repeat(43) as WithdrawKey } as const;
    expect(readRequest(writeRequest(req), catalog)).toEqual({ ok: true, value: req });
  });
});
