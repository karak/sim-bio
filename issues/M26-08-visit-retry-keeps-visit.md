---
id: M26-08
title: 訪問中に判定の板の「もう一度」を押すと visit を残して同じ訪問を開き直す
status: open
milestone: M26
plan: null
depends_on: [M26-02]
evidence: []
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

- [ ] 訪問中の「もう一度」で visit が残る試験 (単体・E2E) が通る。直す前に赤
- [ ] 訪問中に石板を選ぶと visit が落ちる試験 (M26-02) が通るまま
- [ ] `pnpm run check` と関わる E2E が通る

## 作業ログ

- 2026-10-04: 起票 (ユーザーの決定「visit を残す」)。
