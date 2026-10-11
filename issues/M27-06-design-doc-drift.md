---
id: M27-06
title: 設計書とコードのずれ (R3): 09-19 の決定事項の表に改訂を、09-26 §6.1 の D1 の数を policy.ts に合わせる
status: todo
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: []
evidence: []
---

# 設計書とコードのずれ (R3)

優先度: Could (小。全部が既存の文の書き換えなので承認制。候補を file:line・原文・新文で挙げてから直す)

## What to build

レビュー 2026-10-10 の R3。コードは変えず、文書を今のコードに合わせる。日付つきの設計書なので、書いた時点の記述は残し、改訂の列か注で今を指す (M27-05 の後始末 64f9b28 と同じ流儀)。

1. `docs/specs/2026-09-19-ecosystem-sim-design.md` の「決定事項」の表 (29 行目あたり) に「改訂」の列を足し、#12「保存は JSON ファイルの書き出し/読み込みのみ」→ 今は IndexedDB (`src/persist/islandStore.ts`) とファイル、#17「E2E はスモーク 1 本」→ 今は `tests/e2e/*.spec.ts` 21 本、を指す。ほかの行も今と違うものがあれば候補に挙げる。
2. `docs/design/2026-09-26-cloudflare-architecture.md:340` の「D1 の書きは最悪でも約 43%」を `worker/src/policy.ts:12` の注 (45,000 + 8,000 + 15,000 + 5,000 + 10,000 + 5,000 = 88,000 行 = 88%) に合わせる。どちらが正しいかは policy.ts の上限と `daily_budget` の数え方から計算して決める (文書の 2,000・5,000・1,000 と policy.ts の上限が違うなら、違う理由も書く)。
3. 版 3 つ (`SaveData.version`・`SIM_VERSION`・`RUNNER_STATE_VERSION`) の関係は ADR 0002 の決定 5 に書いた (済み)。設計書から ADR 0002 を指す 1 行を足すだけ。

## 受入基準

- [ ] 書き換え候補を file:line・原文・新文で報告し、ユーザーの承認を得てから直す。コミットメッセージに「ユーザーの承認」と日付
- [ ] 09-26 §6.1 の数は計算の根拠 (policy.ts の上限 × 1 件あたりの行) を票の作業ログに書く
- [ ] `pnpm run check` が通る (docs は lint の対象外なので、README の柵 `scripts/check_readme.py` だけ)

## 作業ログ

- 2026-10-11 22:50 起票 (M27 の後始末の残り。レビュー R3。ADR 0002 の決定 5 で 3 つ目は済み)。
