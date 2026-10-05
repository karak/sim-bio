import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Worker のテストは workerd (miniflare) の中で回す。@cloudflare/vitest-plugin は vitest 4 までなので、
// 本体 (vitest 5) とは別の workspace に置いて、別の vitest で回す
// 港の帳簿 (M19-08) は、本番と同じ worker/migrations を test/setup.ts がローカルの D1 に当てる。
// secret はテストの値 (Turnstile は常に通るテストの secret、送り手の HMAC は固定の文字列) で、siteverify への fetch はテストが止める
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: '../wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA', SENDER_SECRET: 'test-sender-secret' },
        },
      }),
    ],
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] },
  };
});
