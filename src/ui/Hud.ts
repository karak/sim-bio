import type { Command, DisasterKind, SaveData, WorldSnapshot } from '../simulation/types';
import type { Speed } from '../core/runner';
import type { LayerKind } from '../render/layerToColors';
import { TimeSeries } from './timeSeries';
import { drawGraph, type GraphLine, type GraphMarker } from './graph';
import { SEA_LEVEL } from '../simulation/terrain';
import './hud.css';

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
};

export type Hud = {
  update(s: WorldSnapshot): void;
  showCell(cell: number | null, s: WorldSnapshot): void;
  addMarker(x: number, label: string, color: string): void;
  setArmed(kind: DisasterKind | null): void;
  setSpawnArmed(speciesId: string | null): void;
};

const SEASONS = ['春', '夏', '秋', '冬'];
const SPEEDS: Speed[] = [0, 1, 10, 100];
const LAYERS: { id: Exclude<LayerKind, `species:${string}`>; label: string }[] = [
  { id: 'terrain', label: '地形' },
  { id: 'temperature', label: '気温' },
  { id: 'moisture', label: '降水' },
  { id: 'vegetation', label: '植生' },
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
    <div class="row" id="speed-row">${SPEEDS.map((s) => `<button id="speed-${s}" class="chip${s === 1 ? ' on' : ''}">${s === 0 ? '⏸' : s + 'x'}</button>`).join('')}</div>
  </div>
  <div class="hud hud-tr row" id="layer-row">${LAYERS.map((l) => `<button id="layer-${l.id}" class="chip${l.id === 'terrain' ? ' on' : ''}">${l.label}</button>`).join('')}<span id="layer-species" class="row"></span></div>
  <div class="hud hud-r">
    <div class="dim">個体数の推移</div>
    <canvas id="graph" width="640" height="200"></canvas>
    <div id="legend" class="row"></div>
    <div class="stats"><span id="stat-temp" class="mono">--℃</span><span class="dim">平均気温</span><span id="stat-veg" class="mono">--%</span><span class="dim">植生率</span></div>
  </div>
  <div class="hud hud-b">
    <label>気温 <input id="temp-offset" type="range" min="-10" max="10" step="0.5" value="0"><span id="temp-offset-v" class="mono">+0.0</span></label>
    <label>降水 <input id="rain-scale" type="range" min="0.3" max="2" step="0.1" value="1"><span id="rain-scale-v" class="mono">×1.0</span></label>
    <span class="sep"></span>
    ${DISASTERS.map((d) => `<button id="disaster-${d.kind}" class="chip">${d.label}</button>`).join('')}
    <span class="sep"></span>
    <button id="save-btn" class="chip">保存</button>
    <label class="chip">読込<input id="load-input" type="file" accept="application/json" hidden></label>
  </div>
  <div class="hud hud-palette"><span class="dim">種を放つ</span><span id="spawn-row" class="row"></span></div>
  <div class="hud hud-bl" id="cell-panel" hidden></div>`,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = root.querySelector<T>('#' + id);
    if (!el) throw new Error(`hud element missing: #${id}`);
    return el;
  };

  const ts = new TimeSeries(500);
  const markers: GraphMarker[] = [];
  let lines: GraphLine[] = [];
  let lastYear = -1;
  let armed: DisasterKind | null = null;
  let spawnArmed: string | null = null;

  const setOn = (rowId: string, id: string) => {
    for (const b of $(rowId).querySelectorAll('.chip')) b.classList.toggle('on', b.id === id);
  };
  for (const s of SPEEDS) {
    $(`speed-${s}`).addEventListener('click', () => {
      h.onSpeed(s);
      setOn('speed-row', `speed-${s}`);
    });
  }
  for (const l of LAYERS) {
    $(`layer-${l.id}`).addEventListener('click', () => {
      h.onLayer(l.id);
      setOn('layer-row', `layer-${l.id}`);
    });
  }
  const tempEl = $<HTMLInputElement>('temp-offset');
  const rainEl = $<HTMLInputElement>('rain-scale');
  tempEl.addEventListener('input', () => {
    const v = Number(tempEl.value);
    $('temp-offset-v').textContent = (v >= 0 ? '+' : '') + v.toFixed(1);
    h.onCommand({ type: 'set_climate', tempOffset: v });
  });
  rainEl.addEventListener('input', () => {
    const v = Number(rainEl.value);
    $('rain-scale-v').textContent = '×' + v.toFixed(1);
    h.onCommand({ type: 'set_climate', rainScale: v });
  });
  const setSpawnArmed = (id: string | null) => {
    spawnArmed = id;
    for (const b of $('spawn-row').querySelectorAll('.chip')) b.classList.toggle('armed', b.id === `spawn-${id}`);
    h.onSpawnArm(id);
  };
  const setArmed = (k: DisasterKind | null) => {
    armed = k;
    for (const d of DISASTERS) $(`disaster-${d.kind}`).classList.toggle('armed', d.kind === k);
    if (k !== null && spawnArmed !== null) setSpawnArmed(null);
    h.onDisasterArm(k);
  };
  for (const d of DISASTERS) {
    $(`disaster-${d.kind}`).addEventListener('click', () => setArmed(armed === d.kind ? null : d.kind));
  }
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

  const ensureSpecies = (s: WorldSnapshot) => {
    if (lines.length === s.species.length + 1) return;
    lines = [
      ...s.species.map((d) => ({ key: d.id, color: d.color, label: d.name })),
      { key: 'temp', color: '#A79CE0', label: '平均気温', axis: 'right' as const },
    ];
    $('legend').innerHTML = lines.map((l) => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join('');
    $('layer-species').innerHTML = s.species.map((d) => `<button id="layer-species-${d.id}" class="chip">${d.name}</button>`).join('');
    for (const d of s.species) {
      $(`layer-species-${d.id}`).addEventListener('click', () => {
        h.onLayer(`species:${d.id}`);
        setOn('layer-row', `layer-species-${d.id}`);
      });
    }
    $('spawn-row').innerHTML = s.species
      .map((d) => `<button id="spawn-${d.id}" class="chip"><i class="swatch" style="background:${d.color}"></i>${d.name}</button>`)
      .join('');
    for (const d of s.species) {
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
    $('hud-year').textContent = `Year ${s.year}`;
    $('hud-season').textContent = `${SEASONS[Math.floor((s.dayOfYear / 360) * 4) % 4]} · Day ${s.dayOfYear}`;
    if (s.year !== lastYear) {
      lastYear = s.year;
      ts.push(s.year, { ...s.totals, temp: s.meanTemperature });
      redraw();
      $('stat-temp').textContent = `${s.meanTemperature.toFixed(1)}℃`;
      $('stat-veg').textContent = `${(vegRatio(s) * 100).toFixed(0)}%`;
    }
  };

  const showCell = (cell: number | null, s: WorldSnapshot) => {
    const p = $('cell-panel');
    if (cell === null) {
      p.hidden = true;
      return;
    }
    const x = cell % s.size;
    const y = (cell - x) / s.size;
    const L = s.layers;
    const sea = L.elevation[cell] < SEA_LEVEL;
    p.hidden = false;
    p.innerHTML =
      `<div class="mono">セル (${x}, ${y})${sea ? ' · 海' : ''}</div>` +
      `<div><span>標高</span><span class="mono">${Math.round(L.elevation[cell] * 1000)} m</span></div>` +
      `<div><span>気温 / 水分</span><span class="mono">${L.temperature[cell].toFixed(1)}℃ / ${L.moisture[cell].toFixed(2)}</span></div>` +
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
  };
}
