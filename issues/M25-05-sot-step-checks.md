---
id: M25-05
title: 正本の手順ごとの checks と judge を足し、acceptance.py check で縛る
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-01]
evidence:
  - "AC1 札の付いた手順から checks と judge を消すと落ちる: scripts/test_acceptance.py StepMarkTest.test_a_tagged_step_without_checks_or_judge_fails_the_check (+ test_empty_marks_count_as_none, test_auto_rows_are_held_to_it_too)"
  - "AC2 知らない lens で落ちる: StepMarkTest.test_an_unknown_lens_fails、lens の名前は tests/e2e/lens.ts の LENSES から読む (test_lens_names_come_from_the_lens_file、RepoSotTest.test_the_lens_names_are_read_from_the_lens_file)"
  - "AC3 今の正本の札の付いた手順に checks か judge が全部ある (human の行も auto の HBR-006 も): RepoSotTest.test_every_tagged_step_of_the_repo_sot_has_checks_or_a_judge、docs/acceptance/scenarios.jsonl の TUR-001・TUR-002・HBR-006・CRG-005・CNF-002・SEL-003 の 20 手順"
  - "AC4 pnpm run test:scripts (91 件 OK) と uv run scripts/acceptance.py check (ok: 43 scenarios)"
  - "page の items.json: PageTest.test_the_page_lists_each_items_checks_and_judge_by_step・test_an_auto_rows_marks_show_under_delegated"
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

- [x] 札の付いた手順から checks と judge を消すと check が落ちる (test_acceptance.py)
- [x] 知らない lens の名前で落ちる
- [x] 今の正本の human の行の札の付いた手順に、checks か judge が全部ある
- [x] `pnpm run test:scripts` と `uv run scripts/acceptance.py check` が通る

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 4)
- 2026-10-01: 実装 (feat/m25-05)。steps の 3 つ目に {checks, judge} を持てるようにし、check が札 (【見た目】【読みやすさ】【手触り】) の付いた active の手順を縛る。lens の名前は lens.ts の LENSES (legible) と照らす。page は items の marks と delegated の marks に出す。正本に 20 手順の marks を足した (読みやすさは checks の legible、見た目・手触りは judge の human。llm は M25-06 で pnpm run judge ができてから付け替える)。レビューは codex の認証切れのため別モデルの読むだけのレビュアー。指摘のうち LENSES を行頭に固定・空の judge を不正として扱う・delegated の marks の試験を反映。target は空でないことだけ見る (shotsOf の名前との照合は M25-06 の課題)。
- 2026-10-01: 検証。test:scripts 91 件・typecheck・lint・lint:py・vitest 1197 件・worker 66 件は通った。E2E は shots.spec.ts の 4 件 (ACCEPTANCE_DIR を scratchpad に向けた) が通った。全件 (90 件) は、ほかの agent の負荷 (load average 20〜30) で 30 分に 13 件しか進まず、途中で止めた (13 件までは赤なし)。全件は親で回す。
