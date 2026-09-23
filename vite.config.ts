/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // assets/ を publicDir にすることで /data/species.json のように読める
  publicDir: 'assets',
  // 観察画面の試作 (M22-02) は別のページ。本体の index.html とは独立に読み込む
  build: { rollupOptions: { input: { main: 'index.html', observe: 'observe.html' } } },
  // SLOW=1 のときだけ tests/slow (シナリオの通し実行、数分かかる) を回す
  test: { include: process.env.SLOW ? ['tests/slow/**/*.test.ts'] : ['tests/unit/**/*.test.ts'], environment: 'node' },
});
