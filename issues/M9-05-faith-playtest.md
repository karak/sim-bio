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

- [x] プレイ記録 3 回分(うち 1 回以上 dead)
- [x] 記録で挙がった表示の問題を直し E2E が通る
- [x] 設計書 §6 と企画書に反映
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-09-22: ビルド配信 + DevTools で 3 回(応える dead / 儀式 alive / 儀式で止める alive)。直した表示: 信仰の切り捨て(0.597 が「0.60」と出て勅令が通らない理由が読めなかった)、HUD の集落の生気「生気 NN%」と警告 civ_vitality_low。記録 docs/specs/plans/2026-09-22-m9-playtest.md。
