import type { Command, WorldSnapshot } from '../simulation/types';
import type { ScenarioDef } from './types';

/**
 * 見える星 (M21-03 K1、LD docs/design/2026-10-28-level-design-intercept-2.md §3): 今年の窓。
 * def.starSignYears が無ければ null (窓の無い石板)。次の星が無ければ (撃ち尽くした・落ち終えた) 空は暗い。
 * 窓は次の星 (target: 取り消せる次の予定隕石) の着弾の starSignYears 年前から着弾の前の年まで。撃てば次の星に移るので、次の窓まで閉じる
 */
export function starWindow(def: ScenarioDef, year: number, target: { atYear: number } | null): { visible: boolean; atYear: number | null } | null {
  const w = def.starSignYears;
  if (w === undefined) return null;
  if (!target) return { visible: false, atYear: null };
  return { visible: year >= target.atYear - w, atYear: target.atYear };
}

/**
 * 窓の開閉を World の civ.starVisible に揃える関数を作る。続き (restored) や古いセーブで食い違っていても流し直す。
 * pending は World へ流したがまだ snapshot に写っていない値で、写ったら null に戻す (同じ年に何度 update しても 1 回だけ流す)。
 * 文明が無ければ流さない (pending も立てない。後で文明が現れたときに流せるように)。star_sign は星の行為ではない (fromStar: false)
 */
export function createStarSignSync(world: { dispatch(cmd: Command, opts?: { fromStar?: boolean }): unknown }): (s: WorldSnapshot, visible: boolean) => void {
  let pending: boolean | null = null;
  return (s, visible) => {
    if (!s.civ) return;
    if (s.civ.starVisible === visible) {
      pending = null;
      return;
    }
    if (pending === visible) return;
    pending = visible;
    world.dispatch({ type: 'star_sign', visible }, { fromStar: false });
  };
}
