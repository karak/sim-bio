import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // CI の runner (4 vCPU) は既定で 2 worker になり、観察画面の WebGL (ソフトウェア描画) と操作画面の E2E が CPU を取り合って固まる。CI では 1 つずつ流す
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL: 'http://localhost:5181', headless: true },
  webServer: {
    command: 'npm run dev -- --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
