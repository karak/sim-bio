import { World } from '../simulation/World';
import type { SpeciesDef, WorldConfig } from '../simulation/types';
import type { LogSink } from '../core/log/types';
import type { ScenarioDef } from '../scenario/types';
import type { IslandStore } from '../persist/islandStore';
import type { LocalSave, SaveLog } from '../persist/localSave';
import { putPendingSlot, type SlotSave } from '../persist/slotSave';
import { putOpenTitle } from '../persist/tabMarks';
import { DEFAULT_SEED, newWorldSeed, searchFor, seedSearchFor, titleHrefOf, type At, type Effect } from './place';
import type { Session } from './session';

/**
 * 確かめを受けた後の効果 (M27-03)。app/place.ts の planOp が並べた Effect を 1 つずつ行い、島の差し替え・枠とファイルの包み・URL の seed= を受け持つ。
 * 移る先 (location・history) は nav の向こうに置き、試験から見えるようにする
 */

/** URL の読み書き。main.ts が location と history に繋ぐ */
export type Nav = {
  search(): string;
  /** location.search へ書く (読み込み直す) */
  go(search: string): void;
  assign(href: string): void;
  /** 読み込み直さずに検索語だけ差し替える (history.replaceState)。search は ? から、空なら検索語を消す */
  replace(search: string): void;
};

export type EffectsDeps = {
  session: Session;
  scenario: ScenarioDef | null;
  config: WorldConfig;
  /** URL の seed= (M26-10) */
  seed: number | null;
  at: () => At;
  drawSeed: () => number;
  log: LogSink;
  persistLog: SaveLog;
  store: IslandStore | null;
  localSave: Pick<LocalSave, 'replaced' | 'saveSlot' | 'flush'>;
  saveChronicle: () => Promise<void> | undefined;
  /** このタブの sessionStorage (移って読む枠・タイトルを開く合図) */
  storage: Pick<Storage, 'setItem' | 'removeItem'>;
  nav: Nav;
  /** 地図を、この大きさと種の並びで作り直す */
  remakeView: (size: number, species: SpeciesDef[]) => void;
  setSeed: (seed: number) => void;
};

export function createEffects(deps: EffectsDeps) {
  const { session, scenario, config, log, persistLog, store, localSave, saveChronicle, nav } = deps;
  /** 今の島の seed を HUD に出し、自由モードなら URL の seed= も揃える (M26-10)。初めて開いた 42 の島だけは URL を変えない */
  const showSeed = (always: boolean) => {
    deps.setSeed(session.world.seed);
    if (scenario) return;
    if (always || deps.seed !== null || session.world.seed !== DEFAULT_SEED) nav.replace(seedSearchFor(nav.search(), session.world.seed));
  };
  const replaceWorld = (next: World) => {
    const shown = session.world.snapshot();
    session.world = next;
    const { size, species: nextSpecies } = session.world.snapshot();
    // 描き分けの表は種から作るので、大きさか種の並びが変われば作り直す
    if (size !== shown.size || nextSpecies.map((d) => d.id).join() !== shown.species.map((d) => d.id).join()) {
      deps.remakeView(size, nextSpecies);
    }
    session.selected = null;
    localSave.replaced(session.world.serialize());
    showSeed(true);
  };
  /** 枠とファイルの包み (M19-17)。石板の中では島・runner の状態・年代記の 3 つ */
  const slotSave = (): SlotSave => {
    const sc = session.scenario;
    return scenario && sc?.recorder
      ? { stage: 'scenario', scenarioId: scenario.id, save: session.world.serialize(), runner: sc.runner.save(), chronicle: sc.recorder.current() }
      : { stage: 'free', save: session.world.serialize() };
  };
  /** 確かめを受けた後に 1 つ行う。false なら残りを行わない */
  const perform = async (e: Effect): Promise<boolean> => {
    switch (e.kind) {
      case 'new_world':
        replaceWorld(World.create({ ...config, seed: newWorldSeed(deps.at(), config.seed, session.world.seed, deps.drawSeed) }, { log }));
        return true;
      case 'restart':
        session.scenario?.restart(e.from);
        return true;
      case 'replace': {
        let restored: World;
        try {
          restored = World.restore(e.save, { log });
        } catch (err) {
          persistLog('warn', 'persist.load.failed', e.save.tick, { slot: e.slot ?? 'file', error: String(err) });
          return false;
        }
        replaceWorld(restored);
        return true;
      }
      case 'refuse':
        persistLog('warn', 'persist.load.failed', e.tick, { slot: e.slot ?? 'file', error: e.error });
        return false;
      case 'stash_import':
        await store?.stashImport(e.data).catch((err: unknown) => persistLog('warn', 'persist.save.failed', e.data.save.tick, { slot: 'import', error: String(err) }));
        return true;
      case 'put_pending':
        putPendingSlot(deps.storage, e.slot);
        return true;
      case 'save_slot':
        void localSave.saveSlot(e.slot, slotSave());
        return true;
      case 'flush':
        // 移る前に、今の島と石板の続きを書き切る (M19-17)。訪問ではどちらも何も書かない
        await Promise.all([localSave.flush(() => session.world.serialize()), saveChronicle()]);
        return true;
      case 'go':
        nav.go(searchFor(nav.search(), e.scenarioId, { keepVisit: e.keepVisit }));
        return true;
      case 'assign':
        nav.assign(e.href);
        return true;
      case 'to_title':
        // タイトルへ (M24-04): 移った先の起動 (bootRouteOf) がタイトルを選ぶよう、舞台に入った印を消して合図を置き、/ へ (見守り手と開発の板の検索語は残す、titleHrefOf)
        putOpenTitle(deps.storage);
        nav.assign(titleHrefOf(nav.search()));
        return true;
    }
  };
  return { perform, slotSave, showSeed };
}
