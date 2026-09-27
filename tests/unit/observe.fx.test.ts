import { describe, it, expect } from 'vitest';
import { BoxGeometry, DataTexture, DirectionalLight, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector2, Vector4 } from 'three';
import { MIST_LINGER_S, MIST_RISE_S, MIST_S, MIST_SPIN, SPROUT_DRAG, SPROUT_REACH_MAX, SPROUT_REACH_MIN, SURGE_CALM_S, SURGE_HOLD_S, SURGE_RATE, WET_DRY_S, WET_FILL_S, mistEnvelope, sproutBurst, sproutReach, surgeStep, wetness, type SurgeState } from '../../src/observe/fx';
import { AtmospherePass } from '../../src/observe/render/atmosphere';
import { SPLASH_KIND, sproutSpread } from '../../src/observe/render/motes';
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
  // (M22-07 の 3 回目で変更: 「放射が広すぎないか。草の周辺だけでいいのに」で 0.55〜1.35 倍 → 0.3〜1.0 倍。粒は円の外へ出ない)
  it('粒は円の 0.3〜1.0 倍まで飛び (外へは出ない)、7 割は 22 本の筋の向きにそろう', () => {
    expect(SPROUT_REACH_MIN).toBe(0.3);
    expect(SPROUT_REACH_MAX).toBe(1.0);
    const rng = mulberry32(5);
    const R = 20;
    let onRay = 0;
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < 2000; i++) {
      const p = sproutBurst(rng, R);
      const reach = p.speed / SPROUT_DRAG;
      lo = Math.min(lo, reach);
      hi = Math.max(hi, reach);
      expect(reach).toBeGreaterThanOrEqual(R * 0.3 - 1e-9);
      expect(reach).toBeLessThanOrEqual(R * 1.0 + 1e-9);
      expect(p.up).toBeGreaterThanOrEqual(1.2);
      expect(p.delay).toBeGreaterThanOrEqual(0);
      expect(p.delay).toBeLessThan(0.5);
      const k = (p.angle / (Math.PI * 2)) * 22 - 0.5;
      if (Math.abs(k - Math.round(k)) * ((Math.PI * 2) / 22) < 0.026) onRay++;
    }
    expect(onRay / 2000).toBeGreaterThan(0.68);
    expect(onRay / 2000).toBeLessThan(0.8);
    // 幅いっぱいに散る (中心寄りも縁も埋まる)
    expect(lo).toBeLessThan(R * 0.32);
    expect(hi).toBeGreaterThan(R * 0.98);
  });

  it('(M22-07 の 3 回目) 放射は植えた所の周りだけ: 植えた 1 セルの点 (半径 10 m) で粒は 9 m、光の板は 9.72 m まで (前は 18 m・24.3 m)', () => {
    const one = sproutSpread(10);
    expect(one.reach).toBeCloseTo(9, 6);
    expect(one.glow).toBeCloseTo(9.72, 6);
    // 前の広がり (1.8 倍・下限 16 m、板は 1.35 倍) の 4 割
    expect(one.glow / (Math.max(16, 10 * 1.8) * 1.35)).toBeCloseTo(0.4, 6);
    // 小さな円は下限 5 m、大きな円は 30 m で頭打ち (27 m)
    expect(sproutSpread(2).reach).toBe(5);
    expect(sproutSpread(5).reach).toBe(5);
    expect(sproutSpread(20).reach).toBeCloseTo(18, 6);
    expect(sproutSpread(80).reach).toBeCloseTo(27, 6);
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
  it('水たまりは雨より先に広がらない: 雨の強さが 4 秒で強まる間 (view.ts と同じ式)、濡れは見えている雨の 1 割以下に遅れる', () => {
    let rain = 0;
    let w = 0;
    const dt = 1 / 60;
    for (let t = dt; t <= 3; t += dt) {
      rain += (1 - rain) * Math.min(1, dt / 4);
      w = wetness(w, true, dt, rain);
      expect(w).toBeLessThanOrEqual(rain * 0.1);
    }
    expect(rain).toBeGreaterThan(0.5);
    for (let t = 0; t < 60; t += dt) {
      rain += (1 - rain) * Math.min(1, dt / 4);
      w = wetness(w, true, dt, rain);
    }
    expect(w).toBe(1);
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
    expect(surface.propPoints.length).toBe(0);
  });

  it('(M22-07 の 3 回目、「跳ね返りの対象を石垣と柱に広げて」) 石垣と柱の天端も焼き、天端の点を返す。屋根が先、地面は 0.3 m 未満の当たりを捨てる', () => {
    // 地面は 1 m。石垣 (中心 (0, 5)、長さ 4.1 m・厚み 0.7 m・天端 1.95 m) を 2 つの置き場所に、柱 (0.7 m 角・天端 3.75 m) を 1 つ
    // (光線の目 0.2 m おきが面の縁にちょうど乗らない大きさ)
    const wall = new Group();
    const w = new Mesh(new BoxGeometry(4.1, 0.95, 0.7), new MeshBasicMaterial());
    w.position.set(0, 1.475, 5);
    const w2 = w.clone();
    w2.position.set(20, 1.475, 5);
    wall.add(w, w2);
    const post = new Group();
    const p = new Mesh(new BoxGeometry(0.7, 2.75, 0.7), new MeshBasicMaterial());
    p.position.set(-6, 2.375, 0);
    // 足元の平たい石 (地面から 0.2 m) は天端に数えない
    const foot = new Mesh(new BoxGeometry(1.2, 0.4, 1.2), new MeshBasicMaterial());
    foot.position.set(-6, 1.0, 0);
    post.add(p, foot);
    const roofs = new Group();
    const roof = new Mesh(new BoxGeometry(4, 0.2, 4), new MeshBasicMaterial());
    roof.position.set(10, 3, 0);
    roofs.add(roof);
    const surface = createSurface(() => 1, [{ x: 10, z: 0 }], roofs, 9, 0.5, [
      { node: wall, sites: [{ x: 0, z: 5 }, { x: 20, z: 5 }], reach: 2.6 },
      { node: post, sites: [{ x: -6, z: 0 }], reach: 1.4 },
    ]);
    expect(surface.at(0, 5)).toBeCloseTo(1.95, 5);
    expect(surface.at(1.8, 5.2)).toBeCloseTo(1.95, 5);
    expect(surface.at(20, 5)).toBeCloseTo(1.95, 5);
    expect(surface.at(0, 6)).toBe(1);
    expect(surface.at(-6, 0)).toBeCloseTo(3.75, 5);
    expect(surface.at(-6.5, 0)).toBe(1);
    expect(surface.at(10, 0)).toBeCloseTo(3.1, 5);
    // 屋根の点は前と同じ 81、天端の点は 0.2 m おき: 石垣 21 × 3 を 2 つ、柱 3 × 3
    expect(surface.roofPoints.length / 3).toBe(81);
    const n = surface.propPoints.length / 3;
    expect(n).toBe(21 * 3 * 2 + 3 * 3);
    let onPost = 0;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [surface.propPoints[i * 3], surface.propPoints[i * 3 + 1], surface.propPoints[i * 3 + 2]];
      if (Math.abs(x + 6) < 0.5) {
        onPost++;
        expect(y).toBeCloseTo(3.75, 5);
        expect(Math.abs(z)).toBeLessThanOrEqual(0.35);
      } else {
        expect(y).toBeCloseTo(1.95, 5);
        expect(Math.abs(z - 5)).toBeLessThanOrEqual(0.35);
      }
    }
    expect(onPost).toBe(9);
  });
});

