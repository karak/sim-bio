import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['.claude/verify/20261029-0922-m21-03-impl/*.test.ts'], environment: 'node', testTimeout: 3_600_000 } });
