---
id: M27-06
title: 設計書とコードのずれ (R3): 09-19 の決定事項の表に改訂を、09-26 §6.1 の D1 の数を policy.ts に合わせる
status: in_progress
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: []
evidence:
  - "scripts/test_check_docs.py RepoTest.test_todays_docs_pass (ポインタ・版の段落・今の決定事項の印。直す前に赤)"
  - "scripts/test_check_docs.py RepoTest.test_docs_before_m27_06_fail (46fc759 の docs が落ちる)"
  - "scripts/test_check_docs.py PointerTest・VersionParagraphTest・FactTest・MarkTest・SlugTest"
  - "pnpm run check:docs (scripts/check_docs.py)"
  - "docs/specs/2026-10-18-decisions-current.md"
---

# 設計書とコードのずれ (R3)

優先度: Could (小。全部が既存の文の書き換えなので承認制。候補を file:line・原文・新文で挙げてから直す)

## What to build

レビュー 2026-10-10 の R3。コードは変えず、文書を今のコードに合わせる。日付つきの設計書なので、書いた時点の記述は残し、改訂の列か注で今を指す (M27-05 の後始末 64f9b28 と同じ流儀)。

1. `docs/specs/2026-09-19-ecosystem-sim-design.md` の「決定事項」の表 (29 行目あたり) に「改訂」の列を足し、#12「保存は JSON ファイルの書き出し/読み込みのみ」→ 今は IndexedDB (`src/persist/islandStore.ts`) とファイル、#17「E2E はスモーク 1 本」→ 今は `tests/e2e/*.spec.ts` 21 本、を指す。ほかの行も今と違うものがあれば候補に挙げる。
2. `docs/design/2026-09-26-cloudflare-architecture.md:340` の「D1 の書きは最悪でも約 43%」を `worker/src/policy.ts:12` の注 (45,000 + 8,000 + 15,000 + 5,000 + 10,000 + 5,000 = 88,000 行 = 88%) に合わせる。どちらが正しいかは policy.ts の上限と `daily_budget` の数え方から計算して決める (文書の 2,000・5,000・1,000 と policy.ts の上限が違うなら、違う理由も書く)。
3. 版 3 つ (`SaveData.version`・`SIM_VERSION`・`RUNNER_STATE_VERSION`) の関係は ADR 0002 の決定 5 に書いた (済み)。設計書から ADR 0002 を指す 1 行を足すだけ。

## 受入基準

- [x] 書き換え候補を file:line・原文・新文で報告し、ユーザーの承認を得てから直す。コミットメッセージに「ユーザーの承認」と日付 (審査台 decisions-20261017、2026-10-18。表の列は却下 → superseded 方式に)
- [x] 09-26 §6.1 の数は計算の根拠 (policy.ts の上限 × 1 件あたりの行) を票の作業ログに書く (2026-10-17 の行)
- [x] (2026-10-18 に変更) 09-19・09-26 の原文は触らず、`superseded by <文書#節>` のポインタを付け、今の決定事項と D1 の書きの数は新しい文書 `docs/specs/2026-10-18-decisions-current.md` に起こす
- [x] (2026-10-18 に追加) ポインタと新文書の記述を機械で検める試験 (`scripts/check_docs.py` と `scripts/test_check_docs.py`) があり、直す前に赤。`pnpm run check` に `check:docs` として入る
- [x] 09-26 の制約の表の後に、版 3 つの関係を ADR 0002 の決定 5 で指す段落を足す
- [ ] `pnpm run check` が通る

## 作業ログ

