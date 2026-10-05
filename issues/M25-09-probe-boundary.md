---
id: M25-09
title: 本番の bundle に入った試験の口 (__scene*・__observe*) を開発のビルドに閉じ、inspect() と probe の型にする
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: []
evidence:
  - "AC1: tests/unit/build.devtools.test.ts (MARKERS に __probe、RETIRED に __scene・__observe を足した時点で赤 → 実装後に緑)"
  - "AC2: 同ファイルの受入のビルド (VITE_DEVTOOLS=1) の確かめが __probe を含めて MARKERS と一致"
  - "AC3: E2E 83 passed / 4 skipped (CI=1 E2E_PORT=5451)、shots 4 passed (ACCEPTANCE_DIR 付き)、node tools/bench-observe.ts 完走 (6 画)"
  - "AC4: tests/unit/render.inspect.test.ts (cellViewOf・selectionOf)、tests/unit/dev.probe.test.ts"
  - "commit: feat/m25-09 の先頭 (git log で M25-09 を引く)"
---

# 本番の bundle に入った試験の口 (__scene*・__observe*) を開発のビルドに閉じ、inspect() と probe の型にする

優先度: Must

## What to build

ADR 0001 の「この ADR の外で起こす票」。設計に依らない製品の欠陥。

`pnpm run build:cloudflare` と同じ環境で vite build すると、出た JS に `__sceneSelection`・`__sceneCell` (src/render/SceneView.ts:246・286) と `__observeAir`・`__observeNotice`・`__observeFx`・`__observeLook`・`__observeHuts`・`__observeProps`・`__observeBreakdown`・`__observeScreen`・`__observeStats`・`__observeDebug` (src/observe/view.ts:657-1008) が入っている (2026-09-30 に確かめた)。
docs/operations/acceptance.md は「開発・受入のビルドだけにあり、本番のビルドには入らない」と言うが、tests/unit/build.devtools.test.ts:8 の MARKERS はこれらを見ていない。

作るもの:
- SceneView と観察画面は window に書かず、読むだけの `inspect()` を返す (純粋な読み。単体で試せる)
- window に載せるのは `DEVTOOLS_BUILT` (src/main.ts:39) の下で動的に import する `src/dev/probe.ts` だけ。名前は `window.__probe` に揃える
- build.devtools.test.ts の MARKERS に `__scene`・`__observe`・`__probe` を足す
- shots.spec.ts・cellHighlight.spec.ts・sceneIdle.spec.ts・observe.spec.ts と tools/bench-observe*.ts の呼び出しを `__probe` に直す

## Blocked by

- なし

## Acceptance criteria

- [ ] build.devtools.test.ts の本番の確かめが、直す前は落ち (MARKERS を足した時点)、直した後は通る
- [ ] 受入のビルド (VITE_DEVTOOLS=1) には入る (空振りしていない)
- [ ] E2E (shots を含む) と bench が今と同じに通る
- [ ] `inspect()` の単体試験がある (選んだセル・カメラ・見え方)

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の外の票 外-1)
- 2026-10-01: 実装。SceneView・観察画面は inspect() を返し、window.__probe は src/dev/probe.ts だけ (main.ts と observe/prototype.ts が DEVTOOLS_BUILT の下で動的 import)。E2E・bench・readme-shots は __probe に直した。codex は認証切れのため、読むだけの別モデルのレビュアーで代えた (型の穴と試験の弱さを直した)。
