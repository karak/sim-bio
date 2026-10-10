import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { FORBIDDEN, filesOf, patternsOf } from './layering.config.mjs';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'docs', '.remember', '.claude', 'tests/e2e/**', 'playwright-report', 'test-results', '.wrangler', 'worker/worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    // シミュレーション層は描画ライブラリに依存させない
    files: ['src/simulation/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['three', 'three/*'] }, ...forbidden('simulation')] }] },
  },
  // 層の向き (M27-01)。表は layering.config.mjs (tests/unit/architecture.test.ts も同じ表を読む)。simulation は上の塊に足してある (同じ rule を 2 度書くと後の塊が前を消すため)
  ...Object.keys(FORBIDDEN)
    .filter((layer) => layer !== 'simulation')
    .map((layer) => ({ files: [filesOf(layer)], rules: { 'no-restricted-imports': ['error', { patterns: forbidden(layer) }] } })),
);

/** その層が読んではいけない層を、no-restricted-imports の patterns (group と message) に写す */
function forbidden(layer) {
  return FORBIDDEN[layer].map((target) => ({ group: patternsOf(target), message: `${filesOf(layer)} は ${target} を読まない (層の向き、M27-01、layering.config.mjs)` }));
}
