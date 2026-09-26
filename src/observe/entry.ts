import type { WorldSnapshot } from '../simulation/types';
import type { TimelineEvent } from '../scenario/ScenarioRunner';
import type { ObservationView } from './view';

/**
 * 操作画面から観察画面に入る/戻る (M22-08)。操作画面の上に全面の層を重ね、観察画面を描く。
 * 観察画面のコード (Three.js・アセット) は初めて入るときに読み込む (操作画面の読み込みを重くしない)。
 * 時間は操作画面の runner が進め、入っている間は push で snapshot を渡す。100x のまま入ったら 10x に落とす (設計 §4)。
 * 入れるのは文明の集落があるとき (区域は集落を中心に切り出すので)。
 */
export type ObserveEntry = {
  /** 操作画面の毎フレームの snapshot。入っていれば観察画面へ渡し、入るボタンの可否を決める。timeline は石板の年表 (介入の場面に使う) */
  push(s: WorldSnapshot, timeline?: readonly TimelineEvent[]): void;
  active(): boolean;
  enter(): Promise<void>;
  exit(): void;
};

export type ObserveEntryOptions = {
  /** 種 id → 名前 (観察画面の知らせの帯に使う) */
  names?: Record<string, string>;
  getSpeed(): number;
  setSpeed(s: 0 | 1 | 10): void;
};

const CSS = `
#observe-open { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 20; font: 13px system-ui, sans-serif; padding: 5px 14px; border-radius: 14px; border: 1px solid rgba(233, 239, 243, 0.5); background: rgba(27, 43, 58, 0.72); color: #e9eff3; cursor: pointer; }
#observe-open[disabled] { opacity: 0.4; cursor: default; }
#observe-layer { position: absolute; inset: 0; z-index: 30; background: #CFE0E4; }
#observe-layer canvas { display: block; width: 100%; height: 100%; }
#observe-layer .o-stats { position: absolute; left: 12px; bottom: 10px; font: 12px/1.4 ui-monospace, Menlo, monospace; color: #1F2621; background: rgba(244, 246, 241, 0.72); padding: 4px 8px; border-radius: 3px; }
#observe-layer .o-shots { position: absolute; right: 12px; top: 10px; display: flex; gap: 6px; }
#observe-layer .o-shots button, #observe-back { font: 12px system-ui, sans-serif; padding: 4px 10px; border: 1px solid #9FA79A; background: rgba(244, 246, 241, 0.8); border-radius: 3px; cursor: pointer; color: #1F2621; }
#observe-layer .o-bar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px 12px; max-width: calc(100% - 24px); padding: 6px 8px 6px 14px; border-radius: 18px; background: rgba(27, 43, 58, 0.74); color: #e9eff3; font: 13px system-ui, sans-serif; }
#observe-layer .o-live { display: flex; align-items: center; gap: 7px; }
#observe-layer .o-live i { width: 8px; height: 8px; border-radius: 50%; background: #7FE3D8; box-shadow: 0 0 0 0 rgba(127, 227, 216, 0.6); animation: o-pulse 1.6s ease-out infinite; }
#observe-layer .o-bar.paused .o-live i { background: #E3A56A; animation: none; }
#observe-layer .o-cam { color: #b7c4cc; }
#observe-layer .o-bar .o-stats { position: static; padding: 0; background: none; color: inherit; font: 12px/1.4 ui-monospace, Menlo, monospace; }
#observe-layer .o-speed { display: flex; gap: 2px; }
#observe-layer .o-speed button, #observe-back { font: 12px system-ui, sans-serif; padding: 3px 10px; border: 1px solid rgba(233, 239, 243, 0.35); background: transparent; border-radius: 12px; cursor: pointer; color: #e9eff3; }
#observe-layer .o-speed button.on { background: #e9eff3; color: #1B2B3A; }
#observe-back { background: rgba(233, 239, 243, 0.14); }
#observe-back kbd { font: 11px ui-monospace, Menlo, monospace; opacity: 0.7; margin-left: 4px; }
@keyframes o-pulse { to { box-shadow: 0 0 0 7px rgba(127, 227, 216, 0); } }
@media (prefers-reduced-motion: reduce) { #observe-layer .o-live i { animation: none; } }
#observe-layer .o-status { position: absolute; left: 50%; top: 45%; transform: translateX(-50%); color: #1F2621; font-size: 14px; }
`;

