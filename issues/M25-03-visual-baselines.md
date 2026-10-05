---
id: M25-03
title: 要素ごとの基準画と閾値、審査台で承認する更新の手順。画の 3 行を auto に移す
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-02]
evidence:
  - "AC1: .confirm-box の padding を 18px 24px 16px → 18px 26px 16px 22px (内側を 2px 横にずらす) にすると CNF-002 の 3 枚が落ちる (差 2260・2163・3206 画素、割合 0.04・0.04・0.05 > 0.02)。`* { text-rendering: geometricPrecision }` を足すと CNF-002 は 3 枚とも通る (shots 4 件のうち、字だけの細い板 7 枚は 0.12 の閾値で通り、4 件 passed)。CSS はどちらも試したあと git checkout で戻した"
  - "AC2: 審査台の回 (.claude/localreview/m25-03-20261001-0217) に CNF-002 の 3 枚の前・後・差が出た。scripts/test_shots_update.py「合格だけ写す」「合格が無ければ何も変えない」、実機では verdict が合格 1 件の写しで基準画 1 枚だけ書き換わり (基準画 21 ファイル中)、全件合格の写しで 20 枚が揃った"
  - "AC3: 基準画を書いたあと shots を続けて 2 回回し、2 回とも 4 passed (1.2m・55s)。その後の shots:update も「基準画は変わらない」"
  - "AC4: CI=1 で .confirm-box を 2px ずらしたまま shots を回すと 4 passed (比べは skip、lens は回る)。tests/unit/baseline.pure.test.ts「手元の Mac だけが比べる」。shots は ACCEPTANCE_DIR が無いと回らないので、pnpm run test:e2e の件数 (96) と時間は変わらない"
  - "AC5: uv run scripts/acceptance.py check ok (43 scenarios)。round の human の行の minutes は TUR-001 5 + TUR-002 4 = 9"
  - "pnpm run check 通る (vitest 124 files 1225 passed・worker 66・scripts 101)。E2E 96 passed (E2E_PORT=5457、ACCEPTANCE_DIR 付きで shots を含む。feat/m19 558a521 を merge した木)"
---

# 要素ごとの基準画と閾値、審査台で承認する更新の手順。画の 3 行を auto に移す

優先度: Must

## What to build

ADR 0001 の段 3。画で見る CRG-005・CNF-002・SEL-003 を、基準画との比べに移す。

作るもの:
- shots の各画を要素ごとの画 (clip) でも撮り、Playwright の `toHaveScreenshot` で基準画と比べる。3D の canvas の範囲と DOM の板は別の画にする
- 閾値は `threshold: 0.2`・`maxDiffPixelRatio: 0.02` (ADR の「基準画の閾値」と付録 B の 2)
- 基準画に撮った Chromium の版 (今は chromium-1243) と macOS の版を添える
- 更新の手順: `pnpm run shots -- --update` で前後の画と差の画を審査台 (.claude/localreview) に並べ、人が承認した画だけ基準画を書き換える
- 基準画は手元の Mac だけに置く (2026-10-01 のユーザーの判断 1)。`*.png` は LFS
- 正本の CRG-005・CNF-002・SEL-003 を auto に移し、covered_by を基準画の試験にする

## Blocked by

- M25-02

## Acceptance criteria

