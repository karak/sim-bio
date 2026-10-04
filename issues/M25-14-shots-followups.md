---
id: M25-14
title: 基準画の回の接頭辞を票から取り、HBR-007 の島の名前を覆って基準画を作り直す
status: open
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-13]
evidence: []
---

# 基準画の回の接頭辞を票から取り、HBR-007 の島の名前を覆って基準画を作り直す

優先度: Should

## What to build

ユーザーの決定 (2026-10-04): 審査台の回の名前は固定の `m25-03-` ではなく票の名前を付ける。HBR-007 の島の名前は年代記の hash から決まり、年代記か simVersion が変わると基準画 2 枚 (1-島の名前・1-訪問の板) が変わるので、名前の字を覆って (mask) 比べる。

作るもの:
- `scripts/shots_update.py` (270 行付近) の `"m25-03-"` を引数 (`--round <接頭辞>`、既定は `shots-`) にする。README の `pnpm run shots:update` の説明と test_scripts も合わせる。既にある回 `.claude/localreview/m25-03-*` は触らない
- HBR-007 の画 1 で、島の名前の字を覆う。Playwright の `toHaveScreenshot` の `mask` を `tests/e2e/baseline.ts` の比べに通す (無ければ足す)。基準画 `HBR-007-1-島の名前.png` は名前そのものの要素なので覆うと意味が無い → この基準画は落とし、lens の legible の checks だけ残す。`HBR-007-1-訪問の板.png` は名前の行だけ覆って撮り直す。`TEXT_STRIPS` から 1-島の名前 を外す
- 基準画を作り直し、新しい回を `.claude/localreview/` に出す (`pnpm run shots:update`)。基準画の承認はユーザー待ち。agent は審査台の共有の items.json・index.html・verdicts.json を変えない (回のフォルダだけ出す)
- 正本 HBR-007 の画 1 の文 (島の名前を基準画で見ると読める部分) が変わるなら、書き換えの案を報告に挙げる (正本の既存の行は agent が変えない)

## Blocked by

- なし

## Acceptance criteria

- [ ] `pnpm run shots:update` の回の名前が `--round` の接頭辞で始まり、test_scripts が通る
- [ ] HBR-007 画 1 で島の名前の字が覆われ、名前が変わっても基準画の比べが通る (名前を別の値にして確かめる。例: 年代記を 1 つ変えた写しで撮る)
- [ ] `uv run scripts/acceptance.py check`・`pnpm run check`・shots を含む E2E の HBR-007 が通る
- [ ] 新しい回が `.claude/localreview/<接頭辞>-<日時>/` に出ている

## 作業ログ

- 2026-10-04: 起票 (ユーザーの決定 2 と 5)。
