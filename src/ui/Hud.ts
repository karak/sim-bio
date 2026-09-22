import type { Command, DisasterKind, SaveData, WorldSnapshot } from '../simulation/types';
import type { CivState } from '../simulation/civilization';
import { STAGE_NAMES, NEED, cellDistance } from '../simulation/civilization';
import type { Speed } from '../core/runner';
import type { LayerKind } from '../render/layerToColors';
import { TimeSeries } from './timeSeries';
import { drawGraph, type GraphLine, type GraphMarker } from './graph';
import { SEA_LEVEL } from '../simulation/terrain';
import { EDICT_FAITH } from '../simulation/edict';
import { formatFaith } from '../simulation/faith';
import { canIntercept, INTERCEPT_NEED, WORKS_FAITH } from '../simulation/works';
import { TOWER_CRYSTAL, TOWER_FAITH } from '../simulation/weatherTower';
import { canLaunchShip, shipDone, timberAround, SHIP_CREW, SHIP_FAITH, SHIP_FOREST_MIN, SHIP_NEED, type ShipState } from '../simulation/ship';
import { LOAD_RADIUS } from '../simulation/civilizationLoad';
import './hud.css';

/** HUD 左上に出す文明の 1 行。文明なし・stage 0 では null (行を出さない) */
export function formatCiv(civ: CivState | null): string | null {
  if (!civ || civ.stage < 1) return null;
  const name = STAGE_NAMES[civ.stage] ?? '?';
  // 進みは次の段階に必要な量 (NEED) に対する割合。最終段階では 100%。民は密度の和 (小さい値) なので 100 倍して整数で見せる (M8-06)
  const need = NEED[civ.stage];
  const pct = Number.isFinite(need) && need > 0 ? Math.min(100, Math.round((civ.progress / need) * 100)) : 100;
  // 燃料 (M8-08): stage 4 (石) 以降、fuel の実績があるときだけ「· 燃料 直近 / 必要」を足す
  // 蓄え (M8-05 v2): 「燃料 蓄え / 年に必要」。蓄えが必要量を割ると足りない年になる
  const fuelText = civ.fuel && civ.stage >= 4 ? ` · 燃料 ${Math.round(civ.fuel.stock)} / ${Math.round(civ.fuel.need)}年` : '';
  // 信仰 (M9-01): 発生済みでもまだ年をまたいでいなければ undefined なので、そのときは出さない
  const faithText = civ.faith !== undefined ? ` · 信仰 ${formatFaith(civ.faith)}` : '';
  // 勅令 (M9-03): 民が採掘を止めている間は「採掘 止」を足す (止めるまでは出さない)
  const miningText = civ.miningStopped ? ' · 採掘 止' : '';
  // 集落の生気 (M9-05): 霊脈枯れの判定 (集落の生気 3 割) が HUD で読めるように。年をまたぐ前は無い
  const vitalityText = civ.vitality !== undefined ? ` · 生気 ${Math.round(civ.vitality * 100)}%` : '';
  // 星の工事 (M10-02): 星になって年をまたぐと works が付く。「工事 備蓄 / 必要」、止まっていれば「止」を足す
  const worksText = civ.works ? ` · 工事 ${civ.works.stock.toFixed(1)} / ${INTERCEPT_NEED}${civ.works.stopped ? ' 止' : ''}` : '';
  // 星の門 (M10 レビュー): 塔以上では星の門と星の衰退が見る半径 12 の民も出す (支え半径 8 の「民」だけでは、なぜ星に上がれないか読めない)
  const starText = civ.stage >= 6 && civ.populationStar !== undefined ? ` · 星の民 ${Math.round(civ.populationStar * 100)}` : '';
  return `文明 ${name}(${civ.stage}) · 進み ${pct}% · 民 ${Math.round(civ.population * 100)}${starText}${fuelText}${faithText}${vitalityText}${miningText}${worksText}`;
}

