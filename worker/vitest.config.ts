import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Worker のテストは workerd (miniflare) の中で回す。@cloudflare/vitest-plugin は vitest 4 までなので、
// 本体 (vitest 5) とは別の workspace に置いて、別の vitest で回す
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: '../wrangler.jsonc' } })],
  test: { include: ['test/**/*.test.ts'] },
});
