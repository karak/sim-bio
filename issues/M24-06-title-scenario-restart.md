---
id: M24-06
title: タイトルの石板の板に「初めから始める」を足す
status: todo
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-03]
evidence: []
---

# タイトルの石板の板に「初めから始める」を足す

優先度: Could

## What to build

W/F (docs/uiux/2026-10-04-title-flow.md) の「初めから始める」。今は操作画面の石板の選択と同じく、続きがあれば「続きから始める」で続きから開く (M24-03)。判定の出た石板は開くと初めから。
続きのある石板で、続きを捨てて初めから始める札を足す。捨てる前に確かめる (CNF の形)。

## Blocked by

- M24-03 の層 C

## Acceptance criteria

- [ ] 試験を先に書く: `titleStepOf` の表に「初めから」の行 (続きを捨てる確かめ → その石板の Year 0)
- [ ] E2E: 続きのある石板で「初めから始める」→ 確かめ → Year 0 で開く。断れば板に留まる
- [ ] 正本 scenarios.jsonl に行を足す (承認制)

## 作業ログ
- 2026-10-28: 起票 (審査台 decisions-20261020 d1020-m24-03-restart=ticket)。
