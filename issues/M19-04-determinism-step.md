---
id: M19-04
title: 決定論の刻み(年の境目で step を切る)と golden replay
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: ["00e3334 落ちるテスト", "a4e5638 stepByYear・SIM_VERSION・golden", "be8a960 レビューの指摘", "b277c7a 境目のクリック", "tests/unit/scenario.determinism.test.ts", "tests/unit/runner.test.ts", "tests/unit/scenario.intercept.test.ts", "tests/unit/scenario.runner.test.ts"]
---

# 決定論の刻み(年の境目で step を切る)と golden replay

優先度: Must(設計書のドライバの優先度)

## What to build

年代記の共有・照合・年表(設計書 §1.3 C6、§9)の前提。今は `core/runner.ts` が 1 フレームで最大 200 tick 進め、`ScenarioRunner.update`(`fireDue` と年の境目の予算)はフレームごとに 1 回しか呼ばれない。予定コマンドが本体に入る tick が速度とフレームの刻みで変わり、同じ seed と介入でも結末が一致するとは限らない。
1 回の step が年の境目を越えないようにし(または ScenarioRunner を tick 単位で進め)、速度とフレームの刻みに依らず同じ結末になることを固定する。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 速度 1x・10x・100x とフレーム間隔の違う 3 通りで、同じ seed・同じ介入の結末のダイジェストが一致する(単体テスト)
  - 証跡:
    - テスト: `tests/unit/scenario.determinism.test.ts` の「1x・10x・100x とフレーム間隔の違う 3 通りの結末が、台本 (年の境目ごとの update) の結末と一致する」。
    - 修正前に落ちることの確認: 00e3334。10x と 100x の hash が台本と違った。
    - 通ることの確認: a4e5638 以降。
  - 補強:
    - 同じファイルの「年の途中と境目ちょうど (1x なら tick 720) のクリックも、打った tick を記録して再生すれば、3 通りとも実際の結末と一致する」(be8a960・b277c7a)。
    - 「判定が出たら境目より先へ進めない」「1 回の step で境目をまたいでも、境目ごとに update する」。
- [x] golden replay: 固定の年代記の結末ダイジェストを vitest で固定し、SIM_VERSION の上げ忘れを落とす
  - テスト: `tests/unit/scenario.determinism.test.ts` の「固定の年代記の結末ダイジェストが SIM_VERSION 1 の golden と一致する」「GOLDEN の最新の版が SIM_VERSION で、版ごとの hash はすべて違う」。
  - 版: `src/simulation/version.ts` の `SIM_VERSION = '1'`(a4e5638)。
  - 落ちることの確認: `VITALITY_LEACH` を 0.00015 から 0.00016 に変えると golden が落ち、戻すと通った。
