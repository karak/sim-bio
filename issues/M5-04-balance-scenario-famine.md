---
id: M5-04
title: バランス維持とシナリオ「生気の飢饉」
status: todo
milestone: M5
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M5-02, M5-03]
evidence: []
---

# バランス維持とシナリオ「生気の飢饉」

## What to build

生気を入れても 100 年共存と振動のテストが通るよう係数を決める。シナリオ「生気の飢饉」(分解者が一か所しかなく、放置すると生気が尽きて植生が崩れる。胞子苔を湿潤地に広げれば回避)を追加し、通し実行テストで放置→滅び、介入→回避を固定する。

## Blocked by

M5-02, M5-03

## Acceptance criteria

- [ ] data.test.ts / world.oscillation.test.ts が通る
- [ ] scenarios.json に vitality-famine。scenario judge に vitality_ratio 条件
- [ ] tests/slow: 生気の飢饉 の放置→dead、介入→alive
- [ ] 設計書 §4/§6 に M5 の差分と証跡

## 作業ログ

