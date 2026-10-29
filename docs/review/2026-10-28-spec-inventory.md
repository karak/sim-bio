# 文書の棚卸しと改訂計画 (2026-10-28)

- 作成: 2026-10-29 (名は依頼の日付 10-28 のまま)。基点 feat/m19 b3cf33e、枝 docs/spec-inventory
- 範囲: `docs/` の全 .md と .html (62 本) と `issues/README.md`。`docs/acceptance/` に .md は無い (scenarios.jsonl・rubrics.json・crops.json だけ。使い方の正本は `docs/operations/acceptance.md`)
- この文書は提案だけ。既存の文書・コード・コメント・scenarios.jsonl の行は 1 つも変えていない。消す・書き換える文は §3 に候補 (file:line・原文・理由) として挙げた。どれも CEO の承認の前には手を付けない
- 問題意識 (CEO、2026-10-28): 「過去の spec をちまちま直すのはやめるべき。そもそも ADR のように積み重ねるものか曖昧。このままだと最初だけ flow 情報として描き散らかし、後で追ったら有効か分からない情報になる。」

調べ方:

1. 機械で数えた (python): 題・行数・最初と最後の commit・commit の数・名の日付より後の commit の数・被参照 (リポの md・ts・py・json 等を path で grep。README.md はフォルダつきの path で数えた)・2026-10-18 (今の決めの文書を起こした日) より後の commit が「ポインタの行だけ」か「中身」か。
2. 読む担当を 3 つに分け (opus、読むだけ)、文書ごとに有効か・stock / flow・提案・コードとの食い違い (file:line) を同じ形で返させた。食い違いは grep で確かめたものだけ。
3. 親が抜き取りで確かめた: `src/main.ts` 257 行、`PRAYER_COOLDOWN = 0` (src/simulation/prayer.ts:24)、`SHIP_CUT_PER_YEAR = 6` (src/simulation/ship.ts:31)、M26-20 の `plan:` のアンカー切れ、09-21 より前の SHA (例 993ae8e) が今の履歴に無いこと、M21-03・M24-02 が status: todo。

## 0. 要旨

1. **曖昧さの元は「日付つきの文書を正本として保守してきたこと」。** 09-19 の設計書は名の日付の後に 45 回、信仰の経済の LD は 13 回、企画書と観察画面の決定は 6 回ずつ書き足された。書いた時点の記録 (flow) と今の正 (stock) が 1 本に混ざり、どの行が今も効くかは本文から読めない。
2. **今の決めの大半が、まだ正本 (decisions-current) に無い。** LD 5 本の結論 (祈りに応えるなの 2063・北の谷・8 年ごと、鐘樹の係数、舟の 6/年、星の門、塔の重さの燃料) は今のコードの定数と一致するが、その文章は LD の後半にしか無い。正本に移したのは迎撃の塔 (M21-03) だけ。
3. **消してよい文書はほとんど無い。** 62 本のうち 60 本は、ほかの文書・src/ と worker/ のコメント・票の `plan:`・`scripts/check_docs.py` のどれかから指されている。提案は「凍結して残す」45 本、「残す」15 本、「消す」2 本 (参照 0 の引き継ぎと、済んだ一度きりの指示書)。統合して消す候補だった 2 本 (art-brief・cloudflare-deploy) は、消すと承認制のコメントや scenarios.jsonl の行が指す先が切れるので凍結にした (§1)。
4. **積み重ねる文書 (append-only) と保守する文書 (stock) と凍結する記録 (flow) を分ける。** ADR・decisions-current の改訂の表・審査台の記録は積み重ねる。overview・fitness-functions・operations・README は保守する。日付つきの設計書・LD・計画・プレイテスト・作業ログは凍結する (§4.1)。
5. **凍結は「目録」と「頭の 1 行」の両方で示す。** 目録 (`docs/README.md`、新しく起こす) に全文書の箱と凍結の日を並べ、凍結した文書の頭にも 1 行足す (コードのコメントや票から直に来た人が気づけるように)。凍結した本文が変わったことは、目録に持たせた本文のハッシュで `check_docs.py` が落とす。git の履歴を読まないので、今の check の作り (中身だけを見る純粋な検査) と CI (fetch-depth 1) に乗る (§4.2・§4.4)。
6. **承認は 1 回に 1 つの変更にした** (§4.3、計 33 回。凍結は群ごとに 1 票だが、中の文書を 1 本ずつ外せる)。順番は「目録 → 柵 → 正本へ移す → 凍結 → 消す」。
7. **正本の decisions-current にも直すべき所がある。** :51 の「積荷 5,000・通報 1,000 は 09-26 と同じ」が同じ文書の表 (3,000・500) と食い違う。迎撃の塔の節は列の名が「今」だが、コードはまだ 3 星・150 年 (M21-03 は todo)。通し実行の件数 49 には check の印が無い (2026-09-23 のロードマップ §8 は 34 + 2 と書いている)。

## 1. 数で見た今

| | 本数 |
|---|---|
| 調べた文書 | 62 (docs 61 + issues/README.md) |
| stock / flow | 13 / 49 |
| 有効 / 一部有効 / 無効 (失効) | 16 / 33 / 13 |
| 提案: 残す / 凍結して残す / 統合して消す / 消す | 15 / 45 / 0 / 2 |
| 名に日付があり、その日より後に commit のある文書 | 17 (数え方: `git log` を --follow なしで、commit の日が名の日付より後 (>)。--follow で数えると 09-19 の設計書は 55 回のうち 43 回、と少し変わる) |
| 2026-10-18 (書き換えない決まりの日) より後に、名の日付より後で中身を書き換えた flow の文書 | 0。ただし日の単位で数えたので、同じ日の書き換えは見えない。intercept-2 は 10-28 に、決めを正本へ移したのと同じ commit (b3cf33e) で §4 を直し、:67 に 3 星の頃の 87 年が取り残された。柵 (F1) を日付でなく本文のハッシュで作るのはこのため |
| どこからも参照されない文書 | 2 (`docs/specs/plans/2026-09-23-handoff.md`・`docs/review/archive-2026-10-13.md`) |
| コードと食い違う箇所の例 (§3 に file:line) | 89 |
| 書き換え・削除・追記の候補 (§3) | 46 |
| 票の `plan:` の切れ (check_docs の anchors_of で検めた) | 10。道が無い 2 (archived M9-03・M9-05 → `docs/specs/plans/2026-09-19-scenarios-and-world.md`)。アンカーが無い 8 (M26-20 `#6-運用`、archived M6-02〜05 は見出しの「—」で `--m6-0x` になる、M10R-03 は「夢食い」と「夢喰い」、M10R-07 は「§」が残る、M10R-08 は「仅説」)。ほかに `plan: null` が 15 票、ART-01 は `git show` の旧版を指す (意図した形) |

## 2. 評価表

列: 初出 = 最初の commit の日。後 = 名の日付より後の commit の数 (日付の無い文書は —)。参照 = 被参照の数 (うち票)。出 = その文書が書いている path (docs/・src/・worker/・scripts/・tests/・issues/) の数。S/F = stock / flow。箱 = §4.1 の A (積み重ねる)・B (保守する)・C (凍結する)。「C (未凍結)」は書き足す予定がまだある flow (票が閉じたら凍結)。提案の太字は既定 (日付つき → flow → 凍結、日付なし → stock → 残す) から外れたもの。詳細と食い違いの file:line は §3 の同じ番号。

