import type { D1Migration } from 'cloudflare:test';

// vitest.config.ts が miniflare の bindings で渡す、テストだけの値
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
