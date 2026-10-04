---
id: M25-16
title: SEL-003 の 2〜4 と CNF-002 の 2〜3 を judge: "llm" にする
status: open
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-05, M25-06, M25-12]
evidence: []
---

# SEL-003 の 2〜4 と CNF-002 の 2〜3 を judge: "llm" にする

優先度: Should

## What to build

ユーザーの決定 (2026-10-02 の一覧の 8、2026-10-04 に実行の指示): 【見た目】の手順のうち、lens と基準画では言い切れない「らしさ」を LLM に判じさせる。TUR-001 の 3D の手順は M25-08 で OBS-002 に移っているので対象外。

作るもの:
- 正本 SEL-003 の手順 2〜4 と CNF-002 の手順 2〜3 の 3 つ目の要素に `{"judge": "llm"}` を足す (checks があれば残す。**この票で名指しされた手順だけ**。ほかの行・文は変えない)
- `docs/acceptance/rubrics.json` に各手順の採点表を足す (SEL-003/2 は M25-06 の試しの分がある。見直してよい)。問いは画で判じられる性質に限り、yes/no で答えられる形に
- `scripts/judge.py` が基準画のある手順をどう扱うかを ADR 0001 の段 5 に合わせる (観察画面でない手順は fail/undecided だけ results.json に書く。pass は書かない)
- `pnpm run judge` を 1 回だけ回し、結果を作業ログに (費用も)

## Blocked by

- なし

## Acceptance criteria

- [ ] `uv run scripts/acceptance.py check` が通り、5 手順が judge: "llm" を持つ
- [ ] rubrics.json に 5 手順の採点表があり、test_judge が通る
- [ ] `pnpm run judge` が 5 手順を判じ、結果 (票と費用) が作業ログにある
- [ ] `pnpm run check` が通る

## 作業ログ

- 2026-10-04: 起票。
