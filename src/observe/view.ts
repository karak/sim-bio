import type { WorldSnapshot } from '../simulation/types';
import type { TimelineEvent } from '../scenario/ScenarioRunner';
import { mulberry32 } from '../simulation/rng';
import { CELL_M, createTerrainField, createTerrainMesh, groundLayers } from './render/terrain';
import { createWater } from './render/water';
import { createGrass } from './render/grass';
import { loadGlb } from './render/assets';
import { triangleBreakdown } from './render/breakdown';
import { terrainDigest } from '../render/inspect';
import type { ObserveInspect } from './inspect';
import { initialDirector } from './director';
import { observeCenter } from './area';
import type { ViewState } from './view/state';
import { AREA_R, OPT, params, WINDOW } from './view/options';
import { createComposite, createStage, disposeStage } from './view/stage';
import { layOutSite } from './view/layout';
import { createFlora } from './view/flora';
import { createSettlement } from './view/settlementBuild';
import { createAgentLayer } from './view/agentLayer';
import { createSea } from './view/sea';
import { bindPointer, createDirector, createFraming, DEPART_S } from './view/camera';
import { createWeather } from './view/weather';
import { createFrameLoop } from './view/frame';
import type { ObserveHost } from './view/host';
export type { ObserveHost };

export type ObservationView = {
  /** 本体が進んだ snapshot を渡す (clock の無いとき)。timeline は石板の年表 (介入の場面を引くため、全体を渡してよい) */
  setSnapshot(s: WorldSnapshot, timeline?: readonly TimelineEvent[]): void;
  start(): void;
  stop(): void;
  /** 今のカメラ: 自動 (自然記録調)・自由 (触ったあと、20 秒で自動に戻る)・個体を追う */
  cameraMode(): 'auto' | 'free' | 'follow';
  /** 組んだ物を捨てる (M26-07): 止め、listener を外し、GPU の資源 (地形・素材・描画先・context) を解放する。以後は使わない */
  dispose(): void;
  /** 試験の口 (M25-09): 描いている物を読む。src/dev/probe.ts が開発・受入のビルドだけ window.__probe に繋ぐ */
  inspect(): ObserveInspect;
};

