---
id: M26-02
title: 訪問中に石板を選ぶと visit= が URL に残り、石板がその訪問として開く
status: review
milestone: M26
plan: null
depends_on: []
evidence:
  - "ae43b31 fix(app): searchFor が visit を落とす (src/app/place.ts)"
  - "tests/unit/app.place.test.ts 'searchFor (M26-02): 訪問中に石板を選ぶと visit を落とし…' (修正前に赤を確認)"
  - "188f8dd tests/e2e/confirm.spec.ts 'M26-02: 訪問中に石板を選ぶと、確かめは出ず…' (修正前に赤を確認)"
  - "pnpm run check 通過 (unit 1226・worker 66)。E2E confirm・persist・harbor・scenarioSave 36 本通過 (scenarioSave:80 は通し実行で 1 回落ち、単独で通過)"
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

- [x] `tests/unit/app.place.test.ts` の todo が本物の試験になり通る
- [x] E2E で、訪問中に石板を選ぶと URL から `visit=` が消え、石板の島が開く
- [x] `pnpm run check` と関係する E2E (confirm・persist・harbor) が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 4)。
- 2026-10-04: 実装。`searchFor` が visit を落とす。訪問から石板を選ぶのは M21-04 の「離れる」確かめを経ない (訪問は finished でなく askOf の leave が null。flush は訪問では何も書かない)。E2E はそれを確かめ、ダイアログが出ないことも見る。未決: 訪問中に判定の板の「もう一度」を押すと select 経由で visit が落ち、自分の石板の島 (自動の枠の続きがあればそれ) が開く。以前は同じ訪問を開き直した。扱いはユーザーの判断待ち。
