/**
 * 層の向き (M27-01、設計書 2026-09-19 §4「依存の向きは一方向」)。層ごとに、読んではいけない src の層。
 * eslint.config.js (静的な import、編集中と CI で落ちる) と tests/unit/architecture.test.ts (動的 import と深い相対パスも見る) が同じ表を読む。
 * 下の層ほど読めるものが少ない。entry (main.ts・観察画面の試作) と dev は何でも読める
 */
/** 入口のファイル (層 entry)。src の層を何でも読める。dev を読むのも入口だけ (動的 import で、本番のビルドでは消える) */
export const ENTRY = ['src/main.ts', 'src/observe/prototype.ts'];

/** src の層 (ディレクトリ名)。表に無いディレクトリや src 直下のファイルは、知らない層として試験が落とす */
const SRC_LAYERS = ['simulation', 'core', 'scenario', 'render', 'chronicle', 'harbor', 'persist', 'app', 'observe', 'ui'];

/**
 * 許可の表 (M27-05 段 6)。層ごとに、読んでよい層 (自分の層は常によい)。表に無い層は読めない。
 * worker の assets は assets/data の JSON (石板・種・碑文の目録)
 */
export const ALLOWED = {
  simulation: ['core'],
  core: ['simulation'],
  scenario: ['core', 'simulation'],
  render: ['core', 'simulation'],
  chronicle: ['core', 'scenario', 'simulation'],
  harbor: ['chronicle', 'core', 'scenario', 'simulation'],
  persist: ['chronicle', 'core', 'harbor', 'scenario', 'simulation'],
  app: ['chronicle', 'core', 'harbor', 'persist', 'scenario', 'simulation'],
  observe: ['core', 'render', 'scenario', 'simulation'],
  ui: ['app', 'chronicle', 'core', 'harbor', 'persist', 'render', 'scenario', 'simulation'],
  dev: [...SRC_LAYERS],
  entry: [...SRC_LAYERS, 'dev'],
  worker: ['assets', 'chronicle', 'core', 'harbor'],
};

/** 層ごとに読んでよい外部パッケージ (表に無いものは読めない)。three は描く層だけ、simulation は simplex-noise だけ */
export const PACKAGES = {
  simulation: ['simplex-noise'],
  core: [],
  scenario: [],
  render: ['three'],
  chronicle: [],
  harbor: [],
  persist: [],
  app: [],
  observe: ['three'],
  ui: [],
  dev: [],
  entry: [],
  worker: [],
};

/** 許可の表の裏返し (eslint の no-restricted-imports は禁止の形で書く)。entry と dev は何でも読める */
export const FORBIDDEN = Object.fromEntries(
  Object.entries(ALLOWED)
    .filter(([layer]) => layer !== 'entry')
    .map(([layer, ok]) => [layer, [...SRC_LAYERS, 'dev'].filter((target) => target !== layer && !ok.includes(target))]),
);

/** 層の置き場 (eslint の files)。worker だけ src の外 */
export const filesOf = (layer) => (layer === 'worker' ? 'worker/src/**' : `src/${layer}/**`);

/** その層を指す相対パスの形。深さ 1〜3 (core/log・observe/render は 2、worker/src は ../../src) */
export const patternsOf = (layer) =>
  [1, 2, 3].flatMap((depth) => {
    const up = '../'.repeat(depth);
    return [`${up}${layer}`, `${up}${layer}/*`, `${up}src/${layer}`, `${up}src/${layer}/*`];
  });
