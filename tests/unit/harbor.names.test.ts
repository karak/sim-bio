import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ChronicleId, InscriptionId } from '../../src/harbor/contract';
import { sha256Hex } from '../../src/chronicle/digest';
import { inscriptionText, islandName, parseInscriptions } from '../../src/harbor/names';
import { FIXTURE_CHRONICLE_ID } from '../fixtures/chronicle';


describe('港の島の呼び名とひとこと (M19-09)', () => {
  it('呼び名は年代記の id だけで決まり、カタカナの 3〜4 音に島・環・洲の結び', () => {
    const id = FIXTURE_CHRONICLE_ID as ChronicleId;
    expect(islandName(id)).toBe(islandName(id));
    expect(islandName(id)).toMatch(/^[ア-ン]{3,4}の(島|環|洲)$/);
    expect(islandName(id)).toBe('キワヌの島');
  });

  it('id が違えば、たいていは違う名になる (64 通りの id で 40 以上)', async () => {
    const ids = await Promise.all(Array.from({ length: 64 }, (_, n) => sha256Hex(`island-${n}`)));
    const names = new Set(ids.map((id) => islandName(id as ChronicleId)));
    expect(names.size).toBeGreaterThan(40);
  });

  it('碑文のカタログを境界で読む。形の違う行は捨てる', () => {
    expect(parseInscriptions([{ id: 'a', text: 'あ' }, { id: 1, text: 'x' }, 'x', { id: 'b' }])).toEqual([{ id: 'a', text: 'あ' }]);
    expect(parseInscriptions({})).toEqual([]);
  });

  it('ひとことは碑文のカタログの文。カタログに無い id は空', () => {
    const inscriptions = parseInscriptions(JSON.parse(readFileSync('assets/data/inscriptions.json', 'utf8')));
    expect(inscriptions).toHaveLength(6);
    expect(inscriptionText('rain-came' as InscriptionId, inscriptions)).toBe('雨は来た');
    expect(inscriptionText('gone' as InscriptionId, inscriptions)).toBe('');
  });
});
