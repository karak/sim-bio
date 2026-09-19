---
id: M5-02
title: 分解者(胞子苔)
status: todo
milestone: M5
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M5-01]
evidence: []
---

# 分解者(胞子苔)

## What to build

第 4 の階層 decomposer を追加。胞子苔は枯死を餌に増え、いる場所の分解率を上げる。湿潤でのみ生き、山火事で全滅する。species.json に追加。

## Blocked by

M5-01

## Acceptance criteria

- [ ] tests/unit/populations.test.ts: 分解者は枯死が多いと増え、無いと減る
- [ ] tests/unit/vitality.test.ts: 分解者がいるセルは分解が速い
- [ ] tests/unit/disaster.test.ts: 山火事は分解者も 0 にする

## 作業ログ

