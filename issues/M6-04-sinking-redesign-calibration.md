---
id: M6-04
title: 「沈む欠片」の再設計と校正
status: todo
milestone: M6
plan: docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md#34-沈む欠片の再設計と校正-m6-04
depends_on: [M6-01, M6-03]
evidence: []
---

# 「沈む欠片」の再設計と校正

## What to build

沈む欠片の予言を「雨は高地を鹿の地にするが力が要り、力は島が痩せるほど細る」とジレンマを明示する形に書き直し、予算と節目を入れる。計画 §3.4 の判定行列を `tests/slow` で固定する: 放置と 3 つの素朴戦略(雨だけ・放流だけ・疫病だけ)は dead、力を配分する 2 通りの台本は alive。

数値は予算・沈降量・高地の気温で合わせ、species.json は動かさない(振動と他の 4 本を壊すため)。他の 4 本は予算なしのまま通す。

## Blocked by

M6-01, M6-03

## Acceptance criteria

- [ ] scenarios.json の沈む欠片に `budget`、`milestones`、書き直した予言
- [ ] tests/slow: 放置 → dead
- [ ] tests/slow: 雨 1.5 倍入れっぱなし → dead、放流だけ → dead、疫病だけ → dead
- [ ] tests/slow: 想定解 1(雨 1.25 + 節約放流)→ alive、想定解 2(貯めて後半に集中)→ alive
- [ ] tests/slow: 既存 4 本と豊かさの罠が引き続き通る
- [ ] 校正で動かした数値と理由を設計書 §4.12 に記録

## 作業ログ