export function createObserveEntry(app: HTMLElement, opts: ObserveEntryOptions): ObserveEntry {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const open = document.createElement('button');
  open.id = 'observe-open';
  open.textContent = '3D で見る';
  open.disabled = true;
  app.appendChild(open);

  let layer: HTMLDivElement | null = null;
  let view: ObservationView | null = null;
  let loading: Promise<void> | null = null;
  let isActive = false;
  let latest: WorldSnapshot | null = null;
  let latestTimeline: readonly TimelineEvent[] | undefined;

  const build = async (s: WorldSnapshot) => {
    const l = document.createElement('div');
    l.id = 'observe-layer';
    // 下の帯: 時間が流れているか・カメラの今・年・速さ・戻る (観察画面の中で唯一の操作。石板と介入は操作画面へ戻って使う)
    l.innerHTML =
      '<canvas></canvas><div class="o-status"></div><div class="o-shots"></div>' +
      '<div class="o-bar" role="toolbar" aria-label="観察画面"><span class="o-live"><i></i><b></b><span class="o-cam"></span></span><div class="o-stats"></div>' +
      '<span class="o-speed"><button data-s="0" aria-label="一時停止">⏸</button><button data-s="1">1x</button><button data-s="10">10x</button></span>' +
      '<button id="observe-back">操作画面へ戻る<kbd>Esc</kbd></button></div>';
    app.appendChild(l);
    layer = l;
    l.querySelector('#observe-back')!.addEventListener('click', () => entry.exit());
    for (const b of l.querySelectorAll<HTMLButtonElement>('.o-speed button')) b.addEventListener('click', () => opts.setSpeed(Number(b.dataset.s) as 0 | 1 | 10));
    const q = (sel: string) => l.querySelector(sel) as HTMLElement;
    q('.o-status').textContent = '観察画面を組んでいます…';
    const { createObservationView } = await import('./view');
    view = await createObservationView({ canvas: q('canvas') as HTMLCanvasElement, status: q('.o-status'), stats: q('.o-stats'), shots: q('.o-shots'), snapshot: s, names: opts.names, debug: new URLSearchParams(location.search).has('observeDebug') });
  };

  let shown = '';
  const CAMERA_LABEL = { auto: '自動カメラ', free: '自由カメラ(20 秒で自動に戻る)', follow: '個体を追っています' } as const;
  /** 下の帯を今の速さとカメラに合わせる (変わったときだけ書き換える) */
  const syncBar = () => {
    if (!layer || !view) return;
    const speed = opts.getSpeed();
    const mode = view.cameraMode();
    const key = `${speed}:${mode}`;
    if (key === shown) return;
    shown = key;
    layer.querySelector('.o-bar')!.classList.toggle('paused', speed === 0);
    layer.querySelector('.o-live b')!.textContent = speed === 0 ? '一時停止中' : '観察中';
    layer.querySelector('.o-cam')!.textContent = CAMERA_LABEL[mode];
    for (const b of layer.querySelectorAll<HTMLButtonElement>('.o-speed button')) b.classList.toggle('on', Number(b.dataset.s) === speed);
  };

  const entry: ObserveEntry = {
    push(s, timeline) {
      latest = s;
      latestTimeline = timeline;
      open.disabled = !s.civ || s.civ.home < 0;
      if (isActive && view) {
        view.setSnapshot(s, timeline);
        syncBar();
      }
    },
    active: () => isActive,
    async enter() {
      if (isActive || !latest || open.disabled) return;
      isActive = true;
      if (opts.getSpeed() > 10) opts.setSpeed(10);
      open.hidden = true;
      if (!layer) {
        loading ??= build(latest);
        await loading;
      }
      if (!isActive || !layer || !view) return;
      layer.hidden = false;
      view.start();
      view.setSnapshot(latest, latestTimeline);
      shown = '';
      syncBar();
    },
    exit() {
      if (!isActive) return;
      isActive = false;
      view?.stop();
      if (layer) layer.hidden = true;
      open.hidden = false;
    },
  };
  open.addEventListener('click', () => void entry.enter());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isActive) entry.exit();
  });
  return entry;
}