| # | 文書 | 種類 | 初出 | 最終 commit | 後 | 参照 (票) | 出 | 有効 | S/F | 箱 | 提案 | S/F の根拠 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D01 | `docs/specs/2026-09-19-ecosystem-sim-design.md` | spec | 2026-09-19 | dd08879 (2026-10-18) | 45 | 20 (12) | 82 | 一部有効 | flow | C | 凍結して残す | a440d08 (09-19) の設計書に、M1〜M10R の実装差分 §4.7〜4.31 と §6 の証跡を 09-23 までに 45 回書き足した。stock として作られたが、中身は積み上がった flow になっている。09-23 より後の commit は dd08879 (ポインタを足した) の 1 回だけ。 |
| D02 | `docs/specs/2026-10-18-decisions-current.md` | spec | 2026-10-18 | b3cf33e (2026-10-28) | 7 | 12 (5) | 19 | 有効 | **stock** | B (改訂の表は A) | 残す | 今の正本として、改訂の表で保守している |
| D03 | `docs/specs/plans/2026-09-19-m1-implementation-plan.md` | plan | 2026-09-19 | a1c9d67 (2026-09-19) | 0 | 17 (17) | 41 | 無効 (失効) | flow | C | 凍結して残す | 日付つきの実装計画で、M1 の完了で役目を終えた |
| D04 | `docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md` | plan | 2026-09-19 | 25e0f6f (2026-09-19) | 0 | 6 (5) | 3 | 無効 (失効) | flow | C | 凍結して残す | 日付つきの計画で、§3.6 に校正の結果を書き足して閉じている |
| D05 | `docs/specs/plans/2026-09-19-m6-playtest.md` | playtest | 2026-09-19 | a2cd73e (2026-09-19) | 0 | 6 (4) | 0 | 有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 |
| D06 | `docs/specs/plans/2026-09-19-m8-civilization-plan.md` | plan | 2026-09-19 | dcd8ad9 (2026-09-19) | 0 | 7 (6) | 2 | 無効 (失効) | flow | C | 凍結して残す | 日付つきの計画 |
| D07 | `docs/specs/plans/2026-09-20-m20-public-release-plan.md` | plan | 2026-09-20 | 21878a8 (2026-09-20) | 0 | 4 (4) | 4 | 一部有効 | flow | C | 凍結して残す | 日付つきの計画と監査の記録 |
| D08 | `docs/specs/plans/2026-09-20-m8-playtest.md` | playtest | 2026-09-21 | acce045 (2026-09-21) | 1 | 2 (1) | 1 | 有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 |
| D09 | `docs/specs/plans/2026-09-22-m10-playtest.md` | playtest | 2026-09-22 | 2e22bc7 (2026-09-22) | 0 | 2 (1) | 0 | 有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 |
| D10 | `docs/specs/plans/2026-09-22-m9-playtest.md` | playtest | 2026-09-22 | 5f040bb (2026-09-22) | 0 | 2 (1) | 5 | 有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 |
| D11 | `docs/specs/plans/2026-09-23-handoff.md` | handoff | 2026-09-23 | 5daf40a (2026-09-23) | 0 | 0 (0) | 4 | 無効 (失効) | flow | C | **消す** | セッションの引き継ぎで、書いた時点の状態を写したもの |
| D12 | `docs/specs/plans/2026-09-23-m10r-07-playtest.md` | playtest | 2026-09-23 | d427d3c (2026-09-23) | 0 | 1 (1) | 0 | 有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 |
| D13 | `docs/specs/plans/2026-09-23-m10r-08-playtest.md` | playtest | 2026-09-23 | c024381 (2026-09-23) | 0 | 1 (1) | 0 | 有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 |
| D14 | `docs/specs/plans/2026-09-23-m10r-playtest.md` | playtest | 2026-09-23 | 5b8d6fc (2026-09-23) | 0 | 3 (2) | 0 | 一部有効 | flow | C | 凍結して残す | 日付つきの手動受入の記録 (差し戻しの判断を含む) |
| D15 | `docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md` | review | 2026-09-23 | a54f1b1 (2026-09-23) | 0 | 6 (3) | 3 | 一部有効 | flow | C | 凍結して残す | 日付つきの監査の記録 |
| D16 | `docs/specs/plans/2026-09-23-roadmap.md` | plan | 2026-09-23 | a895cf2 (2026-10-18) | 1 | 16 (13) | 2 | 一部有効 | flow | C | 凍結して残す | 日付つきの計画。09-23 の後は §8 を末尾に足しただけ (a895cf2) で、前の文は書き換えていない |
| D17 | `docs/specs/plans/2026-10-18-plan.md` | plan | 2026-10-18 | d072620 (2026-10-18) | 0 | 1 (1) | 28 | 一部有効 | flow | C | 凍結して残す | 日付つきの点検表。d072620 の 1 回だけ書き、以後は追っていない。これから書き足す予定は無い (状態は票が持つ) ので凍結できる |
| D18 | `docs/design/2026-09-19-art-brief.md` | design | 2026-09-19 | 1c0344f (2026-09-19) | 0 | 1 (0) | 0 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D19 | `docs/design/2026-09-19-proposal.html` | plan | 2026-09-19 | 2e22bc7 (2026-09-22) | 6 | 5 (2) | 2 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D20 | `docs/design/2026-09-19-scenarios-and-world.md` | design | 2026-09-19 | 5c80fe3 (2026-09-22) | 1 | 68 (59) | 0 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D21 | `docs/design/2026-09-20-level-design-tower.md` | level-design | 2026-09-20 | 7bada9d (2026-09-21) | 1 | 8 (4) | 0 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D22 | `docs/design/2026-09-21-level-design-faith.md` | level-design | 2026-09-21 | d33de56 (2026-09-22) | 2 | 8 (2) | 0 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D23 | `docs/design/2026-09-22-level-design-devices.md` | level-design | 2026-09-22 | d2c4de9 (2026-09-22) | 0 | 8 (2) | 1 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D24 | `docs/design/2026-09-22-level-design-faith-economy.md` | level-design | 2026-09-23 | 25b7f59 (2026-10-11) | 13 | 15 (9) | 5 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D25 | `docs/design/2026-09-23-observation-view-design.md` | design | 2026-09-23 | 2e76f19 (2026-10-12) | 2 | 10 (1) | 1 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D26 | `docs/design/2026-09-23-observation-view.md` | design | 2026-09-23 | 18bbff2 (2026-09-24) | 6 | 22 (13) | 0 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D27 | `docs/design/2026-09-24-observe-perf.md` | plan | 2026-09-24 | 9c309ec (2026-10-02) | 1 | 23 (12) | 2 | 無効 (失効) | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D28 | `docs/design/2026-09-26-cloudflare-architecture.md` | design | 2026-09-26 | dd08879 (2026-10-18) | 3 | 39 (24) | 16 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D29 | `docs/design/2026-09-27-scenario-save-url.md` | design | 2026-09-27 | 2cd444f (2026-09-28) | 1 | 5 (2) | 1 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D30 | `docs/design/2026-09-29-acceptance-redesign.md` | design | 2026-09-29 | b427b74 (2026-09-30) | 1 | 6 (3) | 7 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D31 | `docs/design/2026-10-10-architecture-review.md` | review | 2026-10-10 | 25b7f59 (2026-10-11) | 1 | 10 (6) | 44 | 一部有効 | flow | C | 凍結して残す | 名に日付 → flow (既定) |
| D32 | `docs/design/2026-10-28-level-design-intercept-2.md` | level-design | 2026-10-28 | b3cf33e (2026-10-28) | 0 | 3 (1) | 9 | 一部有効 | flow | C (未凍結) | **残す** | 名に日付 → flow (既定) |
| D33 | `docs/design/qa/observe/deer.md` | qa-log | 2026-09-23 | 0fffb7d (2026-09-26) | — | 4 (2) | 1 | 一部有効 | **flow** | C | 凍結して残す | 手直しを下へ足していく作業の記録 (追記型)。今の値は末尾の節にしか無い |
| D34 | `docs/design/qa/observe/environment.md` | qa-log | 2026-09-23 | cb97bb8 (2026-10-17) | — | 5 (4) | 15 | 一部有効 | **flow** | C | 凍結して残す | 試作の記録の下に追記を重ねる作業ログ (650 行)。M22-11 (done) の所見の置き場 |
| D35 | `docs/design/qa/observe/keyitems.md` | qa-log | 2026-09-24 | 44f4ce4 (2026-09-24) | — | 5 (3) | 13 | 一部有効 | **flow** | C | 凍結して残す | 試作の記録と追記。ただし中に今も効く契約 (舟の GLB) が埋まっている |
| D36 | `docs/design/qa/observe/rabbit.md` | qa-log | 2026-09-24 | 83cf98c (2026-09-26) | — | 1 (1) | 7 | 一部有効 | **flow** | C | 凍結して残す | 手直し 1〜7 を下へ重ねた作業ログ (595 行) |
| D37 | `docs/design/qa/observe/session-2026-10.md` | playtest | 2026-10-20 | 7daf697 (2026-10-20) | — | 2 (1) | 5 | 有効 | **flow** | C (未凍結) | **残す** | 日付つき (2026-10-20) の 1 回のセッションの記録 |
| D38 | `docs/design/qa/observe/wolf.md` | qa-log | 2026-09-24 | c0d641b (2026-10-12) | — | 1 (1) | 1 | 一部有効 | **flow** | C | 凍結して残す | 作り直し 1〜6 回目の作業ログ (489 行) |
| D39 | `docs/design/qa/deer-acceptance-criteria.md` | qa-log | 2026-09-19 | ba31f2f (2026-09-20) | — | 1 (0) | 2 | 無効 (失効) | **flow** | C | 凍結して残す | 日付は無いが 2026-09-20 の 1 ブランチ (worktree-concept-art-variants) の受入の記録。D5 手動受入は未実施のまま、方針転換で失効 |
| D40 | `docs/design/qa/deer-remaining-issues.md` | qa-log | 2026-09-19 | ba31f2f (2026-09-20) | — | 2 (0) | 0 | 無効 (失効) | **flow** | C | 凍結して残す | 2026-09-20 時点の残課題の一覧。閉じる票が無いまま放棄された |
| D41 | `docs/design/qa/handoff-T18-merge.md` | handoff | 2026-09-20 | 32d52f1 (2026-09-20) | — | 3 (2) | 3 | 無効 (失効) | **flow** | C | **消す** | 1 回の作業のための貼り付け用プロンプト。済んだ後に読む理由が無い |
| D42 | `docs/design/qa/rabbit-acceptance-criteria.md` | qa-log | 2026-09-19 | efc7551 (2026-09-19) | — | 1 (0) | 1 | 無効 (失効) | **flow** | C | 凍結して残す | 2026-09-20 のブランチの受入記録。D6・E の手動受入は未実施のまま失効 |
| D43 | `docs/design/qa/rabbit-remaining-issues.md` | qa-log | 2026-09-19 | 8f8aabb (2026-09-20) | — | 3 (0) | 1 | 無効 (失効) | **flow** | C | 凍結して残す | commit 0aae098 時点の残課題 |
| D44 | `docs/design/qa/remaining-tasks.md` | plan | 2026-09-20 | e526110 (2026-09-20) | — | 3 (1) | 0 | 無効 (失効) | **flow** | C | 凍結して残す | 見出しに「2026-09-20 11:30 時点」。名に日付は無いが時点の計画 |
| D45 | `docs/design/qa/verification-workflow.md` | qa-log | 2026-09-19 | c297924 (2026-09-20) | — | 1 (0) | 2 | 一部有効 | **flow** | C | 凍結して残す | 日付は無いが M6〜M8 の旧模型の検証手順。観察画面の検証手順は observe/*.md の「出力と作り直し方」が持つ |
| D46 | `docs/design/qa/wolf-acceptance-criteria.md` | qa-log | 2026-09-19 | cdbb913 (2026-09-20) | — | 1 (0) | 2 | 無効 (失効) | **flow** | C | 凍結して残す | 2026-09-20 のブランチの受入記録。D5 未実施で失効 |
| D47 | `docs/design/qa/wolf-remaining-issues.md` | qa-log | 2026-09-19 | cdbb913 (2026-09-20) | — | 2 (0) | 0 | 無効 (失効) | **flow** | C | 凍結して残す | 2 回目の後の残課題の一覧 |
| D48 | `docs/decisions/0001-acceptance-automation.md` | ADR | 2026-09-30 | 6a5b2f8 (2026-10-04) | — | 24 (21) | 21 | 有効 | stock | A | 残す | ADR は決めを積む記録。ただし改訂の節が無いまま、本文に後の事実 (例外 0.12・段 6 済み) を書き足しており、上書きの跡が追えない |
| D49 | `docs/decisions/0002-architecture-fence.md` | ADR | 2026-10-10 | 5fb8269 (2026-10-11) | — | 5 (0) | 4 | 有効 | stock | A | 残す | ADR。§改訂 に 2026-10-11 の上書きを記録しているが、決定 1・2 の本文そのものを書き換えた (supersede しない判断を明記) |
| D50 | `docs/architecture/fitness-functions.md` | design | 2026-10-10 | 675a1b5 (2026-10-28) | — | 2 (1) | 23 | 有効 | stock | B | 残す | 日付なし。柵を足すたびに 1 行足す決まり (§足し方) で保守 |
| D51 | `docs/architecture/overview.md` | design | 2026-10-11 | 782f3d7 (2026-10-11) | — | 1 (0) | 10 | 一部有効 | stock | B | 残す | 日付なしで「保守する文書」と名乗り、§9 更新の手順を持つ。ただし冒頭の対象 9fa690b と §8 は時点の記述 |
| D52 | `docs/operations/README.md` | index | 2026-10-06 | 4ff7552 (2026-10-06) | — | 1 (1) | 2 | 一部有効 | stock | B | 残す | 日付なしの目次。文書を足し引きするたびに保守する |
| D53 | `docs/operations/acceptance.md` | ops | 2026-09-27 | 8cdc556 (2026-10-18) | — | 15 (8) | 14 | 有効 | stock | B | 残す | 日付なし。M25 の各票で節を足して保守されている |
| D54 | `docs/operations/cloudflare-api-token.md` | ops | 2026-09-27 | 38fb78c (2026-10-10) | — | 7 (1) | 1 | 有効 | stock | B | 残す | 日付なしの型。§手元のログイン(記録) だけが flow の注 |
| D55 | `docs/operations/cloudflare-deploy.md` | ops | 2026-09-27 | 4eda520 (2026-10-11) | — | 10 (1) | 5 | 一部有効 | **flow** | C | 凍結して残す | 名に日付は無いが、中身は 2026-09-27 の初回の配備の記録 (H1〜A12a に済の印)。今の手順は deploy-runbook |
| D56 | `docs/operations/cloudflare.md` | ops | 2026-10-06 | 4eda520 (2026-10-11) | — | 8 (1) | 9 | 一部有効 | stock | B | 残す | 日付なし。README から移した運用の正本 (2026-10-06) |
| D57 | `docs/operations/deploy-runbook.md` | ops | 2026-10-05 | 4eda520 (2026-10-11) | — | 20 (3) | 7 | 有効 | stock | B | 残す | 日付なし。今の配備の正本。§1 の 7403 の経緯だけ flow の注 |
| D58 | `docs/operations/readme-screenshots.md` | ops | 2026-09-26 | d419c0b (2026-09-29) | — | 4 (2) | 1 | 一部有効 | stock | B | 残す | 日付なしの手順 |
| D59 | `docs/uiux/2026-10-04-title-flow.md` | uiux | 2026-10-04 | 1252497 (2026-10-05) | 1 | 18 (7) | 8 | 一部有効 | flow | C | 凍結して残す | 日付つき。2026-10-04 に承認された設計 |
| D60 | `docs/uiux/README.md` | index | 2026-10-04 | 1252497 (2026-10-05) | — | 1 (1) | 2 | 有効 | stock | B | 残す | 日付なしのフォルダの目次と図の読み方 |
| D61 | `docs/review/archive-2026-10-13.md` | review | 2026-10-13 | a39f9a1 (2026-10-13) | — | 0 (0) | 49 | 有効 | **flow** | A | 凍結して残す | 日付つきの一度きりの写し。同じ中身を機械の形で docs/review/archive-2026-10-13.jsonl (228 行) も持つ |
| D62 | `issues/README.md` | index | 2026-09-19 | ac8aa46 (2026-10-28) | — | 10 (3) | 14 | 一部有効 | stock | B | 残す | 日付なしの規約。ただし §進める順 に日付つきの flow が埋まっている |

## 3. 文書ごとの詳細

「食い違い」は文書の file:line と原文、コードの file:line と事実。「候補」は消す・書き換える・足す文の候補で、どれも承認の前には手を付けない。

### D01 `docs/specs/2026-09-19-ecosystem-sim-design.md`

- 題: 生態系シミュレーション 設計書
- 行数 911、commit 57 回、最終 dd08879 2026-10-18 docs(specs): 今の決定事項を 2026-10-18 の文書に起こし、09-19・09-26 に superseded のポインタを
- 有効: 一部有効 — §3 用語・§4 冒頭の依存の向き・§4.1 の不変条件と契約・§4.2 LogSink の型は今のコードと合う。§2 は decisions-current に移済み。§4.1 の型・§4.4〜4.6・§7 は古い。§4.7〜4.31 の係数は今も一致するが、書いた時点の差分の記録である。
- 提案: 凍結して残す
- 参照・在りか: §6 の証跡の SHA のうち、09-21 より前のもの (993ae8e・fe329b9・3598752・084f3b9・adfb981・2f54853・951de6b・99ae814・25aecac・af7628e・2608ae3) は今の履歴に無い (M20-02 の filter-repo で SHA が変わった。git cat-file で MISSING)。たどるには issues/archived/M20-02-history-rewrite.md:36 の bundle が要る。e7e2a39 以降は残っている
- 正本へ移す・扱いを決める節:
  - §3 用語 → docs/architecture/overview.md (冒頭か §3 C3)
  - §4 冒頭の依存の向き + §4.1 不変条件と契約 (create は決定論、dispatch はキューに積み次の step で当てる、snapshot はコピーしない読み取り専用、serialize→restore の往復で一致、ログは deps.log だけへ出す。World.ts:287-292・types.ts:108 と一致) → overview.md §3 C3 に、World の契約として書く。dispatch が validate の結果を返すこと (§4.25) を足して直す
  - §4.1 ログイベントの表 → docs/operations か overview (可観測性)。今の sim.civ.* と sim.ship.* も足す
  - §4.2 LogSink (src/core/log/types.ts と完全に一致。ts を付けるのは World 側) → overview.md。「HTTP は後日 ADR で」の文は httpSink.ts が入ったので落とす
  - §4.4 Runner の契約 (フレーム当たりのティックの上限、速度 0 でも onFrame を呼ぶ) → overview.md
  - 設計の決め: §4.10 dead は省略できる (途中の絶滅を即死にしない)・§4.12 星の力はシナリオ層の数で World に入れない・§4.12 瞬間値ではなく species_mean で判定する・§4.24 escape → dead → alive の評価の順・§4.15 塔はキーアイテムで作り直す方針 → decisions-current に行を足すか ADR 1 本にまとめる
  - §8 リスク (snapshot の読み取り専用は型で守れない、ティックの上限) → overview.md
- 食い違い:
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:68`「world.dispatch(cmd: Command): void」 ↔ `src/simulation/World.ts:291`: dispatch(cmd, opts) は { ok: true } | { ok: false; reason } を返す (M10 のレビューで変わった。§4.25 に書いたが §4.1 は直していない)
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:120-123`「type Command = spawn_species | set_climate | disaster (3 種)」 ↔ `src/simulation/types.ts:89-106`: Command は 9 種 (sink・civ_edict・build_tower・tower_power・intercept・launch_ship を足した)
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:649`「DISASTER_RADIUS.plague は 4 のまま(src/main.ts)」 ↔ `src/simulation/commands.ts:8`: DISASTER_RADIUS は src/simulation/commands.ts に移った (M27-05)。src/main.ts には無い
- 候補:
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:4`「状態: M1〜M6 実装完了(2026-09-19。…)」 — 本文は M10R (09-23) まで書き足してある。文は書き換えず、凍結の印とポインタの行を足す案
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:894-901`「## 7. スコープ外 (ブラウザ内自動保存・HTTP ログ sink・glTF・Web Worker への移行)」 — どれも入った (decisions-current の行 10・12・14・19)。節の下に superseded-by: docs/specs/2026-10-18-decisions-current.md#決定事項 のポインタを足す
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:501-547`「## 5. データ の後に ### 4.23 と #### 4.24.1 が置かれている」 — merge の名残で節の順が崩れている。凍結するなら直さず、注記だけにする案
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:46`「## 4. モジュール構成」 — live の節を overview.md へ移した後、superseded-by: docs/architecture/overview.md#3-c3-ゲームクライアントのコンポーネント のポインタを足す (check_docs の REQUIRED_POINTERS にも足す)
  - `docs/specs/2026-09-19-ecosystem-sim-design.md:148`「| `applyFeedback(state, config)` | 植生 → 降水の補正。係数 0 なら無変更 |」 — applyFeedback という関数は無く、src/simulation/climate.ts:38 の stepClimate の中で feedback.vegetationToRain を読んでいる

### D02 `docs/specs/2026-10-18-decisions-current.md`

- 題: 今の決定事項 (2026-10-18)
- 行数 138、commit 8 回、最終 b3cf33e 2026-10-28 docs(design): M21-03 の決め (K1・W 12・灯に焚く・2 星 60・105 / 110 年) を decisions-
- 有効: 有効 — &lt;!-- check --&gt; の印の数 (Command 9 種・E2E 23 本・枠 4・自動保存 90・D1 の cap) は check_docs がコードと突き合わせており、ls でも tests/e2e は 23。迎撃の塔の節は決めが先行していて、コードはまだ追いついていない。
- 提案: 残す
- 食い違い:
  - `docs/specs/2026-10-18-decisions-current.md:126-127`「2 星 60・105 年、110 年 / 星を 2 回砕いて段階 6 以上」 ↔ `assets/data/scenarios.json:586-`: intercept-tower は今も 3 星 (atYear 60・100・140)、years 150、alive は intercepted min 3。M21-03 は status: todo。節に「実装は M21-03」とあるが、列の名「今」がコードの今と読まれうる
  - `docs/specs/2026-10-18-decisions-current.md:92`「通し実行は tests/slow の 49 件 (scenarios.playthrough.test.ts の 47 件と observe.scenes.test.ts の 2 件)」 ↔ `tests/slow/scenarios.playthrough.test.ts`: 数が 3 通りある。この文書は 47+2、roadmap:154 (10-18 の計測) は 34+観察 2。リテラルの it( は 37 行で、ループ 8 か所の展開数はこの worktree に node_modules が無く vitest list で確かめられなかった。check_docs にこの数の印は無い
  - `docs/specs/2026-10-18-decisions-current.md:26`「| 1 | 関わり方 | 神視点で軽く介入。勝敗なし | … | 同じ |」 ↔ `src/scenario/types.ts:133`: 石板には ScenarioStatus 'alive'|'dead'|'escaped' の勝敗がある。勝敗が無いのは自由モードだけ (理由の列の「後からシナリオとして被せる」がそれに当たる)。「同じ」だけでは読み違えうる
- 候補:
  - `docs/specs/2026-10-18-decisions-current.md:92`「tests/slow の 49 件 (… 47 件と … 2 件)」 — check_docs の印 (例 slow_cases=49) を足し、数え方をコードから機械で取る。今は検められていない数
  - `docs/specs/2026-10-18-decisions-current.md:120`「| 項目 | 今 (2026-10-28) | 根拠 |」 — 列を「決め」と「実装 (票の状態)」に分けるか、節の頭に「コードは M21-03 の done まで旧 3 星」と書く
  - `docs/specs/2026-10-18-decisions-current.md:96-104`「caffeinate -ims・pmset の運用の段落」 — 決定ではなく運用の手順。docs/operations へ移す候補 (正本が運用の細部まで抱えて太る)

### D03 `docs/specs/plans/2026-09-19-m1-implementation-plan.md`

- 題: M1 (地形 + 植物 + 季節 + グラフ) Implementation Plan
- 行数 1172、commit 1 回、最終 a1c9d67 2026-09-19 docs: M1 実装計画と issues チケット 16 件を追加
- 有効: 無効 (失効) — M1 は 09-19 に完了。npm・ファイルの構成・Task ごとの手順は書いた時点のもの (流し読みで判定)。
- 提案: 凍結して残す
- 参照・在りか: issues/archived/M1-01〜16 の 16 票と issues/README.md から参照されている
- 食い違い:
  - `docs/specs/plans/2026-09-19-m1-implementation-plan.md:41`「src/simulation/feedback.ts         applyFeedback」 ↔ `src/simulation/climate.ts:38`: feedback.ts は無い。フィードバックは climate.ts の中で config.feedback.vegetationToRain を読む
  - `docs/specs/plans/2026-09-19-m1-implementation-plan.md:21`「`npm run check` で `tsc --noEmit` + `eslint` + `vitest run` が通ること」 ↔ `package.json:21,72`: packageManager は pnpm@10.28.1。check は typecheck・lint・lint:py・check:docs・check:d1-writes・worker・scripts まで含む

### D04 `docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md`

- 題: M6 実装計画: 「沈む欠片」をジレンマのあるゲームとして遊べるようにする
- 行数 134、commit 2 回、最終 25e0f6f 2026-09-19 feat(scenario): 「沈む欠片」の再設計と校正(M6-04)
- 有効: 無効 (失効) — M6 は完了。予算の初期値は「当たり」で、校正後の値は設計書 §4.12 とコードにある。
- 提案: 凍結して残す
- 参照・在りか: issues/archived/M6-01〜05 と設計書 §4.12 から参照されている
- 正本へ移す・扱いを決める節:
  - §1 G1〜G5 の「ジレンマのある状態」の定義 (放置で滅び、素朴な戦略で滅び、配分すれば回避でき、読め、手で負ける) → 以後の石板の受入の型。issues/README の「シナリオの作り方」に同じ趣旨があるか確かめ、無ければ decisions-current へ
- 食い違い:
  - `docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md:85`「start 40, incomePerYear 8, costs {spawn 4, disaster 12, climate 2}」 ↔ `assets/data/scenarios.json (sinking.budget)`: incomePerYear は 32 (校正後)。§3.6 は設計書 §4.12 に任せている

### D05 `docs/specs/plans/2026-09-19-m6-playtest.md`

- 題: M6 手動受入プレイテスト: 「沈む欠片」
- 行数 71、commit 1 回、最終 a2cd73e 2026-09-19 feat(ui): 手動プレイで見つけた表示の修正と記録(M6-05)
- 有効: 有効 — その時点の手動受入の記録として正しい。手順 (npm run build) は古い。
- 提案: 凍結して残す
- 参照・在りか: 設計書 §6 M6 (826 行) と M6-05・M7-01〜03 の票が証跡として参照している
- 食い違い:
  - `docs/specs/plans/2026-09-19-m6-playtest.md:71`「プレイテストは `npm run build && npx vite preview` で配信したビルドで行う」 ↔ `package.json:72`: packageManager は pnpm

### D06 `docs/specs/plans/2026-09-19-m8-civilization-plan.md`

- 題: M8 計画: 文明の発生と段階、負荷、輝石 — シナリオ「塔の重さ」
- 行数 61、commit 1 回、最終 dcd8ad9 2026-09-19 docs(plan): M8 計画(文明・負荷・輝石、塔の重さ)と M8 チケット 6 件
- 有効: 無効 (失効) — 塔の重さは v2 (キーアイテム) で作り直した。発生の条件は M9-00 で相対値に変わった。
- 提案: 凍結して残す
- 参照・在りか: 設計書 §4.14 と issues/archived/M8-01〜06 から参照されている
- 正本へ移す・扱いを決める節:
  - §2.2 文明の段階の名 (0 なし・1 巣・2 火・3 歌・4 石・5 帆・6 塔・7 星) → 用語として overview か世界観の文書へ (コードの表示名と照合してから)
- 食い違い:
  - `docs/specs/plans/2026-09-19-m8-civilization-plan.md:42`「alive(100 年目): all [ forest の総量 ≥ 開始の 0.3 倍 …, civ_stage ≥ 6 …]」 ↔ `assets/data/scenarios.json (tower.alive)`: alive は civ_stage min 6 (10 年) と species_mean deer ≥ 13.8。森の 3 割は v2 で捨てた
  - `docs/specs/plans/2026-09-19-m8-civilization-plan.md:27`「集落候補セル … の半径 r 内で植生 > 0.4 なら stage 1」 ↔ `src/simulation/civilization.ts:84-85`: EMERGE_VEGETATION 0.4 は「島の陸の植生平均に対する倍率」で、半径 8 で測る (M9-00)

### D07 `docs/specs/plans/2026-09-20-m20-public-release-plan.md`

- 題: M20 計画: GitHub public リポジトリとして公開する
- 行数 112、commit 3 回、最終 21878a8 2026-09-20 docs(release): 公開の決定(起案 karak97、生成物を含めて LFS、filter-repo、MIT、sim-bio)、AR
- 有効: 一部有効 — 決定 (MIT・karak97・LFS・filter-repo) は実施済みで、LICENSE は MIT karak97。LFS の範囲は計画より広い。1 行目の表は filter-repo の置換で文意が壊れている。
- 提案: 凍結して残す
- 参照・在りか: 結果は issues/archived/M20-01〜04 (M20-02 に bundle と手順)
- 正本へ移す・扱いを決める節:
  - ユーザーの決定の表 (ライセンス MIT・権利者 karak97・生成物を公開に含め LFS で持つ) → decisions-current に 1 行ずつ (公開の方針は今も効いている)
- 食い違い:
  - `docs/specs/plans/2026-09-20-m20-public-release-plan.md:93`「PNG も含め git LFS で管理する(`.gitattributes` に `assets/textures/**/*.png` を追加)」 ↔ `.gitattributes:3`: *.png を全部 LFS にしている。.blend・.glb・jpg の一部も LFS
  - `docs/specs/plans/2026-09-20-m20-public-release-plan.md:9`「全 108 コミットが個人メール(`156341+karak@users.noreply.github.com`)」 ↔ `issues/archived/M20-02-history-rewrite.md:38`: filter-repo の --replace-text が文書の中のメールまで noreply に置き換えたので、「個人メール」と書いた所に noreply が載り、文意が逆になった
- 候補:
  - `docs/specs/plans/2026-09-20-m20-public-release-plan.md:9`「全 108 コミットが個人メール(`156341+karak@users.noreply.github.com`)」 — 履歴の書き換えで文意が壊れた。直さないなら「M20-02 の置換で書き換わった」の注を足す

### D08 `docs/specs/plans/2026-09-20-m8-playtest.md`

- 題: M8 手動受入プレイテスト: 「塔の重さ」v2
- 行数 82、commit 1 回、最終 acce045 2026-09-21 feat(scenario): 塔の重さ v2 の手動プレイテストと燃料警告の修正(M8-06)
- 有効: 有効 — 記録としては正しい。燃料の警告の修正は済んでいる。
- 提案: 凍結して残す
- 参照・在りか: 設計書 §6 M8-06 (858 行) と M8-06 の票から参照されている
- 食い違い: 無し (読み手が突き合わせて見つからなかった)

### D09 `docs/specs/plans/2026-09-22-m10-playtest.md`

- 題: M10 手動受入プレイテスト: 「迎撃の塔」「空の舟」
- 行数 66、commit 1 回、最終 2e22bc7 2026-09-22 feat(ui): 手動受入プレイテスト(M10-04): 舟の行を逃がす石板だけに、hidden を display より優先、舟の警告(止
- 有効: 有効 — 記録としては正しい。迎撃の 3 星の設計は decisions-current の迎撃の塔の節で 2 星に改められ、空の舟は M10R-08 で作り直した。
- 提案: 凍結して残す
- 参照・在りか: M10-04 の票と設計書から参照されている
- 食い違い:
  - `docs/specs/plans/2026-09-22-m10-playtest.md:13`「建造中は「舟 進み N / 120」」 ↔ `src/simulation/ship.ts:31`: SHIP_NEED 120 は同じだが、伐採は割合 (SHIP_CUT 0.3) から一定量 SHIP_CUT_PER_YEAR 6 に変わった (M10R-08)。記録の進みの速さは今の値ではない

### D10 `docs/specs/plans/2026-09-22-m9-playtest.md`

- 題: M9 手動受入プレイテスト: 「祈りに応えるな」「霊脈枯れ」
- 行数 61、commit 1 回、最終 5f040bb 2026-09-22 feat(ui): 手動受入プレイテスト(M9-05): 信仰の切り捨て表示と集落の生気の表示・警告
- 有効: 有効 — 記録としては正しい。祈りに応えるなの集落 (35,43 = 2787) は M10R-07 で 2063 に移った。
- 提案: 凍結して残す
- 参照・在りか: M9-05 の票と設計書から参照されている
- 食い違い:
  - `docs/specs/plans/2026-09-22-m9-playtest.md:5`「祈りに応えるな = (35, 43)」 ↔ `assets/data/scenarios.json (no-answer.start.civilization.home)`: home は 2063 (M10R-07)

### D11 `docs/specs/plans/2026-09-23-handoff.md`

- 題: 引き継ぎ: M10R 完了 → 残課題の整理とロードマップの組み直し(2026-09-23 18:20)
- 行数 73、commit 2 回、最終 5daf40a 2026-09-23 docs(issues,plans): ロードマップの承認とチケットの改廃 — M21 仕上げを新設(UI パリティ監査・HUD の読みやすさ
- 有効: 無効 (失効) — §6 の判断待ちは 18:30 の追記どおり回答済み (roadmap §7)。§5「守るべき約束」は今の運用と食い違う。
- 提案: 消す
- 失われる情報: §5 の約束 (push の作法、UI と同じ手で台本を書く、既存コメントを消さない、worktree に merge --ff-only を指示する)
- その在りか: roadmap §5・§7 と issues/README (UI と同じ手の規約)、auto-memory (git push の gh の実パス・worktree の基点・通し実行の分割)、~/.claude/CLAUDE.md (コメントの承認制)、git 履歴 (9e555c2)。この文書を指す他の文書は無い (grep で 0 件)
- 食い違い:
  - `docs/specs/plans/2026-09-23-handoff.md:51`「**並列 vitest は不可**」 ↔ `scripts/slow_report.py:299`: --jobs の既定は 2 で、describe の分けを並列に回す (decisions-current の回帰の通し実行の節も同じ)
  - `docs/specs/plans/2026-09-23-handoff.md:51`「`SLOW=1` + `caffeinate -dimsu` で `-t` 分割」 ↔ `package.json:42`: test:slow:table (uv run scripts/slow_report.py) が caffeinate -ims で立てる (decisions-current:103)
  - `docs/specs/plans/2026-09-23-handoff.md:48`「push は main のみ」 ↔ `(運用)`: 今は feat/m19 で進め、push はユーザーの許可を待つ (2026-10-18-plan.md の冒頭・auto-memory)
- 候補:
  - `docs/specs/plans/2026-09-23-handoff.md:1`「(文書全体)」 — flow の引き継ぎで、内容は roadmap と memory に移済み。参照も無い。消すならユーザーの承認が要る

### D12 `docs/specs/plans/2026-09-23-m10r-07-playtest.md`

- 題: M10R-07 手動受入プレイテスト: 「祈りに応えるな」の作り直し
- 行数 39、commit 1 回、最終 d427d3c 2026-09-23 fix(scenario,docs,test): レビュー修正 — 予定の台詞を年表に二重に積まない(手動受入で二重表示)、仕様書 §4.27
- 有効: 有効 — 今の no-answer (2063、北の谷 1366、8 年ごと、FAITH_YOUNG_STAGE 3) と合う。
- 提案: 凍結して残す
- 参照・在りか: M10R-07 の票から参照されている
- 食い違い: 無し (読み手が突き合わせて見つからなかった)

### D13 `docs/specs/plans/2026-09-23-m10r-08-playtest.md`

- 題: M10R-08 手動受入プレイテスト: 「空の舟」の作り直し
- 行数 46、commit 1 回、最終 c024381 2026-09-23 docs(plans,issues,specs): M10R-08 手動受入 2 回(想定解が UI で 40 年目に escaped、林だけ
- 有効: 有効 — 今の sky-ship (fuelStock 0、0 年目の鐘樹、SHIP_CUT_PER_YEAR 6、SHIP_NEED 120) と合う。
- 提案: 凍結して残す
- 参照・在りか: M10R-08 の票から参照されている
- 食い違い: 無し (読み手が突き合わせて見つからなかった)

### D14 `docs/specs/plans/2026-09-23-m10r-playtest.md`

- 題: M10R 手動受入プレイテスト: 「迎撃の塔」「空の舟」
- 行数 67、commit 2 回、最終 5b8d6fc 2026-09-23 revert(scenario,test): 空の舟の定義と通し実行を M10 の状態(薪 800)に戻す(手動受入で UI では勝てず、机上
- 有効: 一部有効 — 迎撃の部分は記録として正しい (3 星の時点)。空の舟の部分 (薪 0 で手では勝てない) は判断の記録で、定義は M10R-08 で改めた。
- 提案: 凍結して残す
- 参照・在りか: LD faith-economy と M10R-05・06 の票から参照されている
- 正本へ移す・扱いを決める節:
  - §「成立していない点」(UI と同じ手で台本を書く) → 規約は issues/README に移済みか確かめる
- 食い違い: 無し (読み手が突き合わせて見つからなかった)

### D15 `docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md`

- 題: M21-01 通し実行の台本の UI パリティ監査(2026-09-23)
- 行数 62、commit 1 回、最終 a54f1b1 2026-09-23 feat(ui,test,docs): 通し実行の台本を UI の 1 クリックに揃える(M21-01)
- 有効: 一部有効 — 監査と再計測は記録として正しい。§2 のファイルの場所は M27-05 で動いた。§3.2 の M21-03 への問いは decisions-current の迎撃の塔の節と LD intercept-2 が引き継いだ。
- 提案: 凍結して残す
- 参照・在りか: LD intercept-2・LD faith-economy・M27-05・M21-01・M21-03 の票から参照されている
- 正本へ移す・扱いを決める節:
  - §2 規約「台本も UI の 1 クリックを使い、直書きは単体試験で落ちる」→ overview か issues/README の規約へ (今の場所は src/simulation/commands.ts)
- 食い違い:
  - `docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md:27`「`src/ui/clicks.ts` に UI の 1 クリック(`spawnClick`・`disasterClick`)を置き」 ↔ `src/simulation/commands.ts:21-22`: spawnClick・disasterClick は src/simulation/commands.ts にある。src/ui/clicks.ts に残っているのは publishClick (出港) だけ

### D16 `docs/specs/plans/2026-09-23-roadmap.md`

- 題: ロードマップの組み直し(2026-09-23、M10R 完了時点)
- 行数 168、commit 3 回、最終 a895cf2 2026-10-18 docs(plans): 2026-09-23 のロードマップに完了の判定 (§8、票の数と機械の試験の数) を足す
- 有効: 一部有効 — §7 の決定 (M12→M16→M11 の順など) は石板に戻るときに効く。§8 (10-18 に足した) が自分で完了を判定した。§1 の「11 本」は §8.3 が「10 本の数え違い」と自分で直している。
- 提案: 凍結して残す
- 参照・在りか: M11〜M18 の -00 票・issues/README・2026-10-18-plan・architecture-review から参照されている
- 正本へ移す・扱いを決める節:
  - §7 石板の順 (M12→M16→M11→M14 + 歌鳥→M13→M15→M17→M18) と #12 を M12 に入れる決定 → decisions-current に節を立てる (観察画面を優先するかとの関係を書いて)
  - §3 優先の基準 ①〜⑤ → decisions-current か issues/README
- 食い違い:
  - `docs/specs/plans/2026-09-23-roadmap.md:154`「通し (tests/slow) | 47 | 34 + 観察 2」 ↔ `docs/specs/2026-10-18-decisions-current.md:92`: decisions-current は 47 + 2 = 49 件と書く。同じ 10 月の 2 文書で数が違う (コードでの確定は vitest list が要る)

### D17 `docs/specs/plans/2026-10-18-plan.md`

- 題: 2026-10-18 の計画 (仕上げの残りと、石板へ戻る前の決め)
- 行数 432、commit 1 回、最終 d072620 2026-10-18 docs(plans): 2026-10-18 の計画 (仕上げの残り 8 票を 1 票 1 節の点検表に。verify-biotope の層
- 有効: 一部有効 — 開いている票 (M21-03・M22-09・M24-02/03・M26-14・M19-19) の節は今も使える。点検の箱は 145 個すべて未チェックだが、M26-20・M19-03・M21-11 は status: done。
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - 票ごとの節は、票が閉じるまで読まれる。凍結しても読むのは妨げない。箱の状態は書き足さず、状態の正本は票 (§4.1 の決まり 2)
- 食い違い:
  - `docs/specs/plans/2026-10-18-plan.md:325`「Create `docs/design/2026-10-xx-level-design-intercept-2.md`」 ↔ `scripts/check_docs.py (REQUIRED_POINTERS)`: LD は docs/design/2026-10-28-level-design-intercept-2.md としてできていて、decisions-current がそれを supersede している。箱は [ ] のまま
  - `docs/specs/plans/2026-10-18-plan.md:51`「## D1 の書きの予算を性能要件と適用度関数にする (M26-20) (箱はすべて [ ])」 ↔ `issues/M26-20-d1-write-budget-fitness.md`: status: done。scripts/check_d1_writes.py があり、check に入っている
- 候補:
  - `docs/specs/plans/2026-10-18-plan.md:18`「## Program checklist」 — 箱が実態を映していない。箱を付けていくか、「状態の正本は issues/*.md の status」と 1 行書く。書かないと、CEO の言う「後で追ったら有効か分からない」の典型になる

### D18 `docs/design/2026-09-19-art-brief.md`

- 題: アート発注書 — 2D デザイン画像(3D デザイナー用の下絵)
- 行数 67、commit 2 回、最終 1c0344f 2026-09-19 tools: Gemini で発注書どおりコンセプト画を生成するスクリプト
- 有効: 一部有効 — §1 の色は species.json と一致。だが種の名・種の数・プロンプトはコードが先へ進み、絵の正は assets/textures/board/ (観察画面の決定) に移った
- 提案: 凍結して残す
- 参照・在りか: 凍結にした (レビューの指摘: 消すと tools/gen-concept-art.mjs:3・:46 のコメントの書き換えが要り、承認制)。中身の写しの在りか: 形の指示とプロンプトは tools/gen-concept-art.mjs:40-46 (英訳)、色は assets/data/species.json、由来は scenarios-and-world §1.3、今の絵の正は assets/textures/board/README.md。対象読者「ムー読者の中高生」(art-brief:4) はここにしか無い。docs/uiux/2026-10-04-title-flow.md:168・:210 が題で引く
- 食い違い:
  - `docs/design/2026-09-19-art-brief.md:15`「| forest | 森(鐘樹) | 植物 | #2E6B37 | 釣鐘型の樹冠 …」 ↔ `assets/data/species.json:23,164`: forest の name は「森」、鐘樹は別の種 belltree (color #3E8E6A) として M8 で足された
  - `docs/design/2026-09-19-art-brief.md:16-18`「deer | 月鹿 / rabbit | 土兎 / wolf | 灰狼」 ↔ `assets/data/species.json:42,67,91`: name は 鹿・ウサギ・狼。種は 8 つ (moss・firelizard・belltree を含む) で、表の 5 つより多い
  - `docs/design/2026-09-19-art-brief.md:50-53`「no texture detail, single-color background (#F4F6F1), centered subject, 3/4 view for creatures and props, isometric top-down for the island.」 ↔ `tools/gen-concept-art.mjs:40-44`: COMMON は「3/4 view…isometric」を持たず「Square composition.」で終わる。--style=angular (STYLE_PRESETS、:72) も文書に無い

### D19 `docs/design/2026-09-19-proposal.html`

- 題: ビオトープ島 企画書
- 行数 400、commit 9 回、最終 2e22bc7 2026-09-22 feat(ui): 手動受入プレイテスト(M10-04): 舟の行を逃がす石板だけに、hidden を display より優先、舟の警告(止
- 有効: 一部有効 — §01〜03 の体験の芯・§07 のリスクは今も正。冒頭の状態・§06 のスコープ・配備の想定は古く、§4.6 は M4〜M10 の進捗報告が 6 回足され、迎撃の 3 星は decisions-current の 2 星と食い違う
- 提案: 凍結して残す
- 参照・在りか: README.md:92 が「企画書(ピッチ)」として指し、docs/specs/2026-09-19-ecosystem-sim-design.md:694・752・860 が証跡として指す
- 正本へ移す・扱いを決める節:
  - §4.6 の M4〜M10 の段落 (シナリオごとの芯と生き残る手) → 遊ぶ人向けのシナリオ紹介の正本 (README か新しいシナリオ一覧) へ移し、企画書は 09-19 の承認のときの形で凍結する
- 食い違い:
  - `docs/design/2026-09-19-proposal.html:90`「状態 設計完了・実装着手前」 ↔ `wrangler.jsonc:4-11`: Worker biotope-island として dist を配る構成があり、.github/workflows/deploy.yml で配備している
  - `docs/design/2026-09-19-proposal.html:377`「デプロイ先は Cloudflare 静的配信を想定しています（当面はローカルで動作）」 ↔ `wrangler.jsonc:18-37`: 静的配信に加えて D1 (HARBOR)・Rate Limiting・Cron を持つ港の Worker になっている (decisions-current #8)
  - `docs/design/2026-09-19-proposal.html:359`「迎撃の塔では、星は三度(六十・百・百四十年目)落ち」 ↔ `assets/data/scenarios.json:603-624`: コードはまだ 3 星・150 年 (M21-03 は todo) で一致するが、今の決めは decisions-current「迎撃の塔 (M21-03)」の 2 星 60・105 / 110 年
- 候補:
  - `docs/design/2026-09-19-proposal.html:90`「状態 設計完了・実装着手前」 — README が今のピッチとして指すので誤読される。書き換えずに「2026-09-19 承認時点」の注を足すか、README:92 の説明を「承認時の企画書」に変える

### D20 `docs/design/2026-09-19-scenarios-and-world.md`

- 題: シナリオ層と世界観 — 「滅びの予言と、ムーの欠片」
- 行数 244、commit 4 回、最終 5c80fe3 2026-09-22 docs(design): シナリオ設計書 §6 実装後の見直し(空の舟・迎撃の塔・祈りに応えるな の障壁と実装の連動、信仰の経済、直す順番)
- 有効: 一部有効 — §1 世界観と §3 の 30 本の題・予言・Alive/Dead は未実装 20 本の唯一の仕様として生きている (実装済みは 10 本)。§5 の逆算表は M11〜M19 の plan。§6 (09-22 の見直し) は faith-economy LD に置き換わり、#9 の 3 星は decisions-current の 2 星と食い違う
- 提案: 凍結して残す
- 参照・在りか: issues/ の 59 票が plan: で指す (52 票が #5-システムへの逆算、4 票が文書全体、1 票が #b-…、本文 1)。docs/specs/2026-09-19-ecosystem-sim-design.md・docs/design/2026-10-10-architecture-review.md も指す (内訳は読み手の数え。合計は表の参照の列が正。M9-03・05 の 2 件は無い道を指す切れ)
- 正本へ移す・扱いを決める節:
  - §3 の 30 本の表 (未実装 20 本の予言・開始・Alive/Dead・障害) → シナリオ一覧の正本 (stock) へ。実装済みの 10 本は assets/data/scenarios.json が正
  - §5 の逆算表 (優先と使うシナリオ) → docs/specs/plans/2026-09-23-roadmap.md か issues/README.md の進める順へ。票の plan: をそこへ向け直す
  - §1.3 の生き物の表と §1.5 の文明 7 段階 → 用語集・世界観の正本へ (src/simulation の名前と対応させる)
- 食い違い:
  - `docs/design/2026-09-19-scenarios-and-world.md:223`「実装は祈りを「いつもより困ったとき」だけ(期限 5 年、間隔 3 年)にし」 ↔ `src/simulation/prayer.ts:24`: PRAYER_COOLDOWN = 0 (M10R-02 で間隔を 0 にした)
  - `docs/design/2026-09-19-scenarios-and-world.md:54`「| **夢喰い(ゆめくい)** | 頂点 | 知性を持つ生き物だけを食べる。信仰が低いと現れる」 ↔ `src/simulation/dreamEater.ts:10-16`: 夢喰いは種ではなく状態機械 (DREAM_CAP 0.3・DREAM_EAT 0.2・DREAM_LEAVE 0.5)。assets/data/species.json に夢喰いは無い
  - `docs/design/2026-09-19-scenarios-and-world.md:110`「| 9 | **迎撃の塔** | 星は三度落ちる(60・100・140 年目)」 ↔ `assets/data/scenarios.json:603-624`: コードは 3 星・150 年のままで一致するが、decisions-current の今の決めは 2 星 60・105 / 110 年 (M21-03 todo)
- 候補:
  - `issues/archived/M9-03-faith-effects.md (plan: の行)`「plan: docs/specs/plans/2026-09-19-scenarios-and-world.md#5-システムへの逆算」 — その道に文書は無い。正しくは docs/design/2026-09-19-scenarios-and-world.md
  - `issues/archived/M9-05-faith-playtest.md (plan: の行)`「plan: docs/specs/plans/2026-09-19-scenarios-and-world.md#5-システムへの逆算」 — 同上

### D21 `docs/design/2026-09-20-level-design-tower.md`

- 題: レベルデザイン: 「塔の重さ」— 塔を何で動かすか
- 行数 107、commit 2 回、最終 7bada9d 2026-09-21 feat(sim): 塔の重さ v2 を燃料・炎蜥蜴・鐘樹のキーアイテムで作り直し校正(M8-05 v2)
- 有効: 一部有効 — §8 の仕組み (蓄え・負債・火口 3223・予算 噴火 24/放流 4/年収 12) は scenarios.json の tower と civilizationFuel.ts に一致。鐘樹の係数と炎蜥蜴の気温門は M8 v2・M10R-08 で変わった
- 提案: 凍結して残す
- 参照・在りか: src/simulation/civilizationFuel.ts:6 のコメントが §3.1/§6-A を指す
- 正本へ移す・扱いを決める節:
  - §8 の仕組みと数 (FUEL_NEED・HEAT_FUEL 0.8・TIMBER_RATE 0.3・火口の置き方・予算) → decisions-current に「塔の重さ」の節を作り、check の印で civilizationFuel.ts:14-23 と scenarios.json の tower に縛る
- 食い違い:
  - `docs/design/2026-09-20-level-design-tower.md:37`「肉食。`tempRange: [30, 80]` で、噴火後の熱いセルだけで生き」 ↔ `assets/data/species.json:143-146,160`: firelizard の tempRange は [-10, 80]、門は気温でなく minHeat 1.0 (§7 の捨てた案に書いてあるが §3.2 は直っていない)
  - `docs/design/2026-09-20-level-design-tower.md:42`「植物。成長は森の 1/3、死亡率は 1/3(**放流が定着する**)」 ↔ `assets/data/species.json:25-26,166-167`: 森は growthRate 0.015・mortality 0.01、鐘樹は 0.0025・0.0005 (M10R-08)。1/3 ではない
  - `docs/design/2026-09-20-level-design-tower.md:91`「0.002 にして植えた所の周りに留める」 ↔ `assets/data/species.json:176`: belltree の diffusion は 0 (M10R-08、faith-economy LD §9.4)

### D22 `docs/design/2026-09-21-level-design-faith.md`

- 題: レベルデザイン: 「祈りに応えるな」「霊脈枯れ(簡易版)」— 信仰を何で動かすか
- 行数 198、commit 5 回、最終 d33de56 2026-09-22 docs(issues): M9-04 done、設計書 §4.20/§6 と LD §8.3
- 有効: 一部有効 — 霊脈枯れ (1770・12 年ごとの狼・止めよ 0.6・生気の器) と §8 の発生条件は今も正。祈りに応えるなの集落・狼の間隔・祈りの間隔・減衰は faith-economy LD で作り直され、§3〜§5 の多くは古い
- 提案: 凍結して残す
- 参照・在りか: src/simulation/unrest.ts:3・edict.ts:3・vein.ts:3 のコメントが §3.2〜§3.4 を指す
- 正本へ移す・扱いを決める節:
  - §8 の文明の自然発生条件 (地域の安定・輝石の有無・相対の植生・EMERGE_STICKY) → 本体の仕様 (docs/specs/2026-09-19-ecosystem-sim-design.md の後継か decisions-current) へ
  - §9 承認事項 2〜3 (霊脈は開始比の枯渇、霊脈枯れは石+薪) → decisions-current の「霊脈枯れ」の節へ
- 食い違い:
  - `docs/design/2026-09-21-level-design-faith.md:49`「同時に 1 つ、期限 5 年、解決後は 3 年は次が出ない。」 ↔ `src/simulation/prayer.ts:24`: PRAYER_COOLDOWN = 0
  - `docs/design/2026-09-21-level-design-faith.md:102`「| 祈りに応えるな(輝石が無く歌のまま) | 2787 | 6.6 | 0 / 0 | 0.20 |」 ↔ `assets/data/scenarios.json:416`: no-answer の home は 2063 (M10R-07)
  - `docs/design/2026-09-21-level-design-faith.md:133`「FAITH_DECAY 0.03/年」 ↔ `src/simulation/faith.ts:20`: FAITH_DECAY = 0.01 (§8.2 で 1%/年に直したと書くが §5 の初期値の行は残る)

### D23 `docs/design/2026-09-22-level-design-devices.md`

- 題: レベルデザイン: 「迎撃の塔」「空の舟」— 回避装置を何で買わせるか
- 行数 214、commit 6 回、最終 d2c4de9 2026-09-22 fix(civ): 星は掘るのをやめない(M10): 工事は備蓄が満ちても続け、量は塔の採掘量に揃える(霊脈枯れの苔だけが星で助かる退行を直す
- 有効: 一部有効 — §3.1 気象塔・§3.2 工事・§8.1 星の門 (STAR_RADIUS 12・STAR_FAITH 0.8)・SHIP_NEED 120 は今も正。空の舟の薪 800・SHIP_CUT の割合・迎撃の脈 0.62 は faith-economy LD で置き換わり、迎撃の 3 星は M21-03 で 2 星に決まった
- 提案: 凍結して残す
- 参照・在りか: src/simulation/ship.ts:5・works.ts:5・weatherTower.ts:4・civilizationLoad.ts:41 のコメントが §3.1〜§3.3・§8.1 を指す
- 正本へ移す・扱いを決める節:
  - §8.1 星の門 (半径 12 の民・信仰 0.8) と §3.1 気象塔の門 → decisions-current に「回避装置」の節を作り civilizationLoad.ts:45,51 に check の印で縛る
- 食い違い:
  - `docs/design/2026-09-22-level-design-devices.md:179`「**脈は薄く**(`start.crystalScale` 0.62、主脈 29.7 → 18.4)」 ↔ `assets/data/scenarios.json:600`: intercept-tower の crystalScale は 1.0 (M10R-05 で戻した)
  - `docs/design/2026-09-22-level-design-devices.md:212`「集落 2787、沈没 0.0006/年、薪の蓄え 800。」 ↔ `assets/data/scenarios.json:788`: sky-ship の fuelStock は 0 (M10R-08 の民の林)
  - `docs/design/2026-09-22-level-design-devices.md:61`「着工後は毎年、材 × `SHIP_CUT` を伐って進みに積む」 ↔ `src/simulation/ship.ts:31`: SHIP_CUT_PER_YEAR = 6 の一定量 (割合ではない)

### D24 `docs/design/2026-09-22-level-design-faith-economy.md`

- 題: レベルデザイン: 信仰の経済の立て直し(祈りに応えるな・空の舟・迎撃の塔)
- 行数 414、commit 13 回、最終 25b7f59 2026-10-11 docs: 古い置き場の参照に今の置き場を添える (ユーザーの承認 2026-10-11)
- 有効: 一部有効 — §8.9〜§8.10・§9.4〜§9.5 の結論 (若い信仰の記憶・2063・北の谷 1366・8 年ごと・鐘樹 0.0025/0.0005/0・舟 6/年・民の林) は今のコードと一致する唯一の文章。だが §3〜§4 の初案 (2787・4 年ごと・SHIP_CUT 0.3) が同じ文書に残り、§8.11 は迎撃の作り直しを M21-03 に送った
- 提案: 凍結して残す
- 参照・在りか: src/simulation/dreamEater.ts:4 のコメントが §3.3 を指す
- 正本へ移す・扱いを決める節:
  - §9.1〜§9.5 の追加判断の結論 (FAITH_CAP_*・FAITH_YOUNG_STAGE・夢喰いの閾値・舟か塔か・民の林・祈りに応えるなの谷の波) → decisions-current に「祈りに応えるな」「空の舟」の節を作り、faith.ts:39-50・dreamEater.ts:10-16・ship.ts:31-37・scenarios.json の no-answer/sky-ship に check の印で縛る。13 回の書き足しは止める
- 食い違い:
  - `docs/design/2026-09-22-level-design-faith-economy.md:80`「### 4.1 祈りに応えるな(歌、2787、信仰 0.5、狼 4 年ごと)」 ↔ `assets/data/scenarios.json:416,425`: no-answer は home 2063、狼は everyYears 8 (§8.10・§9.5 の結論)
  - `docs/design/2026-09-22-level-design-faith-economy.md:68`「**舟が先に伐り(SHIP_CUT 0.3)、塔はその残りから燃料を取る**」 ↔ `src/simulation/ship.ts:31`: SHIP_CUT_PER_YEAR = 6 の一定量 (§9.4)
- 候補:
  - `docs/design/2026-09-22-level-design-faith-economy.md:393`「### 8.8 空の舟の机上検証(2026-09-23、§9.3 の判断材料)」 — §9.3 と §9.4 の間に §8.8 が差し込まれ、節の順が崩れている (書き足しの跡)。凍結の前に目次の注で読み順を示すか、そのまま凍結する

### D25 `docs/design/2026-09-23-observation-view-design.md`

- 題: 観察画面(空の舟)の設計 — M22-00
- 行数 161、commit 5 回、最終 2e76f19 2026-10-12 docs(issues): M21-08・M22-00 を審査台の合格で done (M22-00 の設計書に承認日時 2026-10-12 
- 有効: 一部有効 — §3 個体層・§6 場面・§7 カメラ・§8 予算・§12 の実装の決めは src/observe と一致 (承認 2026-10-12)。§2 のファイル構成は M27-04 の分割で変わり、空の舟に限る前提は M19-18 で外れた
- 提案: 凍結して残す
- 参照・在りか: src/observe/area.ts:2・agents.ts:2・population.ts:2・scenes.ts:2・director.ts:2 のコメントが §1〜§7 を指す。issues の M22 票も
- 正本へ移す・扱いを決める節:
  - §8 の描画予算 (三角形 150 万・draw call 200・60fps) → docs/architecture/fitness-functions.md FF-23 に既にある (移し済み)
  - §2 の構成 → docs/architecture/overview.md §7 (観察画面の部品) が今の正。ポインタを足す
- 食い違い:
  - `docs/design/2026-09-23-observation-view-design.md:39`「ObservationView.ts  Three.js の組み立て」 ↔ `src/observe/entry.ts:91`: ObservationView.ts は無く、createObservationView は src/observe/view.ts (165 行) と src/observe/view/ に分かれている (M27-04)
  - `docs/design/2026-09-23-observation-view-design.md:40`「assets.ts        GLB の読み込みと LOD」 ↔ `src/observe/render/assets.ts`: src/observe/render/ の下にある (描画の部品は render/ に 25 ファイル)
  - `docs/design/2026-09-23-observation-view-design.md:73`「`role = folk` は集落の支え半径 8 の中の月鹿」 ↔ `src/observe/view/agentLayer.ts:38`: folkRuleFor(…, 3) で半径 3 (同じ文書の §12 が直しているが §3 は残る)

### D26 `docs/design/2026-09-23-observation-view.md`

- 題: 観察画面(空の舟)— 方向性の決定(2026-09-23、ユーザーとの質疑)
- 行数 103、commit 10 回、最終 18bbff2 2026-09-24 docs: 審査台(M22)への判断を各チケットの残りと決定の文書に写す
- 有効: 一部有効 — 決定 1〜12 (体験の芯・見るだけ・実時間・絵画的写実・死の描写・忠実さ) と「動物側の世界観を優先」は今も正。後半は試作 1〜3・審査台の判断を 6 回書き足した判断の記録で、対象を空の舟に限る 0a は M19-18 で外れた
- 提案: 凍結して残す
- 参照・在りか: issues の M22-00〜M22-11 の 11 票 (親が grep で数え直した)が plan: で指す。auto-memory「衝突したら動物の世界観を優先」も
- 正本へ移す・扱いを決める節:
  - 決定事項の表 (0b〜12) と申し送り「動物側の世界観を優先」 → 観察画面の今の決め (decisions-current の節か assets/textures/board/README.md) へ
  - 試作・審査台の判断の節 (L45〜96) → 各 M22/M23 票の作業ログに既に写してある (18bbff2)。ここへの書き足しは止める
- 食い違い:
  - `docs/design/2026-09-23-observation-view.md:11`「| 0a | 対象シナリオ | **空の舟**」 ↔ `src/observe/entry.ts:11`: world の snapshot があればいつでも入れ、集落が無ければ島の真ん中を中心にする (M19-18)。空の舟に限らない

### D27 `docs/design/2026-09-24-observe-perf.md`

- 題: 観察画面の軽量化(M23)の調べと試算
- 行数 80、commit 5 回、最終 9c309ec 2026-10-02 chore(comments): 試験の口の旧名 (__sceneSelection・__observe*) を __probe.scene.
- 有効: 無効 (失効) — M23-01〜09 は実装済み (cull.ts・impostor.ts・shadowOnly.ts・dynamicResolution.ts)。表の「状態」の列は 09-24 の時点で、今は違う。審査台の判断 (09 小屋は不合格) は M23-09 票に写してある
- 提案: 凍結して残す
- 参照・在りか: src/observe/render/cull.ts:4・impostor.ts:28・shadowOnly.ts:4・bloom.ts:5・dynamicResolution.ts:2 のコメントが指す。issues/M23-03・M23-10 の plan:
- 正本へ移す・扱いを決める節:
  - 「計測の道具」の節 (__probe.observe.breakdown の区分の意味) → docs/architecture/fitness-functions.md FF-23 か観察画面の運用文書へ
- 食い違い:
  - `docs/design/2026-09-24-observe-perf.md:39`「海が 1 枚で 115 千。3 km 四方を 240 × 240 に割っており」 ↔ `src/observe/render/water.ts:345-346`: M23-03 のやり直しで、地面の窓は 4.2 m 前後の格子、その外は外ほど粗い輪 (RINGS、:167) にした
  - `docs/design/2026-09-24-observe-perf.md:47`「| インスタンスごとの視錐台カリング … | 未実装」 ↔ `src/observe/render/cull.ts:4`: インスタンスごとの視錐台カリングがある (M23-02)

### D28 `docs/design/2026-09-26-cloudflare-architecture.md`

- 題: 公開のアーキテクチャ(Cloudflare 無料枠、2026-09-26)
- 行数 471、commit 11 回、最終 dd08879 2026-10-18 docs(specs): 今の決定事項を 2026-10-18 の文書に起こし、09-19・09-26 に superseded のポインタを
- 有効: 一部有効 — 結論・ドライバ・§5.1 の決め事・§5.3 やらないこと・§6.2・§6.3 は worker/ と一致。§5.2 の型の素描と §6.1 の上限の数は実装 (M19-08・M26-21) と違い、§11 の実装のずれの表と M27-06 のポインタ・版の段落が後から足されている
- 提案: 凍結して残す
- 参照・在りか: src/chronicle/chronicle.ts:6・src/harbor/contract.ts:6・src/core/parse.ts:2・src/scenario/stepByYear.ts:7・worker/migrations/0001_harbor.sql:1 のコメント、docs/operations/cloudflare.md:6・cloudflare-deploy.md:3、scripts/check_docs.py の REQUIRED_POINTERS と VERSION_DOC
- 正本へ移す・扱いを決める節:
  - §1.3 の制約の後の「版は 3 つ」の段落 (check_docs.py の VERSION_DOC が 09-26 の文書に縛っている) → ADR 0002 決定 5 か docs/architecture/overview.md へ移し、check_docs の VERSION_DOC を向け直す。日付つきの文書に今の事実を足す形をやめる
  - §6.2 何が尽きたら何が起きるか・§6.3 濫用対策 → docs/operations/cloudflare.md (運用の正本) へ
  - §11 実装で変えたこと → docs/architecture/overview.md §4 (港のコンポーネント) に今の形として
- 食い違い:
  - `docs/design/2026-09-26-cloudflare-architecture.md:344`「上限は仮に、出港 2,000、積荷 5,000、通報 1,000。」 ↔ `worker/src/policy.ts:26,29`: cast_cargo の cap は 3,000、report は 500 (M26-21)。L345 の superseded ポインタは「約 43%」だけを指し、同じ行の上限の数は覆っていない
  - `docs/design/2026-09-26-cloudflare-architecture.md:123`「無料プランで使えるかは docs に記載が無い(要確認)」 ↔ `wrangler.jsonc:34-37`: ratelimits に RATE_WRITE (10/60s)・RATE_READ (120/60s) を構成済み
  - `docs/design/2026-09-26-cloudflare-architecture.md:302`「publish(c: Chronicle, d: Digest): Promise<PublishResult>;」 ↔ `src/harbor/client.ts:50`: publish(p: PublishInput)。flushOutbox も足されている (:52)
- 候補:
  - `issues/M26-20-d1-write-budget-fitness.md:6`「plan: docs/design/2026-09-26-cloudflare-architecture.md#6-運用」 — その見出しは無い (§6 は「無料枠を超えたときと、濫用対策」)。アンカーが切れている
  - `docs/specs/2026-10-18-decisions-current.md:51`「3 つの上限 (出港 2,000・積荷 5,000・通報 1,000) は 09-26 と同じ。」 — 同じ文書の表 (cap_cast_cargo=3000・cap_report=500、改訂 2026-10-28 M26-21) と食い違う。正本の中の古い文 (担当外だが 09-26 との対応の文なので挙げる)

### D29 `docs/design/2026-09-27-scenario-save-url.md`

- 題: URL と手元の状態の対応(M19-17 の設計案)
- 行数 86、commit 3 回、最終 2cd444f 2026-09-28 docs: 古くなった確かめの記述を消す(Hud.ts の新しい島のコメント、設計書 §4 の window.confirm の文)。M21-
- 有効: 一部有効 — §2 の舞台 3 つ・§3 の SlotSave の包み・§4 の操作の表・§5 は src/persist/slotSave.ts と src/app/place.ts に一致。M24 のタイトル画面で素の / と開き直しの行き先が変わった
- 提案: 凍結して残す
- 参照・在りか: src/persist/slotSave.ts:9 のコメントが §3 を指す。issues/M19-17
- 正本へ移す・扱いを決める節:
  - §2 の舞台と URL の表・§4 の操作 × 舞台の表 → src/app/place.ts の表試験 (planOp・bootPlanOf) が今の正。docs/uiux/2026-10-04-title-flow.md と合わせ、舞台の今の決めを 1 か所 (decisions-current か docs/architecture/overview.md §6) に
- 食い違い:
  - `docs/design/2026-09-27-scenario-save-url.md:62`「| 開き直す | `auto` から続き | 置き場から続き。」 ↔ `src/persist/tabMarks.ts:2`: タブを閉じて次に開いたときはタイトルから (M24-01)。続きはタイトルから選ぶ
  - `docs/design/2026-09-27-scenario-save-url.md:27`「| 自由モード | `/`(`scenario` なし)」 ↔ `src/app/place.ts:196-207`: 素の / は、このタブで舞台に入った印が無ければタイトルを出す (kind: title)

### D30 `docs/design/2026-09-29-acceptance-redesign.md`

- 題: 受入の確かめの再設計: jsonl の正本・人の 1 周を 2 行に・残りはロジックの試験へ (M21-06〜08)
- 行数 120、commit 2 回、最終 b427b74 2026-09-30 docs(adr): 0001 受入の見た目・読みやすさ・手触りを検査・基準画・LLM の採点で機械に移す (Proposed)
- 有効: 一部有効 — §2 の正本の形 (scenarios.jsonl・id の採番・mode・covered_by・退役) と §5 の関数は今も正 (scripts/acceptance.py・src/app/place.ts)。§3〜§4 の行の数と人の行は 09-29 の時点で、ADR 0001 の状態も古い
- 提案: 凍結して残す
- 参照・在りか: docs/operations/acceptance.md:21 が設計として指す。issues/M21-06・07・08 の plan:
- 正本へ移す・扱いを決める節:
  - §2.1 正本の行の決まり (鍵・id・mode・steps・covered_by・human の鍵・15 分) → docs/operations/acceptance.md へ (scripts/acceptance.py の検査が実体)
- 食い違い:
  - `docs/design/2026-09-29-acceptance-redesign.md:48`「人の行は 4 つ、auto は 34、退役 1。」 ↔ `docs/acceptance/scenarios.jsonl`: 今はシナリオの行 52 (auto active 47・human active 3・退役 2)
  - `docs/design/2026-09-29-acceptance-redesign.md:120`「docs/decisions/0001-acceptance-automation.md (2026-09-30、Proposed) にある。」 ↔ `docs/decisions/0001-acceptance-automation.md:2`: status: accepted

### D31 `docs/design/2026-10-10-architecture-review.md`

- 題: アーキテクチャレビュー(2026-10-10): ドライバ・ビューポイント・パースペクティブ・C4
- 行数 480、commit 2 回、最終 25b7f59 2026-10-11 docs: 古い置き場の参照に今の置き場を添える (ユーザーの承認 2026-10-11)
- 有効: 一部有効 — §0 の 3 つの品質特性と §2 のドライバは今も正。§5.8 の循環と R1・R2 は M27-01〜05 で解消 (ADR 0002:11)、R3 は decisions-current で済み。R5〜R8 は票が無く宙に浮いている。今の構造の正は docs/architecture/overview.md
- 提案: 凍結して残す
- 参照・在りか: docs/architecture/overview.md:4 が評価の置き場として指す。issues/M27-01〜06 の plan:
- 正本へ移す・扱いを決める節:
  - §6 の R5 (mod.py に stats を足す)・R6 (tests/integration は .gitkeep だけ) → 票に起こす。R7・R8 は試験の有無を確かめていないので、票にするかを親が判断
  - §2 のドライバ (B・F・Q・C・P) → docs/architecture/overview.md か ADR 0002 の前提として stock へ
- 食い違い:
  - `docs/design/2026-10-10-architecture-review.md:25`「`src/main.ts` は設計書で「配線のみ」だが 623 行・閉包 35 個」 ↔ `src/main.ts`: 今は 257 行 (M27-03)。src/observe/view.ts も 835 行の関数から 165 行のファイルへ (M27-04)
  - `docs/design/2026-10-10-architecture-review.md:46`「`src/harbor/chronicle.ts`(型)、`src/chronicle`(記録・再生)」 ↔ `src/chronicle/chronicle.ts`: 年代記の型は src/chronicle/chronicle.ts へ移った (M27-02)。src/harbor/ に chronicle.ts は無い
  - `docs/design/2026-10-10-architecture-review.md:388-452`「§5.8 の依存図の循環 4 つ (chronicle ↔ harbor・harbor ↔ persist・harbor ↔ ui・app ↔ ui)」 ↔ `layering.config.mjs (ALLOWED)`: 層の許可の表で循環を禁じている (docs/architecture/overview.md §5.1・§5.2 が今の実測)

### D32 `docs/design/2026-10-28-level-design-intercept-2.md`

- 題: レベルデザイン: 迎撃の塔の作り直し(見える星)
- 行数 316、commit 3 回、最終 b3cf33e 2026-10-28 docs(design): M21-03 の決め (K1・W 12・灯に焚く・2 星 60・105 / 110 年) を decisions-
- 有効: 一部有効 — §3 K1・§5 縮約モデル・§10 の走査は M21-03 (todo) の根拠として生きている。決め (K1・W 12・灯に焚く・2 星 60・105 / 110 年・2 回) は decisions-current に移し済み。§6 の行列は 150 年・3 回のまま (承認で直さないと決めた 2-7)。コードはまだ 3 星・150 年
- 提案: 残す
- 参照・在りか: scripts/check_docs.py の REQUIRED_POINTERS、証跡 .claude/verify/20261028-0857-m21-03-ld/
- 正本へ移す・扱いを決める節:
  - §6 の判定行列と §7 の実装の順 → M21-03 の実装中は票と合わせて使う。実装が済んだら凍結し、行列は tests/slow の題が正になる
- 食い違い:
  - `docs/design/2026-10-28-level-design-intercept-2.md:133`「| 想定解 1 | 儀式 + 星で止めよ + 窓で再開 + 撃てば止めよ | alive | 150 | 星を 3 回砕いた |」 ↔ `assets/data/scenarios.json:603,659`: コードは years 150・intercepted min 3 で今は一致するが、decisions-current の決めは 110 年・2 回。M21-03 の実装で両方が変わる
  - `docs/design/2026-10-28-level-design-intercept-2.md:67`「3. 60〜87 年: 空は暗い。」 ↔ `src/simulation/works.ts`: 窓 (K1) はまだコードに無い (star_sign の grep は 0 件)。文書の中でも、2 つ目が 93 年に見えるなら暗いのは 60〜92 年で、§4 を 2 星に直したときの取り残し
- 候補:
  - `docs/design/2026-10-28-level-design-intercept-2.md:67`「3. 60〜87 年: 空は暗い。脈は止めた分だけ残る。狼の祈りが来れば応えてよい。」 — 同じ §4 の 4 行目を 2 星 (93 年に見える) に直したが、この行は 3 星のときの 87 年のまま。直すか、§4 全体を書いた時点のままに戻して decisions-current に任せる

### D33 `docs/design/qa/observe/deer.md`

- 題: 観察画面の月鹿(M22-02 デフォルメ試作)
- 行数 527、commit 8 回、最終 0fffb7d 2026-09-26 feat(observe): 月鹿の手直し 7 — 鼻の下端を基準に顎の下端まで 1 つの倍率で縦に伸ばす(1.3・1.6・1.9 倍の 3 
- 有効: 一部有効 — 末尾の「手直し 7」の数 (近 3,891・雌 3,391・群れ 866・遠 210、骨 28、クリップ 5、FACE7_K 1.3 は tools/blender/observe_deer.py:746 と一致) は今の GLB と合う。冒頭の「実測」「骨」「材質」は手直し前の値のまま腐っている
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §出力と作り直し方 (組み立て・撮影・比較画・検証のコマンド) は今も正。凍結の前に冒頭へ「今の値は末尾の手直し 7」と 1 行足すか、observation-view の設計書 §8 か新しい正本へ写す
- 食い違い:
  - `docs/design/qa/observe/deer.md:27`「| `deer`(近 LOD、雄) | **3,166** | 2,299 |」 ↔ `assets/models/observe/deer.glb (glTF の node deer)`: 近 LOD は 3,891 三角形 (雌 deer_doe 3,391・deer_lod1 866・deer_far 210)。同じ文書の 496 行目は 3,891 で正しい
- 候補:
  - `docs/design/qa/observe/deer.md:23 (## 実測 の直下)`「(足す 1 行) 「この表は 2026-09-24 の値。今の値は末尾の「手直し 7」の実測」」 — 冒頭の表を今の値と読む誤りを防ぐ。原文は書き換えない

### D34 `docs/design/qa/observe/environment.md`

- 題: 観察画面の環境アセット(M22-02 デフォルメ試作)
- 行数 649、commit 14 回、最終 cb97bb8 2026-10-17 feat(observe): 株の縁の裂けに 1 段下の尺度の荒れ・切れ込み・細い突起を足す (M22-11 3 回目)
- 有効: 一部有効 — 追記の節 (M22-11 の 2026-10-17 まで) は今の作りに近い。冒頭の「作り方と確認」「既知の課題」は試作時のままで、UV なし・遠景 LOD なしは後の追記と M23-09 で解消済み
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §既知の課題 (113 行〜) は大半が解消済み。凍結の前に「既知の課題は追記で一部解消。今の形は observe の各 .ts と GLB」と 1 行足す
- 食い違い:
  - `docs/design/qa/observe/environment.md:115`「UV を書き出していません(`export_texcoords=False`)。」 ↔ `assets/models/observe/belltree.glb・flora.glb、tools/blender/observe_kit.py:406`: belltree.glb・flora.glb は TEXCOORD_0 と画像 1 枚を持つ。observe_kit.py は export_texcoords=texcoords で書き出す (settlement.glb・ship.glb は UV 無しのまま)
  - `docs/design/qa/observe/environment.md:121`「LOD は成木だけです。小屋・船台などの遠景用 LOD はありません」 ↔ `src/observe/settlementLayout.ts:20,35`: M23-09 で settlement.glb に hut_lod1・slipway_lod1・lantern_post_lod1 ほか計 7 つの遠距離版が入り、距離で差し替える
- 候補:
  - `docs/design/qa/observe/environment.md:113 (## 既知の課題 の直下)`「(足す 1 行) 「UV (葉のカード・木の肌) と集落の遠距離版は、後の追記・M23-09 で解消」」 — 解消済みの課題が開いているように読める

### D35 `docs/design/qa/observe/keyitems.md`

- 題: 観察画面のキーアイテムと残りの植物(M22-06 舟・集落の追加、M22-03 植物)
- 行数 244、commit 6 回、最終 44f4ce4 2026-09-24 docs(qa): 木の磨き上げの記録 — 比較画・予算・日の抜ける割合・自己評価、三角形の表を更新、M22-03 の作業ログ
- 有効: 一部有効 — §舟の GLB の約束の数 (SLIP_TOP 1.36・BLOCK_DROP 0.5・SLIP_TILT atan(1.5/27)・HOVER 11、段ごとに 1 ノード) は src/observe/render/ship.ts:25-28 と一致し、ship.ts:7 がこの節を「アセットの約束」として引く。「配線はまだ」は古い
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §舟の GLB の約束 (35〜50 行) → コードが引く正本。凍結の前に docs/specs か observation-view の設計書 §8 へ移し、src/observe/render/ship.ts:7 のポインタを移し先へ向ける (コメントの書き換えは承認制)
- 食い違い:
  - `docs/design/qa/observe/keyitems.md:38`「配線はまだしていません。」 ↔ `src/observe/render/ship.ts:11-20,76`: NODE (keel・ribs・planks・mast・sails・done) と FLYING を shipStage(ship.progress) で選んで 1 つだけ見せる配線がある
- 候補:
  - `docs/design/qa/observe/keyitems.md:38`「配線はまだしていません。」 — src/observe/render/ship.ts で配線済み。書き換えでなく直下にポインタ 1 行 (「M22-06 で配線。段の閾値は src/observe/scenes.ts の SHIP_STAGE_AT」) を足す候補

### D36 `docs/design/qa/observe/rabbit.md`

- 題: 観察画面の土兎(M22-05)
- 行数 595、commit 9 回、最終 83cf98c 2026-09-26 feat(observe): 土兎の手直し 8 — 群れ LOD の首を 8 角にして首輪を 12 区間で一周させ、首輪の外の柱を消す(M22
- 有効: 一部有効 — 末尾の手直し 7 の数 (近 3,212) は今の GLB と一致。冒頭の実測 (近 1,504) は最初の版のまま
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §出力と作り直し方は今も正 (observe_rabbit.py・observe_creature_*.py)
- 食い違い:
  - `docs/design/qa/observe/rabbit.md:29`「| `rabbit`(近 LOD) | **1,504** | 1,126 |」 ↔ `assets/models/observe/rabbit.glb (glTF の node rabbit)`: 近 LOD 3,212・rabbit_lod1 658・rabbit_far 112 三角形、骨 24、クリップ 6。同じ文書の 568 行目は 3,212
- 候補:
  - `docs/design/qa/observe/rabbit.md:25 (## 実測 の直下)`「(足す 1 行) 「最初の版の値。今は末尾の手直し 7」」 — 冒頭の表が今の値に見える

### D37 `docs/design/qa/observe/session-2026-10.md`

- 題: 観察セッションの材料(M22-09、2026-10-20)
- 行数 114、commit 1 回、最終 7daf697 2026-10-20 docs(qa): 観察セッション 2026-10 の材料 (4 場面の画・stats・OBS-002 の judge・bench、直しなし。
- 有効: 有効 — M22-09 (status: todo) の層 A・B の材料。層 C の「所感」の欄 (108 行〜) はユーザーの記入待ちで空
- 提案: 残す
- 正本へ移す・扱いを決める節:
  - §所感(層 C) はユーザーが書く欄。書かれて M22-09 が done になったら凍結
- 食い違い: 無し (読み手が突き合わせて見つからなかった)

### D38 `docs/design/qa/observe/wolf.md`

- 題: 観察画面の灰狼(M22-05)
- 行数 489、commit 7 回、最終 c0d641b 2026-10-12 feat(observe): 灰狼の 6 回目 — 頬・首の横・胸を一続きの淡い域と塊の裾にし、尾を尻の背の線から出す(M22-05)
- 有効: 一部有効 — 末尾の 6 回目 (近 6,464・群れ 1,004・遠 179) は GLB と一致。冒頭の実測 (2,639) は 1 回目のまま
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §出力と作り直し方は今も正
- 食い違い:
  - `docs/design/qa/observe/wolf.md:33`「| `wolf`(近 LOD) | **2,639** | 1,689 |」 ↔ `assets/models/observe/wolf.glb (glTF の node wolf)`: 近 LOD 6,464・wolf_lod1 1,004・wolf_far 179 三角形、骨 29、クリップ 6。同じ文書の 461 行目は 6,464
- 候補:
  - `docs/design/qa/observe/wolf.md:29 (## 実測 の直下)`「(足す 1 行) 「1 回目の値。今は末尾の 6 回目」」 — 冒頭の表が今の値に見える

### D39 `docs/design/qa/deer-acceptance-criteria.md`

- 題: 光角鹿 (deer) 3D モデル QA 受入基準
- 行数 60、commit 2 回、最終 ba31f2f 2026-09-20 model: 光角鹿 (deer) の角・パネル・脚・胴・頭を作り直し、パネル境界を直線化 (T1/T4/T12b)
- 有効: 無効 (失効) — 対象の assets/models/deer.glb は観察画面の前の 2D 期の模型で、配らず画面も読まない (assets/.assetsignore:8-9)。今の鹿は assets/models/observe/deer.glb (M22-02/05) で受入も別
- 提案: 凍結して残す
- 食い違い:
  - `docs/design/qa/deer-acceptance-criteria.md:3`「対象: `assets/models/deer.glb` / `assets/models/deer.blend`」 ↔ `assets/.assetsignore:8-9`: 「観察画面の前の、2D の頃の模型 … 観察画面は models/observe/ を読む」として /models/*.glb を配らない。src/observe/view.ts:59 が読むのは /models/observe/deer.glb
- 候補:
  - `docs/design/qa/deer-acceptance-criteria.md:1 の下`「(足す 1 行) 「失効: 観察画面の月鹿 (assets/models/observe/deer.glb、docs/design/qa/observe/deer.md) に置き換わった。この模型は配らない (assets/.assetsignore)」」 — 日付つき文書は書き換えず、今を指すポインタの行を足す決まり (decisions-current の更新の約束) に合わせる

### D40 `docs/design/qa/deer-remaining-issues.md`

- 題: 光角鹿 (deer) 3D モデル 残課題
- 行数 42、commit 2 回、最終 ba31f2f 2026-09-20 model: 光角鹿 (deer) の角・パネル・脚・胴・頭を作り直し、パネル境界を直線化 (T1/T4/T12b)
- 有効: 無効 (失効) — 残課題 #1〜#6 は票にならず、観察画面の鹿の作り直し (M22-02・M22-05 done) で対象ごと置き換わった。「中間成果物として利用する」も今は使っていない
- 提案: 凍結して残す
- 食い違い:
  - `docs/design/qa/deer-remaining-issues.md:3`「中間成果物として利用する。」 ↔ `assets/.assetsignore:3`: 「画面が fetch するのは data/** と models/observe/*.glb だけ … 古い模型で、画面は読まない」。src に models/deer.glb を読む所は無い
- 候補:
  - `docs/design/qa/deer-remaining-issues.md:1 の下`「(足す 1 行) 「失効: 残課題は閉じずに観察画面の月鹿 (M22-05) で置き換わった」」 — 残課題が今も開いているように読める

### D41 `docs/design/qa/handoff-T18-merge.md`

- 題: 引き継ぎプロンプト: T18 — 3D モデル制作ブランチのマージ
- 行数 67、commit 2 回、最終 32d52f1 2026-09-20 docs: 参照画像の archive 移動をコミット済みに更新 (残タスク一覧・T18 引き継ぎ)
- 有効: 無効 (失効) — マージは 2026-09-20 に済み (2aa9877、issues/archived/ART-01 が done)。一度きりの指示書
- 提案: 消す
- 失われる情報: マージの前提の事実 (分岐点 b09d573、.gitignore の衝突と解き方、LFS 6 件) と手順
- その在りか: issues/archived/ART-01-merge-concept-art-variants.md (手順の要約・evidence 2aa9877)、docs/design/qa/remaining-tasks.md:75 の T18 行、git 履歴。ブランチ worktree-concept-art-variants も残っている
- 食い違い:
  - `docs/design/qa/handoff-T18-merge.md:47`「`npm run lint` と `npm test` (unit) を実行し」 ↔ `package.json (packageManager)`: packageManager は pnpm@10.28.1、ロックは pnpm-lock.yaml だけ (package-lock.json は無い)
- 候補:
  - `docs/design/qa/handoff-T18-merge.md (全体)`「ファイルごと」 — 済んだ一度きりの指示書。ART-01 の plan: は git show worktree-concept-art-variants:… で旧版を指しているので、消しても参照は切れない

### D42 `docs/design/qa/rabbit-acceptance-criteria.md`

- 題: 土兎 (rabbit) 3D モデル QA 受入基準 (フルセット)
- 行数 78、commit 2 回、最終 efc7551 2026-09-19 model: rabbit.blend をリポジトリ管理に含める (.gitignore の *.blend 除外を解除、文書を修正)
- 有効: 無効 (失効) — 対象の assets/models/rabbit.glb は配らない旧模型。今の兎は assets/models/observe/rabbit.glb (近 LOD 3,212 三角形、骨 24)
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - 「利用ツール」表 (compare_ref.py・tune_colors.py・gen-concept-art.mjs の起動) は verification-workflow.md と重なる。残すなら verification-workflow 側だけでよい
- 食い違い:
  - `docs/design/qa/rabbit-acceptance-criteria.md:25`「三角形数が旧モデル (592) の 3〜5 倍 | 1776〜2960 | 1863」 ↔ `assets/models/observe/rabbit.glb (glTF の node rabbit)`: 画面が読む兎は近 LOD 3,212・群れ 658・遠 112 三角形。1863 の模型 (assets/models/rabbit.glb) は .assetsignore:9 で配らない
- 候補:
  - `docs/design/qa/rabbit-acceptance-criteria.md:1 の下`「(足す 1 行) 「失効: 観察画面の土兎 (docs/design/qa/observe/rabbit.md) に置き換わった」」 — 今の受入と取り違えないため

### D43 `docs/design/qa/rabbit-remaining-issues.md`

- 題: 土兎 (rabbit) 3D モデル 残課題
- 行数 73、commit 3 回、最終 8f8aabb 2026-09-20 docs: 残タスク一覧を進捗サマリー・完了表・ブランチ状況込みで更新、rabbit 残課題にタスク ID を紐付け
- 有効: 無効 (失効) — #1〜#8 は票 (T6・T7・T13 など) にならず、M22-05 の作り直しで対象ごと消えた。#7 の「ゲームのレンダラで同じ補正」も、観察画面は材質をトゥーンに差し替えるので前提が無い
- 提案: 凍結して残す
- 食い違い:
  - `docs/design/qa/rabbit-remaining-issues.md:58`「対処案: ゲームのレンダラで同じ手順 (撮影→ΔE→比率補正) を回す。」 ↔ `src/observe/render/assets.ts:8,16`: 観察画面は GLB の材質を読み込み時にトゥーン (toonFromStandard) に置き換える。Blender の材質色を合わせ込む前提が無い
- 候補:
  - `docs/design/qa/rabbit-remaining-issues.md:1 の下`「(足す 1 行) 「失効: 残課題は閉じずに観察画面の土兎 (M22-05) で置き換わった」」 — 開いた残課題に見える

### D44 `docs/design/qa/remaining-tasks.md`

- 題: 3D モデル制作 残タスク一覧 (rabbit / deer / wolf 横断)
- 行数 91、commit 7 回、最終 e526110 2026-09-20 docs: T18 完了(feat/m8 へのマージ 887cf57)、ART-01 done
- 有効: 無効 (失効) — 完了は T18 だけ。P2・P3 の T1b・T5b・T5c・T6・T7・T8・T10〜T17 は票にならず (issues の grep は ART-01 だけ)、観察画面の作り直しで失効
- 提案: 凍結して残す
- 食い違い:
  - `docs/design/qa/remaining-tasks.md:4`「各モデルは中間成果物として利用可能。」 ↔ `assets/.assetsignore:8-9`: models/ 直下の glb は「観察画面の前の、2D の頃の模型」として配らない。画面の鹿・狼・兎は models/observe/*.glb (src/observe/view.ts:59-64)
- 候補:
  - `docs/design/qa/remaining-tasks.md:3`「2026-09-20 11:30 時点。」 — 直後に 1 行足す候補: 「失効: T18 のほかは票にせず、M22 (観察画面) の作り直しで不要になった」。原文は残す

### D45 `docs/design/qa/verification-workflow.md`

- 題: 3D モデル検証ワークフロー (rabbit / deer / wolf 共通)
- 行数 74、commit 5 回、最終 c297924 2026-09-20 tools: compare_ref.py に行・列ごとのクラス区間 (classrows.txt) を出力 (T15)
- 有効: 一部有効 — 道具 (tools/blender/compare_ref.py・tune_colors.py・creature_parts.py) は今もあり手順は回る。ただし対象の旧模型は配らず、観察画面の動物は observe_creature_{render,sheet,check}.py の別の流れで検証している
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §カメラと正規化枠・§受入基準のテンプレートの指標 (IoU・ΔE76・平行投影) は、ADR 0001 の表 (docs/decisions/0001-acceptance-automation.md:69「M6 の tools/blender/compare_ref.py の ΔE と IoU の考え方」) が引く方法の説明。凍結のままで足りる
- 食い違い:
  - `docs/design/qa/verification-workflow.md:13`「`tools/blender/<creature>.py` | モデル生成スクリプト (rabbit / deer / wolf)」 ↔ `src/observe/view.ts:59-64`: 画面が読むのは observe_deer.py・observe_wolf.py・observe_rabbit.py が書く assets/models/observe/*.glb。<creature>.py の出力 (assets/models/*.glb) は配らない
- 候補:
  - `docs/design/qa/verification-workflow.md:49-52`「# 5. メッシュ検査 … # 4. 証跡を …」 — 番号が 5 → 4 の逆順。凍結なら直さず、直すなら承認制の範囲

### D46 `docs/design/qa/wolf-acceptance-criteria.md`

- 題: 岩狼 (wolf) 3D モデル QA 受入基準
- 行数 60、commit 2 回、最終 cdbb913 2026-09-20 model: 岩狼 (wolf) の頭・比率・縁線を作り直し、評価に平行投影モードを追加 (T2/T3/T5/T12)
- 有効: 無効 (失効) — 対象の assets/models/wolf.glb (2,182 三角形) は配らない旧模型。今の狼は observe/wolf.glb (6 回の作り直し、M22-05)
- 提案: 凍結して残す
- 食い違い:
  - `docs/design/qa/wolf-acceptance-criteria.md:22`「三角形数 | 1500〜3000 | 2182 | PASS」 ↔ `assets/models/observe/wolf.glb (glTF の node wolf)`: 画面が読む狼は近 LOD 6,464・群れ 1,004・遠 179 三角形、骨 29。2182 の模型は .assetsignore:9 で配らない
- 候補:
  - `docs/design/qa/wolf-acceptance-criteria.md:1 の下`「(足す 1 行) 「失効: 観察画面の灰狼 (docs/design/qa/observe/wolf.md) に置き換わった」」 — 今の受入と取り違えないため

### D47 `docs/design/qa/wolf-remaining-issues.md`

- 題: 岩狼 (wolf) 3D モデル 残課題
- 行数 38、commit 2 回、最終 cdbb913 2026-09-20 model: 岩狼 (wolf) の頭・比率・縁線を作り直し、評価に平行投影モードを追加 (T2/T3/T5/T12)
- 有効: 無効 (失効) — #1〜#6 は票にならず、灰狼の作り直し (M22-05) で置き換わった
- 提案: 凍結して残す
- 食い違い:
  - `docs/design/qa/wolf-remaining-issues.md:3`「中間成果物として利用する。」 ↔ `assets/.assetsignore:8-9`: /models/*.glb は配らない。src に models/wolf.glb を読む所は無い (src/observe/view.ts:63 が読むのは /models/observe/wolf.glb)
- 候補:
  - `docs/design/qa/wolf-remaining-issues.md:1 の下`「(足す 1 行) 「失効: 観察画面の灰狼 (M22-05) で置き換わった」」 — 開いた残課題に見える

### D48 `docs/decisions/0001-acceptance-automation.md`

- 題: 人が判じている受入の見た目・読みやすさ・手触りを、検査・基準画・LLM の採点で機械に移す
- 行数 294、commit 6 回、最終 6a5b2f8 2026-10-04 feat(m25-12): レビューの指摘 (O9 を肯定の文に・ADR の事実・失効の試験) と票を review に
- 有効: 有効 — 決定 (lens・基準画 0.2/0.02・例外 0.12・claude -p の 3 票・人は TUR-001 の 1 分) は tests/e2e/baseline.ts:9、tests/e2e/lens.ts:203、scenarios.jsonl と一致。chromium-1243 も tests/e2e/baselines/VERSIONS.json と一致
- 提案: 残す
- 食い違い:
  - `docs/decisions/0001-acceptance-automation.md:250`「### 2. 基準画の閾値の測り (`src/tests/probe/fontdrift.spec.ts`)」 ↔ `tools/acceptance-probe/probe-specs/fontdrift.spec.ts`: src/tests/probe は無い。道具は tools/acceptance-probe/ (probe-specs・judge/judge.sh・cmp2.py) に移った。241-243 行が移すと予告しているので誤りではないが、書かれた道はもう無い
- 候補:
  - `docs/decisions/0001-acceptance-automation.md:243 の下`「(足す 1 行) 「移した先: tools/acceptance-probe/probe-specs/・judge/・cmp2.py・contrast.py」」 — 付録 B の各節の道が今は無い。本文は書き換えずポインタを足す
  - `docs/decisions/0001-acceptance-automation.md (末尾)`「(足す) ## 改訂 の節」 — 120 行・180 行の後からの書き足し (M25-12 の例外、段 6 済み) を、0002 と同じく日付つきで記録する

### D49 `docs/decisions/0002-architecture-fence.md`

- 題: 層の向きと大きさを柵で守り、年代記の型の置き場と受け入れた危険を決める
- 行数 47、commit 3 回、最終 5fb8269 2026-10-11 docs(adr): ADR 0002 を M27-04・05 の取り込みに合わせて上書き (ユーザーの承認 2026-10-11)
- 有効: 有効 — 決定 1 (ALLOWED・ENTRY・PACKAGES) は layering.config.mjs と一致。決定 2 の 261 / 218 は architecture.test.ts:126,129 の上限と一致。決定 3 は src/chronicle/chronicle.ts
- 提案: 残す
- 食い違い:
  - `docs/decisions/0002-architecture-fence.md:23`「`main.ts` は 261 行・`boot` は 218 行 (M27-05 の後の値)」 ↔ `src/main.ts (wc -l)`: 257 行。261 は FILE_LINES の上限 (tests/unit/architecture.test.ts:126) で、今の長さではない (ラチェットの内なので害は小さい)

### D50 `docs/architecture/fitness-functions.md`

- 題: 適応度関数の一覧
- 行数 77、commit 7 回、最終 675a1b5 2026-10-28 docs: 審査台 decisions-20261020 の承認を適用 (E2E 21→23 の印、test:slow:table の時間、観
- 有効: 有効 — FF-07 の 261、FF-08 の World.ts 985、FF-09 の boot 218 ほか 11 件は architecture.test.ts:126-140 と一致。FF-18・19 の捨てる順と 7 日 / 30 日は worker/src/policy.ts:7,72-74 と一致。check の中身も package.json の check と合う
- 提案: 残す
- 食い違い: 無し (読み手が突き合わせて見つからなかった)
- 候補:
  - `docs/architecture/fitness-functions.md (表 2 か 4)`「(足す) check:docs・check:d1-writes の行」 — package.json の check に入っている scripts/check_docs.py (decisions-current の数) と check_d1_writes.py (D1 の書きの 90%) が適応度関数の表に無い。削除でなく追記の候補

### D51 `docs/architecture/overview.md`

- 題: アーキテクチャの概観(C4 と層の依存)
- 行数 375、commit 2 回、最終 782f3d7 2026-10-11 docs(issues): M27-05 の作業ログ・受入の証跡と、概観 (overview.md) を 7 段の後の形に更新する
- 有効: 一部有効 — §5.1 の表は layering.config.mjs の ALLOWED・PACKAGES と行ごとに一致。§5.3 の 261・985・12 件は tests/unit/architecture.test.ts:126-140 と一致。§7 の 12 部品と view.ts 165 行も一致。§8 の票の状態だけ古い
- 提案: 残す
- 正本へ移す・扱いを決める節:
  - §8 M27-05 で変わった所 (時点の表) は保守の対象外。コミットの表は票 M27-05 の作業ログにもあるので、§8 は票へのポインタ 1 行に縮める候補
- 食い違い:
  - `docs/architecture/overview.md:355`「票 `issues/M27-05-stage-union-and-command-layer.md`(status: review)。」 ↔ `issues/M27-05-stage-union-and-command-layer.md (frontmatter)`: status: done
- 候補:
  - `docs/architecture/overview.md:355`「(status: review)」 — 票は done。時点の状態を stock の文書に書かない方へ

### D52 `docs/operations/README.md`

- 題: docs/operations/ — 運用の文書
- 行数 18、commit 1 回、最終 4ff7552 2026-10-06 feat(check): README に運用の手順を置かせない柵 scripts/check_readme.py を pnpm run ch
- 有効: 一部有効 — 置き場の決まりと check_readme.py の説明は正。目次の cloudflare-deploy.md の説明「配備の手順」は、その文書自身が「2 回目からは deploy-runbook.md」と書いている記録
- 提案: 残す
- 食い違い:
  - `docs/operations/README.md:15`「| [cloudflare-deploy.md](cloudflare-deploy.md) | 配備の手順(人の作業と AI の作業) |」 ↔ `docs/operations/cloudflare-deploy.md:10`: 「2 回目からの配備は … deploy-runbook.md で行う」。初回 (2026-09-27) の記録で、今の手順ではない (文書どうしの食い違い)
- 候補:
  - `docs/operations/README.md:15`「| [cloudflare-deploy.md](cloudflare-deploy.md) | 配備の手順(人の作業と AI の作業) |」 — 統合するなら行を消す。残すなら「初回の配備 (2026-09-27) の記録」に直す

### D53 `docs/operations/acceptance.md`

- 題: 受入の確かめの手順 (M19-16)
- 行数 154、commit 13 回、最終 8cdc556 2026-10-18 docs(judge): --image の回が no・失敗の票の根拠を出すことを使い方の注と acceptance.md に足す (M26-
- 有効: 有効 — round の human は TUR-001 だけ (scenarios.jsonl の active な human は TUR-001 と deploy の OPS-001・002)、judge の llm は OBS-002・SEL-003・CNF-002、LENSES は legible だけ、閾値 0.2 / 0.02 / 0.12、judge の既定 sonnet (scripts/judge.py:65)。どれもコードと一致
- 提案: 残す
- 食い違い: 無し (読み手が突き合わせて見つからなかった)
- 候補:
  - `docs/operations/acceptance.md:64-82 (LLM の採点)`「(足す) docs/acceptance/crops.json の説明」 — M26-11 の切り抜き (scripts/judge.py:26,68) を judge が読むが、この文書に無い。削除でなく追記の候補

### D54 `docs/operations/cloudflare-api-token.md`

- 題: CI 用の API トークンのテンプレート(最小の権限)
- 行数 56、commit 2 回、最終 38fb78c 2026-10-10 docs(operations): 端末の wrangler login に頼る書き方を、記録と Keychain の道に直す (ユーザーの承
- 有効: 有効 — Worker biotope-island の Editor + D1 Edit の型は deploy.yml の 2 段 (d1 migrations apply・deploy) と合う。deploy-runbook の H6・H11 が引く
- 提案: 残す
- 食い違い:
  - `docs/operations/cloudflare-api-token.md:28`「テンプレートの Edit Cloudflare Workers は Zone や KV まで含むので使わない」 ↔ `docs/operations/cloudflare.md:62`: 「テンプレート Edit Cloudflare Workers のトークンを作り」と逆のことを書いている (文書どうしの食い違い。正はこちら)

### D55 `docs/operations/cloudflare-deploy.md`

- 題: Cloudflare への配備の手順(人の作業と AI の作業)
- 行数 104、commit 13 回、最終 4eda520 2026-10-11 docs(operations): 手元の wrangler は pnpm run cf で打つ (M26-12)
- 有効: 一部有効 — 大半の行が「済 2026-09-27」の初回の記録で、10 行目で自分から deploy-runbook.md に譲っている。§8 配ったあとの確かめ (ログ・D1 の行・Observability) と §3 の「初回は secret put で置けない」注は今も生きていて、deploy-runbook.md:151 が §8 を引く
- 提案: 凍結して残す
- 参照・在りか: 凍結にした (レビューの指摘)。消すと承認制の参照が 3 つ切れる: docs/acceptance/scenarios.jsonl:2 (OPS の background が §8 を指す)・scripts/cf_auth.py:205 のコメント (H3)・wrangler.jsonc:23 のコメント (A2)。deploy-runbook.md:10・:23 も番号 (H3・H6・H7・A7〜A9) をこの文書に頼る。§8 と §3 の注は runbook へ写し (M8a)、この文書は初回の配備の記録として凍結する
- 正本へ移す・扱いを決める節:
  - §8 配ったあとの確かめ (A13〜H10) → deploy-runbook.md §5 へ (§5 が「ほかの確かめは cloudflare-deploy.md の 8」と引いている)
  - §3 末尾の「初回は secret put では置けない … --secrets-file」→ deploy-runbook.md に「作り直すとき」の節として
  - §5 の A7〜A10 は deploy-runbook.md §2.1 と同じ (重複なので移し不要)
- 食い違い:
  - `docs/operations/cloudflare-deploy.md:76`「feat/m19 を push し、PR を作る。CI(check と E2E)が pnpm で通ることを確かめる」 ↔ `.github/workflows/deploy.yml:18`: 配備は main だけ (if: github.ref == 'refs/heads/main')。手順 6 の feat/m19 → main は一度きりの段取りで、今の配備の手順 (deploy-runbook §2.2) には無い
- 候補:
  - `docs/operations/README.md:15`「| [cloudflare-deploy.md](cloudflare-deploy.md) | 配備の手順(人の作業と AI の作業) |」 — 説明を「初回の配備 (2026-09-27) の記録。今の手順は deploy-runbook.md」に直す候補

### D56 `docs/operations/cloudflare.md`

- 題: Cloudflare への配備と運用
- 行数 100、commit 3 回、最終 4eda520 2026-10-11 docs(operations): 手元の wrangler は pnpm run cf で打つ (M26-12)
- 有効: 一部有効 — 港の API の表、回数制限 (10/分・120/分、wrangler.jsonc:35-36)、捨てる順、400 MB、Cron の 7 日 / 30 日 (worker/src/policy.ts:21-31,69-74)、課金にしない、mod.py は正。§配備(人が行う) の初回 1〜9 は cloudflare-deploy / deploy-runbook と重なり、トークンの型も食い違う
- 提案: 残す
- 正本へ移す・扱いを決める節:
  - §配備(人が行う) の初回 1〜9 (57〜67 行) → 消して deploy-runbook.md への 1 行に (初回の型は cloudflare-api-token.md)
- 食い違い:
  - `docs/operations/cloudflare.md:62`「**Account API tokens** で、テンプレート **Edit Cloudflare Workers** のトークンを作り、このアカウントだけに絞る。」 ↔ `docs/operations/cloudflare-api-token.md:28・.github/workflows/deploy.yml:49-58`: 型の文書は「Edit Cloudflare Workers は使わない」で Custom Token (Worker の Editor + D1 Edit)。deploy.yml が使う権限はその 2 つだけ
  - `docs/operations/cloudflare.md:64`「`pnpm exec wrangler login` のあと `pnpm exec wrangler d1 create biotope-harbor` で作り」 ↔ `docs/operations/deploy-runbook.md:63`: runbook は「wrangler login でログインし直して進めない」。括弧の注で補っているが、本文の手順は古い道のまま
- 候補:
  - `docs/operations/cloudflare.md:57-67`「初回だけ、次を人が行う。 1. … 9. Actions の `Deploy (Cloudflare)` を …」 — deploy-runbook.md §2.1・cloudflare-deploy.md H1〜H7 と重なり、4 のトークンの型が食い違う。課金にしない決まりの 1・2 は §課金にしない に同じ文がある

### D57 `docs/operations/deploy-runbook.md`

- 題: 配備の手順書(端末の状態に左右されない形)
- 行数 181、commit 9 回、最終 4eda520 2026-10-11 docs(operations): 手元の wrangler は pnpm run cf で打つ (M26-12)
- 有効: 有効 — 主の道の順 (check → site key → build → check:free-tier → d1 migrations → deploy) は .github/workflows/deploy.yml:36-55 と一致。pnpm run deploy・cf・cf:auth は package.json にある
- 提案: 残す
- 食い違い: 無し (読み手が突き合わせて見つからなかった)
- 候補:
  - `docs/operations/deploy-runbook.md:151`「ほかの確かめ(ログ・D1 の行・Observability)は cloudflare-deploy.md の 8。」 — §8 の中身をここへ写す回 (M13) で、この行を写した節への参照に置き換える (cloudflare-deploy は凍結して残る)

### D58 `docs/operations/readme-screenshots.md`

- 題: README のスクリーンショットを撮り直す
- 行数 34、commit 2 回、最終 d419c0b 2026-09-29 docs(readme): スクリーンショットを横 640 の縮小画(JPEG)で載せ、押すと元の PNG を開く
- 有効: 一部有効 — 撮る画 10 枚の表は tools/readme-shots.ts:45-68 の SHOTS と一致。起動のコマンドだけ npm の頃のまま
- 提案: 残す
- 食い違い:
  - `docs/operations/readme-screenshots.md:8`「npm run dev」 ↔ `package.json (packageManager)`: packageManager は pnpm@10.28.1、ロックは pnpm-lock.yaml だけ。ほかの運用文書は pnpm run dev
- 候補:
  - `docs/operations/readme-screenshots.md:8`「npm run dev」 — pnpm run dev に揃える (コードブロックの中の注 # も同じ)

### D59 `docs/uiux/2026-10-04-title-flow.md`

- 題: タイトル画面の画面遷移図 (M24-00)
- 行数 296、commit 4 回、最終 1252497 2026-10-05 docs(uiux): M24-01 の後で古くなった文 5 つを直す (session.ts:9、title-flow の状態・storag
- 有効: 一部有効 — 遷移図・メニューの並び・起動の判断は src/ui/titleMenu.ts:27-37・src/app/place.ts:204 に実装された。M24-02・03 (status: todo。実装は取り込み済みで層 C 待ち) の plan:。「開いた問い」の 1 つ目は末尾の「決まったこと」で解決済み。feat/m19 が main に無いことは今も正 (merge-base で確認)
- 提案: 凍結して残す
- 正本へ移す・扱いを決める節:
  - §起動の判断 の表 (bootRouteOf の条件の順) は src/app/place.ts のコメントと単体試験が正本になった。凍結のままでよい
- 食い違い:
  - `docs/uiux/2026-10-04-title-flow.md:119`「起動の行き先を純粋な関数 `bootRouteOf` で決める。入力は 4 つで」 ↔ `src/app/place.ts:204`: bootRouteOf(search, scenarios, pending, marks, devSkip) の 5 つ。石板の一覧 scenarios が増えた
  - `docs/uiux/2026-10-04-title-flow.md:291`「票の参照の書き換えはユーザーの承認を待つ」 ↔ `issues/M24-01-title-screen.md:6・issues/M24-03-title-scenario-harbor.md:6`: plan: は docs/uiux/2026-10-04-title-flow.md に揃っている (同じ文書の 296 行目にも「揃えた」とある)
- 候補:
  - `docs/uiux/2026-10-04-title-flow.md:291`「- 票 M24-00 の「作るもの」と M24-01〜03 の `plan:` は `docs/uiux/2026-09-29-title-flow.md` を指している。…票の参照の書き換えはユーザーの承認を待つ」 — 296 行目で解決済み。凍結の方針なら消さずにそのまま残してよい

### D60 `docs/uiux/README.md`

- 題: docs/uiux
- 行数 40、commit 3 回、最終 1252497 2026-10-05 docs(uiux): M24-01 の後で古くなった文 5 つを直す (session.ts:9、title-flow の状態・storag
- 有効: 有効 — wireframes/*.svg と make_wireframes.py は実在。bootRouteOf は src/app/place.ts:204
- 提案: 残す
- 食い違い: 無し (読み手が突き合わせて見つからなかった)

### D61 `docs/review/archive-2026-10-13.md`

- 題: 審査台の記録 2026-10-13
- 行数 3324、commit 1 回、最終 a39f9a1 2026-10-13 docs(review): 審査台の確定分を文字の記録に移す
- 有効: 有効 — 2026-10-02〜10-13 の審査台の判定 (items 112・板 C 17・板 D 25・票の審査 22+52) を文字に写したもの。判定の記録としては正で、どこからも参照されない
- 提案: 凍結して残す
- 食い違い: 無し (読み手が突き合わせて見つからなかった)
- 候補:
  - `docs/review/archive-2026-10-13.md (全体)`「ファイルごと」 — 消すなら失うのは人が読む形だけ (中身は .jsonl と git 履歴 a39f9a1 にある)。3,324 行で参照ゼロだが、ユーザーの判定の原文なので凍結を推す

### D62 `issues/README.md`

- 題: issues — チケット管理
- 行数 102、commit 11 回、最終 ac8aa46 2026-10-28 docs(issues): 正本の行の形の決まりの在りかを lint の行の隣に指す
- 有効: 一部有効 — 規約・シナリオの作り方・通し実行のテンプレート (spawnClick・disasterClick は src/simulation/commands.ts:21-22) は正。issues/archived/ (91 件) と issues/uat/ に触れていない。§進める順 (2026-09-23) は M19・M22・M23 がほぼ done になった時点の表
- 提案: 残す
- 正本へ移す・扱いを決める節:
  - §進める順(2026-09-23 承認) → docs/specs/plans/2026-09-23-roadmap.md §7 へのポインタ 1 行に縮め、今の順は roadmap か decisions-current に置く
- 食い違い:
  - `issues/README.md:28`「tools/issues.sh          # 全チケットを状態付きで一覧」 ↔ `tools/issues.sh:8`: for f in issues/[A-Z]*-[0-9]*-*.md で直下だけを見る。issues/archived/ の 91 件 (done を移したもの、6475dae ほか) は出ない
  - `issues/README.md:57`「M21-03 迎撃の作り直し(試作の案あり)と M19-03 回帰の通し実行は M22 の後」 ↔ `docs/specs/2026-10-18-decisions-current.md (節「迎撃の塔 (M21-03)」)`: M21-03 は 2026-10-28 に K1・W 12・2 星で決まった (票は todo)。M22 はほぼ done で「M22 の後」の段は過ぎた
- 候補:
  - `issues/README.md:51-71`「## 進める順(2026-09-23 承認、docs/specs/plans/2026-09-23-roadmap.md §7) の表」 — 時点の順を stock の規約に持たない。表を roadmap へのポインタに置き換える候補
  - `issues/README.md:7 の下`「(足す) done の票は issues/archived/ へ移す決まりと、受入の票を置く issues/uat/ の説明」 — フォルダがあるのに規約に無い。削除でなく追記

## 4. 改訂計画

### 4.1 正本を何にするか (3 つの箱)

「ADR のように積み重ねるものか」への答え: 箱によって違う。どの文書も次の 3 つのどれか 1 つに入れ、どの箱かを目録 (§4.2) に書く。

| 箱 | 書き方 | 文書 | 何を置くか |
|---|---|---|---|
| A. 積み重ねる (append-only) | 行を足すだけ。前の行は直さない。変えるときは新しい行 (新しい ADR) で前を置き換え、置き換えた旨を前の行に 1 行足す | `docs/decisions/*` (ADR)、decisions-current の節「改訂」、`docs/review/archive-*` | なぜそう決めたか (理由と捨てた案)。審査台の判定の原文 |
| B. 保守する (stock) | 今に合わせて書き換える。日付を名に入れない (decisions-current は例外として名の日付を起こした日と読む) | `docs/specs/2026-10-18-decisions-current.md` の本文、`docs/architecture/overview.md`・`fitness-functions.md`、`docs/operations/*`、`docs/uiux/README.md`、`issues/README.md` | 今どう決まっているか (決め)、今どう組まれているか (構造)、今どう運用するか (手順)。数は check の印でコードに縛る |
| C. 凍結する (flow) | 書いた日 (または票が閉じた日) で凍結し、本文を書き換えない。足してよいのは頭のポインタの行だけ | 名に日付のある設計書・LD・計画・プレイテスト・監査・引き継ぎ、`docs/design/qa/**` の作業ログ | その日の過程と根拠。結論は B へ移してから凍結する |

B のどの文書に何を置くか:

- **decisions-current (決め)**: 今の 19 行と D1・通し実行・迎撃の塔に加えて、シナリオごとの決め (祈りに応えるな・空の舟・塔の重さ・霊脈枯れ・回避装置の門)、石板の順 (2026-09-23 のロードマップ §7)、公開の方針 (M20: MIT・karak97・LFS)、シナリオの判定の決め (dead は省略できる・星の力はシナリオ層に置く・species_mean で判定・escape → dead → alive の順)。数は check の印で定数に縛る。運用の細部 (caffeinate・pmset) は `docs/operations/` へ出す。
- **overview (構造)**: 09-19 の設計書の §3 用語・§4 冒頭の依存の向き・§4.1 の World の契約 (dispatch が validate の結果を返すことを足して)・§4.2 LogSink・§4.4 Runner の契約・§8 リスク。09-26 の「版は 3 つ」の段落 (ADR 0002 の決定と合わせて)。観察画面の舟の GLB の約束 (`src/observe/render/ship.ts:7` が引く)。§8 の時点の表は票へのポインタ 1 行に縮める。
- **ADR (理由)**: 新しく起こすのは、決めの理由が LD にしか無く、しかも後から覆りうるものだけ。§4.7〜4.31 の 25 節を ADR に割ることはしない (理由の多くは LD と定数の脇のコメントにある)。ADR には節「改訂」を必須にする (0001 には無い)。
- **operations (手順)**: 配備は `deploy-runbook.md` 1 本を正本にし、`cloudflare-deploy.md` の §8 (配ったあとの確かめ) と §3 の初回の secret の注を移す。`cloudflare.md` の §配備 1〜9 は runbook へのポインタにする (トークンの型の食い違いもここで消える)。受入の行の決まり (acceptance-redesign §2.1) と `crops.json` は `acceptance.md` へ。
- **シナリオ一覧**: scenarios-and-world §3 の 30 本の表は、未実装 20 本の唯一の仕様。今は 09-19 の flow の中にある。B に「シナリオ一覧」を起こすか、凍結のまま「未実装の石板の仕様はここ」と目録に書くかは CEO の判断 (§4.3 の M12)。

運用の決まり (新しく足す):

1. 判断の過程は C (日付つきの LD・レビュー) に書いてよい。決まったら、同じ commit で B に行を足し、C の頭にポインタを足す。C への後からの書き足しはしない。続きは票の作業ログか、新しい日付つきの文書へ書く。
2. 状態 (todo・done・箱の [x]) の正本は票の frontmatter だけにする。計画・overview・README に状態を書かない (2026-10-18 の計画の箱は 145 個すべて [ ] のまま。overview:355 は M27-05 を review と書くが done)。
3. 決めとコードがずれる間 (決めたが票が todo) は、decisions-current の節の頭に「実装: 票 X (todo)。コードは旧値」と書く。列の名「今」と、コードの今を取り違えないため。

### 4.2 凍結の仕方

凍結は 2 つで示す。どちらも本文には触らない。

1. **目録** (`docs/README.md`、新しく起こす): 全文書を 1 行ずつ「path・箱 (A / B / C)・凍結した日・今の正本・本文のハッシュ」で並べる。全体を見渡す人と柵のため。この文書 (`docs/review/2026-10-28-spec-inventory.md`) 自身も C に入れ、CEO がこの計画を判じた日で凍結する。
2. **頭の 1 行**: 凍結した文書の題の直下に、決まった形の行を足す。コードのコメントや票の `plan:` から直に来た人が気づけるように。目録だけだとこの道で気づけない (CEO の「後で追ったら有効か分からない」はこの道で起きる)。形は次の 2 つに限る (柵がこの形の外を落とす)。
   - `> 凍結: YYYY-MM-DD。今の正本: <path>#<anchor>` (今を指す先がある文書)
   - `> 凍結: YYYY-MM-DD。失効: <理由 1 句>` (今を指す先が無い文書。qa/ の旧模型など)
   - 今の決まりの `superseded-by` の行 (節ごとのポインタ) はそのまま使える。§3 の候補のうち「節の直下に注を 1 行足す」もの (D33〜D36・D38・D39〜D47・D48 の注) は、この頭の行に寄せる。

比べ (公平に):

| | 目録だけ | 頭の 1 行だけ (10-18 の決まりの延長) | 両方 (推す) |
|---|---|---|---|
| 承認 | 目録 1 本 | 群ごと (6 回、中で 1 本ずつ外せる) | 目録 1 回 + 群ごと 6 回 |
| 直に来た人が気づく | 気づかない | 気づく | 気づく |
| 見渡し・柵 | できる | 文書を全部読む必要 | できる |
| 10-18 の決まり (decisions-current:15「ポインタの行を足す」、承認済み) との関係 | 外れる (足さないので) | そのまま | そのまま。目録は足すだけ |

### 4.3 承認の単位

1 回に 1 つの変更。各回は 1 commit。凍結 (段 3) は群ごとに 1 票にし、審査台では中の文書を 1 本ずつ外せる形で出す。番号の順に進める。

**段 0 — 目録を起こす (新しいファイル 1 本だけ。既存の文書は変えない)**

| # | 何を |
|---|---|
| I1 | `docs/README.md` を起こす。全文書の行 (path・箱・凍結の日は空・今の正本・ハッシュは空)。箱は §2 の表の列のとおり |

**段 1 — 柵 (scripts と試験だけ。文書は変えない)**

| # | 何を | 初日に落ちないための手当て |
|---|---|---|
| F2 | 目録に無い文書・目録にあって無い文書・名に日付があるのに箱が B (例外は decisions-current だけ名指し) を落とす | I1 の後なので通る |
| F1 | 目録で凍結の日がある文書について、本文のハッシュ (頭の決まった形の行を除いた残り) が目録の値と違えば落とす。頭の行の形の外の行も落とす | 凍結の日がまだ空なので、何も検めない (段 3 で 1 本ずつ効き始める) |
| F4 | 票の `plan:` の path とアンカーの切れを落とす (`plan: null` は許す。ART-01 の `git show` の形は許す) | 今の切れ 10 件は、直す回 P1 が済むまで警告にとどめる |

**段 2 — 正本へ移す (B に足すだけ。C は触らない)**

| # | 何を | 移し元 → 移し先 |
|---|---|---|
| M1 | 祈りに応えるなの決め (2063・北の谷 1366・8 年ごと・若い信仰の記憶) と印 | faith-economy §8.9〜§8.10・§9.5 → decisions-current |
| M2 | 空の舟の決め (鐘樹 0.0025 / 0.0005 / 0・舟 6/年・民の林・舟か塔か) と印 | faith-economy §9.3〜§9.4 → decisions-current |
| M3 | 塔の重さの決め (燃料・火口・予算) と印 | tower §8 → decisions-current |
| M4 | 霊脈枯れと文明の発生の決め | faith §8〜§9 → decisions-current |
| M5 | 回避装置の門 (星の門 12・0.8、気象塔) と印 | devices §3.1・§8.1 → decisions-current |
| M6 | 石板の順 | roadmap §7 → decisions-current |
| M7 | 公開の方針 (MIT・karak97・LFS) | M20 計画の表 → decisions-current |
| M8 | シナリオの判定の決め (dead は省略できる・星の力はシナリオ層・species_mean・escape → dead → alive) | 09-19 §4.10・§4.12・§4.24 → decisions-current |
| M9 | World の契約・LogSink・Runner・用語・リスク | 09-19 §3・§4.1・§4.2・§4.4・§8 → overview |
| M10 | 版 3 つの段落 (check_docs の VERSION_DOC も向け直す) | 09-26 §1.3 の後 → overview か ADR 0002 |
| M11 | 舟の GLB の約束 | qa/observe/keyitems.md → overview §7 |
| M11c | `src/observe/render/ship.ts:7` のコメントを M11 の移し先へ向け直す (既存コメントの書き換え。原文と理由はその回に示す) | — |
| M12 | 未実装 20 本の石板の仕様をどこに置くか (B に起こす / 凍結のまま目録で指す) | scenarios-and-world §3 |
| M13 | 配ったあとの確かめ (§8) と初回の secret の注 (§3) を写す | cloudflare-deploy → deploy-runbook |
| M13d | `docs/operations/cloudflare.md:57-67` (初回の配備 1〜9) を runbook への 1 行にする (既存の文の削除) | — |
| M14 | 受入の行の決まりと crops.json | acceptance-redesign §2.1 → operations/acceptance.md |
| M15 | decisions-current :51 の文を直す (表の 3,000・500 と合わせる) | decisions-current |
| M16 | 迎撃の塔の節の頭に「実装: M21-03 (todo)。コードは 3 星・150 年」 | decisions-current |
| M17 | 通し実行の件数に印 `slow_cases` を足す。数は Python で数えられない (試験がループで展開される) ので、`vitest list --json` を読む小さな node のスクリプトで数え、check_docs の FACTS に渡す | decisions-current・scripts |
| M18 | caffeinate・pmset の段落を operations へ移す | decisions-current → operations |
| P1 | 票の `plan:` の切れ 10 件を直す (既存の行の書き換え。票ごとの原文と直しをその回に示す)。済んだら F4 を警告から落とす柵へ | issues/ |

**段 3 — 凍結 (目録に凍結の日とハッシュ、頭に 1 行)**

| # | 対象 |
|---|---|
| Z1 | `docs/specs/`: 09-19 の設計書と plans/ の 14 本 (handoff は X1) |
| Z2 | `docs/design/` の LD 4 本 (tower・faith・devices・faith-economy)。intercept-2 は M21-03 が done になってから |
| Z3 | `docs/design/` のほか 10 本 (企画書・art-brief・scenarios-and-world・観察画面 2 本・observe-perf・09-26・save-url・acceptance-redesign・architecture-review) |
| Z4 | `docs/design/qa/` 直下の 8 本 (旧模型。M22 で失効。handoff-T18 は X2) |
| Z5 | `docs/design/qa/observe/` の 5 本 (session-2026-10 は M22-09 で所感が書かれてから) |
| Z6 | `docs/uiux/2026-10-04-title-flow.md`・`docs/operations/cloudflare-deploy.md`・この文書 |

凍結を待つ文書 (C (未凍結)) の基準は「これから書き足す予定があるか」。票が開いていても、読まれるだけで書き足さない文書は凍結してよい (凍結は書き足しを止めるだけで、読むのは妨げない)。intercept-2 (M21-03 の実装で行列を使う) と session-2026-10 (所感の欄が空) だけが待つ。

**段 4 — 消す (1 本ずつ)**

| # | 対象 | 条件 |
|---|---|---|
| X1 | `docs/specs/plans/2026-09-23-handoff.md` | 参照 0。中身は roadmap・auto-memory・CLAUDE.md にある |
| X2 | `docs/design/qa/handoff-T18-merge.md` | ART-01 の票 (`git show` の旧版を指す) と git 履歴にある。ほかの参照 2 件 (qa の一覧) は凍結した文書の中なので書き換えない |

**段 5 — 決まりを書く**

| # | 何を |
|---|---|
| R1 | §4.1 の箱の定義と「運用の決まり」3 つを decisions-current の「更新の約束」に足す |
| R2 | ADR に節「改訂」を必須にし、0001 に節を足す (本文は書き換えない) |

計 33 回 (段 0: 1、段 1: 3、段 2: 21、段 3: 6、段 4: 2、段 5: 2)。段 2 の中は順不同で、CEO が要らないと判じた回は飛ばせる。

### 4.4 機械の柵 (check_docs の拡張案)

今の `scripts/check_docs.py` は、ファイルの中身だけを読む純粋な検査 (load_repo → check_files) で、git も commit のメッセージも読まない。CI (`.github/workflows/ci.yml`・`deploy.yml`) の checkout は fetch-depth 1 で、基点との差分は取れない。柵はこの作りに乗せる。

| 柵 | 何を落とす | 作り | 走る所 |
|---|---|---|---|
| F2 目録 | `docs/**/*.md`・`*.html` で目録に無いもの、目録にあって無いもの、名に日付があるのに箱が B | 目録の表を読む関数。load_repo を `*.html` まで広げる | `pnpm run check` (CI と配備の前も) |
| F1 凍結の書き換え | 凍結の日がある文書の本文 (頭の決まった形の行を除く) の sha256 が目録の値と違う。頭に決まった形の外の行がある | 本文 → ハッシュの純粋な関数。試験で固定 | 同上 |
| F4 票の `plan:` | `issues/**/*.md` の `plan:` の path が無い・アンカーが見出しに無い | 既存の anchors_of を使う。load_repo を issues/ まで広げる | 同上 (P1 までは警告) |
| (任意) F5 状態の二重持ち | B の文書に票の状態 (`status: review` など) や `- [ ]` が増えたら警告 | 文字の検索 | 同上 |

F1 の限界: 柵は書き換えを見つけるだけで、許すかは決めない。目録のハッシュを書き換えれば通るので、凍結を解くことは目録の差分として見える (B の文書の 1 行の変更で、レビューと審査台に出る)。agent が自分でハッシュを直すことは止められない。止めるのは「既存の文の書き換えは承認制」の決まりと、目録の差分を審査台で見ること。

F1 は名に日付の無い C (qa/ の作業ログ・cloudflare-deploy) も目録で拾うので、名に日付が無い一度きりの記録も守れる。日でなく本文で比べるので、同じ日の書き換え (intercept-2 の b3cf33e のような) も、凍結の後なら落ちる。

## 5. 確かめていないこと・限界

- 通し実行の件数: decisions-current は 49 (47 + 2)、2026-09-23 のロードマップ §8 は 34 + 2。`tests/slow/scenarios.playthrough.test.ts` はループで試験を展開するため、この worktree (node_modules 無し) では vitest list で数を確かめていない。M17 で印を足すときに数える。
- 被参照の数は path の文字の一致で数えた。文の中で題だけを書いた参照 (「09-19 の設計書」) は数えていない。票の `plan:` は数えている。
- 「有効」の判定は読み手 3 つ (opus) の読みと、親の抜き取り (§冒頭の 3) による。長い作業ログ (qa/observe の 500〜650 行、M1 の計画 1,172 行、審査台の記録 3,324 行) は流し読みで判定した。
- 09-21 より前の SHA (09-19 の設計書 §6 の 11 個) は M20-02 の履歴の書き換えで今の履歴に無い。たどるには `issues/archived/M20-02-history-rewrite.md` の bundle が要る。凍結の判断は変わらない。
- 担当の外で気づいたこと: M24-02・M24-03 は status: todo だが E2E は入っていて、decisions-current の改訂の表がそれを数えている。票の状態と実装のずれは §4.1 の決まり 2 で扱う。

## 6. レビューの反映

読むだけの別モデルのレビュアー (opus) に 1 周見せた (fede318 に対して)。§3 の食い違いは 25 件ほどの抜き取りでほぼ正しく、誤りは参照と在りかの側にあった。直したこと:

- 票の `plan:` の切れを 3 → 10 に数え直した (check_docs の anchors_of で検めた)。`plan: null` 15 票と ART-01 の形を書いた。
- cloudflare-deploy (D55) を「統合して消す」から「凍結して残す」へ。消すと scenarios.jsonl:2・scripts/cf_auth.py:205・wrangler.jsonc:23 の承認制の参照が切れる。art-brief (D18) も表を計画に合わせて凍結へ。対象読者の行と、題で引く参照を在りかに足した。
- 目録を起こす回 (I1) を段 0 に置き、柵はその後にした。F1 を git の差分から目録のハッシュへ替えた (check_docs の作りと CI の fetch-depth 1 に乗る)。F1 の限界を書いた。
- 頭に足す行の形を 2 つに決め、§3 の「節の直下に注」の候補はそこへ寄せると書いた。
- 目録とポインタの比べを表にし、目録だけでは直に来た人が気づけないこと、10-18 の決まりとの関係を書いた。推しを「両方」に改めた。
- 承認を 1 回に 1 つの変更に割った (移し元ごと、移すことと削除・コメントの書き換えを別の回に)。F3 (通し実行の件数の印) は文書を変えるので段 2 の M17 へ移し、node で数える手当てを書いた。
- 凍結を待つ基準を「書き足す予定があるか」に揃えた (2026-10-18 の計画は凍結へ、intercept-2 と session-2026-10 だけ待つ)。表に箱 (A / B / C) と出ていく参照の数の列を足し、食い違いの無い文書に「無し」と書いた。
- Z の数 (LD は 5 本、scenarios-and-world の置き場、handoff の二重数え) と、commit の数え方を直した。

直していないこと: 被参照の数は path の文字の一致のまま (§5)。D20 の内訳の数え違いは読み手の数えとして注を付けた。
