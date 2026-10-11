import type { TimelineEvent } from '../../scenario/ScenarioRunner';
import { createNoticeBand } from '../notice';
import type { Landmarks } from '../area';
import { CELL_M, type TerrainField } from '../render/terrain';
import type { Water } from '../render/water';
import type { Motes } from '../render/motes';
import type { Puddles } from '../render/puddles';
import type { AtmospherePass } from '../render/atmosphere';
import { MIST_S, mistEnvelope, wetness } from '../fx';
import type { SceneEvent } from '../scenes';
import type { ObserveInspect } from '../inspect';
import type { ObserveHost } from './host';
import type { Sea } from './sea';
import type { Stage } from './stage';
import type { ViewState } from './state';
import { DEPART_S } from './camera';

export type WeatherInput = {
  host: Pick<ObserveHost, 'names'>;
  nowMs: () => number;
  canvas: HTMLCanvasElement;
  field: TerrainField;
  stage: Stage;
  air: AtmospherePass | null;
  motes: Motes;
  puddles: Puddles;
  water: Water;
  sea: Sea;
  marks: Landmarks;
  home: number;
  state: ViewState;
};

export type Weather = {
  playScene(e: SceneEvent): void;
  notice(e: TimelineEvent): void;
  fx(dt: number): void;
  fxInsp: ObserveInspect['fx'];
  rain(): number;
};

export function createWeather({ host, nowMs, canvas, field, stage: { hemi }, air, motes, puddles, water, sea, marks, home, state }: WeatherInput): Weather {
  // 介入の場面 (M22-08): 芽吹きの金の粒・疫病の霧・雨。霧と雨は実時間で薄れる
  let mist = 0;
  // (M22-07 の手直し) 霧が立ってからの秒数。濃さと余韻は fx.ts の mistEnvelope が決める (MIST_S を過ぎたら消えている)
  let mistAge = MIST_S;
  let mistAt = { x: 0, y: 0, z: 0 };
  let mistR = 20;
  let rain = 0;
  let rainLeft = 0;
  // (M22-07 の手直しで変更: 霧の長さ MIST_S (90 秒) は fx.ts に移した)
  const RAIN_S = 45;
  // (M22-07 の手直し) 雨の濡れ (水たまりの広がり) と、波紋を動かす時刻
  let wet = 0;
  let fxTime = 0;
  const playScene = (e: SceneEvent) => {
    if (e.kind === 'sprout') motes.sprout(e.at, Math.max(1, e.radius) * CELL_M);
    else if (e.kind === 'mist') {
      mist = 1;
      mistAge = 0;
      mistR = Math.max(12, e.radius * CELL_M);
      mistAt = { x: e.at.x, y: field.heightAt(e.at.x, e.at.z), z: e.at.z };
    } else if (e.kind === 'rain') rainLeft = RAIN_S;
    else if (e.kind === 'departure') state.departLeft = DEPART_S;
    else if (e.kind === 'sailLost') lampsTarget = 0;
  };
  // 帆を失う (M22-08、設計 §6): 民が灯りを消す。文明の段階が帆に戻ったら (船が進み出したら) また灯す
  let lamps = 1;
  let lampsTarget = 1;
  // 知らせの帯 (M22-08): 石板の警告・祈り・結末を、画面の上に控えめに出して 8 秒で消す
  // (M22-08 の手直しで変更: 帯の DOM・見た目・寿命は notice.ts へ移した。石板の銘板の見た目にし、続けて来た知らせは待たせて順に出す)
  const band = createNoticeBand(canvas.parentElement ?? document.body, () => host.names ?? {});
  // 調整用: 開発者ツールから知らせを出す (__probe.observe.notice({ year, kind: 'prayer', phase: 'issued', prayer: 'wolves' }))
  const notice = (e: TimelineEvent) => band.push(e);
  const fx = (dt: number) => {
    band.step(nowMs());
    if (lampsTarget === 0 && state.snap.ship && state.snap.civ && state.snap.civ.stage >= 5) lampsTarget = 1;
    lamps += (lampsTarget - lamps) * Math.min(1, dt / 3);
    motes.setLamps(lamps);
    // (M22-07 の手直しで変更: 霧の濃さは一様に薄めず、fx.ts の mistEnvelope (立ち上がり → 満ちる → 最後の 32 秒の余韻) で決める)
    mistAge += dt;
    const env = mistEnvelope(mistAge);
    mist = env.amount;
    // (M22-07 の 3 回目で変更: 地面の高さを渡し、霧を地形に沿わせる (atmosphere.ts が霧の下の高さの表を焼く))
    air?.setMist(mistAt, mistR, mist, env.fade, field.heightAt);
    rainLeft = Math.max(0, rainLeft - dt);
    rain += ((rainLeft > 0 ? 1 : 0) - rain) * Math.min(1, dt / 4);
    motes.setRain(rain);
    // (M22-07 の手直し) 雨の水たまり・海面の波紋
    fxTime += dt;
    // (審査台 23:54 の指摘で変更: 濡れはいま見えている雨の強さ rain で満ちる。降り始めに水たまりが雨より先に広がらない)
    wet = wetness(wet, rainLeft > 0, dt, rain);
    puddles.update(wet, rain, hemi.color, fxTime);
    water.setRain(rain);
    sea.step(dt);
  };
  // 調整用: 開発者ツールから場面を起こす (__probe.observe.fx('sprout' | 'mist' | 'rain'))
  // (M22-07 の手直しで変更: 'sinking' は海面を 1.5 m 上げる (本体の沈降の代わり)。上がる間は波立ちと流れが見える)
  const fxInsp: ObserveInspect['fx'] = (kind) => {
    const at = marks.grove ?? marks.center;
    if (kind === 'sprout') playScene({ kind, year: state.snap.year, cell: home, at, speciesId: 'belltree', radius: 1 });
    else if (kind === 'mist') playScene({ kind, year: state.snap.year, cell: home, at, radius: 4 });
    else if (kind === 'sinking') sea.raise(1.5);
    else playScene({ kind, year: state.snap.year });
  };
  return { playScene, notice, fx, fxInsp, rain: () => rain };
}
