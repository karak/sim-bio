---
id: M15-04
title: 「大津波の年」「地峡が切れる」の校正
status: todo
milestone: M15
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M15-02, M15-03]
evidence: []
---

# 「大津波の年」「地峡が切れる」の校正

## What to build

2 本を予算付きで書き、判定行列を固定する。

## Blocked by

M15-02, M15-03

## Acceptance criteria

- [ ] 校正の前にレベルデザイン文書(体験の芯・キーアイテム・ループ・判定行列)を書き、ユーザーの承認を得る
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] scenarios.json に 2 本
- [ ] tests/slow: 各シナリオで放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive
- [ ] 設計書に校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

