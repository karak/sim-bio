---
id: M26-02
title: 訪問中に石板を選ぶと visit= が URL に残り、石板がその訪問として開く
status: open
milestone: M26
plan: null
depends_on: []
evidence: []
---

# 訪問中に石板を選ぶと visit= が URL に残る

優先度: Must

## What to build

確かめ済みの欠陥 (2026-09-29)。別の見守り手の島を `visit=` で開いている間に石板 (シナリオ) を選ぶと、`visit=` が URL に残り、石板がその島の訪問として開き直される。自分の続きが戻らず、年表も読めない。

- `src/app/place.ts` の `searchFor(search, scenarioId)` が visit を落とさない
- 正しい振る舞いは `tests/unit/app.place.test.ts:212` の `it.todo('searchFor: 訪問中に石板を選ぶと visit を落とす …')` に書いてある

やること:
1. todo を本物の試験にして落ちるのを見る (M21-07 の表の試験に行を足す形でもよい)
2. `searchFor` で visit を落として通す。訪問から石板を選ぶ E2E が無ければ 1 本足す (訪問 → 石板を選ぶ → URL に visit が無く、石板の島が自分のものとして開く)
3. 「訪問を離れる」確かめ (M21-04) との関係を作業ログに書く (石板選びは離れる操作なので確かめを経る、など)

## Blocked by

- なし

## Acceptance criteria

- [ ] `tests/unit/app.place.test.ts` の todo が本物の試験になり通る
- [ ] E2E で、訪問中に石板を選ぶと URL から `visit=` が消え、石板の島が開く
- [ ] `pnpm run check` と関係する E2E (confirm・persist・harbor) が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 4)。
