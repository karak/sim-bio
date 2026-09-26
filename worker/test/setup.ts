import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.HARBOR, env.TEST_MIGRATIONS);

// テストごとに帳簿を空にする (保存の分離の粒度に頼らない)
const TABLES = ['reports', 'chronicles', 'cargo', 'outcomes', 'daily_budget', 'harbor_stats'];
beforeEach(async () => {
  await env.HARBOR.batch(TABLES.map((t) => env.HARBOR.prepare(`DELETE FROM ${t}`)));
});
