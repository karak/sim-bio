---
id: M27-01
title: アーキテクチャの柵 (層の向き・循環・大きさのラチェット)
status: in_progress
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: []
evidence: []
---

# アーキテクチャの柵

優先度: Must (M27-02・03・04 の前に置く。先に赤を見てから直す)

## What to build

レビュー (docs/design/2026-10-10-architecture-review.md) の R1・R2 を、文書でなく試験と lint で守る。

- `tests/unit/architecture.test.ts`: src の層の間の値の import に循環が無い。three.js は render・observe だけ。simulation の外部は simplex-noise だけ。worker が読む src は harbor・chronicle・core だけ。ファイルと関数の大きさのラチェット (main.ts ≤ 300 行、150 行を超える関数は表のものだけ)
- `eslint.config.js`: 層ごとに読んではいけない層を `no-restricted-imports` で (設計書 2026-09-19 §4「依存の向きは一方向」)

## 受入基準

- [ ] 柵を入れた直後は、循環 (chronicle↔harbor・harbor↔persist・harbor↔ui・app↔ui) と main.ts の行数で赤になる (直す前の赤を作業ログに残す)
- [ ] M27-02・03 の後に `pnpm run check` が通る
- [ ] 柵が本物であること: 試しに `src/scenario` から `../ui/Hud` を import すると lint が落ち、`src/harbor` から `../ui/clicks` を import すると循環の試験が落ちる (作業ログに結果)

## 作業ログ
