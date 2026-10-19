---
id: M26-20
title: D1 の書きの日次予算を性能要件として切り出し、最悪の行数を policy.ts と表の定義から数える適用度関数 (python) で測る
status: done
milestone: M26
plan: docs/design/2026-09-26-cloudflare-architecture.md#6-運用
depends_on: [M27-06]
evidence:
  - fb1558d 性能要件の節 (X = 90)
  - 22d1cad scripts/check_d1_writes.py, scripts/test_check_d1_writes.py (10 tests, RED→GREEN は .claude/verify/20261020-1200-m26-20/red.txt・green.txt)
  - ac2b6a5 M26-21 起票、check から外す
---

# D1 の書きの予算の適用度関数

優先度: Should (無料枠を超えると D1 のクエリが失敗する。今は注の手計算だけ)

## What to build

M27-06 の候補出しで、`worker/src/policy.ts` の注の最悪 88,000 行/日に入っていない書きが 2 つ見つかった: 取り下げの連鎖で消える通報の行 (1 行につき 2)、毎日 00:10 UTC の掃除 (`worker/src/ledger.ts`、前日の積荷 5,000 × 3・通報 1,000 × 2・30 日前の隠した年代記 ~333 × 2・予算の行 ~11・集計 2 ≒ 17,700 行)。最悪の日は約 105,700 行で無料枠 100,000 行/日を超えうる (閉港 `d1_write_limit` で壊れはしないが、§6.1 の「自分で先に止まる」は守れない)。ユーザーの判定 (2026-10-18): コメントに書くことではなく、性能要件として切り出し、測る適用度関数を python で書く。

やること:
1. 性能要件を文に: 「全部の道が上限まで使われ、Cron の掃除が走る最悪の日でも、D1 の書きは無料枠 100,000 行/日の X% 以内」(X はユーザーと決める。候補 90)。置き場は `docs/specs/2026-10-18-decisions-current.md` (M27-06 で起こす文書) の性能要件の節。
2. 適用度関数 `scripts/check_d1_writes.py`: `worker/src/policy.ts` の `BUDGETS` (cap・shedAt) と `worker/migrations/*.sql` (主鍵・索引・UNIQUE の数) と Cron の消す数から、道ごとの 1 件あたりの行と最悪の日の合計を計算して出す。要件を超えたら終了コード 1。手計算の表 (M27-06 の作業ログ 2026-10-17) と同じ数が出ることを試験で検める。
3. `pnpm run check` に入れる (`check:d1-writes`)。
4. 超えているなら、予算の段 (shedAt) か cap を下げる案を出す (変えるのはユーザーの承認の後)。

## Blocked by

- M27-06 (新文書の置き場)

## Acceptance criteria

- [x] 性能要件の文が文書にあり、数 (X%) がユーザーの決定で決まっている
- [x] `scripts/check_d1_writes.py` が policy.ts・migrations から最悪の行数を計算し、手計算 (88,000 + 取り下げの連鎖 + Cron ≒ 105,700) と一致する試験が `scripts/test_check_d1_writes.py` にある (直す前に赤)
- [x] `pnpm run check` に入り、通る (超えているなら、その理由と次の票) → 超えている (105,679 行、105.7%)。理由は Cron の掃除 17,679 行。次の票 M26-21。入れるのは M26-21 の後

## 作業ログ

- 2026-10-18: 起票 (M27-06 の審査台のメモから)。
- 2026-10-20: 実装・取り込み。最悪の日 105,679 行 (道 88,000 + Cron 17,679)。要件 90,000 を超えるので check:d1-writes は check に入れず、削減案を M26-21 に。withdraw の 5 行目の根拠は不明 (M26-21 に記録)。perf 0.17 s。
