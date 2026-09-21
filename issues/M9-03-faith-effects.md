---
id: M9-03
title: 信仰の効き(内乱と採掘の制止)
status: todo
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-02, M9-06]
evidence: []
---

# 信仰の効き(内乱と採掘の制止)

## What to build

信仰が低いと内乱が起き、民が減って段階が下がる。信仰が高いと石板の「採掘を止めよ」に民が従い、輝石を掘らなくなる(負荷は残る)。判定条件 faith と警告が使える。

## Blocked by

M9-02

## Acceptance criteria

- [ ] 信仰 < 0.3 が 3 年続くと内乱: 集落の民が半減し段階 −1(単体テスト)。ログ sim.civ.unrest
- [ ] 石板の「採掘を止めよ / 再開せよ」は信仰 ≥ 0.6 のときだけ効き、効いた年から採掘が 0 になる(単体 + E2E)
- [ ] Condition faith { min?, max? } の真偽(単体テスト)。警告 faith_low(信仰 < 0.4)
- [ ] 文明のない世界では何も起きない
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

