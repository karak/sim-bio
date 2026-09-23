---
id: M13-04
title: 「熱を抜け」「地底の民」「霊脈枯れ(完全版)」の校正
status: todo
milestone: M13
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M13-02, M13-03, M9-03, M13-00]
evidence: []
---

# 「熱を抜け」「地底の民」「霊脈枯れ(完全版)」の校正

## What to build

3 本を予算付きで書き、判定行列を通し実行で固定する。霊脈枯れは M9-04 の簡易版を置き換える。

## Blocked by

M13-02, M13-03, M9-03, M13-00

## Acceptance criteria

- [ ] M13-00 のレベルデザイン(承認済み)に従う。想定解の台本は UI と同じ手(放流 環 1・0.5、力 4)で書き、手で勝てない想定解は成立と数えない
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] scenarios.json に 3 本。霊脈枯れ(簡易版)は削除し、M9-04 の通し実行を差し替える
- [ ] tests/slow: 各シナリオで放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive。既存も通る
- [ ] 設計書に係数と校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