- [ ] `.confirm-box` を 2px ずらすと落ち、`* { text-rendering: geometricPrecision }` を足しても落ちない (作業ログに数を写す)
- [ ] 審査台に前後と差の画が出て、承認すると基準画が書き換わり、承認しないと変わらない
- [ ] 続けて 2 回回して 2 回目が通る
- [ ] CI (ubuntu) では基準画の比べが回らない (`pnpm run test:e2e` の数と時間が変わらない)
- [ ] `uv run scripts/acceptance.py check` が通り、round の human の行の minutes の和が 9 になる

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 3)
- 2026-10-01: 実装 (feat/m25-03)。
  - 設計。基準画は Playwright の snapshot の置き場 `tests/e2e/baselines/<ID>-<n>-<要素名>.png` (`playwright.config.ts` の `snapshotPathTemplate`、`updateSnapshots: 'none'`)。受入の画面の `shots/` (human の行の画だけ、check_shots が見る) とは別の場所なので、auto の行 (HBR-006・CRG-005・CNF-002・SEL-003) も基準画を持て、check_shots と衝突しない。shotsOf が、渡された要素ごとに `toHaveScreenshot` (soft) をして、SEL-003 は `#scene` を「3D の面」の別の画にする。`BASELINES_DIR` を環境で置き換えられる (shots:update が基準画を書き換えずに新旧を比べるため)。
  - 基準画 20 枚 (CNF-002 3・CRG-005 3・HBR-006 8・SEL-003 6) と `VERSIONS.json` (chromium-1243・macOS 26.6.2)。
  - 比べるのは `!CI && darwin` (tests/e2e/baseline.ts の `shouldCompareBaselines`)。CI は lens だけ。
  - 閾値は ADR の threshold 0.2・maxDiffPixelRatio 0.02。ただし字だけの細い板 (訪問のリンク・積荷の知らせ・受け取りの文・セルの詳細の 7 枚) は 0.12。geometricPrecision で 0.02 を越えたため (訪問のリンク 247 画素 0.03、積荷の知らせ 0.06、受け取りの文 0.08、セルの詳細 0.03)。字を横に 2px ずらすと 訪問のリンク 0.13・受け取りの文 0.21 で落ちるのを確かめた (セルの詳細のずらしは測っていない)。文は撮る前に toHaveText で確かめている。ADR の本文は 0.02 のままで、この例外は ADR に無い (親に報告)。
  - 更新の手順は `pnpm run shots:update` (前後と差の画を審査台の回に出す。基準画は書き換えない) と `pnpm run shots:update -- --apply <回>` (審査台の verdicts.json で合格にした画だけ写し、VERSIONS.json を書く)。Playwright の json 報告を読み、比べ以外で落ちた試験があれば終了 1。閾値の内で版だけ変わったときは版だけ書き換える。`pnpm run shots --update` の形は pnpm が `--update` を playwright に渡して落ちるので、名前は `acceptance:page` の流儀の `shots:update` にした。docs/operations/acceptance.md に節を足した (既存の文は変えていない)。
  - 正本: CRG-005・CNF-002・SEL-003 を mode: auto に移した。消したもの。when: round・minutes: 1 (3 行とも)・links: [] (3 行とも)・judge 「見た目・読みやすさだけ。受け取りの帳簿と着いたセルは CRG-002〜CRG-004 の自動試験が見る」(CRG-005)・「見た目・読みやすさだけ。取り消しの効き目と focus の動きは CNF-001 の自動試験が見る」(CNF-002)・「見た目だけ。帯と印の置き場と数は SEL-001、揺れの止め方は SEL-002 の自動試験が見る」(SEL-003)。steps・title・covered_by は変えていない。CNF-002・SEL-003 の steps には `{"judge": "human"}` の手順が残る (auto の行でも check は通る)。
  - 更新の試し。.confirm-box の padding を 2px ずらして shots:update を回し、CNF-002 の 3 枚の前・後・差が .claude/localreview/m25-03-20261001-0217 に出た (基準画はそのまま)。
  - 最初の基準画 20 枚は、最初の回 (.claude/localreview/m25-03-20261001-0209) を agent が合格の写しで写した。ユーザーの目での承認はまだ。
  - レビュー。codex は認証切れ、読むだけの別モデルのレビュー。直した: `-- --apply` を pnpm が `--` ごと渡すので先頭の `--` を捨てる、比べ以外の失敗を報告して終了 1、版だけの書き換え。直さない: ADR の本文への例外の書き足し (既存の文書の文の扱いを親に任せる)。
  - 並行の負荷で check と E2E を同時に回すと harbor・persist の E2E と 1 件の単体が timeout した。続けて 1 つずつ回して全部通った。
- 2026-10-02 19:00 ユーザーの承認: 最初の基準画 20 枚(審査台 .claude/localreview/m25-03-20261001-0209/ の回)を承認。基準画はそのまま。
