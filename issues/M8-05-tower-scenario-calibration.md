---
id: M8-05
title: 判定条件と「塔の重さ」の校正
status: in_progress
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-03]
evidence: []
---

# 判定条件と「塔の重さ」の校正

## What to build

シナリオ条件 civ_stage と警告 civ_declining を足し、「塔の重さ」を予算付きで書き、放置と素朴戦略は dead、力を配分する 2 通りは alive を通し実行で固定する。

## Blocked by

M8-03

## Acceptance criteria

- [ ] Condition civ_stage { min?, max?, years? }(直近 years 年の最小段階)。単体テスト
- [ ] 警告 civ_declining(段階が下がった年)。単体テスト
- [ ] scenarios.json に塔の重さ(予言・start.civilization・予算・節目・alive/dead)
- [ ] tests/slow: 放置 dead、森の放流だけ dead、疫病だけ dead、雨 + 放流 alive、疫病で間引き + 放流 alive。既存 15 件も通る
- [ ] 設計書 §4.14 に係数と校正の表

## 作業ログ

