import { describe, it, expect } from 'vitest';
import { issuePrayer, isAnswer, prayerStillNeeded, PRAYER_CRYSTAL_LOW, PRAYER_GRASS_DROP, PRAYER_PREDATOR_RISE, PRAYER_YEARS, PRAYER_COOLDOWN } from '../../src/simulation/prayer';
import { SUPPORT_RADIUS } from '../../src/simulation/civilization';

describe('issuePrayer (M9-02 → M9-03: 基準比「いつもより」、境界値)', () => {
  const base = { grassMean: 0.2, predatorRatio: 0.5 };
  it('何も当てはまらなければ null', () => {
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: 0.5, crystalRatio: 1, baseline: base })).toBeNull();
  });
  it('基準が無ければ (最初の PRAYER_BASELINE_MIN 年) 雨・狼の祈りは出ない。輝石は出る', () => {
    expect(issuePrayer({ grassMean: 0, predatorRatio: 100, crystalRatio: 1 })).toBeNull();
    expect(issuePrayer({ grassMean: 0, predatorRatio: 100, crystalRatio: 0 })).toBe('crystal');
  });
  it('草が基準 × PRAYER_GRASS_DROP 未満なら rain (ちょうどでは出ない)', () => {
    expect(issuePrayer({ grassMean: base.grassMean * PRAYER_GRASS_DROP - 1e-6, predatorRatio: 0.5, crystalRatio: 1, baseline: base })).toBe('rain');
    expect(issuePrayer({ grassMean: base.grassMean * PRAYER_GRASS_DROP, predatorRatio: 0.5, crystalRatio: 1, baseline: base })).toBeNull();
  });
  it('捕食者比が基準 × PRAYER_PREDATOR_RISE 超なら wolves (ちょうどでは出ない)。基準 0 でも捕食者が現れれば出る', () => {
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: base.predatorRatio * PRAYER_PREDATOR_RISE + 1e-6, crystalRatio: 1, baseline: base })).toBe('wolves');
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: base.predatorRatio * PRAYER_PREDATOR_RISE, crystalRatio: 1, baseline: base })).toBeNull();
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: 0.01, crystalRatio: 1, baseline: { grassMean: 0.2, predatorRatio: 0 } })).toBe('wolves');
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: 0, crystalRatio: 1, baseline: { grassMean: 0.2, predatorRatio: 0 } })).toBeNull();
  });
  it('輝石比が閾値未満なら crystal (絶対値、ちょうどでは出ない)', () => {
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: 0.5, crystalRatio: PRAYER_CRYSTAL_LOW - 0.001, baseline: base })).toBe('crystal');
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: 0.5, crystalRatio: PRAYER_CRYSTAL_LOW, baseline: base })).toBeNull();
  });
  it('複数当てはまれば crystal > wolves > rain の優先', () => {
    expect(issuePrayer({ grassMean: 0.2, predatorRatio: 5, crystalRatio: 0, baseline: base })).toBe('crystal');
    expect(issuePrayer({ grassMean: 0, predatorRatio: 5, crystalRatio: 1, baseline: base })).toBe('wolves');
    expect(issuePrayer({ grassMean: 0, predatorRatio: 5, crystalRatio: 0, baseline: base })).toBe('crystal');
  });
  it('prayerStillNeeded (M9-03): 困りごとが続いているかを種類ごとに判定する', () => {
    expect(prayerStillNeeded('rain', { grassMean: 0.1, predatorRatio: 0.5, crystalRatio: 1, baseline: base })).toBe(true);
    expect(prayerStillNeeded('rain', { grassMean: 0.2, predatorRatio: 0.5, crystalRatio: 1, baseline: base })).toBe(false);
    expect(prayerStillNeeded('wolves', { grassMean: 0.2, predatorRatio: 1, crystalRatio: 1, baseline: base })).toBe(true);
    expect(prayerStillNeeded('wolves', { grassMean: 0.2, predatorRatio: 0.5, crystalRatio: 1, baseline: base })).toBe(false);
    expect(prayerStillNeeded('crystal', { grassMean: 0.2, predatorRatio: 0.5, crystalRatio: 0.05, baseline: base })).toBe(true);
    expect(prayerStillNeeded('crystal', { grassMean: 0.2, predatorRatio: 0.5, crystalRatio: 0.5, baseline: base })).toBe(false);
    // 基準が無ければ判断できないので残す (開始時に指定した祈りが最初の年に消えない)
    expect(prayerStillNeeded('rain', { grassMean: 1, predatorRatio: 0.5, crystalRatio: 1 })).toBe(true);
    expect(prayerStillNeeded('wolves', { grassMean: 1, predatorRatio: 0, crystalRatio: 1 })).toBe(true);
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
