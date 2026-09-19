---
id: M4-01
title: シナリオ定義と判定の純粋関数
status: done
milestone: M4
plan: docs/design/2026-09-19-scenarios-and-world.md
depends_on: []
evidence: ["8b8f516", "tests/unit/scenario.judge.test.ts"]
---

# シナリオ定義と判定の純粋関数

## What to build

石板の予言をデータ(assets/data/scenarios.json)で定義し、snapshot と介入回数から Alive / Dead / 進行中を判定する純粋関数 judgeScenario を作る。条件は種の生存、陸地率、植生率、種の総量倍率、年数到達、無介入。

## Blocked by

なし(すぐ着手可)

## Acceptance criteria

- [ ] tests/unit/scenario.judge.test.ts: 各条件型が期待どおり真偽を返す
- [ ] scenarios.json が型に合い、4 本(沈む欠片・星が落ちる夜・火の山の目覚め・豊かさの罠)を含む

## 作業ログ