/**
 * #hud-ship の説明文 (M10-03)。formatCiv とは別の行に出す (formatCiv の既存の文字列はテストが留め金にしているので変えない)。
 * 未着工なら門の説明、建造中なら進み、完成したが信仰不足なら「民は乗らない」を添え、飛び立てば専用の文を返す。
 */
export function formatShipHint(civ: CivState | null, ship: ShipState | null): string {
  if (!ship) return `帆・信仰 ${SHIP_FAITH}・材 ${SHIP_FOREST_MIN} で着工。材を伐って ${SHIP_NEED} まで進む`;
  if (ship.launchedYear !== undefined) return '舟は飛び立った';
  const faith = civ?.faith ?? 0;
  const done = shipDone(ship);
  const faithWaiting = done && faith < SHIP_FAITH;
  // 乗せる民 (M10R-04): 信仰は足りているが、SHIP_CREW (徴収半径の民の平均) に足りない年の文言
  const crew = civ?.populationShip ?? 0;
  const crewWaiting = done && !faithWaiting && crew < SHIP_CREW;
  const waitingText = faithWaiting ? ` · 民は乗らない(信仰 ${formatFaith(faith)})` : crewWaiting ? ` · 民が乗るには足りない(民 ${crew.toFixed(2)} / ${SHIP_CREW})` : '';
  return `舟 進み ${ship.progress.toFixed(1)} / ${SHIP_NEED}` + waitingText;
}

export type HudHandlers = {
  onCommand(cmd: Command): void;
  onSpeed(s: Speed): void;
  onLayer(l: LayerKind): void;
  onSave(): SaveData;
  onLoad(save: SaveData): void;
  /** 災害ボタンを押した (次に島をクリックした場所に落とす) / 解除した */
  onDisasterArm(kind: DisasterKind | null): void;
  /** 種パレットで種を選んだ (次に島をクリックした場所に放つ) / 解除した */
  onSpawnArm(speciesId: string | null): void;
  /** 気象塔チップを押した (次に島をクリックした場所に build_tower を送る) / 解除した (M10-01) */
  onTowerArm(active: boolean): void;
};

export type Hud = {
  update(s: WorldSnapshot): void;
  showCell(cell: number | null, s: WorldSnapshot): void;
  addMarker(x: number, label: string, color: string): void;
  setArmed(kind: DisasterKind | null): void;
  setSpawnArmed(speciesId: string | null): void;
  /** 気象塔チップの武装状態を外から揃える (M10-01) */
  setTowerArmed(active: boolean): void;
  /** 星の力で買えるかどうか。false のチップは薄く見せる (押せるが runner が弾く) */
  setAffordable(a: { spawn: boolean; disaster: boolean; climate: boolean; tower: boolean }): void;
  /** 舟の行を出すか (M10-04)。逃がす条件 (escape) の無い石板では「舟を作れ」が気を散らすので隠す。自由モードでは出す */
  setShipEnabled(on: boolean): void;
};

const SEASONS = ['春', '夏', '秋', '冬'];
/** セル時系列: サンプリング間隔 (tick)、保持年数、平均を取る半径 */
const LOCAL_SAMPLE_TICKS = 10;
const LOCAL_YEARS = 5;
const LOCAL_RADIUS = 3;
const SPEEDS: Speed[] = [0, 1, 10, 100];
const LAYERS: { id: Exclude<LayerKind, `species:${string}`>; label: string }[] = [
  { id: 'terrain', label: '地形' },
  { id: 'temperature', label: '気温' },
  { id: 'moisture', label: '降水' },
  { id: 'vegetation', label: '植生' },
  { id: 'vitality', label: '生気' },
  { id: 'crystal', label: '輝石' },
];
const DISASTERS: { kind: DisasterKind; label: string }[] = [
  { kind: 'meteor', label: '隕石' },
  { kind: 'volcano', label: '火山' },
  { kind: 'wildfire', label: '山火事' },
  { kind: 'plague', label: '疫病' },
];

