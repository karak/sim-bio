---
id: M8-06
title: 手動受入プレイテスト
status: blocked
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-05, M8-08, M8-09, M8-10]
evidence: []
---

# 手動受入プレイテスト

## What to build

ビルド済みを vite preview で配信し、塔の重さを 3 回遊んで記録する。1 回は負け、理由が石板で分かること。分かりにくさは直し、設計書 §6 と企画書に反映する。

## Blocked by

M8-01, M8-02, M8-03, M8-04, M8-05

## Acceptance criteria

- [ ] プレイ記録 3 回分(docs/specs/plans/2026-09-19-m8-playtest.md)
- [ ] 記録で挙がった表示の問題を直し、E2E が通る
- [ ] 設計書 §6 M8 の受入表に証跡、企画書に文明の一節

## 作業ログ

- 2026-09-20: 1 回目(放置)と 2〜3 回目の途中で中断。森 151 → 26 が 10 年以内、塔が 2 年で星、進み 291%、民 0 表示。
  根本は判定変数(森の総量)が塔に鈍感なこと。M8-07 のレベルデザインを経て v2 で再実施する。
