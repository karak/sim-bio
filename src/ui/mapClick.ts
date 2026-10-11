import type { Command, DisasterKind, WorldSnapshot } from '../simulation/types';
import type { Session } from '../app/session';
import type { Hud } from './Hud';
import { disasterClick, spawnClick } from '../simulation/commands';
import { IDLE, pressStep, type PressInput } from './press';

/**
 * 地図のクリック (M27-03)。押しとドラッグを分け (press.ts)、持っているチップ (災害・放流・気象塔) があればそのセルへの命令にして HUD に目印を置き、無ければセルを選ぶ
 */

/** HUD で持ったチップ。main.ts が HUD の手から書き、次の島のクリックで使う */
export type Chips = {
  armed: DisasterKind | null;
  spawnArmed: string | null;
  /** 気象塔チップを持っているか (M10-01)。次の島クリックで build_tower を送る */
  towerArmed: boolean;
};

export type MapClickDeps = {
  /** 画面の点のセル。地図は作り直されるので、クリックのたびに今の地図に引く */
  pickCell: (x: number, y: number) => number | null;
  session: Session;
  chips: Chips;
  intervene: (c: Command) => boolean;
  hud: Pick<Hud, 'addMarker' | 'setSpawnArmed' | 'setArmed' | 'setTowerArmed' | 'showCell'>;
};

/** 持っているチップが出す命令と、HUD の目印の文と色、チップを放す手。何も持っていなければ null */
function armedOf(chips: Chips, hud: MapClickDeps['hud'], s: WorldSnapshot, cell: number): { cmd: Command; label: string; color: string; disarm: () => void } | null {
  if (chips.spawnArmed) {
    const id = chips.spawnArmed;
    const def = s.species.find((d) => d.id === id);
    // 1 セルだけだと見えにくいので半径 1 (3×3 相当) に放つ。1 コマンドなので値段も 1 回分。海セルは World 側で無視される
    return { cmd: spawnClick(id, cell), label: def?.name ?? id, color: def?.color ?? '#6FBF7C', disarm: () => hud.setSpawnArmed(null) };
  }
  if (chips.armed) return { cmd: disasterClick(chips.armed, cell), label: chips.armed, color: '#E07A55', disarm: () => hud.setArmed(null) };
  if (chips.towerArmed) return { cmd: { type: 'build_tower', cell }, label: '気象塔', color: '#7FB3E0', disarm: () => hud.setTowerArmed(false) };
  return null;
}

export function mountMapClick(canvas: HTMLCanvasElement, deps: MapClickDeps): void {
  const { session, chips, intervene, hud } = deps;
  // カメラのドラッグの終わりにも click が来る。押しと判別し、ドラッグだったときは次の click を選びにしない (M26-03)
  let press = IDLE;
  let dragged = false;
  const feedPress = (input: PressInput) => {
    const step = pressStep(press, input);
    press = step.state;
    if (input.type === 'down') dragged = false;
    if (step.action === 'drag') dragged = true;
  };
  canvas.addEventListener('pointerdown', (e) => feedPress({ type: 'down', pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointermove', (e) => feedPress({ type: 'move', pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => feedPress({ type: 'up', pointerId: e.pointerId }));
  canvas.addEventListener('pointercancel', (e) => feedPress({ type: 'cancel', pointerId: e.pointerId }));
  canvas.addEventListener('click', (e) => {
    if (dragged) return;
    const cell = deps.pickCell(e.clientX, e.clientY);
    if (cell === null) return;
    const s = session.world.snapshot();
    const armed = armedOf(chips, hud, s, cell);
    if (armed) {
      if (intervene(armed.cmd)) hud.addMarker(s.year, armed.label, armed.color);
      armed.disarm();
      return;
    }
    session.selected = cell;
    hud.showCell(cell, s);
  });
}
