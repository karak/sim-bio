import type { WorldSnapshot } from '../simulation/types';
import type { TimelineEvent } from '../scenario/ScenarioRunner';
import type { ObservationView } from './view';
import type { ObserveInspect } from './inspect';
import { observeIslandOf, observeNeedsRebuild } from './rebuild';

/**
 * 操作画面から観察画面に入る/戻る (M22-08)。操作画面の上に全面の層を重ね、観察画面を描く。
 * 観察画面のコード (Three.js・アセット) は初めて入るときに読み込む (操作画面の読み込みを重くしない)。
 * 時間は操作画面の runner が進め、入っている間は push で snapshot を渡す。100x のまま入ったら 10x に落とす (設計 §4)。
 * world の snapshot があればいつでも入れる。区域の中心は observeCenter (area.ts) が決め、集落が無ければ島の真ん中にする (M19-18)。
 */
export type ObserveEntry = {
  /** 操作画面の毎フレームの snapshot。入っていれば観察画面へ渡し、入るボタンの可否を決める。timeline は石板の年表 (介入の場面に使う) */
  push(s: WorldSnapshot, timeline?: readonly TimelineEvent[]): void;
  active(): boolean;
  enter(): Promise<void>;
  exit(): void;
  /** 観察画面を組んだあとの試験の口 (M25-09)。まだ入っていなければ null */
  inspect(): ObserveInspect | null;
};

export type ObserveEntryOptions = {
  /** 種 id → 名前 (観察画面の知らせの帯に使う) */
  names?: Record<string, string>;
  getSpeed(): number;
  setSpeed(s: 0 | 1 | 10): void;
  /** 入るボタンを置く所 (M19-18: 操作画面では左上の時間の箱の速さの列の端)。省略時は app */
  buttonHost?: HTMLElement;
  /** 描きの時計 (ms)。開発の ?clock= で固定する (M25-02)。既定は performance.now() */
  now?: () => number;
};

const CSS = `
#observe-open { margin-left: 6px; font: 12px system-ui, sans-serif; padding: 2px 12px; border-radius: 14px; border: 1px solid rgba(233, 239, 243, 0.5); background: rgba(27, 43, 58, 0.72); color: #e9eff3; cursor: pointer; }
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
  (opts.buttonHost ?? app).appendChild(open);

  /** 島ごとに組む観察画面 (M26-07)。dead は捨てたことの印で、組み終わりを待っている間に捨てられたら、組み終わった view を捨てる */
  type Built = { island: object; layer: HTMLDivElement; view: ObservationView | null; ready: Promise<void>; dead: boolean };
  let cur: Built | null = null;
  let isActive = false;
  let latest: WorldSnapshot | null = null;
  let latestTimeline: readonly TimelineEvent[] | undefined;

  const build = (s: WorldSnapshot): Built => {
    const l = document.createElement('div');
    l.id = 'observe-layer';
    // 下の帯: 時間が流れているか・カメラの今・年・速さ・戻る (観察画面の中で唯一の操作。石板と介入は操作画面へ戻って使う)
    l.innerHTML =
      '<canvas></canvas><div class="o-status"></div><div class="o-shots"></div>' +
      '<div class="o-bar" role="toolbar" aria-label="観察画面"><span class="o-live"><i></i><b></b><span class="o-cam"></span></span><div class="o-stats"></div>' +
      '<span class="o-speed"><button data-s="0" aria-label="一時停止">⏸</button><button data-s="1">1x</button><button data-s="10">10x</button></span>' +
      '<button id="observe-back">操作画面へ戻る<kbd>Esc</kbd></button></div>';
    app.appendChild(l);
    l.querySelector('#observe-back')!.addEventListener('click', () => entry.exit());
    for (const b of l.querySelectorAll<HTMLButtonElement>('.o-speed button')) b.addEventListener('click', () => opts.setSpeed(Number(b.dataset.s) as 0 | 1 | 10));
    const q = (sel: string) => l.querySelector(sel) as HTMLElement;
    q('.o-status').textContent = '観察画面を組んでいます…';
    const built: Built = { island: observeIslandOf(s), layer: l, view: null, dead: false, ready: Promise.resolve() };
    built.ready = (async () => {
      const { createObservationView } = await import('./view');
      const v = await createObservationView({ canvas: q('canvas') as HTMLCanvasElement, status: q('.o-status'), stats: q('.o-stats'), shots: q('.o-shots'), snapshot: s, names: opts.names, now: opts.now, debug: new URLSearchParams(location.search).has('observeDebug') });
      if (built.dead) v.dispose();
      else built.view = v;
    })();
    return built;
  };

  /** 島が替わった観察画面を捨てる (M26-07)。view の GPU の資源を解放し、層を外す */
  const discard = (b: Built) => {
    b.dead = true;
    b.view?.stop();
    b.view?.dispose();
    b.view = null;
    b.layer.remove();
    if (cur === b) cur = null;
  };

  /** 今の島の観察画面を返す。島が替わっていれば、前の物を捨てて組み直す */
  const ensure = (s: WorldSnapshot): Built => {
    if (cur && !observeNeedsRebuild(cur.island, observeIslandOf(s))) return cur;
    if (cur) discard(cur);
    cur = build(s);
    return cur;
  };

  /** 観察画面を出す。組み終わるまで待ち、待つ間に島が替わった・戻ったなら出さない */
  const present = async () => {
    if (!latest) return;
    const b = ensure(latest);
    await b.ready;
    if (!isActive || b.dead || !b.view || !latest) return;
    b.layer.hidden = false;
    b.view.start();
    b.view.setSnapshot(latest, latestTimeline);
    shown = '';
    syncBar();
  };

  let shown = '';
  const CAMERA_LABEL = { auto: '自動カメラ', free: '自由カメラ(20 秒で自動に戻る)', follow: '個体を追っています' } as const;
  /** 下の帯を今の速さとカメラに合わせる (変わったときだけ書き換える) */
  const syncBar = () => {
    const layer = cur?.layer;
    const view = cur?.view;
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
      open.disabled = false;
      // 島が替わった (新しい島・枠や file の読み込み) ら、前の島の観察画面を捨てる。入っていれば組み直して出す
      if (cur && observeNeedsRebuild(cur.island, observeIslandOf(s))) {
        discard(cur);
        if (isActive) void present();
        return;
      }
      if (isActive && cur?.view) {
        cur.view.setSnapshot(s, timeline);
        syncBar();
      }
    },
    active: () => isActive,
    inspect: () => cur?.view?.inspect() ?? null,
    async enter() {
      if (isActive || !latest || open.disabled) return;
      isActive = true;
      if (opts.getSpeed() > 10) opts.setSpeed(10);
      open.hidden = true;
      await present();
    },
    exit() {
      if (!isActive) return;
      isActive = false;
      cur?.view?.stop();
      if (cur) cur.layer.hidden = true;
      open.hidden = false;
    },
  };
  open.addEventListener('click', () => void entry.enter());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isActive) entry.exit();
  });
  return entry;
}
