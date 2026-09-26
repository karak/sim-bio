import { defineConfig } from '@playwright/test';

// E2E_PORT で worktree ごとにずらせる (reuseExistingServer が別の worktree の dev サーバーを拾わないように)
const port = Number(process.env.E2E_PORT ?? 5181);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, headless: true },
  webServer: {
    command: `pnpm run dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
    env: { VITE_LOG_URL: '/api/v1/logs' },
  },
});
