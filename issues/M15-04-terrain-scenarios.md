---
id: M15-04
title: 「大津波の年」「地峡が切れる」の校正
status: todo
milestone: M15
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M15-02, M15-03, M15-00]
evidence: []
---

# 「大津波の年」「地峡が切れる」の校正

## What to build

2 本を予算付きで書き、判定行列を固定する。

## Blocked by

M15-02, M15-03, M15-00

## Acceptance criteria

- [ ] M15-00 のレベルデザイン(承認済み)に従う。想定解の台本は UI と同じ手(放流 環 1・0.5、力 4)で書き、手で勝てない想定解は成立と数えない
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] scenarios.json に 2 本
- [ ] tests/slow: 各シナリオで放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive
- [ ] 設計書に校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

