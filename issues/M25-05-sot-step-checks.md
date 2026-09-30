---
id: M25-05
title: 正本の手順ごとの checks と judge を足し、acceptance.py check で縛る
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-01]
evidence: []
---

# 正本の手順ごとの checks と judge を足し、acceptance.py check で縛る

優先度: Should

## What to build

ADR 0001 の段 4。正本の【見た目】【読みやすさ】【手触り】の札の付いた手順ごとに、何が判じるかを持たせる。

作るもの:
- scenarios.jsonl の steps に `checks: [{lens, target}]` か `judge: "llm" | "human"` を持てるようにする (scripts/acceptance.py の鍵の表と `_check_shape`)
- check は、札の付いた手順に checks も judge も無ければ落とす。lens の名前は tests/e2e/lens.ts の一覧と照らす
- page (items.json) は手順ごとの checks と judge を出し、受入の画面が「機械が見た」「LLM が見た」「人が見る」を並べられるようにする
- scripts/test_acceptance.py に試験を足す

## Blocked by

- M25-01 (lens の名前)

## Acceptance criteria

- [ ] 札の付いた手順から checks と judge を消すと check が落ちる (test_acceptance.py)
- [ ] 知らない lens の名前で落ちる
- [ ] 今の正本の human の行の札の付いた手順に、checks か judge が全部ある
- [ ] `pnpm run test:scripts` と `uv run scripts/acceptance.py check` が通る

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 4)
