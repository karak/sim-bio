/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // assets/ を publicDir にすることで /data/species.json のように読める
  publicDir: 'assets',
  // SLOW=1 のときだけ tests/slow (シナリオの通し実行、数分かかる) を回す
  test: { include: process.env.SLOW ? ['tests/slow/**/*.test.ts'] : ['tests/unit/**/*.test.ts'], environment: 'node' },
});
