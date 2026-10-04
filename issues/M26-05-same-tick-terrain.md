---
id: M26-05
title: 新しい島が前の島と同じ tick のとき地形が作り直されない
status: review
milestone: M26
plan: null
depends_on: [M21-10]
evidence:
  - tests/unit/render.rebuild.test.ts (needsRebuild・terrainDigest)
  - tests/e2e/sameTickIsland.spec.ts (ファイル・新しい島・枠、すべて tick 0 のまま)
  - tests/e2e/sceneIdle.spec.ts (M21-10 が通る)
  - src/render/rebuild.ts, src/render/SceneView.ts
---

# 新しい島が前の島と同じ tick のとき地形が作り直されない

優先度: Must

## What to build

古い欠陥 (2026-09-29 に確認)。年 0 で「新しい島」を押す、今の tick と同じ tick の枠を読む、などで新しい島の tick が前と同じだと、画面の地形が前の島のまま。SceneView が tick の変化で描き直しを判じているため (M21-10 で止めた時は描かないようにした所と関係する)。

やること:
1. 落ちる試験: 単体 (SceneView か描く判定の純粋な関数) と E2E (年 0 で新しい島 → 地形の画が変わる。`__probe` の `inspect()` か画素で見る)
2. 直す: 島の同一性 (世界の id か seed) の変化でも描き直す。tick だけで判じない
3. M21-10 の「止めた時は描かない」を壊さない (`tests/e2e/sceneIdle.spec.ts` が通る)

## Blocked by

- なし

## Acceptance criteria

- [x] 同じ tick の新しい島で地形が作り直される試験 (単体・E2E) が通る
- [x] sceneIdle.spec と `pnpm run check`、shots を含む E2E が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 5)。
- 2026-10-04: 実装。原因は SceneView.update が tick と層だけで描き直しを判じていたこと。判定を純粋関数 needsRebuild (src/render/rebuild.ts) に出し、島の同一性 (World の標高バッファの参照。島の中では差し替わらない) を加えた。選びの帯の書き直しも同じ参照で判じる。試験の口は SceneInspect.terrainDigest (地形の頂点の高さの要約)。先に落ちる E2E で再現を確かめた (判定から島を外すと落ちる)。
- 2026-10-04: pnpm run check 通過 (126 files / 1242 tests)。E2E: sceneIdle・cellHighlight・persist・smoke・shots・sameTickIsland 41 件通過。レビュー (opus) に実害の指摘は無し。
- 残り (別チケット候補): 観察画面 (src/observe/entry.ts:124, view.ts:1033) も島を 1 度だけ作り tick だけで更新するので、島が替わると前の島のまま。
