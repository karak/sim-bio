---
id: M3-02
title: Holling II 型の摂食応答
status: todo
milestone: M3
plan: references/games/stage-design-ideas.md
depends_on: [M3-01]
evidence: []
---

# Holling II 型の摂食応答

## What to build

動物の摂食を飽和型にする。SpeciesDef に handlingTime を追加し、摂取量を predation·food / (1 + predation·handlingTime·food) にする。狼と鹿に handlingTime を設定し、島全体または地域の年次総量に持続する波が出るようにする。

## Blocked by

M3-01

## Acceptance criteria

- [ ] tests/unit/populations.test.ts: handlingTime > 0 で餌が多いときの摂取量が線形より小さい
- [ ] tests/unit/world.oscillation.test.ts: 鹿または狼の年次総量に 60 年で極大値 ≥ 3、後半 30 年の振幅比 ≥ 0.2(M3-01 の期待を反転)
- [ ] 100 年共存テスト(data.test.ts)が引き続き通る

## 作業ログ

