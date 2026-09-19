---
id: M4-02
title: 滅びの進行(沈降コマンドと予定コマンド)
status: todo
milestone: M4
plan: docs/design/2026-09-19-scenarios-and-world.md
depends_on: [M4-01]
evidence: []
---

# 滅びの進行(沈降コマンドと予定コマンド)

## What to build

World に沈降コマンド(全セルの標高を下げる)を追加し、シナリオの予定コマンド(年 N に隕石、毎年沈降など)を tick に合わせて dispatch する ScenarioRunner を作る。介入回数を数える。

## Blocked by

M4-01

## Acceptance criteria

- [ ] tests/unit/world.commands.test.ts: sink で陸地率が下がり、海になったセルの植物が 0 になる
- [ ] tests/unit/scenario.runner.test.ts: 予定コマンドが指定 tick でちょうど 1 回 dispatch され、年次で judge が呼ばれる
- [ ] serialize/restore を通しても予定が壊れない(runner はシナリオ開始からの tick で判定)

## 作業ログ

