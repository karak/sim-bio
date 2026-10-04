import { defineConfig } from '@playwright/test';

// E2E_PORT で worktree ごとにずらせる (reuseExistingServer が別の worktree の dev サーバーを拾わないように)
const port = Number(process.env.E2E_PORT ?? 5181);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // 基準画 (M25-03、tests/e2e/baseline.ts)。手元の Mac だけで持つので、名前に platform は付けない。更新は pnpm run shots:update --apply だけで、比べの途中で勝手に書かない
  // BASELINES_DIR は pnpm run shots:update が、基準画を書き換えずに新旧を比べるための置き換え
  snapshotPathTemplate: `${process.env.BASELINES_DIR ?? 'tests/e2e/baselines'}/{arg}{ext}`,
  updateSnapshots: 'none',
  // CI の runner (4 vCPU) は既定で 2 worker になり、観察画面の WebGL (ソフトウェア描画) と操作画面の E2E が CPU を取り合って固まる。CI では 1 つずつ流す
  workers: process.env.CI ? 1 : undefined,
  // 素の / はタイトルを出す (M24-01)。spec の素の goto('/') は今の操作画面を開く前提なので、開発の印 (src/dev/session.ts の SKIP_TITLE_KEY) を localStorage に置いて飛ばす。
  // タイトルの spec だけ test.use({ storageState: { cookies: [], origins: [] } }) で外す。browser.newContext() で手で作る文脈には効かない
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: 'biotope-dev-skip-title', value: '1' }] }] },
  },
  webServer: {
    command: `pnpm run dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
    // 港 (M19-09) は同じ origin の /api/v1/*。dev サーバーには港が無いので、spec が page.route() で決定論的に答える (答えなければ閉港)
    env: { VITE_LOG_URL: '/api/v1/logs', VITE_HARBOR_URL: '/' },
  },
});
