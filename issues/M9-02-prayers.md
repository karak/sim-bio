---
id: M9-02
title: 祈り
status: todo
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-01]
evidence: []
---

# 祈り

## What to build

民の困りごとが石板に「祈り」として届く。集落周辺の草が少なければ「雨を」、捕食者が多ければ「狼を減らして」、輝石が尽きれば「星の砂を」。期限内に対応する介入をすれば信仰が上がり、無視すれば下がる。

## Blocked by

M9-01

## Acceptance criteria

- [ ] 祈りの生成は純粋関数。条件(草の密度・捕食者比・輝石量)ごとに 1 種類、同時に 1 つだけ、期限 5 年(単体テスト)
- [ ] 期限内に対応する種類の介入があれば「応えた」と判定して信仰 +、期限切れで −(単体テスト)
- [ ] 石板に現在の祈りと残り年数が出て、応えた・無視したが年表に並ぶ(E2E: 試し読みシナリオで祈りが出て、対応する介入で消える)
- [ ] ログ scenario.prayer(issued / answered / ignored)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

