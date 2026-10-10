/**
 * 層の向き (M27-01、設計書 2026-09-19 §4「依存の向きは一方向」)。層ごとに、読んではいけない src の層。
 * eslint.config.js (静的な import、編集中と CI で落ちる) と tests/unit/architecture.test.ts (動的 import と深い相対パスも見る) が同じ表を読む。
 * 下の層ほど読めるものが少ない。entry (main.ts・観察画面の試作) と dev は何でも読める
 */
export const FORBIDDEN = {
  simulation: ['ui', 'render', 'observe', 'scenario', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
  core: ['ui', 'render', 'observe', 'scenario', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
  scenario: ['ui', 'render', 'observe', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
  render: ['ui', 'observe', 'scenario', 'harbor', 'persist', 'chronicle', 'app', 'dev'],
  chronicle: ['ui', 'render', 'observe', 'harbor', 'persist', 'app', 'dev'],
  harbor: ['ui', 'render', 'observe', 'persist', 'app', 'dev'],
  persist: ['ui', 'render', 'observe', 'app', 'dev'],
  app: ['ui', 'render', 'observe', 'dev'],
  observe: ['ui', 'harbor', 'persist', 'chronicle', 'app'],
  ui: ['observe', 'dev'],
  worker: ['ui', 'render', 'observe', 'scenario', 'simulation', 'persist', 'app', 'dev'],
};

/** 層の置き場 (eslint の files)。worker だけ src の外 */
export const filesOf = (layer) => (layer === 'worker' ? 'worker/src/**' : `src/${layer}/**`);

/** その層を指す相対パスの形。深さ 1〜3 (core/log・observe/render は 2、worker/src は ../../src) */
export const patternsOf = (layer) =>
  [1, 2, 3].flatMap((depth) => {
    const up = '../'.repeat(depth);
    return [`${up}${layer}`, `${up}${layer}/*`, `${up}src/${layer}`, `${up}src/${layer}/*`];
  });