- 2026-10-11 22:50 起票 (M27 の後始末の残り。レビュー R3。ADR 0002 の決定 5 で 3 つ目は済み)。
- 2026-10-17: 候補出し (読むだけの opus)。承認待ち。審査台の板 `.claude/localreview/decisions-20261017.html` (群 1〜3 が書き換え 16 件、群 4 が決めること 3 件)。
  - 09-19 の表: ずれている行は #4 (分解者)・#5 (層)・#7 (Command 9 種)・#8 (Workers)・#10 (年代記の Worker)・#11 (観察画面)・#12 (IndexedDB)・#14 (glTF は観察画面)・#17 (E2E 21 本、`ls tests/e2e/*.spec.ts | wc -l` で確認)・#19 (HTTP sink)。ずれの無い 9 行は「—」。
  - §6.1 の計算 (親が policy.ts・ledger.ts で検めた): `admit` は通した 1 件につき `daily_budget` に 1 行、日の合計は最大の段 45,000 で止まる。道の書きは出港 2,000 × 4 行 + 積荷 5,000 × 3 + 通報 1,000 × 5 + 確認 5,000 × 1 + 結末 5,000 × 1 + 取り下げ 1,000 × 5 = 43,000。合計 88,000 行 = 無料枠 100,000 行/日の 88%。policy.ts の注が正しく、文書の 43% は実装前 (67bd7d0) の見積もり。上限 2,000・5,000・1,000 は policy.ts と同じで変わっていない。ずれの原因は数え方 (文書は 3 道の書きだけ、実装は全部の道を数え、数えそのものも 1 行書く)。道の書きの和 43,000 が「約 4.3 万」と一致するのは偶然か数えの行の落ちか、式が残っていないので不明。
  - 注の外: 取り下げの連鎖で消える通報の行、毎日 00:10 UTC の掃除 (`ledger.ts`、最悪約 17,700 行) は 88,000 に入っていない。最悪の日は約 105,700 で枠を超えうる (閉港 `d1_write_limit` で壊れはしない)。扱いは板の群 4 で決める。
  - ADR 0002 の決定 5 を指す 1 行は 09-26 (3 つの版をすべて扱う唯一の文書) の制約の表の後が推し。
- 2026-10-18: 審査台の判定 (decisions-20261017)。表の「改訂」の列は却下 (1-1 のメモ「元の設計書に superseded by <参照先文書と節へのポインタ> をつけて別ファイルを起こす。必ず RED を持つ自動テストで担保」、残り 10 行は保留で同じ)。§6.1・§3.2 の数は承認 (メモ「内容は良いが、文書管理は superseded 方式にして」)。policy.ts の注は却下 (メモ「これはコメントに書くべきことか？ 性能要件として切り出したうえで、対応する測定用の適用度関数を python などで書いてほしい」→ 別の票 M26-20)。ADR 0002 の 1 行は 09-26 の制約の表の後 (C8 と C6 の注の間)。Cron の掃除の分は文書に書くだけ (予算は変えない)。表の外の古い記述 (09-19 の 4 行目・§4.2:191・§7 の 4 項目) は次の回で候補を出す。
- 2026-10-18: superseded 方式で実装 (worktree の agent)。先に `scripts/check_docs.py`・`scripts/test_check_docs.py` を書いて赤を確かめた (`RepoTest.test_todays_docs_pass` が落ち、`pnpm run check:docs` は 4 件の違反で終了コード 1: 09-26 に `#d1-の書きの予算` へのポインタが 0 個 (要るのは 2 個)、09-19 に `#決定事項` へのポインタが 0 個、09-26:60 の C8 と「C6 の注」の間に版 3 つと ADR 0002 の段落が無い、`docs/specs/2026-10-18-decisions-current.md` が無い)。その後に新文書 (決定事項の表 20 行 + 列「今 (2026-10-18)」「根拠」、D1 の書きの予算、改訂) を起こし、09-19 の冒頭の箇条・09-26 の §3.2 の表の後・§6.1 の箇条の下にポインタ、09-26 の C8 と「C6 の注」の間に版 3 つの段落を足した (既存の文は変えず、行を足しただけ)。新文書の数は印 `<!-- check: 名=値 -->` で、check:docs が今のコード (E2E 21 本・Command 9 種・decomposer・SLOTS 4・AUTOSAVE_TICKS 90・BUDGETS の cap と shedAt の最大 45,000・policy.ts の注の 88,000) と突き合わせる。`pnpm run check` に `check:docs` を入れた。
