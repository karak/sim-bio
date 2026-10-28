import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['.claude/verify/20261028-0857-m21-03-ld/*.test.ts'], environment: 'node', testTimeout: 3_600_000 } });
