---
id: M6-03
title: 石板の警告・節目・結果の内訳
status: todo
milestone: M6
plan: docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md#33-石板の警告節目結果の内訳-m6-03
depends_on: []
evidence: []
---

# 石板の警告・節目・結果の内訳

## What to build

年が変わるたびに石板が危険を告げる(種が基準の 25% 未満、陸地が基準の半分未満、力が足りない、維持費が収入超え)。予言の節目(「50 年目: 陸は半分になる」)が先に見え、到達したら消える。勝敗のオーバーレイに内訳(介入回数、使った力、陸地率、種の総量)が出る。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 純粋関数 `scenarioWarnings(def, snapshot, start, power)` の単体テスト: 4 種類それぞれの真偽
- [ ] 石板に警告が最大 3 行出る。ログ `scenario.warning` は種類(と種)ごとに初回だけ
- [ ] `ScenarioDef.milestones` を読み、未到達の節目が石板に見え、到達で消える
- [ ] `Verdict.stats` にオーバーレイの内訳が入り、表示される
- [ ] E2E: 警告と内訳の文言が出る(test-quick か沈む欠片で)

## 作業ログ

