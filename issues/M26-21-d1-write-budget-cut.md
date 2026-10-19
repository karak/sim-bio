---
id: M26-21
title: D1 の書きの予算を性能要件 (90%) の内に収める (shedAt・cap の削減、ユーザーの承認制)
status: todo
milestone: M26
plan: docs/specs/2026-10-18-decisions-current.md#d1-の書きの性能要件
depends_on: [M26-20]
evidence: []
---

# D1 の書きの予算の削減

優先度: Should (M26-20 の測りで最悪の日 105,679 行 = 105.7%。要件は 90% = 90,000 行)

## What to build

`worker/src/policy.ts` の BUDGETS を下げて `pnpm run check:d1-writes` を 0 で通し、`pnpm run check` に `check:d1-writes` を入れる。
数を変えるのはユーザーの承認の後。案 (M26-20 の agent の報告 2026-10-20):

| 案 | 変える数 | 減る行 | 合計 | 割合 |
|---|---|---|---|---|
| a | daily_budget の最大の shedAt 45,000 → 30,000 | 15,000 | 90,679 | 90.7% (まだ 679 超) |
| a+b | 上に加え cast_cargo の cap 5,000 → 4,000 | +6,000 (道 3,000 + Cron 3,000) | 84,679 | 84.7% |
| a+b+c | 上に加え report の cap 1,000 → 500 | +約 5,000 | 約 79,700 | 約 80% |

ほかに決めること:
- withdraw の「1 件 5 行」の根拠。SQL からは 4 行 (行・主鍵・部分索引 2 つ) で、5 行目は policy.ts の注にしか無い。check_d1_writes.py は `WITHDRAW_EXTRA = 1` で注に合わせている。1 を落とすなら合計は 1,000 減る。
- report の「5 行」は最悪の仮定 (行・by_day の索引・計数の UPDATE・部分索引 2 つからの外し)。

## Blocked by

- ユーザーの承認 (どの案にするか)

## Acceptance criteria

- [ ] BUDGETS の変更がユーザーの承認 (日付) 付きで入り、`pnpm run check:d1-writes` が 0 で終わる
- [ ] `package.json` の `check` に `check:d1-writes` が入り、`pnpm run check` が通る
- [ ] `docs/specs/2026-10-18-decisions-current.md` の「D1 の書きの予算」に変更後の数と改訂の行

## 作業ログ

- 2026-10-20: 起票 (M26-20 の測りから)。
