import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'docs', '.remember', '.claude', 'tests/e2e/**', 'playwright-report', 'test-results', '.wrangler', 'worker/worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    // シミュレーション層は描画ライブラリに依存させない
    files: ['src/simulation/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['three', 'three/*'] }] },
  },
  // 層の向き (M27-01、設計書 2026-09-19 §4・docs/design/2026-10-10-architecture-review.md §5.8)。
  // 下の層ほど読めるものが少ない。循環と大きさは tests/unit/architecture.test.ts が見る
  ...layering({
    'src/simulation/**': ['ui', 'render', 'observe', 'scenario', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
    'src/core/**': ['ui', 'render', 'observe', 'scenario', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
    'src/scenario/**': ['ui', 'render', 'observe', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
    'src/render/**': ['ui', 'observe', 'scenario', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
    'src/chronicle/**': ['ui', 'render', 'observe', 'harbor', 'persist', 'app', 'dev'],
    'src/harbor/**': ['ui', 'render', 'observe', 'persist', 'app', 'dev'],
    'src/persist/**': ['ui', 'render', 'observe', 'app', 'dev'],
    'src/app/**': ['ui', 'render', 'observe', 'dev'],
    'src/observe/**': ['ui', 'harbor', 'persist', 'chronicle', 'app'],
    'src/ui/**': ['observe', 'dev'],
    'worker/src/**': ['ui', 'render', 'observe', 'scenario', 'simulation', 'persist', 'app', 'dev'],
  }),
);

/** files のパターンごとに、読んではいけない src の層を no-restricted-imports に写す (../ と ../../ の両方の深さ) */
function layering(table) {
  return Object.entries(table).map(([files, layers]) => ({
    files: [files],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: layers.map((layer) => ({
            group: [`../${layer}`, `../${layer}/*`, `../../${layer}`, `../../${layer}/*`, `../../src/${layer}`, `../../src/${layer}/*`],
            message: `${files} は ${layer} を読まない (層の向き、M27-01)`,
          })),
        },
      ],
    },
  }));
}