export async function createObservationView(host: ObserveHost): Promise<ObservationView> {
  const status = host.status;
  const s = host.snapshot;
  const nowMs = host.now ?? (() => performance.now());
  // (M19-18) 区域の中心。集落が無ければ島の真ん中の陸セルにし、集落だけの形 (小屋・船台など)・踏み固めた道・切り開き・民を置かない
  const { cell: home, settlement: hasSettlement } = observeCenter(s);
  const field = createTerrainField(s, home, WINDOW);

  const canvas = host.canvas;
  const stage = createStage(canvas, field);
  const { renderer, scene, camera, controls, sun } = stage;

  status.textContent = '地形を組んでいます…';
  const terrain = createTerrainMesh(s, field);
  scene.add(terrain);
  const water = createWater(field, 3000);
  scene.add(water.mesh);

  const [deerGlb, treeGlb, settleGlb, floraGlb, wolfGlb, rabbitGlb, shipGlb] = await Promise.all([
    loadGlb('/models/observe/deer.glb'),
    loadGlb('/models/observe/belltree.glb'),
    loadGlb('/models/observe/settlement.glb'),
    loadGlb('/models/observe/flora.glb'),
    loadGlb('/models/observe/wolf.glb'),
    loadGlb('/models/observe/rabbit.glb'),
    loadGlb('/models/observe/ship.glb'),
  ]);
  // (草の磨き上げ: 房の形は grass.ts の carpetTuft を使う (flora.glb の grass_tuft は星形に開いて判を押したように見えた)。地面と同じ層で色を決める)
  const grass = createGrass(field, groundLayers(s), OPT.grass, 7, undefined, (AREA_R + 1) * CELL_M);
  scene.add(grass.mesh);

  const { area, marks, slip, plaza, worn } = layOutSite(s, home, hasSettlement, field, terrain, grass);

  const rng = mulberry32(11);
  const flora = createFlora({ s, field, rng, hasSettlement, slip, treeGlb, floraGlb, stage });
  const { lods, forestSet, replant } = flora;

  const settle = createSettlement({ s, field, rng, hasSettlement, marks, slip, plaza, worn, settleGlb, shipGlb, stage });
  const { settlement, motes, puddles, shipView } = settle;

  status.textContent = '鹿を焼いています…';
  const herd = createAgentLayer({ s, area, hasSettlement, home, marks, deerGlb, wolfGlb, rabbitGlb, stage });
  const { creatures } = herd;
  const state: ViewState = {
    snap: s,
    area,
    targets: herd.initial.targets,
    building: !!s.ship && s.ship.launchedYear === undefined && (s.civ?.stage ?? 0) >= 5,
    agents: herd.initial.agents,
    simSpeed: OPT.freeze ? 0 : OPT.speed,
    director: initialDirector(),
    touched: !OPT.auto,
    followId: null,
    departLeft: OPT.depart && OPT.auto ? DEPART_S : 0,
    newEvents: [],
    seenEvents: 0,
    // 入った (start した) あとの最初の年表は、見る前の出来事として既読にするだけ (入るたびに昔の介入を再生しない)
    baseline: true,
  };
  const sea = createSea(s, home, water, grass);
  const onSnapshot = (next: WorldSnapshot) => {
    state.snap = next;
    replant(next);
    sea.retarget(next);
    herd.retarget(state);
    if (OPT.ship === null && !OPT.launched && !OPT.depart) shipView.set(state.snap.ship);
  };
  const clock = host.clock;

  const composite = createComposite(stage, canvas);
  const { air, resize } = composite;
  // 調整用 (M22-07): 開発者ツールから空気の層の uniform と時刻を触る
  // 試験の口 (M25-09): window に書かず inspect() で返す。src/dev/probe.ts が開発・受入のビルドだけ window に繋ぐ
  const airInsp: ObserveInspect['air'] = { air, sun, camera, controls, scene, renderer, heightAt: field.heightAt };
  status.textContent = '';

  const shots = host.shots;
  const { presets, lookInsp } = createFraming({ field, stage, lods, settlement, marks, slip, state });
  for (const [label, go] of host.debug === false ? [] : Object.entries(presets)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', go);
    shots.appendChild(b);
  }
  // 本体の速さ (M22-08 の仮。観察画面では 100x を選べない)
  // (操作画面から入ったときは操作画面の速さに従うので、ボタンは時間を自分で進めるとき (試作) だけ)
  for (const v of clock ? [0, 1, 10] : []) {
    const b = document.createElement('button');
    b.textContent = v === 0 ? '⏸' : `${v}x`;
    b.addEventListener('click', () => (state.simSpeed = v));
    shots.appendChild(b);
  }
  const weather = createWeather({ host, nowMs, canvas, field, stage, air, motes, puddles, water, sea, marks, home, state });
  const { playScene, notice, fxInsp } = weather;
  const { direct } = createDirector({ field, stage, lods, settlement, shipView, marks, slip, state, shots, playScene, notice });
  const { screenInsp } = bindPointer({ canvas, field, stage, state });
  // 軽量化の試算用: 区分ごとの三角形の内訳 (render/breakdown.ts)。__probe.observe.breakdown() を開発者ツールから呼ぶ
  const breakdownInsp: ObserveInspect['breakdown'] = () =>
    triangleBreakdown(camera, { terrain: [terrain], water: [water.mesh], grass: [grass.mesh], belltree: lods.filter((l) => l !== forestSet).map((l) => l.group), forest: forestSet ? [forestSet.group] : [], settlement: [settlement], ship: [shipView.group], creatures: [creatures.group] }, scene);
  const first = params.get('shot');
  const presetTimer = first && presets[first] ? setTimeout(presets[first], 1500) : 0;
  const frame = createFrameLoop({ host, nowMs, state, stage, composite, field, marks, water, grass, flora, settle, herd, weather, direct, onSnapshot, assets: { deer: !!deerGlb, belltree: !!treeGlb, settlement: !!settleGlb, flora: !!floraGlb, wolf: !!wolfGlb, rabbit: !!rabbitGlb } });
  return {
    inspect: () => ({ air: airInsp, notice, fx: fxInsp, look: lookInsp, huts: settle.hutsInsp, props: settle.propsInsp, breakdown: breakdownInsp, screen: screenInsp, stats: frame.stats, debug: frame.debug, terrainDigest: () => terrainDigest(terrain.geometry.getAttribute('position').array as Float32Array) }),
    setSnapshot(next, timeline) {
      if (timeline) {
        if (timeline.length < state.seenEvents) state.seenEvents = 0;
        if (!state.baseline) state.newEvents.push(...timeline.slice(state.seenEvents));
        state.seenEvents = timeline.length;
        state.baseline = false;
      }
      if (next.tick !== state.snap.tick) onSnapshot(next);
    },
    start: frame.start,
    stop: frame.stop,
    dispose() {
      clearTimeout(presetTimer);
      frame.stop();
      disposeStage(stage, resize);
    },
    cameraMode() {
      if (state.director.mode === 'auto') return 'auto';
      return state.followId !== null ? 'follow' : 'free';
    },
  };
}