describe('(M22-07 の 3 回目) 雨の跳ね返りの大きさ: 「草や土は見えないくらいでちょうどいい」', () => {
  it('草と土はかすかに (0.14 m・濃さ 0.3・短く)、屋根は控えめ (0.42 m)、石垣と柱は屋根より小さい', () => {
    const SIZE = 0.6;
    expect(SIZE * SPLASH_KIND.ground.scale).toBeCloseTo(0.144, 6);
    expect(SIZE * SPLASH_KIND.roof.scale).toBeCloseTo(0.42, 6);
    expect(SIZE * SPLASH_KIND.prop.scale).toBeCloseTo(0.33, 6);
    expect(SPLASH_KIND.ground.alpha).toBe(0.3);
    expect(SPLASH_KIND.ground.life).toBeLessThan(SPLASH_KIND.prop.life);
    expect(SPLASH_KIND.prop.scale).toBeLessThan(SPLASH_KIND.roof.scale);
    // 前はどの面も 0.6 m・濃さ 1
    expect(SPLASH_KIND.roof.scale).toBeLessThan(1);
  });
});

describe('(M22-07 の 3 回目) 疫病の霧: 「螺旋の動きがみえない。」', () => {
  it('腕は 1 秒に 0.42 rad 回り、2〜3 秒で 48〜72° 回る (前は 1 秒に 2° ほど)', () => {
    expect(MIST_SPIN).toBe(-0.42);
    const deg = (s: number) => (Math.abs(MIST_SPIN) * s * 180) / Math.PI;
    expect(deg(2)).toBeGreaterThan(45);
    expect(deg(3)).toBeLessThan(75);
  });

  it('霧の下の地面の高さを 64 × 64 の表に焼き (余韻で広がる所まで)、中心と半径が変わったときだけ焼き直す', () => {
    const pass = new AtmospherePass(new PerspectiveCamera(), new DirectionalLight());
    let calls = 0;
    // 東へ 10% の上り坂 (x = −50 で 1 m)
    const heightAt = (x: number) => {
      calls++;
      return 6 + x * 0.1;
    };
    pass.setMist({ x: -50, y: 1, z: 20 }, 40, 1, 0, heightAt);
    expect(calls).toBe(64 * 64);
    const u = pass.mat.uniforms;
    const g = u.uMistGround.value as Vector4;
    const size = 40 * 1.45 * 2;
    expect(g.x).toBeCloseTo(-50 - size / 2, 6);
    expect(g.y).toBeCloseTo(20 - size / 2, 6);
    expect(g.z).toBeCloseTo(size, 6);
    const h = u.uMistGroundH.value as Vector2;
    // 表の目の中心の高さの幅: 端の目は縁から半目内側
    const cell = size / 64;
    expect(h.x).toBeCloseTo(6 + (g.x + cell / 2) * 0.1, 5);
    expect(h.y).toBeCloseTo((size - cell) * 0.1, 5);
    const tex = u.tMistGround.value as DataTexture;
    const data = tex.image.data as Uint8Array;
    // 西の端は 0、東の端は 255、真ん中の列は半ば。北から南へは変わらない
    expect(data[0]).toBe(0);
    expect(data[63]).toBe(255);
    expect(Math.abs(data[32] - 128)).toBeLessThanOrEqual(3);
    expect(data[63 * 64 + 63]).toBe(255);
    // 同じ霧のうちは焼き直さない (毎コマ呼ばれる)
    pass.setMist({ x: -50, y: 1, z: 20 }, 40, 0.5, 0.3, heightAt);
    expect(calls).toBe(64 * 64);
    // 霧が消えている間 (濃さ 0) は焼かない、新しい霧では焼き直す
    pass.setMist({ x: 0, y: 1, z: 0 }, 40, 0, 0, heightAt);
    expect(calls).toBe(64 * 64);
    pass.setMist({ x: 0, y: 1, z: 0 }, 40, 1, 0, heightAt);
    expect(calls).toBe(2 * 64 * 64);
    pass.dispose();
  });
});
