import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

/** 開発用の手段 (M19-16、src/dev) だけが持つ文字列。どれかが bundle にあれば、その手段が入っている */
const MARKERS = ['biotope-dev-snapshot', 'x-dev-sender', '/api/snapshots', 'shortcut', '__probe', 'advanceTo'];
/** 試験の口 (M25-09)。SceneView・観察画面は window に書かず inspect() を返し、window に載せるのは src/dev/probe.ts の __probe だけ。以前の名前が残っていないことも見る */
const RETIRED = ['__scene', '__observe'];

/** package.json の build:cloudflare・build:acceptance と同じ環境で vite build し、出た JS に含まれる印を返す */
async function markersIn(env: Record<string, string>): Promise<string[]> {
  const outDir = mkdtempSync(join(tmpdir(), 'devtools-build-'));
  const saved = { ...process.env };
  // vitest は NODE_ENV=test で走る。そのままだと import.meta.env.DEV が true になるので、pnpm run build と同じ production にする
  Object.assign(process.env, { NODE_ENV: 'production', VITE_LOG_URL: '/api/v1/logs', VITE_HARBOR_URL: '/', ...env });
  try {
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true, copyPublicDir: false } });
    const js = readdirSync(join(outDir, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
      .join('\n');
    return [...MARKERS, ...RETIRED].filter((m) => js.includes(m));
  } finally {
    process.env = saved;
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('開発用の手段は本番のビルドに入らない (M19-16)', { timeout: 60_000 }, () => {
  it('本番のビルド (build:cloudflare) には、状態の受け渡し・見守り手の名乗り・近道のどれも無い', async () => {
    expect(await markersIn({})).toEqual([]);
  });

  it('受入のビルド (build:acceptance、VITE_DEVTOOLS=1) には入る (上の確かめが空振りしていない)', async () => {
    expect(await markersIn({ VITE_DEVTOOLS: '1' })).toEqual(MARKERS);
  });
});
