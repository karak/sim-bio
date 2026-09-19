---
id: M5-01
title: 枯死層と生気層(物質循環の閉じ)
status: done
milestone: M5
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: ["084f3b9 tests/unit/vitality.test.ts tests/unit/vegetation.test.ts"]
---

# 枯死層と生気層(物質循環の閉じ)

## What to build

植物・動物の死亡と山火事の焼失を枯死(litter)に積み、枯死が分解されて生気(vitality)になり、植物の成長が生気を消費する。生気は隣接へ拡散し、ゆっくり漏出する。生気が薄いと植物の成長が鈍る。

## Blocked by

なし(すぐ着手可)

## Acceptance criteria

- [x] tests/unit/vitality.test.ts: 枯死→生気の分解、生気の拡散と漏出、海は 0
- [x] tests/unit/vegetation.test.ts: 生気が薄いセルは成長が遅い、成長すると生気が減る、枯死が死亡分だけ増える
- [x] serialize/restore に vitality と litter が含まれる

## 作業ログ

