---
id: M27-01
title: アーキテクチャの柵 (層の向き・循環・大きさのラチェット)
status: review
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: []
evidence:
  - "7785c6a test(arch): tests/unit/architecture.test.ts と eslint.config.js の layering() (直す前の赤: 循環 19 本・main.ts 623 行・boot 568 行)"
  - "tests/unit/architecture.test.ts 'src の層の間に、値の import の循環が無い' ほか 7 本 (M27-02・03 の後に全部通過)"
  - "柵の確かめ (2026-10-10 16:05): src/scenario/_fence.ts に ../ui/Hud の import を置くと eslint が no-restricted-imports 1 件、src/harbor/_fence.ts に ../ui/clicks を置くと循環の試験が赤 (app → harbor → ui → app ほか 12 本)。どちらも消して戻した"
---

# アーキテクチャの柵

優先度: Must (M27-02・03・04 の前に置く。先に赤を見てから直す)

## What to build

レビュー (docs/design/2026-10-10-architecture-review.md) の R1・R2 を、文書でなく試験と lint で守る。

- `tests/unit/architecture.test.ts`: src の層の間の値の import に循環が無い。three.js は render・observe だけ。simulation の外部は simplex-noise だけ。worker が読む src は harbor・chronicle・core だけ。ファイルと関数の大きさのラチェット (main.ts ≤ 300 行、150 行を超える関数は表のものだけ)
- `eslint.config.js`: 層ごとに読んではいけない層を `no-restricted-imports` で (設計書 2026-09-19 §4「依存の向きは一方向」)

## 受入基準

- [x] 柵を入れた直後は、循環 (chronicle↔harbor・harbor↔persist・harbor↔ui・app↔ui) と main.ts の行数で赤になる (直す前の赤を作業ログに残す)
- [x] M27-02・03 の後に `pnpm run check` が通る
- [x] 柵が本物であること: 試しに `src/scenario` から `../ui/Hud` を import すると lint が落ち、`src/harbor` から `../ui/clicks` を import すると循環の試験が落ちる (作業ログに結果)

## 作業ログ

- 2026-10-10 15:35 柵を書いて赤を見た: 循環 19 本 (chronicle↔harbor・harbor↔persist・harbor↔ui・app↔ui の組み合わせ)、lint 10 件、main.ts 623 行、boot 568 行。赤のまま 7785c6a にコミット (直す順を読めるように)
- 16:05 M27-02 の後、柵が本物かを確かめた (上の evidence)。
- 層の向きは eslint (CI と編集中に落ちる、いちばん強い仕組み) に、循環と大きさは試験に置いた。import の辺は TypeScript の AST から取り、`import type` と全部 type の named import は循環の数えから外す (core ↔ simulation の型だけの辺を許すため)。
- 大きさの表はラチェット。下げたら表を書き換える (M27-04 で view.ts の 1074 行・createObservationView の 836 行を既定へ戻す)。
- 17:10 レビュー (読むだけの opus の agent) の指摘を直した: (1) `layering()` の simulation の塊が、前からある three の禁止 (eslint.config.js:11) を後ろから消していた (flat config は同じ rule を後の塊が上書きする)。表を `layering.config.mjs` に 1 つにし、simulation は前からある塊に足す形にした。(2) eslint は動的 import と `../../../` を見ないので、同じ表を architecture.test.ts にも当てた (`層の向きは動的 import と深い相対パスでも守る`)。(3) ラチェットの余りを詰めた (main.ts 300 → 265、boot 250 → 225。今は 261・220)。(4) app.effects・intervene・restore の試験を強めた (to_title の鍵、showSeed の条件 5 つ、budget 以外の弾きでは揺らさない、投げる理由の文)。
- 確かめ (17:10): `src/app/_fence.ts` の `import('../ui/Hud')` は eslint を通るが試験で赤。`src/simulation/_fence.ts` の `import 'three'` は eslint 1 件。`src/core/log/deep/_fence.ts` の `../../../ui/Hud` は eslint 1 件。どれも消して戻した。
