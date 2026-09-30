---
id: M25-08
title: TUR-002 を retired にし、TUR-001 を手触りの 1 分にする
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-07]
evidence: []
---

# TUR-002 を retired にし、TUR-001 を手触りの 1 分にする

優先度: Must

## What to build

ADR 0001 の段 6。2026-10-01 のユーザーの判断 6 (手触りの 1 分は人に残す)。

作るもの:
- TUR-002 を `status: retired` にし、`retired.replaced_by` に SEL-003・CRG-005・CNF-002・DEV-001 を書く (行は消さない)
- TUR-001 を書き直す: 残すのは「判定の板を取っ手でドラッグすると付いてきて気持ちよい」の 1 手順 (`judge: "human"`、1 分)。3D の絵は M25-07 の行へ、読みやすさは HBR-006 へ移したことを judge に書く
- 受入の画面の「人の 1 周」の background を直す (docs/acceptance/scenarios.jsonl の TUR の行)
- docs/operations/acceptance.md の「人が判じるのは」の段を直す

TUR-002 の retire は M25-03 の後にできる。TUR-001 の書き直しは M25-07 の後 (ADR の「段 5 と段 6 は順を逆にしても値が出る」)。

## Blocked by

- M25-03 (TUR-002)
- M25-07 (TUR-001)

## Acceptance criteria

- [ ] `uv run scripts/acceptance.py check` が通り、round の human の行が TUR-001 (1 分) だけになる
- [ ] `pnpm run acceptance:page` の items.json に TUR-001 だけが項目として出て、delegated に移した行が並ぶ
- [ ] results.json の旧い判定 (r2-cargo など) が TUR-002 の retired の行の下で読める

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 6)
