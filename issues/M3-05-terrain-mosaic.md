---
id: M3-05
title: 生息地のモザイク化と避難地
status: todo
milestone: M3
plan: references/games/stage-design-ideas.md
depends_on: [M3-03]
evidence: []
---

# 生息地のモザイク化と避難地

## What to build

水分ノイズの周波数を上げて森・草原・乾燥地をパッチ状に分け、湖を数個置く。狼の適合度が低い避難地(高地)が被食者の生き残りを支える。地形生成は決定論なので性質テストで分布を守る。

## Blocked by

M3-03

## Acceptance criteria

- [ ] tests/unit/terrain.test.ts: 陸の水分の分布で 0.45 未満と 0.6 以上がそれぞれ 15% 以上ある
- [ ] tests/unit/terrain.test.ts: 陸に囲まれた湖(海に接しない水セル)が 1 つ以上ある
- [ ] 100 年共存テストと振動テストが通る

## 作業ログ

