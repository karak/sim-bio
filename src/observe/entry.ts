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
#observe-back { position: absolute; left: 12px; top: 10px; }
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
    l.innerHTML = '<canvas></canvas><div class="o-status"></div><div class="o-stats"></div><div class="o-shots"></div><button id="observe-back">操作画面へ戻る</button>';
    app.appendChild(l);
    layer = l;
    l.querySelector('#observe-back')!.addEventListener('click', () => entry.exit());
    const q = (sel: string) => l.querySelector(sel) as HTMLElement;
    q('.o-status').textContent = '観察画面を組んでいます…';
    const { createObservationView } = await import('./view');
    view = await createObservationView({ canvas: q('canvas') as HTMLCanvasElement, status: q('.o-status'), stats: q('.o-stats'), shots: q('.o-shots'), snapshot: s, names: opts.names });
  };

  const entry: ObserveEntry = {
    push(s, timeline) {
      latest = s;
      latestTimeline = timeline;
      open.disabled = !s.civ || s.civ.home < 0;
      if (isActive && view) view.setSnapshot(s, timeline);
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
  return entry;
}
