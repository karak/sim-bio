---
id: M24-07
title: タイトルの板 (新規ゲーム・ロード・コンフィグ・石板・港) を撮り、採点表で LLM に判じさせる (TTL-001・TTL-002)
status: todo
milestone: M24
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M24-02, M24-03]
evidence: []
---

# タイトルの板 (新規ゲーム・ロード・コンフィグ・石板・港) を撮り、採点表で LLM に判じさせる (TTL-001・TTL-002)

優先度: Should

## 経緯

M24-02・M24-03 の受入の案に、タイトルの見た目を人が 2 分ずつ見る human の行 TTL-001・TTL-002 があった。
ADR 0001 段 6 (回の human の行は TUR-001 だけ、合わせて 1 分) に当たるので正本には入れず、
2026-10-28 の審査台 (d1028-ttl-rows) でユーザーが「OBS-002 と同じ LLM の採点の行に作り直す」と決めた。
元の 2 行の案は `.claude/verify/20261028-0856-m24-03b/` と親のセッションの scratchpad (`ttl-rows-held.jsonl`) にある。

## What to build

OBS-002 (M25-07) と同じ形で、タイトルの板を画で読む auto の行を 2 つ作る。

- 撮影: `tests/e2e/shots.spec.ts` に `TTL-001`・`TTL-002` の test を足す。幅 1280 と 390 の 2 つで撮る (M24-00 の desktop と狭い画面)。
  - TTL-001 (M24-02): 素の `/` の「新規ゲーム」「ロード」「コンフィグ」の板。ロードの板は、自由モードを少し進めて枠 1 に保存した後に撮る (行が出る)。
  - TTL-002 (M24-03): 「新規ゲーム」→「石板を選ぶ」の一覧と予言、「港」の板 (空の港と閉港の 2 つ)。
  - 背景の絵は 3D なので画素の基準は持たない (OBS-002・HBR-007 の帯と同じ)。板の字は lens `legible` で確かめられる所は確かめる (HBR-007 の形)。
- 採点表: `docs/acceptance/rubrics.json` に `TTL-001/<n>`・`TTL-002/<n>` の Q を足す。見るもの:
  - 板の字が背景の絵の上でも読める
  - 「戻る」と題が上に並ぶ。空の枠は押せないと分かる (TTL-001)
  - 一覧と予言の文が背景の絵に負けずに読める。選んだ石板と始める札が分かる (TTL-002)
  - 狭い画面で板が切れない
- 正本: `docs/acceptance/scenarios.jsonl` に TTL の `{"kind":"code"}` の行と、TTL-001・TTL-002 の auto の行 (手順に `judge: "llm"`、`covered_by` に shots の test) を足す。
  M24-02・M24-03 の `tickets` を持たせる。足す前に `python3 scripts/acceptance.py lint <proposal.jsonl>` を通す。
- 判定: `pnpm run shots` → `pnpm run judge` で 3 票そろった yes を合格にする (OBS-002 と同じ)。

## Acceptance criteria

- [ ] 2 回撮って画素の差が板の中で 0 (背景の 3D は除く)
- [ ] 仕込んだ欠陥 (板の背景を透かす・題を消す・狭い画面で板をはみ出させる) を、それぞれの Q が 3 票とも no で見つける
- [ ] 今のタイトルの板は全部の Q が 3 票とも yes (no があれば票に起こす)
- [ ] `uv run scripts/acceptance.py check` と `pnpm run test:scripts` が通る
- [ ] M24-02・M24-03 の受入基準の「見た目」の項に、この行を証跡として書く

## 作業ログ
- 2026-10-28 票を起こした (d1028-ttl-rows = llm)。
