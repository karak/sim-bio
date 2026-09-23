import { World } from '../simulation/World';
import { createMemorySink } from '../core/log/memorySink';
import type { SaveData } from '../simulation/types';
import { createObservationView } from './view';

/**
 * 観察画面の試作のページ (observe.html)。空の舟 25 年目の保存を読み、観察画面が自分で本体の時間を進める。
 * 観察画面そのものは view.ts (操作画面からも同じものに入る)。URL の指定は view.ts の先頭に書いてある。
 */
async function boot(): Promise<void> {
  const el = (id: string) => document.getElementById(id)!;
  el('status').textContent = '保存を読んでいます…';
  const save = (await (await fetch('/data/observe/sky-ship-y25.json')).json()) as SaveData;
  const world = World.restore(save, { log: createMemorySink() });
  const view = await createObservationView({
    canvas: el('observe') as HTMLCanvasElement,
    status: el('status'),
    stats: el('stats'),
    shots: el('shots'),
    snapshot: world.snapshot(),
    clock: world,
  });
  view.start();
}

boot().catch((e) => {
  const el = document.getElementById('status');
  if (el) el.textContent = `読み込みに失敗: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