/** DOM・グラフ・ファイル入出力を隠す。World を直接持たず、handlers 経由で main.ts に渡す。 */
export function createHud(root: HTMLElement, h: HudHandlers): Hud {
  root.insertAdjacentHTML(
    'beforeend',
    `
  <div class="hud hud-tl">
    <div><span id="hud-year" class="mono">Year 0</span> <span id="hud-season" class="dim">春 · Day 0</span></div>
    <div id="hud-civ" class="mono" hidden></div>
    <div id="hud-edict" class="row" hidden><span class="dim">勅令</span><button id="edict-stop" class="chip">採掘を止めよ</button><button id="edict-resume" class="chip">再開せよ</button><span class="dim">信仰 ${EDICT_FAITH} 以上で民が従う</span></div>
    <div id="hud-works" class="row" hidden><span class="dim">迎撃</span><button id="intercept-btn" class="chip">星を砕け</button><span class="dim">星の民が備蓄 ${INTERCEPT_NEED} を積むと撃てる(工事は信仰 ${WORKS_FAITH} 以上で進む)</span></div>
    <div id="hud-ship" class="row" hidden><span class="dim">舟</span><button id="ship-btn" class="chip">舟を作れ</button><span id="ship-hint" class="dim"></span></div>
    <div class="row" id="speed-row">${SPEEDS.map((s) => `<button id="speed-${s}" class="chip${s === 1 ? ' on' : ''}">${s === 0 ? '⏸' : s + 'x'}</button>`).join('')}</div>
  </div>
  <div class="hud-right">
  <div class="hud hud-tr row" id="layer-row">${LAYERS.map((l) => `<button id="layer-${l.id}" class="chip${l.id === 'terrain' ? ' on' : ''}">${l.label}</button>`).join('')}<span id="layer-mode" class="row"><button id="layer-mode-density" class="chip on">密度</button><button id="layer-mode-suit" class="chip">住みやすさ</button></span><span id="layer-species" class="row"></span></div>
  <div class="hud hud-r">
    <div class="dim">個体数の推移</div>
    <canvas id="graph" width="640" height="200"></canvas>
    <div id="legend" class="row"></div>
    <div class="stats"><span id="stat-temp" class="mono">--℃</span><span class="dim">平均気温</span><span id="stat-veg" class="mono">--%</span><span class="dim">植生率</span></div>
  </div>
  </div>
  <div class="hud hud-b">
    <label>気温 <input id="temp-offset" type="range" min="-10" max="10" step="0.5" value="0"><span id="temp-offset-v" class="mono">+0.0</span></label>
    <label>降水 <input id="rain-scale" type="range" min="0.3" max="2" step="0.05" value="1"><span id="rain-scale-v" class="mono">×1.00</span></label>
    <span class="sep"></span>
    ${DISASTERS.map((d) => `<button id="disaster-${d.kind}" class="chip">${d.label}</button>`).join('')}
    <span id="volcano-hint" class="dim" hidden>火の山: 島の印(火口)に打てば熱が塔の燃料になる</span>
    <button id="tower-chip" class="chip">気象塔</button>
    <span id="tower-hint" class="dim" hidden>塔・信仰 ${TOWER_FAITH}・輝石 ${TOWER_CRYSTAL}</span>
    <span class="sep"></span>
    <button id="save-btn" class="chip">保存</button>
    <label class="chip">読込<input id="load-input" type="file" accept="application/json" hidden></label>
  </div>
  <div class="hud hud-palette"><span class="dim">種を放つ</span><span id="spawn-row" class="row"></span></div>
  <div class="hud hud-bl" id="cell-panel" hidden>
    <div id="cell-info"></div>
    <div class="dim" style="margin-top:6px">周辺 (半径 ${LOCAL_RADIUS}) の密度 · 直近 ${LOCAL_YEARS} 年</div>
    <canvas id="local-graph" width="480" height="160"></canvas>
  </div>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>('#' + id);
    if (!el) throw new Error(`hud element missing: #${id}`);
    return el;
  };

  const ts = new TimeSeries(500);
  const local = new TimeSeries((LOCAL_YEARS * 360) / LOCAL_SAMPLE_TICKS);
  let localCell: number | null = null;
  let shipEnabled = true;
  let localLastTick = -1;
  const markers: GraphMarker[] = [];
  let lines: GraphLine[] = [];
  let lastYear = -1;
  let armed: DisasterKind | null = null;
  let spawnArmed: string | null = null;
  /** 気象塔チップを持っているか (M10-01)。災害・種パレットと排他 */
  let towerArmed = false;
  // 種チップの表示モード: 密度そのまま or 住みやすさ (適合度)。選択中の種があるときだけ layer に効く
  let layerMode: 'density' | 'suit' = 'density';
  let activeSpeciesId: string | null = null;

  const setOn = (rowId: string, id: string) => {
    for (const b of $(rowId).querySelectorAll('.chip')) b.classList.toggle('on', b.id === id);
  };
  // setOn は行内の .chip を丸ごと消灯するので、その後にモードチップの見た目を復元する
  const setLayerModeUI = () => {
    $('layer-mode-density').classList.toggle('on', layerMode === 'density');
    $('layer-mode-suit').classList.toggle('on', layerMode === 'suit');
  };
  for (const s of SPEEDS) {
    $(`speed-${s}`).addEventListener('click', () => {
      h.onSpeed(s);
      setOn('speed-row', `speed-${s}`);
    });
  }
  for (const l of LAYERS) {
    $(`layer-${l.id}`).addEventListener('click', () => {
      activeSpeciesId = null;
      h.onLayer(l.id);
      setOn('layer-row', `layer-${l.id}`);
      setLayerModeUI();
    });
  }
  const setLayerMode = (m: 'density' | 'suit') => {
    layerMode = m;
    setLayerModeUI();
    if (activeSpeciesId !== null) h.onLayer(m === 'suit' ? `suit:${activeSpeciesId}` : `species:${activeSpeciesId}`);
  };
  $('layer-mode-density').addEventListener('click', () => setLayerMode('density'));
  $('layer-mode-suit').addEventListener('click', () => setLayerMode('suit'));
  const tempEl = $<HTMLInputElement>('temp-offset');
  const rainEl = $<HTMLInputElement>('rain-scale');
  /** 直前のフレームで世界が持っていた気候。変化したときだけスライダーを追従させる */
  let lastWorldRain = 1;
  let lastWorldTemp = 0;
  tempEl.addEventListener('input', () => {
    const v = Number(tempEl.value);
    $('temp-offset-v').textContent = (v >= 0 ? '+' : '') + v.toFixed(1);
    h.onCommand({ type: 'set_climate', tempOffset: v });
  });
  rainEl.addEventListener('input', () => {
    const v = Number(rainEl.value);
    $('rain-scale-v').textContent = '×' + v.toFixed(2);
    h.onCommand({ type: 'set_climate', rainScale: v });
  });
  // 気象塔チップ (M10-01): 災害・種パレットと同じ「武装 → 次のクリックで発火」の流儀。三者は排他 (どれか 1 つだけ武装できる)
  const setTowerArmed = (v: boolean) => {
    towerArmed = v;
    $('tower-chip').classList.toggle('armed', v);
    $('tower-hint').hidden = !v;
    h.onTowerArm(v);
  };
  const setSpawnArmed = (id: string | null) => {
    spawnArmed = id;
    for (const b of $('spawn-row').querySelectorAll('.chip')) b.classList.toggle('armed', b.id === `spawn-${id}`);
    if (id !== null && towerArmed) setTowerArmed(false);
    h.onSpawnArm(id);
  };
  const setArmed = (k: DisasterKind | null) => {
    armed = k;
    for (const d of DISASTERS) $(`disaster-${d.kind}`).classList.toggle('armed', d.kind === k);
    // 火山チップを持っているときだけ、火山セルへの誘導ヒントを出す (M8-08)
    $('volcano-hint').hidden = k !== 'volcano';
    if (k !== null && spawnArmed !== null) setSpawnArmed(null);
    if (k !== null && towerArmed) setTowerArmed(false);
    h.onDisasterArm(k);
  };
  $('tower-chip').addEventListener('click', () => {
    const next = !towerArmed;
    if (next && armed !== null) setArmed(null);
    if (next && spawnArmed !== null) setSpawnArmed(null);
    setTowerArmed(next);
  });
  for (const d of DISASTERS) {
    $(`disaster-${d.kind}`).addEventListener('click', () => setArmed(armed === d.kind ? null : d.kind));
  }
  // 勅令 (M9-03): 石板の言葉として dispatch する (力は要らない。信仰の門は World 側)
  $('edict-stop').addEventListener('click', () => h.onCommand({ type: 'civ_edict', edict: 'stop_mining' }));
  $('edict-resume').addEventListener('click', () => h.onCommand({ type: 'civ_edict', edict: 'resume_mining' }));
  $('intercept-btn').addEventListener('click', () => h.onCommand({ type: 'intercept' }));
  $('ship-btn').addEventListener('click', () => h.onCommand({ type: 'launch_ship' }));
  $('save-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(h.onSave())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `biotope-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $<HTMLInputElement>('load-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    f.text()
      .then((t) => h.onLoad(JSON.parse(t) as SaveData))
      .catch((err: unknown) => console.error('load failed', err))
      .finally(() => {
        input.value = '';
      });
  });

  const canvas = $<HTMLCanvasElement>('graph');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const redraw = () => drawGraph(ctx, ts, lines, markers, canvas.width, canvas.height);
  const localCanvas = $<HTMLCanvasElement>('local-graph');
  const localCtx = localCanvas.getContext('2d');
  if (!localCtx) throw new Error('2d context unavailable');
  const redrawLocal = () =>
    drawGraph(localCtx, local, lines.filter((l) => l.axis !== 'right'), [], localCanvas.width, localCanvas.height);

  /** 選択セル周辺の種ごとの平均密度 */
  const localDensities = (cell: number, s: WorldSnapshot): Record<string, number> => {
    const x0 = cell % s.size;
    const y0 = (cell - x0) / s.size;
    const out: Record<string, number> = {};
    let count = 0;
    for (const d of s.species) out[d.id] = 0;
    for (let dy = -LOCAL_RADIUS; dy <= LOCAL_RADIUS; dy++) {
      for (let dx = -LOCAL_RADIUS; dx <= LOCAL_RADIUS; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= s.size || y >= s.size || dx * dx + dy * dy > LOCAL_RADIUS * LOCAL_RADIUS) continue;
        const i = y * s.size + x;
        if (s.layers.elevation[i] < SEA_LEVEL) continue;
        count++;
        for (const d of s.species) out[d.id] += s.layers.populations[d.id][i];
      }
    }
    if (count) for (const k of Object.keys(out)) out[k] /= count;
    return out;
  };

  const ensureSpecies = (s: WorldSnapshot) => {
    if (lines.length === s.species.length + 1) return;
    lines = [
      ...s.species.map((d) => ({ key: d.id, color: d.color, label: d.name })),
      { key: 'temp', color: '#A79CE0', label: '平均気温', axis: 'right' as const },
    ];
    // 凡例には現在の総量も出す (年に 1 回更新)。疫病を打つかなどの判断に数字が要る
    $('legend').innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${l.label} <b id="legend-${l.key}" class="mono"></b></span>`).join('');
    $('layer-species').innerHTML = s.species.map((d) => `<button id="layer-species-${d.id}" class="chip">${d.name}</button>`).join('');
    for (const d of s.species) {
      $(`layer-species-${d.id}`).addEventListener('click', () => {
        activeSpeciesId = d.id;
        h.onLayer(layerMode === 'suit' ? `suit:${d.id}` : `species:${d.id}`);
        setOn('layer-row', `layer-species-${d.id}`);
        setLayerModeUI();
      });
    }
    // spawnable: false の種 (M8-09: 炎蜥蜴) は放流チップを出さない。凡例・住みやすさレイヤーには出る (上のループ)
    const spawnableSpecies = s.species.filter((d) => d.spawnable !== false);
    $('spawn-row').innerHTML = spawnableSpecies
      .map((d) => `<button id="spawn-${d.id}" class="chip"><i class="swatch" style="background:${d.color}"></i>${d.name}</button>`)
      .join('');
    for (const d of spawnableSpecies) {
      $(`spawn-${d.id}`).addEventListener('click', () => {
        const next = spawnArmed === d.id ? null : d.id;
        if (next !== null && armed !== null) setArmed(null);
        setSpawnArmed(next);
      });
    }
  };

  const vegRatio = (s: WorldSnapshot) => {
    let land = 0;
    let v = 0;
    for (let i = 0; i < s.layers.elevation.length; i++) {
      if (s.layers.elevation[i] >= SEA_LEVEL) {
        land++;
        v += s.layers.vegetation[i];
      }
    }
    return land ? v / land : 0;
  };

  const update = (s: WorldSnapshot) => {
    ensureSpecies(s);
    if (localCell !== null && s.tick % LOCAL_SAMPLE_TICKS === 0 && s.tick !== localLastTick) {
      localLastTick = s.tick;
      local.push(s.tick / 360, localDensities(localCell, s));
      redrawLocal();
    }
    $('hud-year').textContent = `Year ${s.year}`;
    // 世界の気候が変わったときだけスライダーを追従させる (力が尽きて既定に戻ったときなど)。
    // 差があるたびに戻すと、一時停止中に動かしたスライダー (コマンドは次の step で適用) と喧嘩する
    if (s.climate.rainScale !== lastWorldRain) {
      lastWorldRain = s.climate.rainScale;
      rainEl.value = String(s.climate.rainScale);
      $('rain-scale-v').textContent = '×' + s.climate.rainScale.toFixed(2);
    }
    if (s.climate.tempOffset !== lastWorldTemp) {
      lastWorldTemp = s.climate.tempOffset;
      tempEl.value = String(s.climate.tempOffset);
      $('temp-offset-v').textContent = (s.climate.tempOffset >= 0 ? '+' : '') + s.climate.tempOffset.toFixed(1);
    }
    $('hud-season').textContent = `${SEASONS[Math.floor((s.dayOfYear / 360) * 4) % 4]} · Day ${s.dayOfYear}`;
    const civText = formatCiv(s.civ);
    const civEl = $('hud-civ');
    civEl.hidden = civText === null;
    if (civText !== null) civEl.textContent = civText;
    // 勅令 (M9-03): 文明があるときだけ石板の勅令を出す。止まっていれば「止めよ」を、掘っていれば「再開せよ」を沈める
    const edictEl = $('hud-edict');
    edictEl.hidden = civText === null;
    if (civText !== null) {
      const stopped = s.civ?.miningStopped ?? false;
      $('edict-stop').classList.toggle('on', stopped);
      $('edict-resume').classList.toggle('on', !stopped);
    }
    // 迎撃 (M10-02): 星になって工事が始まったら行を出す。備蓄が足りるまでは沈める (unaffordable)
    const worksEl = $('hud-works');
    worksEl.hidden = !s.civ?.works;
    if (s.civ?.works) $('intercept-btn').classList.toggle('unaffordable', !canIntercept(s.civ).ok);
    // 空の舟 (M10-03): 文明が発生していれば行を出す (帆に満たない間は門の説明だけ)。formatCiv は変えず、この行にだけ進みを出す
    // M10-04 のプレイテスト: 「迎撃の塔」で「舟を作れ」が並ぶと気が散るので、石板に逃がす条件が無ければ行ごと隠す (setShipEnabled)
    const shipEl = $('hud-ship');
    shipEl.hidden = civText === null || !shipEnabled;
    if (civText !== null && s.civ && shipEnabled) {
      const civ = s.civ;
      $('ship-hint').textContent = formatShipHint(civ, s.ship);
      const radius = LOAD_RADIUS[civ.stage] ?? 0;
      const timber = timberAround({ forest: s.layers.populations['forest'], belltree: s.layers.populations['belltree'] }, civ.home, radius, s.layers.elevation, s.size);
      $('ship-btn').classList.toggle('unaffordable', !canLaunchShip(civ, timber, s.ship).ok);
    }
    if (s.year !== lastYear) {
      lastYear = s.year;
      ts.push(s.year, { ...s.totals, temp: s.meanTemperature });
      for (const d of s.species) $(`legend-${d.id}`).textContent = (s.totals[d.id] ?? 0).toFixed(0);
      redraw();
      $('stat-temp').textContent = `${s.meanTemperature.toFixed(1)}℃`;
      $('stat-veg').textContent = `${(vegRatio(s) * 100).toFixed(0)}%`;
    }
  };

  const showCell = (cell: number | null, s: WorldSnapshot) => {
    const p = $('cell-panel');
    if (cell === null) {
      p.hidden = true;
      localCell = null;
      return;
    }
    if (cell !== localCell) {
      localCell = cell;
      localLastTick = -1;
      local.clear();
      local.push(s.tick / 360, localDensities(cell, s));
      redrawLocal();
    }
    const x = cell % s.size;
    const y = (cell - x) / s.size;
    const L = s.layers;
    const sea = L.elevation[cell] < SEA_LEVEL;
    p.hidden = false;
    // 気象塔 (M10-01): このセルが効いている塔の半径内なら「気象塔: 雨 N×」を出す。
    // 複数の塔が重なれば towers 配列の後ろ (= 後で建てたもの) を優先する (World.towerFactors と同じ規約)
    let tower: WorldSnapshot['towers'][number] | null = null;
    for (const t of s.towers) if (t.active && cellDistance(cell, t.cell, s.size) <= t.radius) tower = t;
    const towerText = tower
      ? `<div><span>気象塔</span><span class="mono">雨 ${tower.rainScale.toFixed(2)}×${tower.tempOffset !== 0 ? `・気温 ${tower.tempOffset >= 0 ? '+' : ''}${tower.tempOffset.toFixed(1)}` : ''}</span></div>`
      : '';
    $('cell-info').innerHTML =
      `<div class="mono">セル (${x}, ${y})${sea ? ' · 海' : ''}</div>` +
      `<div><span>標高</span><span class="mono">${Math.round(L.elevation[cell] * 1000)} m</span></div>` +
      `<div><span>気温 / 水分</span><span class="mono">${L.temperature[cell].toFixed(1)}℃ / ${L.moisture[cell].toFixed(2)}</span></div>` +
      `<div><span>生気 / 枯死</span><span class="mono">${L.vitality[cell].toFixed(2)} / ${L.litter[cell].toFixed(2)}</span></div>` +
      `<div><span>輝石</span><span class="mono">${L.crystal[cell].toFixed(2)}</span></div>` +
      towerText +
      s.species.map((d) => `<div><span>${d.name}</span><span class="mono">${L.populations[d.id][cell].toFixed(2)}</span></div>`).join('');
  };

  return {
    update,
    showCell,
    addMarker: (x, label, color) => {
      markers.push({ x, label, color });
      redraw();
    },
    setArmed,
    setSpawnArmed,
    setTowerArmed,
    setShipEnabled: (on) => {
      shipEnabled = on;
      if (!on) $('hud-ship').hidden = true;
    },
    setAffordable: (a) => {
      for (const b of $('spawn-row').querySelectorAll('.chip')) b.classList.toggle('unaffordable', !a.spawn);
      for (const d of DISASTERS) $(`disaster-${d.kind}`).classList.toggle('unaffordable', !a.disaster);
      tempEl.classList.toggle('unaffordable', !a.climate);
      rainEl.classList.toggle('unaffordable', !a.climate);
      $('tower-chip').classList.toggle('unaffordable', !a.tower);
    },
  };
}
