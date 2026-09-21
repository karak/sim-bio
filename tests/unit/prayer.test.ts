import { describe, it, expect } from 'vitest';
import { issuePrayer, isAnswer, PRAYER_GRASS_LOW, PRAYER_PREDATOR_HIGH, PRAYER_CRYSTAL_LOW, PRAYER_YEARS, PRAYER_COOLDOWN } from '../../src/simulation/prayer';
import { SUPPORT_RADIUS } from '../../src/simulation/civilization';

describe('issuePrayer (M9-02, 境界値)', () => {
  it('何も当てはまらなければ null', () => {
    expect(issuePrayer({ grassMean: 1, predatorRatio: 0, crystalRatio: 1 })).toBeNull();
  });
  it('草が閾値未満なら rain', () => {
    expect(issuePrayer({ grassMean: PRAYER_GRASS_LOW - 0.001, predatorRatio: 0, crystalRatio: 1 })).toBe('rain');
    // 境界: ちょうど閾値では出ない (未満のみ)
    expect(issuePrayer({ grassMean: PRAYER_GRASS_LOW, predatorRatio: 0, crystalRatio: 1 })).toBeNull();
  });
  it('捕食者比が閾値超なら wolves', () => {
    expect(issuePrayer({ grassMean: 1, predatorRatio: PRAYER_PREDATOR_HIGH + 0.001, crystalRatio: 1 })).toBe('wolves');
    // 境界: ちょうど閾値では出ない (超のみ)
    expect(issuePrayer({ grassMean: 1, predatorRatio: PRAYER_PREDATOR_HIGH, crystalRatio: 1 })).toBeNull();
  });
  it('輝石比が閾値未満なら crystal', () => {
    expect(issuePrayer({ grassMean: 1, predatorRatio: 0, crystalRatio: PRAYER_CRYSTAL_LOW - 0.001 })).toBe('crystal');
    expect(issuePrayer({ grassMean: 1, predatorRatio: 0, crystalRatio: PRAYER_CRYSTAL_LOW })).toBeNull();
  });
  it('複数当てはまれば crystal > wolves > rain の優先', () => {
    // crystal と wolves 両方当てはまる → crystal
    expect(issuePrayer({ grassMean: 1, predatorRatio: PRAYER_PREDATOR_HIGH + 1, crystalRatio: 0 })).toBe('crystal');
    // wolves と rain 両方当てはまる → wolves
    expect(issuePrayer({ grassMean: 0, predatorRatio: PRAYER_PREDATOR_HIGH + 1, crystalRatio: 1 })).toBe('wolves');
    // 3 つとも当てはまる → crystal
    expect(issuePrayer({ grassMean: 0, predatorRatio: PRAYER_PREDATOR_HIGH + 1, crystalRatio: 0 })).toBe('crystal');
  });
});

describe('isAnswer (M9-02)', () => {
  const size = 32;
  const home = 0;
  const ctx = { home, size, rainScaleBefore: 1 };

  describe('rain', () => {
    it('set_climate で雨を今より増やせば応え', () => {
      expect(isAnswer('rain', { type: 'set_climate', rainScale: 1.2 }, ctx)).toBe(true);
    });
    it('set_climate で雨を増やさなければ応えでない (同じ・減らす・rainScale 省略)', () => {
      expect(isAnswer('rain', { type: 'set_climate', rainScale: 1 }, ctx)).toBe(false);
      expect(isAnswer('rain', { type: 'set_climate', rainScale: 0.8 }, ctx)).toBe(false);
      expect(isAnswer('rain', { type: 'set_climate', tempOffset: 1 }, ctx)).toBe(false);
    });
    it('集落から SUPPORT_RADIUS + radius 以内への草の放流は応え', () => {
      const cell = SUPPORT_RADIUS; // home からちょうど SUPPORT_RADIUS のセル (x 方向)
      expect(isAnswer('rain', { type: 'spawn_species', speciesId: 'grass', cell, amount: 0.1 }, ctx)).toBe(true);
      // radius を足せばさらに遠くても応え
      const farCell = SUPPORT_RADIUS + 2;
      expect(isAnswer('rain', { type: 'spawn_species', speciesId: 'grass', cell: farCell, amount: 0.1, radius: 2 }, ctx)).toBe(true);
    });
    it('圏外への草の放流、または他の種の放流は応えでない', () => {
      const farCell = SUPPORT_RADIUS + 5;
      expect(isAnswer('rain', { type: 'spawn_species', speciesId: 'grass', cell: farCell, amount: 0.1 }, ctx)).toBe(false);
      const cell = SUPPORT_RADIUS;
      expect(isAnswer('rain', { type: 'spawn_species', speciesId: 'forest', cell, amount: 0.1 }, ctx)).toBe(false);
    });
    it('disaster は応えでない', () => {
      expect(isAnswer('rain', { type: 'disaster', kind: 'plague', cell: 0, radius: 4 }, ctx)).toBe(false);
    });
  });

  describe('wolves', () => {
    it('集落から SUPPORT_RADIUS + radius 以内への疫病は応え', () => {
      const cell = SUPPORT_RADIUS;
      expect(isAnswer('wolves', { type: 'disaster', kind: 'plague', cell, radius: 0 }, ctx)).toBe(true);
    });
    it('圏外の疫病、または疫病以外の災害は応えでない', () => {
      const farCell = SUPPORT_RADIUS + 5;
      expect(isAnswer('wolves', { type: 'disaster', kind: 'plague', cell: farCell, radius: 0 }, ctx)).toBe(false);
      expect(isAnswer('wolves', { type: 'disaster', kind: 'volcano', cell: 0, radius: 4 }, ctx)).toBe(false);
    });
    it('草の放流や気候操作は応えでない', () => {
      expect(isAnswer('wolves', { type: 'spawn_species', speciesId: 'grass', cell: 0, amount: 0.1 }, ctx)).toBe(false);
      expect(isAnswer('wolves', { type: 'set_climate', rainScale: 1.5 }, ctx)).toBe(false);
    });
  });

  describe('crystal', () => {
    it('M9 では常に応えでない', () => {
      expect(isAnswer('crystal', { type: 'set_climate', rainScale: 1.5 }, ctx)).toBe(false);
      expect(isAnswer('crystal', { type: 'disaster', kind: 'plague', cell: 0, radius: 0 }, ctx)).toBe(false);
      expect(isAnswer('crystal', { type: 'spawn_species', speciesId: 'grass', cell: 0, amount: 0.1 }, ctx)).toBe(false);
    });
  });
});

// 係数の回帰防止: 期限とクールダウンが正の整数年であること
describe('係数 (M9-02)', () => {
  it('PRAYER_YEARS と PRAYER_COOLDOWN は正の整数', () => {
    expect(Number.isInteger(PRAYER_YEARS)).toBe(true);
    expect(PRAYER_YEARS).toBeGreaterThan(0);
    expect(Number.isInteger(PRAYER_COOLDOWN)).toBe(true);
    expect(PRAYER_COOLDOWN).toBeGreaterThan(0);
  });
});
