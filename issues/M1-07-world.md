---
id: M1-07
title: World(create/dispatch/step/snapshot/serialize)
status: in_progress
milestone: M1
plan: docs/specs/plans/2026-09-19-m1-implementation-plan.md#task-7-world
depends_on: [M1-02, M1-03, M1-04, M1-05, M1-06]
evidence: []
---

# World(create/dispatch/step/snapshot/serialize)

実装計画の該当タスクを参照: [task-7-world](../docs/specs/plans/2026-09-19-m1-implementation-plan.md)

## 完了条件

- `world.determinism/properties/commands/save/log` の 5 テストが通る
- 固定シード 100 年で NaN なし・植生率 5〜95%

## 作業ログ

- 計画からの変更: 植生モデルの死亡項を `m·(1−f)·p` から `m·(2−f)·p`(基礎死亡 + 不適合分)に変更。旧式では 100 年後に植生率 97% で「全部埋まる」状態になったため。適合時の平衡密度は `1 − m/r`。
- `MIN_DENSITY = 1e-4` 未満を 0 とみなす(浮動小数で絶滅が判定できないため)。
- 全植物種の合計が 1 を超えたら比例縮小(合計が 1.0001 になるケースがあった)。
