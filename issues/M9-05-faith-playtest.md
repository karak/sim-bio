---
id: M9-05
title: 手動受入プレイテスト(M9)
status: todo
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-00, M9-01, M9-02, M9-03, M9-04]
evidence: []
---

# 手動受入プレイテスト(M9)

## What to build

ビルド済みを配信して 2 本を 3 回遊び、記録する。1 回は負け、理由が石板で分かること。分かりにくさを直す。

## Blocked by

M9-01, M9-02, M9-03, M9-04

## Acceptance criteria

- [ ] プレイ記録 3 回分(うち 1 回以上 dead)
- [ ] 記録で挙がった表示の問題を直し E2E が通る
- [ ] 設計書 §6 と企画書に反映
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

