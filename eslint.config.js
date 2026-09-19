import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'docs', '.remember', '.claude', 'tests/e2e/**', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    // シミュレーション層は描画ライブラリに依存させない
    files: ['src/simulation/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['three', 'three/*'] }] },
  },
);
