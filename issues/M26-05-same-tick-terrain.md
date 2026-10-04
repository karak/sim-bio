---
id: M26-05
title: 新しい島が前の島と同じ tick のとき地形が作り直されない
status: open
milestone: M26
plan: null
depends_on: [M21-10]
evidence: []
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

- [ ] 同じ tick の新しい島で地形が作り直される試験 (単体・E2E) が通る
- [ ] sceneIdle.spec と `pnpm run check`、shots を含む E2E が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 5)。
