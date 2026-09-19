---
id: M6-01
title: 星の力(介入の予算)
status: todo
milestone: M6
plan: docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md#31-星の力介入の予算-m6-01
depends_on: []
evidence: []
---

# 星の力(介入の予算)

## What to build

シナリオに予算がある場合、石板に「力」が出て、放流や災害や気候変更で減り、足りなければ弾かれる。毎年、陸地率と生気に応じて回復し、気候を変え続けている分は維持費として減る。力が尽きたら気候は既定に戻り、石板にそう出る。予算のないシナリオと自由モードは今までどおり無料。

先に `spawn_species` に `radius` を足し、クリック 1 回の 3×3 放流を 1 コマンドにする(値段を 1 回で引くため)。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] `spawn_species` の `radius` で半径内の陸セルに放てる。既存の 1 セル放流(省略時)は変わらない
- [ ] `ScenarioDef.budget` を読み、`intervene` が値段を引く。足りないと `{ ok: false, reason: 'budget' }` で world に流れない
- [ ] 年が変わると `incomePerYear × 陸地率 × 生気平均 − 維持費` が加算され、上限で止まる
- [ ] 力が負になったら 0 にし、気候を既定に戻す `set_climate` が dispatch され、`scenario.power.exhausted` がログに出る
- [ ] 石板に力の残量と「+収入 / −維持費」が出る。弾かれたときは `cmd.rejected` がログに出て石板が反応する
- [ ] `budget` のないシナリオは無料のまま(既存の runner テストが通る)
- [ ] E2E: 予算付きシナリオで放流すると石板の力が減る

## 作業ログ

