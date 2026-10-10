import type { WorldSnapshot } from '../../simulation/types';
import { observeYearText } from '../../core/season';
import type { Landmarks } from '../area';
import type { TerrainField } from '../render/terrain';
import type { Water } from '../render/water';
import type { Grass } from '../render/grass';
import { rimLight } from '../render/toon';
import { glow } from '../render/bake';
import { createDynamicResolution } from '../render/dynamicResolution';
import type { ObserveDebug, ObserveStats } from '../inspect';
import { DAY_CYCLE_S, daylightAt, phaseAt } from '../daylight';
import type { ObserveHost } from './host';
import { OPT } from './options';
import type { Composite, Stage } from './stage';
import type { ViewState } from './state';
import type { Flora } from './flora';
import type { Settlement } from './settlementBuild';
import type { AgentLayer } from './agentLayer';
import type { Weather } from './weather';

export type FrameInput = {
  host: Pick<ObserveHost, 'stats' | 'debug' | 'clock'>;
  nowMs: () => number;
  state: ViewState;
  stage: Stage;
  composite: Composite;
  field: TerrainField;
  marks: Landmarks;
  water: Water;
  grass: Grass;
  flora: Flora;
  settle: Settlement;
  herd: AgentLayer;
  weather: Weather;
  direct(dt: number): void;
  onSnapshot(next: WorldSnapshot): void;
  /** 素材が読めたか (計測の行に出す。組んだ後は変わらない) */
  assets: ObserveStats['assets'];
};

export type FrameLoop = { start(): void; stop(): void; stats(): ObserveStats | null; debug(): ObserveDebug | null };

