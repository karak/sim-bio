import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, readConfig, reducedMotionOf, writeConfig, type Config } from '../../src/persist/config';

/** タイトルのコンフィグ (M24-02、docs/uiux/2026-10-04-title-flow.md の決めること 2 の案 A)。置き場 (localStorage) を引数に取る */
const fakeStorage = () => {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};
const KEY = 'biotope.config';

describe('コンフィグの読み書き (M24-02)', () => {
  it('何も置いていなければ既定 (画質は自動・動きを減らすは OS に従う・最初の速さは 1x)', () => {
    expect(readConfig(fakeStorage())).toEqual({ quality: 'auto', motion: 'os', speed: 1 });
    expect(DEFAULT_CONFIG).toEqual({ quality: 'auto', motion: 'os', speed: 1 });
  });

  it('書いた値を 1 つの鍵 (biotope.config) に JSON で置き、そのまま読み戻す', () => {
    const s = fakeStorage();
    const c: Config = { quality: 'light', motion: 'on', speed: 10 };
    writeConfig(s, c);
    expect(JSON.parse(s.items.get(KEY) ?? 'null')).toEqual(c);
    expect(readConfig(s)).toEqual(c);
    writeConfig(s, { quality: 'fine', motion: 'off', speed: 1 });
    expect(readConfig(s)).toEqual({ quality: 'fine', motion: 'off', speed: 1 });
  });

  const broken: [why: string, raw: string, out: Config][] = [
    ['JSON でない', '{quality', DEFAULT_CONFIG],
    ['null', 'null', DEFAULT_CONFIG],
    ['配列', '[1,2]', DEFAULT_CONFIG],
    ['文字列', '"fine"', DEFAULT_CONFIG],
    ['知らない画質だけ既定に戻す', '{"quality":"ultra","motion":"on","speed":10}', { quality: 'auto', motion: 'on', speed: 10 }],
    ['知らない動きだけ既定に戻す', '{"quality":"light","motion":"yes","speed":10}', { quality: 'light', motion: 'os', speed: 10 }],
    ['並びに無い速さだけ既定に戻す', '{"quality":"light","motion":"on","speed":100}', { quality: 'light', motion: 'on', speed: 1 }],
    ['文字列の速さは既定に戻す', '{"quality":"light","motion":"on","speed":"10"}', { quality: 'light', motion: 'on', speed: 1 }],
    ['足りない項目は既定で埋める', '{"speed":10}', { quality: 'auto', motion: 'os', speed: 10 }],
    ['知らない項目は捨てる', '{"quality":"fine","motion":"off","speed":1,"volume":3}', { quality: 'fine', motion: 'off', speed: 1 }],
  ];
  it.each(broken)('壊れた値は既定に戻す: %s', (_why, raw, out) => {
    const s = fakeStorage();
    s.items.set(KEY, raw);
    expect(readConfig(s)).toEqual(out);
  });

  it('読めない・書けない置き場 (使えない localStorage) は投げない。読めなければ既定、書けなければ false', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readConfig(throwing)).toEqual(DEFAULT_CONFIG);
    expect(writeConfig(throwing, DEFAULT_CONFIG)).toBe(false);
    expect(writeConfig(fakeStorage(), DEFAULT_CONFIG)).toBe(true);
  });
});

describe('動きを減らすか reducedMotionOf (M24-02)', () => {
  const rows: [motion: Config['motion'], os: boolean, out: boolean][] = [
    ['os', true, true],
    ['os', false, false],
    ['on', false, true],
    ['on', true, true],
    ['off', true, false],
    ['off', false, false],
  ];
  it.each(rows)('motion %s・OS の設定 %s → %s', (motion, os, out) => {
    expect(reducedMotionOf(motion, os)).toBe(out);
  });
});
