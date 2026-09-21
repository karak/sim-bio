---
id: M9-03
title: 信仰の効き(内乱と採掘の制止)
status: done
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-02, M9-06]
evidence: ["c310e0d 1e342f0 tests/unit/world.civilization.edict.test.ts", "1e342f0 tests/unit/unrest.test.ts", "1e342f0 tests/unit/vein.test.ts tests/unit/world.vein.test.ts", "1e342f0 tests/unit/prayer.test.ts tests/unit/world.civilization.prayer.test.ts", "1e342f0 tests/e2e/smoke.spec.ts", "1e342f0 tests/slow/scenarios.playthrough.test.ts"]
---

# 信仰の効き(内乱と採掘の制止)

## What to build

信仰が低いと内乱が起き、民が減って段階が下がる。信仰が高いと石板の「採掘を止めよ」に民が従い、輝石を掘らなくなる(負荷は残る)。判定条件 faith と警告が使える。

## Blocked by

M9-02

## Acceptance criteria

- [x] 信仰 < 0.3 が 3 年続くと内乱: 集落の民が半減し段階 −1(単体テスト)。ログ sim.civ.unrest
- [x] 石板の「採掘を止めよ / 再開せよ」は信仰 ≥ 0.6 のときだけ効き、効いた年から採掘が 0 になる(単体 + E2E)
- [x] Condition faith { min?, max? } の真偽(単体テスト)。警告 faith_low(信仰 < 0.4)
- [x] 文明のない世界では何も起きない
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-09-21〜22: 勅令(edict.ts)・内乱(unrest.ts)・霊脈(vein.ts: 脈の番号付け、脈を辿る採掘、生気の器)を実装。霊脈は 2 度仕組みを変えた(セルごとの枯渇 → 脈全体、分解の効き → 生気の上限)。
- 副作用: 祈りと内乱で塔の重さ v2 が 56 年目に滅びた。祈りを「いつもより」(基準比)に、取り下げを追加、災害は集落を襲ったときだけ、減衰 0.01 に。塔の台本は変えずに通る。設計書 §4.19。
