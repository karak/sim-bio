// M21-03 の審査台の画を撮る使い捨ての設定 (tests/e2e には入れない)。根の playwright.config.ts の use と webServer を写した
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const port = Number(process.env.E2E_PORT ?? 5188);
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

export default defineConfig({
  testDir: '.',
  timeout: 900_000,
  workers: 1,
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: [{ name: 'biotope-dev-skip-title', value: '1' }] }] },
  },
  webServer: {
    command: `pnpm run dev --port ${port} --strictPort`,
    cwd: root,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
    env: { VITE_LOG_URL: '/api/v1/logs', VITE_HARBOR_URL: '/' },
  },
});
