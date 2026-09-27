---
id: M9-00
title: 文明の自然発生条件の見直し(地域で測る)
status: done
milestone: M9
plan: docs/design/2026-09-21-level-design-faith.md#8-文明の自然発生条件の見直しm9-00
depends_on: [M8-02, M9-06]
evidence: ["2a35b32 tests/unit/civilization.test.ts", "2a35b32 tests/unit/world.civilization.test.ts", "8ac0fa6 tests/slow/scenarios.playthrough.test.ts"]
---

# 文明の自然発生条件の見直し(地域で測る)

## What to build

M8-02 の実測どおり、既定の島(seed 42、size 64、全種)では鹿の文明が発生しない。原因は構造的(島全体の鹿は 9 年周期で
振動し続け振幅比 0.42〜0.53、密度最大点は採食圧最大点で植生 0.25)。閾値は据え置き、測り方を地域に変える(LD §8)。

- 安定: 候補セルの支え半径 8 の総量の年次履歴で振幅比 < EMERGE_AMPLITUDE。候補が前年から 8 セル以内なら履歴を継ぐ
- 余剰: 候補の MINE_RADIUS[1] 以内に輝石がある
- 植生: 候補の支え半径 8 の平均 ≥ EMERGE_VEGETATION × 島の陸の植生平均

## Blocked by

M8-02, M9-06(LD の承認)

## Acceptance criteria

- [x] checkEmergence が地域の履歴・輝石の有無・相対植生で判定する(単体テスト、境界値つき)
- [x] seed 42 / size 64 / 全種で鹿の文明が 60 年以内に発生する(`sim.civ.emerged`)
- [x] 草だけの世界(tests/unit/world.civilization.test.ts)の既存テストが変わらない
- [x] 既存の通し実行 20 件が通る
- [x] 設計書 §4 に差分、§6 に証跡。npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 2026-09-21: 実測(150 年放置)。島全体の振幅比 0.42〜0.53、候補 2635 の半径 8 の地域人口 3.8〜4.3・振幅比 0.08〜0.11、半径 3 植生 0.25、半径 8 植生 0.18。
- 2026-09-21: 実装。候補を輝石の近くに限り、群れに留まる規則(EMERGE_STICKY 0.5)を足した。size 64 で 22 年目に発生。size 128 は地域の群れが振幅 0.8〜0.9 で波打ち未発生(既知の制約、設計書 §4.17)。通し実行 20 件通過(3 分割)。
