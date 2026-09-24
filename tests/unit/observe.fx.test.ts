import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { MIST_LINGER_S, MIST_RISE_S, MIST_S, SPROUT_DRAG, SURGE_CALM_S, SURGE_HOLD_S, SURGE_RATE, WET_DRY_S, WET_FILL_S, mistEnvelope, sproutBurst, sproutReach, surgeStep, wetness, type SurgeState } from '../../src/observe/fx';
import { puddleSpots } from '../../src/observe/render/puddles';
import { createSurface } from '../../src/observe/render/roofs';
import { mulberry32 } from '../../src/simulation/rng';

describe('介入の場面の時間の形 (M22-07 の手直し): 疫病の霧の余韻', () => {
  it('立ち上がり → 満ちる → 最後の 32 秒の余韻。全体は 90 秒のまま', () => {
    expect(MIST_S).toBe(90);
    expect(mistEnvelope(0)).toEqual({ amount: 0, fade: 0 });
    expect(mistEnvelope(MIST_RISE_S / 2).amount).toBeCloseTo(0.5, 5);
    // 満ちている間は濃さ 1・余韻 0 (前は立った直後から一様に薄れ、60 秒で 0.33 まで下がっていた)
    for (const t of [MIST_RISE_S, 20, 57.9]) expect(mistEnvelope(t)).toEqual({ amount: 1, fade: 0 });
    // 余韻の入り口は続いている (濃さが跳ばない)
    expect(mistEnvelope(MIST_S - MIST_LINGER_S + 0.01).amount).toBeGreaterThan(0.99);
    expect(mistEnvelope(MIST_S).amount).toBe(0);
    expect(mistEnvelope(MIST_S + 5)).toEqual({ amount: 0, fade: 1 });
  });

  it('余韻の間、fade は 0 → 1 へ進み、濃さは単調に薄れる。半ばでまだ 3 割ほど残る (すっと消えない)', () => {
    let prev = mistEnvelope(MIST_S - MIST_LINGER_S).amount;
    let prevFade = -1;
    for (let t = MIST_S - MIST_LINGER_S; t < MIST_S; t += 0.5) {
      const e = mistEnvelope(t);
      expect(e.amount).toBeLessThanOrEqual(prev + 1e-9);
      expect(e.fade).toBeGreaterThan(prevFade);
      prev = e.amount;
      prevFade = e.fade;
    }
    const mid = mistEnvelope(MIST_S - MIST_LINGER_S / 2);
    expect(mid.fade).toBeCloseTo(0.5, 5);
    expect(mid.amount).toBeGreaterThan(0.25);
    expect(mid.amount).toBeLessThan(0.4);
  });
});

describe('介入の場面の時間の形 (M22-07 の手直し): 芽吹きの放射', () => {
  it('粒は植えた円の 0.55〜1.35 倍まで飛び、7 割は 22 本の筋の向きにそろう', () => {
    const rng = mulberry32(5);
    const R = 20;
    let onRay = 0;
    for (let i = 0; i < 2000; i++) {
      const p = sproutBurst(rng, R);
      const reach = p.speed / SPROUT_DRAG;
      expect(reach).toBeGreaterThanOrEqual(R * 0.55 - 1e-9);
      expect(reach).toBeLessThanOrEqual(R * 1.35 + 1e-9);
      expect(p.up).toBeGreaterThanOrEqual(1.2);
      expect(p.delay).toBeGreaterThanOrEqual(0);
      expect(p.delay).toBeLessThan(0.5);
      const k = (p.angle / (Math.PI * 2)) * 22 - 0.5;
      if (Math.abs(k - Math.round(k)) * ((Math.PI * 2) / 22) < 0.026) onRay++;
    }
    expect(onRay / 2000).toBeGreaterThan(0.68);
    expect(onRay / 2000).toBeLessThan(0.8);
  });

  it('抗力で減速して、1 秒で届く所の 89%、3 秒でほぼ止まる', () => {
    const speed = 20 * SPROUT_DRAG;
    expect(sproutReach(speed, 0)).toBe(0);
    expect(sproutReach(speed, -1)).toBe(0);
    expect(sproutReach(speed, 1) / 20).toBeCloseTo(1 - Math.exp(-SPROUT_DRAG), 6);
    expect(sproutReach(speed, 3)).toBeGreaterThan(19.9);
    expect(sproutReach(speed, 30)).toBeLessThanOrEqual(20);
  });
});

