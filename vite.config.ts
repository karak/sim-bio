/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // assets/ を publicDir にすることで /data/species.json のように読める
  publicDir: 'assets',
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
