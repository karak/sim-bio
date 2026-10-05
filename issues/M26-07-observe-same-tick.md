---
id: M26-07
title: 観察画面が島の入れ替え (新しい島・枠や file の読み込み) の後も最初の島を見せる
status: review
milestone: M26
plan: null
depends_on: [M26-05]
evidence:
  - tests/unit/observe.rebuild.test.ts (観察画面を組み直す判定)
  - tests/e2e/observeIslandSwap.spec.ts (file 読み込み・新しい島の後の 3D が新しい島。修正前は赤)
  - src/observe/rebuild.ts, src/observe/entry.ts, src/observe/view.ts (dispose)
---

# 観察画面が島の入れ替えの後も最初の島を見せる

優先度: Must

## What to build

M26-05 (島の画面の地形が同じ tick で作り直されない) の調べで見つかった同じ型の欠陥。観察画面は一度だけ組み (`src/observe/entry.ts:124` の `loading ??= build(latest)`)、更新は tick の変化だけで判じる (`src/observe/view.ts:1033` の `if (next.tick !== snap.tick)`)。新しい島・枠の読み込み・file の読み込みの後に「3D で見る」を開くと、最初の島が出る。

やること:
1. 落ちる試験: E2E (tick 0 で違う島の file を読む → 3D で見る → 島が変わっている。M26-05 の `terrainDigest()` に相当する口を観察画面の `inspect()` に足す)。単体は判定を純粋な関数にして `src/render/rebuild.ts` の `needsRebuild` と揃える
2. 直す: 島の同一性 (M26-05 と同じ `layers.elevation` の参照) が変わったら観察画面を組み直す (`loading` を捨てる)
3. OBS-002 の撮影 (`pnpm run shots`) と `pnpm run judge` が通る。基準画は無い (観察画面は採点表)

## Blocked by

- M26-05 (取り込み済み 4522b74)

## Acceptance criteria

- [x] 島を入れ替えた後の観察画面が新しい島を見せる試験 (E2E・単体) が通る
- [x] `pnpm run check`、observe・observeEntry・sceneIdle の E2E、shots の OBS-002 が通る

## 作業ログ

- 2026-10-04: 起票 (M26-05 の agent の報告から)。
- 2026-10-04: 実装 (feat/m26-07)。島の同一性 (layers.elevation) が替われば観察画面を捨てて組み直す (view.dispose で listener・素材・context を解放)。観察画面の inspect に terrainDigest を追加。別 agent のレビューで、grade の uniform の共有・失敗した組みの再試行・assets/foliage の cache の WeakMap 化・preset の timer を直した。check・observe/observeEntry/sceneIdle/sameTickIsland/freeIslandSeed/observeIslandSwap の E2E (14 件)・shots (6 件、OBS-002 含む) 通過。基準画の変更なし。
