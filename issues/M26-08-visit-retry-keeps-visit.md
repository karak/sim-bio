---
id: M26-08
title: 訪問中に判定の板の「もう一度」を押すと visit を残して同じ訪問を開き直す
status: review
milestone: M26
plan: null
depends_on: [M26-02]
evidence:
  - "1ade935 fix(place): 訪問中の「もう一度」は visit を残して同じ訪問を開き直す (src/app/place.ts の Op retry・Effect go の keepVisit・searchFor の keepVisit、src/ui/Tablet.ts の onRetry、src/main.ts)"
  - "tests/unit/app.place.test.ts 'searchFor (M26-08): 「もう一度」は visit を残し…'・'planOp (M26-08): もう一度は visit を残す行き先…' (修正前に赤を確認)"
  - "tests/unit/ui.tablet.dom.test.ts 'M26-08: onRetry を渡すと「もう一度」はそちらを呼び…' (修正前に赤を確認)"
  - "tests/e2e/harbor.spec.ts 'M26-08: 訪問が判定まで進んだあとの「もう一度」は、URL の visit を残して…' (修正前に赤を確認: URL が ?scenario=test-civ になる)"
  - "pnpm run check 通過 (unit 1248・worker 66)。E2E harbor・confirm・verdict 25 本通過 (M26-02 の E2E を含む)"
---

# 訪問中の「もう一度」は visit を残す

優先度: Must

## What to build

M26-02 で `searchFor` が visit を落とすようにした。判定の板の「もう一度」(`src/ui/Tablet.ts:250` の `onSelect(def?.id ?? null)`) も同じ select を通るので、訪問中に押すと visit が落ち、確かめ無しに自分の石板の島 (自動の枠の続きがあればそれ) が開く。M26-02 より前は同じ訪問を開き直していた。

ユーザーの決定 (2026-10-04): **visit を残す**。訪問中の「もう一度」は同じ訪問を初めから開き直す。石板を選ぶ (一覧から) は今どおり visit を落とす。

やること:
1. 落ちる試験: 単体 (place の plan・search で、訪問中のもう一度が visit を残す) と E2E (訪問 → 判定まで → もう一度 → URL に同じ visit= があり、訪問として開く)
2. 直す: 「もう一度」を石板の選びと別の操作として区別する (例: Op に retry を足す)。石板の選びは visit を落とすまま
3. M26-02 の試験 (`tests/unit/app.place.test.ts` の searchFor、訪問から石板を選ぶ E2E) が通るまま

## Acceptance criteria

- [x] 訪問中の「もう一度」で visit が残る試験 (単体・E2E) が通る。直す前に赤
- [x] 訪問中に石板を選ぶと visit が落ちる試験 (M26-02) が通るまま
- [x] `pnpm run check` と関わる E2E が通る

## 作業ログ

- 2026-10-04: 起票 (ユーザーの決定「visit を残す」)。
- 2026-10-04: 実装 (1ade935)。判定の板の「もう一度」を Op `retry` に分け、go の effect に keepVisit を付けて searchFor が visit を残す。確かめと flush は select と同じ (訪問では確かめず、何も書かない)。石板を一覧から選ぶ select は visit を落とすまま。Tablet は onRetry を省略すると onSelect と同じ動き (既存の試験はそのまま通る)。
