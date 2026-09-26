import { isObject } from '../core/parse';
import type { ChronicleId, InscriptionId } from './contract';

/**
 * 港に並ぶ島の呼び名 (設計書 §2.2・§6.3: 自由文を受けないので、名前は決まった材料から作る)。
 * 設計書は「seed から」だが、今の石板はどれも seed 42 で、seed だけでは同じ石板の島がみな同じ名になる。
 * 年代記の id (seed と介入の正規化 JSON の SHA-256) から作り、同じ島はどのブラウザでも同じ名になる
 */
const HEAD = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ナ', 'ヌ', 'ハ', 'ホ', 'マ', 'ム', 'ラ', 'ル', 'レ'] as const;
const MID = ['ア', 'イ', 'ウ', 'オ', 'カ', 'ケ', 'タ', 'ナ', 'ニ', 'ノ', 'マ', 'モ', 'ラ', 'リ', 'ル', 'ワ'] as const;
const TAIL = ['ア', 'イ', 'ウ', 'オ', 'ナ', 'ネ', 'ヌ', 'ム', 'ラ', 'リ', 'ル', 'レ', 'ロ', 'ン', 'ヤ', 'ミ'] as const;
/** 島の呼び名の結び。ムーの欠片の島々なので、島・環・洲の 3 つから選ぶ (4 つ目以降は島に寄せる) */
const KIND = ['の島', 'の島', 'の環', 'の洲'] as const;

const nibble = (id: string, i: number) => Number.parseInt(id[i] ?? '0', 16) || 0;

export function islandName(id: ChronicleId): string {
  const long = nibble(id, 3) % 2 === 0;
  const syllables = [HEAD[nibble(id, 0)], MID[nibble(id, 1)], ...(long ? [MID[nibble(id, 4)]] : []), TAIL[nibble(id, 2)]];
  return syllables.join('') + KIND[nibble(id, 5) % KIND.length];
}

export type Inscription = { id: InscriptionId; text: string };

/** 碑文のカタログ (assets/data/inscriptions.json、静的アセット) を境界で読む。形の違う行は捨てる。ここに読めた id が港の受ける碑文になる */
export function parseInscriptions(v: unknown): Inscription[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((row) => (isObject(row) && typeof row.id === 'string' && typeof row.text === 'string' ? [{ id: row.id as InscriptionId, text: row.text }] : []));
}

/** 碑文の id から文。カタログに無い id (版を上げて外した) は、刻みの消えた石として空の文を返す */
export function inscriptionText(id: InscriptionId, catalog: readonly Inscription[]): string {
  return catalog.find((d) => d.id === id)?.text ?? '';
}
