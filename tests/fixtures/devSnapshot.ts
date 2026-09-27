import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { parseDevSnapshot, restoreDb, type DevSnapshot } from '../../src/dev/snapshot';

/**
 * 受入の画面で添えられた状態 id (M19-16) を、テストで再現する助け。
 * 単体では readSnapshot(id).current.save を World.restore に、置き場は db を restoreDb (fake-indexeddb) に渡す。
 * E2E では openSnapshot で page の origin の IndexedDB に流し込み、写したときの道を開く
 */

/** 写しの置き場。worktree からは ACCEPTANCE_DIR で本体の .claude/acceptance を指す */
export const snapshotDir = (): string => join(process.env.ACCEPTANCE_DIR ?? '.claude/acceptance', 'snapshots');

/** id (s-20260927-050607-abcd) か、写しの file の道 */
export function readSnapshot(idOrFile: string): DevSnapshot {
  const file = idOrFile.endsWith('.json') ? idOrFile : join(snapshotDir(), `${idOrFile}.json`);
  const parsed = parseDevSnapshot(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error.path} ${parsed.error.reason}`);
  return parsed.value;
}

/**
 * 写しの置き場を page の origin に流し込み、写したときの道を baseURL の上で開く。
 * 画面を起こさない静的な file を先に開き、画面が置き場を開く前に流し込む
 */
export async function openSnapshot(page: Page, snap: DevSnapshot): Promise<void> {
  await page.goto('/data/species.json');
  await page.evaluate(([src, dump]) => new Function(`return ${src}`)()(indexedDB, JSON.parse(dump)), [restoreDb.toString(), JSON.stringify(snap.db)]);
  const url = new URL(snap.url);
  await page.goto(url.pathname + url.search);
}