describe('介入の場面の時間の形 (M22-07 の手直し): 雨の濡れと沈む海', () => {
  it('濡れは降っている間 14 秒で満ち、止むと 40 秒で乾く (0〜1 に収まる)', () => {
    let w = 0;
    for (let t = 0; t < WET_FILL_S / 2; t += 0.5) w = wetness(w, true, 0.5);
    expect(w).toBeCloseTo(0.5, 6);
    for (let t = 0; t < 20; t += 0.5) w = wetness(w, true, 0.5);
    expect(w).toBe(1);
    w = wetness(w, false, WET_DRY_S / 4);
    expect(w).toBeCloseTo(0.75, 6);
    expect(wetness(0.01, false, 5)).toBe(0);
  });

  it('海面は 0.12 m/s で上がり、上がる間と上がり終えて 6 秒は波立ちが満ち、そのあと 24 秒で静まる', () => {
    let s: SurgeState = { level: 1, surge: 0, hold: 0 };
    s = surgeStep(s, 2.5, 5);
    expect(s.level).toBeCloseTo(1 + SURGE_RATE * 5, 6);
    expect(s.surge).toBe(1);
    // 追いつくまで
    for (let t = 0; t < 20; t += 0.1) s = surgeStep(s, 2.5, 0.1);
    expect(s.level).toBe(2.5);
    // 上がり終えてから SURGE_HOLD_S 秒は保つ (本体の沈降は途切れ途切れ)
    s = { ...s, hold: SURGE_HOLD_S };
    s = surgeStep(s, 2.5, SURGE_HOLD_S - 0.5);
    expect(s.surge).toBe(1);
    expect(s.hold).toBeCloseTo(0.5, 6);
    // 保ちが切れたコマから静まり始める
    s = surgeStep(s, 2.5, 0.5);
    expect(s.hold).toBe(0);
    s = surgeStep(s, 2.5, SURGE_CALM_S / 2 - 0.5);
    expect(s.surge).toBeCloseTo(0.5, 6);
    // 海面が下がるときは追わずにすぐ
    expect(surgeStep(s, 0.5, 0.1).level).toBe(0.5);
  });
});

describe('雨の水たまりと跳ね返り (M22-07 の手直し)', () => {
  it('水たまりは踏み固めた円の中の、平らか窪んだ所にだけ置き、互いに重ならない', () => {
    // x > 0 は急な斜面 (傾き 30%)、x < 0 は平ら
    const heightAt = (x: number) => (x > 0 ? x * 0.3 : 0);
    const spots = puddleSpots([{ x: 0, z: 0, r: 20 }], heightAt, mulberry32(3), 12);
    expect(spots.length).toBeGreaterThan(4);
    for (const s of spots) {
      expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(20 * 0.85 + 1e-9);
      expect(s.r).toBeGreaterThanOrEqual(1.2);
      expect(s.r).toBeLessThanOrEqual(3);
      // 斜面の上 (窪みでも平らでもない) には無い。斜面の裾 (周りの輪が斜面にかかり、真ん中が周りより低い) には置いてよい
      expect(s.x).toBeLessThan(s.r * 1.5);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z)).toBeGreaterThanOrEqual(spots[i].r + spots[j].r);
  });

  it('跳ね返りを置く面: 小屋の屋根の上は屋根の高さ、外と軒の外は地面。屋根の上の点を返す', () => {
    // 小屋 1 棟 (中心 (10, 0))。高さ 3 m の屋根の箱 4 × 4 m、地面は 1 m
    const box = new Mesh(new BoxGeometry(4, 0.2, 4), new MeshBasicMaterial());
    box.position.set(10, 3, 0);
    const roofs = new Group();
    roofs.add(box);
    const surface = createSurface(() => 1, [{ x: 10, z: 0 }], roofs);
    expect(surface.at(10, 0)).toBeCloseTo(3.1, 5);
    expect(surface.at(11.5, -1.5)).toBeCloseTo(3.1, 5);
    expect(surface.at(13, 0)).toBe(1);
    expect(surface.at(-20, 0)).toBe(1);
    // 屋根の点は 0.5 m おきで 4 × 4 m の中 (境を含めて 9 × 9)
    const n = surface.roofPoints.length / 3;
    expect(n).toBe(81);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(surface.roofPoints[i * 3] - 10)).toBeLessThanOrEqual(2);
      expect(surface.roofPoints[i * 3 + 1]).toBeCloseTo(3.1, 5);
    }
    // 屋根が無ければ地面そのまま
    expect(createSurface(() => 2, [{ x: 0, z: 0 }], null).at(0, 0)).toBe(2);
  });
});
