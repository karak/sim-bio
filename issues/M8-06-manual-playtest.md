---
id: M8-06
title: 手動受入プレイテスト
status: done
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-05, M8-08, M8-09, M8-10]
evidence: ["99ae814 docs/specs/plans/2026-09-20-m8-playtest.md tests/unit/scenario.warnings.test.ts tests/e2e/smoke.spec.ts"]
---

# 手動受入プレイテスト

## What to build

ビルド済みを vite preview で配信し、塔の重さを 3 回遊んで記録する。1 回は負け、理由が石板で分かること。分かりにくさは直し、設計書 §6 と企画書に反映する。

## Blocked by

M8-01, M8-02, M8-03, M8-04, M8-05

## Acceptance criteria

- [x] プレイ記録 3 回分(docs/specs/plans/2026-09-20-m8-playtest.md)
- [x] 記録で挙がった表示の問題を直し、E2E が通る(燃料の警告を蓄えと負債で判定。`tests/unit/scenario.warnings.test.ts`)
- [x] 設計書 §6 M8 の受入表に証跡、企画書に文明の一節

## 作業ログ

- 2026-09-20: 1 回目(放置)と 2〜3 回目の途中で中断。森 151 → 26 が 10 年以内、塔が 2 年で星、進み 291%、民 0 表示。
  根本は判定変数(森の総量)が塔に鈍感なこと。M8-07 のレベルデザインを経て v2 で再実施する。
- 2026-09-21: v2 で再実施。`vite preview --port 5199` + Chrome DevTools で `?scenario=tower` を 3 回(火だけ → 滅び、樹だけ → 滅び、配分 → 生き延び。噴火 11 回、鹿 19.8)。
  記録 `docs/specs/plans/2026-09-20-m8-playtest.md`。直した表示: 燃料の警告が「その年に集めた量」で判定され蓄えのある年にも出ていたので、蓄えと負債で判定するように変更。
  候補(M9 以降): 炎蜥蜴を集落周りの警告に、鐘樹の材の見込みを石板に、火口と集落の距離を島に描く。

