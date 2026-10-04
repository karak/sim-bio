---
id: M19-12
title: 課金にしない構成検査と運用スクリプト
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-02]
evidence:
  - "bb4e700 feat(cloudflare): 課金にしない構成検査 check_free_tier.py と運用スクリプト mod.py(CI と配備の直前に検査、README に決まり)"
  - "7ccef19 refactor(scripts): レビュー対応(表に無い key は unknown_key、JSONC の末尾のカンマは閉じ括弧で外す、dist の検査を check_dist へ分ける、wrangler が失敗の終了コードを返したら行があっても失敗)"
  - "9ccfbb6 fix(scripts): mod.py の年代記の id を港の契約 parseChronicleId と同じ形 (16 進 64 文字の小文字だけ) にする"
  - "tests: scripts/test_check_free_tier.py, scripts/test_mod.py"
---

# 課金にしない構成検査と運用スクリプト

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §3.3・Q4。`scripts/check_free_tier.py` を CI の check に入れる(使わない binding・有料の usage model・.assetsignore の欠け・20,000 ファイル/25 MiB 超えを落とす)。`scripts/mod.py`(隠す・戻す・消す・予算を見る、中身は `wrangler d1 execute --remote`)。このゲーム専用の Cloudflare アカウントで、支払い方法を登録しない運用を README に書く。

## Blocked by

M19-02

## Acceptance criteria

