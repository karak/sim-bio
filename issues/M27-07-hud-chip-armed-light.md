---
id: M27-07
title: HUD の種の列を作り直すと、持っている放流のチップの光 (.armed) だけ消える
status: done
milestone: M27
plan: issues/M27-05-stage-union-and-command-layer.md
depends_on: [M27-05]
evidence:
  - "tests/unit/ui.hud.dom.test.ts「放流のチップを持っている間に種の列が作り直されても、同じ種の新しい札は光る」。赤の確かめ: src/ui/Hud.ts の ensureSpecies を直す前に pnpm exec vitest run tests/unit/ui.hud.dom.test.ts を走らせ、classList.contains('armed') が false で落ちた (expected false to be true、1 failed / 7 passed)。直した後は 8 passed"
  - "pnpm run check exit 0 (vitest 141 files / 1440 tests、worker 66 tests、scripts 329 tests)"
  - "基準画: tests/e2e/shots.spec.ts の HUD を写す画は 'HUD のグラフ' (#graph) だけで、#spawn-row の札は写らない。ほかに .armed を写す画も無い。DOM の光 (クラス) の付け外しだけなので、基準画は変わらない見込み (shots は回していない)"

---

# 放流のチップを持っている間に種の列が作り直されると、光だけ消える

優先度: Could (小。見た目だけ。M27-05 の段 4 の報告で見つかった、前からある穴)

## What to build

`src/ui/Hud.ts` の `ensureSpecies` は種の数が変わると `#spawn-row` を innerHTML で作り直す。放流のチップ (`chip = { kind: 'spawn', speciesId }`) を持っている間にそれが起きると、札の `.armed` の光だけ消え、`chip()` は持ったまま (次の島のクリックで放流は出る)。見た目と状態がずれる。

直し方の案: `ensureSpecies` の作り直しの最後に `setChip(chip)` を呼んで光を揃える (値は 1 つなので、それで足りる)。

## 受入基準

- [x] `tests/unit/ui.hud.dom.test.ts` に、放流のチップを持った状態で種が増えた snapshot を `update` し、新しい `#spawn-row` の札に `.armed` が付いていることを見る試験 (直す前に赤を確かめる)
- [x] `pnpm run check` が通る。基準画 (`pnpm run shots`) は変わらない (見込み。理由は evidence)
- [x] 既存コメントの削除・書き換えは候補として報告し、承認を得てから (候補なし)

## 作業ログ

- 2026-10-11 22:50 起票 (M27-05 の作業ログ「前からある穴」から)。
- 2026-10-17 TDD で直した。赤を確かめてから、`ensureSpecies` の末尾に、持っているチップの id と同じ札だけ `.armed` を付ける 2 行を足した。案の `setChip(chip)` は `h.onArm` を再び呼び main.ts に二重に知らせるので、光だけを揃える形にした。AC 3 点目 (既存コメントの削除・書き換え) は候補なし。status は親が取り込んでから。
- 2026-10-17: 取り込み (02cf5cf)。done。
