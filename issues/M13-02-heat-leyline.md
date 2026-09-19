---
id: M13-02
title: 熱と霊脈の連動
status: todo
milestone: M13
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M13-01]
evidence: []
---

# 熱と霊脈の連動

## What to build

火山の熱が霊脈に沿って広がり、線上の森が熱を逃がす。熱が溜まりすぎると噴火が起きる(火山の周期)。石板が熱の前兆を告げる。

## Blocked by

M13-01

## Acceptance criteria

- [ ] 熱は線に沿って隣へ拡散し、線上の森の密度に応じて減る(単体テスト)
- [ ] 火山セルの熱が閾値を超えると噴火(火山コマンドが自動で起きる)し、熱が下がる(単体テスト)。ログ sim.volcano.erupted
- [ ] 警告 heat_rising(熱が閾値の 70% 超)。tick.summary に maxHeat
- [ ] 「火の山の目覚め」は予定の噴火のまま変わらない(通し実行が通る)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

