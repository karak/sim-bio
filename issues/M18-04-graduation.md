---
id: M18-04
title: 「見守り手の卒業」(原因ランダム、300 年)
status: todo
milestone: M18
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M18-03, M18-00]
evidence: []
---

# 「見守り手の卒業」(原因ランダム、300 年)

## What to build

滅びの原因がシードで選ばれ、石板を読んで原因に応じた回避をして 300 年存続する総合シナリオ。

## Blocked by

M18-03, M18-00

## Acceptance criteria

- [ ] M18-00 のレベルデザイン(承認済み)に従う。想定解の台本は UI と同じ手(放流 環 1・0.5、力 4)で書き、手で勝てない想定解は成立と数えない
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] 原因の選択は seed で決定論。候補は実装済みの全原因(単体テスト: 全候補が選ばれうる)
- [ ] tests/slow: 代表 3 原因で放置 dead、想定解 alive
- [ ] 設計書に証跡
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

