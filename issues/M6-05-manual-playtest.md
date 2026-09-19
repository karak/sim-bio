---
id: M6-05
title: 手動受入プレイテスト
status: done
milestone: M6
plan: docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md#35-手動受入-m6-05
depends_on: [M6-01, M6-02, M6-03, M6-04]
evidence: ["2608ae3 docs/specs/plans/2026-09-19-m6-playtest.md tests/e2e/smoke.spec.ts"]
---

# 手動受入プレイテスト

## What to build

ブラウザで沈む欠片を 3 回遊び、`docs/specs/plans/2026-09-19-m6-playtest.md` に各回の戦略・力の使い方・結果・石板の理由・悩んだ点・分かりにくかった点を記録する。少なくとも 1 回は負け、負けた理由が石板で分かること。分かりにくさ(文言・表示)は本チケットで直し、数値の再校正が要るなら M6-04 に戻す。設計書 §4.12/§6 に M6 の差分と証跡を書く。

## Blocked by

M6-01, M6-02, M6-03, M6-04

## Acceptance criteria

- [x] プレイ記録 3 回分(うち 1 回以上 dead、理由が石板の文言で説明できる)
- [x] 記録で挙がった表示・文言の問題を直し、E2E が通る
- [x] 設計書 §4.12(M6 の差分)と §6 M6 の受入表に証跡
- [x] 企画書に「星の力」と沈む欠片のジレンマの一節

## 作業ログ

- 2026-09-19: Chrome DevTools 経由で 3 回プレイ(1 回目 dead、2・3 回目 alive)。size 128 で校正が移らない問題を発見し start.size 64 に固定。スライダー同期・刻み・凡例の数字を修正(2608ae3)。M7 候補は記録の「まとめ」に。
