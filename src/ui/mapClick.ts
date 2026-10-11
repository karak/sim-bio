import type { Command, WorldSnapshot } from '../simulation/types';
import type { Session } from '../app/session';
import type { Chip, Hud } from './Hud';
import { disasterClick, spawnClick } from '../simulation/commands';
import { IDLE, pressStep, type PressInput } from './press';

/**
 * 地図のクリック (M27-03)。押しとドラッグを分け (press.ts)、持っているチップ (災害・放流・気象塔) があればそのセルへの命令にして HUD に目印を置き、無ければセルを選ぶ
 */

export type MapClickDeps = {
  /** 画面の点のセル。地図は作り直されるので、クリックのたびに今の地図に引く */
  pickCell: (x: number, y: number) => number | null;
  session: Session;
  intervene: (c: Command) => boolean;
  /** 持っているチップ (災害・放流・気象塔) は HUD が 1 つで持つ (M27-05)。次の島のクリックで使い、setChip(null) で放す */
  hud: Pick<Hud, 'addMarker' | 'chip' | 'setChip' | 'showCell'>;
};

/** 持っているチップが出す命令と、HUD の目印の文と色 (放すのは呼び手が hud.setChip(null) で) */
function armedOf(chip: Chip, s: WorldSnapshot, cell: number): { cmd: Command; label: string; color: string } {
  switch (chip.kind) {
    case 'spawn': {
      const id = chip.speciesId;
      const def = s.species.find((d) => d.id === id);
      // 1 セルだけだと見えにくいので半径 1 (3×3 相当) に放つ。1 コマンドなので値段も 1 回分。海セルは World 側で無視される
      return { cmd: spawnClick(id, cell), label: def?.name ?? id, color: def?.color ?? '#6FBF7C' };
    }
    case 'disaster':
      return { cmd: disasterClick(chip.disaster, cell), label: chip.disaster, color: '#E07A55' };
    case 'tower':
      return { cmd: { type: 'build_tower', cell }, label: '気象塔', color: '#7FB3E0' };
  }
}

export function mountMapClick(canvas: HTMLCanvasElement, deps: MapClickDeps): void {
  const { session, intervene, hud } = deps;
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
    const chip = hud.chip();
    if (chip) {
      const armed = armedOf(chip, s, cell);
      if (intervene(armed.cmd)) hud.addMarker(s.year, armed.label, armed.color);
      hud.setChip(null);
      return;
    }
    session.selected = cell;
    hud.showCell(cell, s);
  });
}
