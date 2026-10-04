import type { Chronicle } from '../harbor/chronicle';
import type { SaveData } from '../simulation/types';
import { el } from '../ui/el';
import type { DevSession } from './session';
import { captureSnapshot, dumpDb } from './snapshot';

export type DevPanelDeps = {
  session: DevSession;
  /** 自動保存を書き出してから (transaction を作ってから) 今の島を返す */
  capture(): { save: SaveData; chronicle: Chronicle | null };
  /** 石板の島か。近道の札は石板でだけ出す */
  scenario: boolean;
};

const STYLE = `
.dev-panel { pointer-events: auto; display: flex; flex-direction: column; gap: 6px; width: 250px;
  padding: 10px 12px; font: 12px/1.5 system-ui, sans-serif; color: #f5e9c8; background: rgba(40, 30, 12, 0.92); border: 1px dashed #d9a441; border-radius: 6px; }
.dev-panel h2 { margin: 0; font-size: 12px; letter-spacing: 0.1em; color: #d9a441; }
.dev-panel button { font: inherit; padding: 4px 8px; border-radius: 4px; border: 1px solid #d9a441; background: #2a1f0a; color: inherit; cursor: pointer; }
.dev-panel button:disabled { opacity: 0.5; cursor: default; }
.dev-panel output { font-family: ui-monospace, Menlo, monospace; user-select: all; word-break: break-all; }
`;

/**
 * 開発の板 (M19-16、?dev=1)。状態を受入の画面へ送って id を得る・近道で判定を alive にする。
 * 見た目は島の画面と揃えない (開発のものだと一目で分かるように、破線の琥珀色にする)
 */
export function mountDevPanel(app: HTMLElement, deps: DevPanelDeps): void {
  const { session } = deps;
  const id = el('output', { id: 'dev-snapshot-id', 'aria-label': '状態 id' });
  const send = el('button', { type: 'button' }, '状態を受入の画面へ送る');
  send.addEventListener('click', async () => {
    send.disabled = true;
    id.textContent = '送っている…';
    try {
      const snap = await captureSnapshot({ indexedDB, dbName: session.dbName, url: location.href, player: session.player?.name ?? null, current: deps.capture(), now: Date.now });
      const res = await fetch(new URL('/api/snapshots', session.acceptanceUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snap) });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as { id: string };
      id.textContent = body.id;
    } catch (e) {
      id.textContent = `送れなかった (${session.acceptanceUrl}): ${String(e)}`;
    } finally {
      send.disabled = false;
    }
  });
  const shortcut = deps.scenario && !session.shortcut && el('button', { type: 'button' }, '近道: 次の年の境目で alive にする');
  if (shortcut) {
    shortcut.addEventListener('click', async () => {
      shortcut.disabled = true;
      deps.capture();
      // 自動保存が確定してから開き直す (開き直した画面が同じ島の続きから近道にする)。
      // 同じ store を読む transaction は、先に作った書きの transaction が終わってから動くので、読み終えれば書きも確定している
      await dumpDb(indexedDB, session.dbName);
      const q = new URLSearchParams(location.search);
      q.set('shortcut', 'alive');
      location.search = q.toString();
    });
  }
  // 右の列 (.hud-right) の末尾に積む。グラフの板の高さが変わっても、板はその下から始まり覆わない (M26-04)
  const column = app.querySelector('.hud-right') ?? app;
  app.append(el('style', {}, STYLE));
  column.append(
    el(
      'section',
      { class: 'dev-panel', 'aria-label': '開発' },
      el('h2', {}, `開発${session.player ? ` · 見守り手 ${session.player.name}` : ''}`),
      send,
      id,
      shortcut,
      session.shortcut && el('p', { id: 'dev-shortcut' }, '近道の島。判定は港へ出さない'),
    ),
  );
}
