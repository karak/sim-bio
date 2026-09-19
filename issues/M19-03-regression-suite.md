---
id: M19-03
title: 回帰の通し実行
status: todo
milestone: M19
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# 回帰の通し実行

## What to build

全シナリオの判定行列を一括で回し、時間を管理する。長いものは並列に分け、結果を表にする。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] tests/slow を並列(worker)で回し、シナリオごとの結果と所要時間を表で出す
- [ ] 合計時間の上限を決め、超えたら size を落とすかケースを間引く方針を設計書に書く
- [ ] 新しいシナリオを足すときの手順(判定行列のテンプレート)を issues/README に
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

