import { defineConfig } from '@playwright/test';

// npm run test:e2e:cloudflare から回す。ビルド (VITE_LOG_URL=/api/v1/logs) を wrangler dev で配り、本物の受け口に当てる。
// wrangler dev は spec が自分で立てる (受け口が console に書いた行を読むため)。E2E_PORT で worktree ごとにずらせる
export const cloudflarePort = Number(process.env.E2E_PORT ?? 8791);

export default defineConfig({
  testDir: 'tests/e2e-cloudflare',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${cloudflarePort}`, headless: true },
});
