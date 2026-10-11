---
id: M27-07
title: HUD の種の列を作り直すと、持っている放流のチップの光 (.armed) だけ消える
status: todo
milestone: M27
plan: issues/M27-05-stage-union-and-command-layer.md
depends_on: [M27-05]
evidence: []
---

# 放流のチップを持っている間に種の列が作り直されると、光だけ消える

優先度: Could (小。見た目だけ。M27-05 の段 4 の報告で見つかった、前からある穴)

## What to build

`src/ui/Hud.ts` の `ensureSpecies` は種の数が変わると `#spawn-row` を innerHTML で作り直す。放流のチップ (`chip = { kind: 'spawn', speciesId }`) を持っている間にそれが起きると、札の `.armed` の光だけ消え、`chip()` は持ったまま (次の島のクリックで放流は出る)。見た目と状態がずれる。

直し方の案: `ensureSpecies` の作り直しの最後に `setChip(chip)` を呼んで光を揃える (値は 1 つなので、それで足りる)。

## 受入基準

- [ ] `tests/unit/ui.hud.dom.test.ts` に、放流のチップを持った状態で種が増えた snapshot を `update` し、新しい `#spawn-row` の札に `.armed` が付いていることを見る試験 (直す前に赤を確かめる)
- [ ] `pnpm run check` が通る。基準画 (`pnpm run shots`) は変わらない
- [ ] 既存コメントの削除・書き換えは候補として報告し、承認を得てから

## 作業ログ

- 2026-10-11 22:50 起票 (M27-05 の作業ログ「前からある穴」から)。
