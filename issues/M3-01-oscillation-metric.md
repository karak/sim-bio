---
id: M3-01
title: 振動の自動判定
status: todo
milestone: M3
plan: references/games/stage-design-ideas.md
depends_on: []
evidence: []
---

# 振動の自動判定

## What to build

年次の総量系列から「極大値の数」と「振幅比 (max−min)/max」を計算する純粋関数を用意し、性質テストで振動の有無を機械的に判定できるようにする。現状のモデルで鹿・狼が減衰することをテストで固定し、以降のチケットでその期待を反転させる。

## Blocked by

なし(すぐ着手可)

## Acceptance criteria

- [ ] tests/unit/oscillation.test.ts: 合成した正弦波・減衰波・定常で極大値数と振幅比が期待どおり
- [ ] tests/unit/world.oscillation.test.ts: 現行モデルで 60 年の鹿の年次総量が減衰(後半 30 年の振幅比 < 0.1)であることを固定

## 作業ログ

