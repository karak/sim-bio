---
id: M25-06
title: pnpm run judge: 手元の claude -p で採点表に当て、3 票の多数決を results.json に書く
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-05]
evidence: []
---

# pnpm run judge: 手元の claude -p で採点表に当て、3 票の多数決を results.json に書く

優先度: Should

## What to build

ADR 0001 の段 5。2026-10-01 のユーザーの判断 2 (手元の `claude -p` で回す。API の鍵は持たない)。
試した呼び方と数は ADR の付録 B の 4 (1 回 10〜14 秒、換算 0.015〜0.033 USD、5 問 × 2 枚 × 3 回で答えがそろった)。元は tools/acceptance-probe/judge.sh (M25-01 で写す)。

作るもの:
- `scripts/judge.py`: 正本の `judge: "llm"` の手順ごとに、画と採点表 (rubric) と JSON schema で `claude -p` を 3 回呼ぶ。`--system-prompt`・`--setting-sources ""`・`--strict-mcp-config`・`--disable-slash-commands`・`--tools Read` で手元の CLAUDE.md・MCP・スキルを読ませない。標準入力は閉じる。答えの言語を問いに書く
- 問いごとの多数決。3 票そろわない問いと no の問いだけを人に出す
- results.json に `judge: "llm"` と、票・根拠・CLI の版・モデル・換算額・時刻を書く
- 画素の基準を持つ画は LLM の yes だけでは合格にしない (ADR の「LLM の判定」)
- `pnpm run judge` を package.json に足す。CI では回さない

## Blocked by

- M25-03 (承認済みの基準画を並べて渡す)
- M25-05 (judge の欄)

## Acceptance criteria

- [ ] 仕込んだ欠陥 3 つ (ピンを海の色にする・確かめの文を切る・観察画面の木を消す) を、3 票とも no で見つける (作業ログに票を写す)
- [ ] 承認済みの画は 3 票とも yes
- [ ] 1 回の受入 (画 16 枚 × 3 票) の時間と換算額を作業ログに書く (見積もりは直列 10 分・4 並列 2.5 分・約 1 USD)
- [ ] results.json の書き方が acceptance.py の check_results を通る (test_acceptance.py)
- [ ] 鍵の環境変数が無くても回る

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 5)
