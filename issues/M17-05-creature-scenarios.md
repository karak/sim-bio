---
id: M17-05
title: 「巨人の道」「夢喰いの影」の校正
status: todo
milestone: M17
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M17-01, M17-02]
evidence: []
---

# 「巨人の道」「夢喰いの影」の校正

## What to build

2 本を予算付きで書き、判定行列を固定する。

## Blocked by

M17-01, M17-02

## Acceptance criteria

- [ ] scenarios.json に 2 本
- [ ] tests/slow: 各シナリオで放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive
- [ ] 設計書に校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

