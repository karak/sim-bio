---
id: M14-03
title: 「環がもたらす客」の校正
status: todo
milestone: M14
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M14-02, M14-00]
evidence: []
---

# 「環がもたらす客」の校正

## What to build

外来種を定着させず、または共存させて在来 5 種を守る。判定行列を固定する。

## Blocked by

M14-02, M14-00

## Acceptance criteria

- [ ] M14-00 のレベルデザイン(承認済み)に従う。想定解の台本は UI と同じ手(放流 環 1・0.5、力 4)で書き、手で勝てない想定解は成立と数えない
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] scenarios.json に環がもたらす客(予定の来訪、予算、alive: 在来 5 種の 10 年平均、dead: 在来 2 種絶滅)
- [ ] tests/slow: 放置 dead、狼を増やすだけ dead、疫病だけ dead、想定解 2 つ alive
- [ ] 設計書に校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

