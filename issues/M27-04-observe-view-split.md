---
id: M27-04
title: 観察画面の view.ts (1 関数 836 行) を組み立て・更新・inspect に分ける
status: todo
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: [M27-01]
evidence: []
---

# 観察画面の view.ts を分ける (R2 の後半)

優先度: Could (M27-03 の後。基準画 OBS-002 と tests/slow/observe.scenes が安全網)

## What to build

`createObservationView` (src/observe/view.ts:239〜1074) を、scene の組み立て (地形・水・草・木・集落・生き物の生成)、フレームの更新 (director・daylight・fx・dynamic resolution)、`inspect()` の 3 つに分ける。振る舞いと描画は変えない。

## 受入基準

- [ ] `tests/unit/architecture.test.ts` の表から `createObservationView` の 836 行の例外を消し (150 行の既定に戻し)、`src/observe/view.ts` の 1074 行の例外も既定の 700 行に戻す
- [ ] 基準画 OBS-002 1〜3 と `pnpm run shots` が変わらない。`SLOW=1` の observe.scenes 通過
- [ ] `tools/bench-observe.ts` の fps・三角形・draw call が前と同じ (前後の数を作業ログに)

## 作業ログ