export function createFrameLoop(input: FrameInput): FrameLoop {
  const { host, nowMs, state, stage, composite, field, marks, water, grass, flora, settle, herd, weather, direct, onSnapshot } = input;
  const { renderer, sky, camera, controls, hemi, sun } = stage;
  const { air, grade, resize } = composite;
  const { lods, stumpSet, understory } = flora;
  const { hutSet, propSets, motes, shipView } = settle;
  const { creatures } = herd;
  const { fx } = weather;
  // 本体の時間 (M22-08): 速度 speed のとき実時間 1 秒に speed tick 進める (操作画面と同じ。1 年 = 360 tick)。
  // 進んだら区域の密度から目標頭数を引き直す。目印 (船台・林) は最初に決めたまま動かさない (船台は着工の年に決めて動かさない)
  let simAcc = 0;
  const clock = host.clock;
  const advance = (dt: number) => {
    if (!clock || state.simSpeed <= 0) return;
    simAcc += dt * state.simSpeed;
    const n = Math.min(Math.floor(simAcc), 50);
    if (n <= 0) return;
    simAcc -= n;
    clock.step(n);
    onSnapshot(clock.snapshot());
  };
  let lastStats: ObserveStats | null = null;
  let lastDebug: ObserveDebug | null = null;
  const stats = host.stats;
  let last = nowMs();
  let t = 0;
  let frames = 0;
  let acc = 0;
  let fps = 0;
  // (M23-07) 動的な解像度。倍率は renderer のピクセル比に掛ける (ピクセル比 2 の画面は 0.5 = CSS の画素まで、1 の画面は 0.7 まで下げる)
  const dynres = OPT.dynres ? createDynamicResolution({ min: renderer.getPixelRatio() >= 1.5 ? 0.5 : 0.7 }) : null;
  const loop = () => {
    const now = nowMs();
    if (dynres) grade.setPixelRatio(renderer.getPixelRatio() * dynres.update(now - last));
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    // 試作の徘徊: 目的地へ歩き、着いたら食むか待つ (M22-04 の個体層に置き換える)
    // (置き換えた: 以下は個体層の 1 フレーム。出入りの計画 → 状態機械 → 描画)
    advance(dt);
    herd.flow(state, dt);
    const day = daylightAt(phaseAt(OPT.freeze ? 0 : (t * DAY_CYCLE_S) / OPT.day, OPT.time));
    if (sky && air) {
      sky.update(day, camera);
      air.setDay(day, t);
      hemi.color.set(day.skyColor);
      hemi.groundColor.set(day.groundColor);
      hemi.intensity = day.hemiIntensity;
      sun.color.set(day.lightColor);
      sun.intensity = day.lightIntensity;
      sun.position.set(day.lightDir.x * 120, day.lightDir.y * 120, day.lightDir.z * 120);
      // 夜は灯り・鐘の口・ムーの光を強める (焼いた材質の発光に共通で掛かる)
      glow.value = 1 + day.night * 1.1;
      rimLight.value.set(day.lightColor).multiplyScalar(day.lightIntensity / 2.6);
      // 雨の間は日が陰り、空気が濃くなる
      const rain = weather.rain();
      if (rain > 0.01) {
        sun.intensity *= 1 - rain * 0.5;
        hemi.intensity *= 1 - rain * 0.2;
        air.mat.uniforms.uHaze.value *= 1 + rain * 1.8;
        air.mat.uniforms.uShafts.value *= 1 - rain * 0.8;
      }
    }
    fx(dt);
    herd.step(state, dt, day.night > 0.6);
    motes.update(t, dt, day.night, camera, controls.target, state.agents.agents);
    water.update(t);
    shipView.update(t);
    direct(dt);
    // (M23-02 で変更: 視錐台で落とすもの (群れ・木・下草・草) は、このコマのカメラが決まった後 (direct の後) に更新する。前だと寄せ先へ切り替えた最初のコマが前の画の視錐台で描かれる)
    creatures.update(state.agents.agents, camera, field.heightAt, t, dt);
    for (const l of lods) l.update(camera);
    hutSet?.update(camera);
    stumpSet?.update(camera);
    for (const p of propSets) p.update(camera);
    for (const u of understory) u.update(camera);
    grass.update(t, camera.position, camera);
    renderer.info.autoReset = false;
    renderer.info.reset();
    grade.render(dt);
    frames++;
    acc += dt;
    if (acc >= 0.5) {
      fps = frames / acc;
      frames = 0;
      acc = 0;
      const info = renderer.info.render;
      const count = (sp: string) => state.agents.agents.filter((a) => a.species === sp).length;
      const st: ObserveStats = { follow: state.followId, camera: state.director.mode === 'auto' ? `${state.director.shot?.kind}:${state.director.shot?.reason}` : 'free', at: camera.position.toArray().map(Math.round), year: state.snap.year, tick: state.snap.tick, speed: state.simSpeed, ship: shipView.node(), phase: +day.phase.toFixed(3), fps: Math.round(fps), res: dynres?.scale ?? 1, calls: info.calls, triangles: info.triangles, deer: count('deer'), wolf: count('wolf'), rabbit: count('rabbit'), folk: state.agents.agents.filter((a) => a.role === 'folk').length, trees: flora.treeCount(), grass: grass.mesh.count + grass.far.count, assets: input.assets };
      lastStats = st;
      lastDebug = { marks, agents: state.agents.agents.map((g) => ({ id: g.id, sp: g.species, role: g.role, st: g.state, x: Math.round(g.x), z: Math.round(g.z) })) };
      if (host.debug === false) stats.textContent = observeYearText(state.snap);
      else stats.textContent = `${st.year} 年 · ${!clock ? '' : state.simSpeed === 0 ? '⏸ · ' : `${state.simSpeed}x · `}${st.fps} fps${st.res < 1 ? ` (解像度 ×${st.res})` : ''} · calls ${st.calls} · tris ${(st.triangles / 1000).toFixed(0)}k · 鹿 ${st.deer}(民 ${st.folk}) · 狼 ${st.wolf} · 兎 ${st.rabbit} · 鐘樹 ${st.trees} · 草 ${st.grass}`;
    }
    if (running) handle = requestAnimationFrame(loop);
  };
  let running = false;
  let handle = 0;
  return {
    start() {
      if (running) return;
      running = true;
      state.baseline = true;
      last = nowMs();
      resize();
      handle = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
    stats: () => lastStats,
    debug: () => lastDebug,
  };
}
