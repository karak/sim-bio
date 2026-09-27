import type { Speed } from '../core/runner';
import { DEV_SENDER_HEADER } from '../harbor/wire';
import { DB_NAME } from '../persist/islandStore';
import type { ScenarioDef } from '../scenario/types';
import { mountDevPanel, type DevPanelDeps } from './panel';

/**
 * 開発・受入のときだけの手段 (M19-16)。main.ts は DEVTOOLS_BUILT のときだけこの module を動的に読み込むので、本番のビルドには入らない。
 * どれも URL の明示の指定で効く: ?dev=1 (開発の板と 1000x)、?player=<名前> (別の見守り手)、?shortcut=alive (判定を alive で打ち切る近道)
 */
export type DevPlayer = {
  name: string;
  /** 手元の置き場 (島の保存・年代記・outbox・取り下げ鍵・控え) の DB の名前 */
  dbName: string;
  /** 港への要求に添える名乗り。港は wrangler dev のときだけ、これを送り手の IP の代わりに数える (worker/src/guard.ts) */
  headers: Readonly<Record<string, string>>;
};

export type DevSession = {
  player: DevPlayer | undefined;
  /** 手元の置き場の DB の名前。見守り手が無ければ既定の名前 */
  dbName: string;
  /** 速さの札の並び。?dev=1 のときだけ 1000x を足す。undefined なら HUD の既定 */
  speeds: readonly Speed[] | undefined;
  /** 近道の島か。近道の判定は港へ出さない (出港・回避率・積荷のどれも) */
  shortcut: boolean;
  /** 状態の写しを送る受入の画面のサーバー。?acceptance=<loopback の URL> で差し替える (E2E が別のポートで立てる) */
  acceptanceUrl: string;
  /** 近道なら判定を差し替えた石板、そうでなければ同じ石板を返す */
  scenarioDef(def: ScenarioDef): ScenarioDef;
  /** ?dev=1 と近道のときだけ開発の板を出す */
  mount(app: HTMLElement, deps: Omit<DevPanelDeps, 'session'>): void;
};

const PLAYER_NAME = /^[A-Za-z0-9_-]{1,24}$/;
const DEV_SPEEDS: readonly Speed[] = [0, 1, 10, 100, 1000];

/**
 * 近道の石板: 次の年の境目で alive になる (予言の年を 1 年目にし、滅びと部分勝利の条件を外す)。
 * 途中から近道にすると、戻した年の次の境目で alive になる
 */
function shortcutDef(def: ScenarioDef): ScenarioDef {
  return { ...def, years: 1, alive: { type: 'year_reached', year: 0 }, dead: undefined, escape: undefined };
}

const ACCEPTANCE_URL = 'http://localhost:5392';
const LOOPBACK: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 手元の状態を送る先は手元のサーバーだけ (リンクで渡された URL へ置き場の中身を送らない) */
function acceptanceUrlOf(v: string | null): string {
  if (v === null || !URL.canParse(v)) return ACCEPTANCE_URL;
  const url = new URL(v);
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname) ? url.origin : ACCEPTANCE_URL;
}

export function devSessionOf(params: URLSearchParams): DevSession {
  const name = params.get('player');
  const panel = params.get('dev') === '1';
  const shortcut = params.get('shortcut') === 'alive';
  const player = name !== null && PLAYER_NAME.test(name) ? { name, dbName: `${DB_NAME}@${name}`, headers: { [DEV_SENDER_HEADER]: name } } : undefined;
  const session: DevSession = {
    player,
    dbName: player?.dbName ?? DB_NAME,
    speeds: panel ? DEV_SPEEDS : undefined,
    shortcut,
    acceptanceUrl: acceptanceUrlOf(params.get('acceptance')),
    scenarioDef: (def) => (shortcut ? shortcutDef(def) : def),
    mount: (app, deps) => {
      if (panel || shortcut) mountDevPanel(app, { ...deps, session });
    },
  };
  return session;
}