- [x] 予言の卒業(#30)など、本体と ScenarioRunner の乱数がすべて seed から来ていることを確かめて記す
  - 下の作業ログの「乱数と時刻」に記した。#30(M18-04)はまだ作られていない。
- [x] tests/slow の通し実行(47 件)の判定が変わらない。変わるなら理由を作業ログに書く
  - 47 件すべて通った(be8a960 の時点、5 分割)。判定は変わっていない。
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - b277c7a で `npm run check` が 84 ファイル・725 件すべて通った。E2E は 28 件すべて通った。

## 作業ログ

### 2026-09-26(M19-04 の実装)

**原因(C6)**

原因は `src/core/runner.ts` と `src/main.ts` の組み合わせにある。
- `src/core/runner.ts` の rAF のループは、1 フレームで `min(ticks, 200)` tick を `world.step` でまとめて進める。
- `src/main.ts` の onFrame は、その後で 1 回だけ `ScenarioRunner.update` を呼ぶ。
- そのため、年の境目 360·Y を越えたフレームでの評価は tick 360·Y + δ で行われる。δ はそのフレームで境目を越えてから進んだ tick 数。
  - 予定コマンド(fireDue)が本体に入る tick も 360·Y + δ になる。
  - 年次評価(力の増減・警告・判定)の snapshot も同じ tick のものになる。
- 60Hz の描画での δ:
  - 1x・10x は 1 フレーム 1 tick 以下なので、δ は 0。
  - 100x は 0 か 1。
  - フレームの間隔が空くと、最大 199 まで広がる。

**直し方**

`src/scenario/stepByYear.ts` の `stepByYear(world, runner, n)` を足した。
- 1 回の `world.step` は年の境目を越えない。
- 境目に着くたびに、その snapshot で `runner.update` を呼ぶ。
- 判定が出たら、残りの tick は進めない。
- 境目は `ScenarioRunner.ticksToNextYear(s)` で求める。開始 tick から数える。

main はシナリオ中で、かつ判定の前だけ `stepByYear` を使う。判定の後に速度を戻したときは、今までどおり `world.step` で島を回す。

「ScenarioRunner を tick ごとに呼ぶ」案をとらなかった理由:
- 境目で切れば、tests/slow の台本(年の境目ごとに update → `step(360)`)と同じ刻みになる。
- ScenarioRunner と tests/slow の台本の駆動に手を入れずに済む。
- 毎 tick の snapshot と update の費用もかからない。

毎フレームの update は残した。
- 境目の後、同じ年のうちに呼ばれても、効かない。`fired` が予定の二重の発火を弾き、年次評価は `year !== lastYear` のときしか動かないため。
- 石板の祈り(`currentPrayer`)と、停止中の迎撃の連打の突き合わせは、毎フレームの update に頼っている。

**レビュー(codex の代わりに `pstack:thermo-nuclear-code-quality-review`)**

codex は使えなかった。auth が切れており、`codex exec --sandbox danger-full-access` も権限の判定で拒否された。代わりに別の agent に 2 回レビューを頼んだ。

1 回目(a4e5638 に対して、should-fix 6 件)への対応は be8a960。
- 01-B: 判定の onVerdict が `world.step` の中で速度を 0 にすると、`acc -= ticks*1000/speed` が 0 で割って -Infinity になる。次のフレームの前に速度を戻すと、島が二度と進まない。
  - 直し方: フレームの速度を固定して割る。
  - テスト: `tests/unit/runner.test.ts` の「step の中で速度が 0 にされても…」。修正前は 10 のまま止まるのを確認した。
- 01-C: 迎撃の pending の突き合わせが、毎フレームの update にしかなかった。境目でしか update しない再生では、2 発目が二重に引かれて rejected になる。
  - 直し方: `syncIntercepts` を出し、intervene の迎撃の枝でも呼ぶ。
  - テスト: `tests/unit/scenario.intercept.test.ts` の「年の途中で update を挟まなくても…」。修正前は rejected になるのを確認した。
- 01-E: 判定の後の `stepByYear(…, MAX_SAFE_INTEGER)` が固まりうる。
  - 直し方: stepByYear は判定の後は進めない。判定の後にどうするかは main が選ぶ。
- 01-D・02: 境目ちょうどの介入の順序の契約を、テストの `replay()` に書いた。
  - 契約: その境目の update の後に打つ。ライブのクリックと同じ順になる。
  - 年代記に tick 720 の介入を足した。golden は差し替えた。SIM_VERSION は未公開なので 1 のまま。
  - ライブで記録した tick から再生すると結末が一致するテストを足した。
- 03: 構造の作り替え(`ScenarioRunner.advance(n)`、update を境目専用にする、`ticksToNextYear` を非公開にする)は M19-06 に回した。引き継ぎは `issues/M19-06-chronicle.md` に書いた。

2 回目(be8a960 に対して)は、条件付きで承認された。
- 条件: M19-06 への引き継ぎを書くこと。済み。
- nit のうち「境目ちょうどのクリックをライブ側でも確かめる」は b277c7a で足した。
- 次の nit は直していない:
  - JSDoc の「毎フレーム呼ぶ」の文は既存のコメントなので書き換えず、上に 1 行足した。
  - `SIM_VERSION` の型(string と Number の混在)。
  - GOLDEN をその場で書き換えても通ること。版の上げ忘れは、テストの失敗文言で促すにとどまる。

**乱数と時刻(`src/simulation`・`src/scenario`・`src/core`)**

- `Math.random`・`crypto`・`Date.now` は、src 全体で本体の状態に効く使い方をしていない。`src/ui/Hud.ts:283` の `Date.now()` は、保存するファイルの名前にしか使わない。
- 乱数は `src/simulation/rng.ts` の mulberry32 だけで、seed から作る。
  - 地形: `seed` と `seed ^ 0x9e3779b9`(`src/simulation/terrain.ts:35-36`)。
  - 輝石: `seed ^ CRYSTAL_SEED_OFFSET`(`src/simulation/terrain.ts:67`)。
  - simplex-noise の `createNoise2D(random)` は、渡した乱数で順列表を一度作るだけ。
- step の中(気候・火事・植生・個体群・文明・祈り)と ScenarioRunner には乱数が無い。
- 時刻は `World.log` の `ts`(`deps.now ?? new Date()`)にしか使わず、状態には入らない。
- 予言の卒業(#30、M18-04)はまだ作られていない。作るときは、乱数を seed から作る(`mulberry32(seed ^ 定数)`)。
- 残るリスク: 気候は毎 tick `Math.sin`・`Math.cos` を使う(`src/simulation/climate.ts:36-37`)。V8 どうしなら一致するが、エンジンの違うブラウザで最後の桁まで一致するとは限らない。M19-06 に書いた。

**テストの結果**

- 単体テスト(`npm run check`)
  - b277c7a で 84 ファイル・725 件すべて通った。
  - 1 回目(a4e5638)は、`tests/unit/world.civilization.prayer.test.ts` の 1 件が 5 s のタイムアウトで落ちた。このテストは今回の変更に触れていない。同じ時刻に load average が 9 台で、単独で回すと 17 件すべて通った。
- E2E(`npx playwright test`、自分の worktree の dev サーバー 5181 で)
  - a4e5638 と b277c7a の両方で、28 件すべて通った。
- tests/slow(`SLOW=1`、`tests/slow/scenarios.playthrough.test.ts`、be8a960 で caffeinate を付けて 5 分割)
  - 5 / 15 / 18 / 13 / 14 件で、どれも通った(分割どうしで重なりがある)。
  - 5 つの `-t` が 47 件すべてを覆うことは、名前の一覧と照らし合わせて確かめた。
  - 判定は変わっていない。台本は `stepByYear` を通らないので、変わらないのが筋。ScenarioRunner の変更は `ticksToNextYear` の追加と、迎撃の突き合わせを intervene でも呼ぶことだけ。台本の迎撃は年を離れて撃つので、効かない。