- [x] check_free_tier.py が違反の各例で落ち、今の構成で通る(単体テスト)
  - `scripts/check_free_tier.py`。bb4e700・7ccef19
  - `scripts/test_check_free_tier.py`(27 件、unittest)
    - 今の構成で通る: 「test_current_wrangler_jsonc_passes」「test_current_assetsignore_passes」。build の後の本物の dist でも `pnpm run check:free-tier` が「違反なし」(配るのは 63 ファイルのうち 18、ほかは `.assetsignore` で外れる)
    - binding: 「test_bindings_outside_the_design_fail」(r2_buckets・queues・analytics_engine_datasets・browser・ai・vectorize・kv_namespaces・durable_objects・hyperdrive・logpush がそれぞれ 1 件で落ちる)、「test_r2_says_it_would_bill」、「test_unknown_key_fails_until_it_is_added_to_the_table」(表に無い key は `unknown_key`)、「test_d1_ratelimits_and_cron_are_allowed_for_m19_08」、「test_environments_are_checked_like_the_top_level」(`env.<名前>.` の下も同じ表)
    - 有料の設定: 「test_usage_model_fails_whatever_its_value」(unbound・bundled・standard)、「test_limits_override_fails」
    - .assetsignore: 「test_missing_blend_fails」「test_missing_concept_fails」「test_commented_out_negated_or_narrowed_lines_fail」(`# *.blend`・`!deer.blend`・`/*.blend`)、「test_concept_without_its_subfolders_fails」、「test_fails_when_dist_has_no_assetsignore」
    - 数と大きさ: 「test_file_count_at_the_limit_passes_and_one_more_fails」(20,000 は通り 20,001 で落ちる)、「test_file_size_at_the_limit_passes_and_one_byte_more_fails」(25 MiB ちょうどは通り 1 バイト多いと落ちる)、「test_ignored_files_are_neither_counted_nor_sized」、「test_passes_when_the_big_file_is_ignored」「test_fails_on_a_big_file_that_is_deployed」(疎なファイルで 25 MiB + 1)、「test_skips_the_files_wrangler_never_uploads」、「test_fails_when_dist_is_not_built」
    - 読み方: 「test_drops_comments_and_trailing_commas_but_keeps_slashes_in_strings」ほか JSONC 2 件、「test_matches_like_gitignore」ほか .gitignore の書式 3 件(解釈できない書式 `[...]`・`\` は数え違えずに例外)
  - テストが欠陥を捕まえることは、scratchpad の変異(閾値の `>` → `>=`、無視の判定を外す、否定を無視する、anchored の扱い、`*` を `**` 扱い、表から d1 を外す、`env` を見ない、`all` → `any` など 12 通り)で確かめた。全部が落ちる(r2 を理由の表から外す変異は、許す表に無いので同じく落ちる。落ちる理由の文だけが変わるので「test_r2_says_it_would_bill」を足した)
  - 手元の赤の証跡: 本物の dist の写しに r2_buckets・limits を足し、`.assetsignore` から `*.blend` を外すと、`NG [binding] r2_buckets`・`NG [limits] limits`・`NG [assetsignore] *.blend` の 3 件で終了コード 1
  - CI: `.github/workflows/ci.yml` は `pnpm run check`(scripts の単体テストと ruff を含む)と、E2E のあとに `pnpm run check:free-tier`。`.github/workflows/deploy.yml` は `build:cloudflare` のあと、`wrangler deploy` の直前に `pnpm run check:free-tier`。uv は `astral-sh/setup-uv` v10.2.0(SHA で固定)。push はしていないので、CI の上ではまだ動かしていない
- [x] mod.py の各操作をローカル D1 で確かめる
  - `scripts/mod.py`。bb4e700・7ccef19・9ccfbb6
  - `scripts/test_mod.py`(14 件): 「LocalD1Test」が一時の wrangler 設定(D1 の binding `HARBOR`)と `--persist-to` の一時 dir で、`wrangler d1 execute --local` に仮の表(`PROVISIONAL_SCHEMA`)を作り、`mod.main` を通す
    - 「test_hide_is_idempotent_and_restore_clears_the_reports」: 隠すと `hidden_at` が入り、もう一度隠しても時刻は変わらない。戻すと `hidden_at = NULL`・`report_count = 0`、ほかの年代記は変わらない
    - 「test_delete_removes_only_that_chronicle」、「test_unknown_id_fails_for_every_operation」(隠す・戻す・消すで「見つからない」、終了コード 1)
    - 「test_budget_shows_the_newest_days_against_the_caps」(新しい日から、上限との比)、「test_budget_without_rows_says_so」
    - 境界: 「test_rejects_anything_that_could_break_out_of_the_sql_literal」(id は 16 進 64 文字だけ)、「test_accepts_the_same_form_as_the_harbor_contract」(M19-07 の `parseChronicleId` と同じく小文字だけ。9ccfbb6)、「test_target_must_be_chosen_explicitly」(`--remote`・`--local` のどちらかが要る)、「test_delete_without_yes_does_not_touch_the_database」、「test_persist_to_is_only_for_local」、「test_wrangler_error_is_reported_and_fails」、「test_nonzero_exit_fails_even_if_stdout_looks_like_rows」
    - wrangler の引数: 「test_remote_targets_the_deployed_database_only」「test_local_passes_config_and_persist_dir」
  - 変異 10 通り(COALESCE を外す、report_count を戻さない、id の検査を部分一致に、`--local` 固定、`--yes` を見ない、見つからないを見ない、並びを昇順に、WHERE を外す など)は全部が落ちる
  - **`--remote` は動かしていない**(Cloudflare のリモートに触れるのはユーザーの許可が要る)。M19-08 の D1 ができて、配備したあとに確かめる
  - 表と列は仮。M19-08 で合わせる約束を `scripts/mod.py` の docstring と `issues/M19-08-harbor-worker.md` の作業ログに書いた
- [x] README に配備・運用・「課金にしない」の決まりを書く
  - `README.md` の「Cloudflare へ配る」に「課金にしない」(専用アカウント、支払い方法を登録しない、構成検査が CI と配備で落とすもの、binding を足すときの手順)と「運用(`scripts/mod.py`)」を足した。配備の手順は M19-02 のまま。「動かし方」に uv と `pnpm run test:scripts`、ディレクトリの表に `scripts/`。bb4e700
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - `pnpm run check`(7ccef19 で 1 回、背景で): typecheck(root・worker の tsc と `wrangler types --check`)、eslint、`lint:py`(ruff check・format --check)、vitest 91 ファイル 830 件、worker 20 件、`test:scripts` 41 件がすべて通り、終了コード 0。9ccfbb6 の変更は mod.py の id の検査だけなので、`lint:py` と `test:scripts`(41 件)だけを回し直して通った
  - E2E: CI と同じ順で `pnpm run test:e2e:cloudflare`(3 件すべて通る、wrangler dev の上)→ `pnpm run check:free-tier`(その build の dist で「違反なし」)。9ccfbb6 の上
  - `pnpm exec playwright test`(本体の E2E)は回していない。この変更は src・worker・画面に触れない
  - evidence は frontmatter の 3 つの commit とテストファイル 2 つ

## 作業ログ

- 2026-09-26 実装(agent、worktree-agent-a311ce2ca77270dff。基点は feat/m19 の fe69dbf)
  - **docs で確かめたこと**(Cloudflare docs の MCP と、手元の wrangler 4.141.0)
    - 静的アセットの上限は Workers Free で 1 版 20,000 ファイル・1 ファイル 25 MiB(Paid は 100,000。wrangler 4.34.0 以上): https://developers.cloudflare.com/workers/platform/limits/#static-assets ・ https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/
    - `limits`(`cpu_ms`・`subrequests`)は Standard の usage model だけ。上げられるのは Paid(無料は CPU 10 ms・subrequest 50): https://developers.cloudflare.com/workers/wrangler/configuration/#limits ・ https://developers.cloudflare.com/workers/platform/limits/
    - usage model: Bundled・Unbound は旧い方式で、新しいアカウントには無い。変えるのはダッシュボード: https://developers.cloudflare.com/workers/platform/pricing/ 。手元の `node_modules/wrangler/config-schema.json` にはもう `usage_model` が無い。検査は値によらず落とす
    - binding の key の一覧は `config-schema.json` の `RawConfig`(r2_buckets・queues・analytics_engine_datasets・browser・ai・vectorize・kv_namespaces・durable_objects・hyperdrive・logpush・containers・workflows・pipelines ほか)。許す表の外はすべて落とすので、新しい製品の key も黙って通らない
    - `.assetsignore` は assets の dir の根に置き、書式は .gitignore: https://developers.cloudflare.com/workers/static-assets/binding/#ignoring-assets 。wrangler は `.assetsignore`・`_redirects`・`_headers` を先に足して無視する(`wrangler-dist/cli.js` の `createAssetsIgnoreFunction`)。検査の数えもこれに合わせた。本物の dist で、wrangler と同じ `ignore` 7.0.9 が配るとするファイルの一覧と、検査の一覧が 18 件で一致することを scratchpad で確かめた
    - `wrangler d1 execute <DB> --local|--remote --json --command` と `--config`・`--persist-to`(`wrangler d1 execute --help`)、ローカル D1: https://developers.cloudflare.com/d1/best-practices/local-development/ 。ローカルの `--json` の `meta` には `changes` が無いので、`UPDATE ... RETURNING`・`DELETE ... RETURNING` で当たった行を数える。失敗は `{"error": {"text": ...}}` と終了コード 1
  - **形**: 構成検査は純粋な関数(`check_config`・`check_assetsignore`・`check_assets`)と、ファイルを読む `check_repo`・`check_dist` に分けた。binding は許す表 `ALLOWED_KEYS` と、落とす理由を言える表 `REJECTED_KEYS` の 2 枚。`.assetsignore` はパターンの文字面ではなく、見本の道(`models/deer.blend`・`textures/concept/rejected/a.png` など)が無視されるかで見る。否定の `!` や狭めた書き方も落とせる。JSONC と .gitignore の読みは標準ライブラリだけで書いた(PEP 723 の `dependencies = []`)
  - **mod.py の境界**: `wrangler d1 execute` は bind ができないので、年代記の id を 16 進 64 文字に絞ってから SQL に埋める。`--remote`・`--local` はどちらかを必ず選ぶ。消すは `--yes` が要る。隠すは COALESCE で冪等
  - **pnpm の scripts**: `check:free-tier`(`uv run scripts/check_free_tier.py`、build の後に回す)、`test:scripts`(unittest、ローカル D1 を使うので 13 秒ほど)、`lint:py`(ruff 0.16.9 を uvx で固定)。`check` に `lint:py` と `test:scripts` を足した
  - **レビュー**(`pstack:thermo-nuclear-code-quality-review` の観点で自分で `git diff feat/m19...HEAD` に当てた)
    - 表に無い key を `binding` と呼んでいた(`workers_dev` のような binding でない key も同じ名前になる)。`unknown_key` に分けた。7ccef19
    - JSONC の末尾のカンマを、文字列を NUL に置き換えてから正規表現で外していた(手品)。閉じ括弧を出すときに、直前の空白とカンマを外す 1 本の走査にした。7ccef19
    - `check_repo` が早い return のたびに `[*violations, ...]` を繰り返していた。dist の検査を `check_dist` に分け、`check_repo` は 2 つを並べるだけにした。7ccef19
    - wrangler が失敗の終了コードで行の形の出力を返したときに、成功と読むかを守るテストが無かった(変異で生き残った)。「test_nonzero_exit_fails_even_if_stdout_looks_like_rows」を足した。7ccef19
    - Workers AI の理由の文を、docs で言える範囲(手元の開発でも遠隔で動く)に直した。7ccef19
    - 作業の途中で M19-07 が feat/m19 に入り、`src/harbor/contract.ts` の `parseChronicleId` が `^[0-9a-f]{64}$`(小文字だけ)と決まった。mod.py は大文字を小文字に直して受けていたので、同じ形に揃えた(境界の規則を 1 つにする)。9ccfbb6。この worktree は fe69dbf のままで、M19-07 は取り込んでいない(src に触れないため)
  - **見送り**: `triggers.crons` の本数(無料は 5 本/アカウント。アカウント単位なので 1 つの設定では数えきれない)。D1 の保存量(400 MB の栓)を `budget` で見ること(Cron の集計の形が M19-08 で決まってから)。`--remote` の実地の確かめ(配備の許可のあと)
