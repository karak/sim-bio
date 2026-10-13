---
id: M26-18
title: judge が製品の正しい画に 3 票とも no を出した (HBR-006/6) 根本の原因を突き止め、同じ形の偽の no が出ない仕組みにする
status: in_progress
milestone: M26
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-15]
evidence: []
---

# judge の偽の no の根本の原因を断つ

優先度: Should

## What to build

M25-15 で、judge が 3 票とも no にした HBR-006/6 (画 5) は製品が設計どおりで、判定の読み違いだった (島の名前は見出しの下の「港へ出す」の板に文で出るのに、judge は島の絵・一覧を探した)。M25-15 は合格だが、ユーザーは偽の no の根本の対策を求めた (2026-10-11 の票の審査)。

手がかり (確かめていない):
- docs/acceptance/rubrics.json に HBR-006/6 の行が無い。採点表の無い手順は、正本の文をそのまま問いにして当てている見込み。採点表のある手順 (SEL-003・CNF-002 など) は問いが画の何を見るかを言う
- SEL-003/3 の no は帯が画の中で小さすぎたため (M26-11 で切り抜きを当てて直した)。原因の型が別か同じかも分ける

やること:
1. judge.py が HBR-006/6 に何を問うたか (問いの文・当てた画) を、記録または `--dry-run` で確かめ、no の原因を一つに絞る。推測で止めない
2. 原因を、この手順だけでなく同じ形の手順すべてに効く仕組みで断つ。例: llm 手順は採点表が無いと judge が呼ぶ前に止まる (黙って正本の文へ戻さない)、または採点表が要るかを scripts の試験が検める。正本 (scenarios.jsonl) の既存の行の書き換えは承認制なので、案を報告に挙げる
3. 仕組みの試験は直す前に赤を確かめる。本物の judge は HBR-006/6 で 1 回まで (費用)

## Blocked by

- M25-15 (done)

## Acceptance criteria

- [x] HBR-006/6 の偽の no の原因が、問い・画・票の記録を根拠に作業ログにある
- [x] 同じ形の手順で偽の no が出ないことを検める仕組み (試験または judge の前の検め) があり、直す前に赤
- [ ] HBR-006/6 の judge を 1 回回して 3 票とも yes (または回さない訳と、目で見た根拠) — 1 回回して割れた (下の作業ログ)。2 回目は費用の上限でユーザーの判断
- [x] `pnpm run test:scripts`・`pnpm run check` が通る (2026-10-14 01:27、unit 1439・worker 66)

## 作業ログ

- 2026-10-11: 起票 (M25-15 の票の審査でユーザーのメモ「合格はいいが、偽陽性でNOとなった原因の根本対策をフォローアップチケットにして。」)。
- 2026-10-14: 着手 (in_progress)。
  - 原因 (記録から)。2026-10-01 の 48 回の試し (M25-06 の作業ログ) は `--step HBR-006/6` で当てた。HBR-006 は judge が llm の手順を持たず、採点表も無かったので、judge.py の `questions_of` が手順の文をそのまま 1 つの問い S にした (当時の文は 1ec9cbb の正本で「判定の後に開き直した港の口で、閉港の文と「この石板で最後に判定の出た島」が読める」。今の文「…見出し「…」とその下の島の名前の文 (…) が読める」は 4033f88、2026-10-04 のユーザーの承認で書き換えた後)。問いの末尾は「文の言う物が見えない・読めないなら no」。票の根拠は「「この石板で最後に判定の出た島」の直下に島の表示が無い」(M25-06 の作業ログ)。つまり judge は括弧の中を「読む文字列」でなく「探す物 (島)」と取り、「物が見えない → no」の指示どおりに no を出した。画は全体の 1280x720 (切り抜きは当時無い)。judge.json にこの回の票は無い (`--step` の回の記録は M25-06 の後の整理で残っていない)。
  - 同じ形の原因は SEL-003/3 (M26-11) とは別。あちらは物が小さすぎた (切り抜きで直した)。こちらは問いの作り方 (採点表の無い手順の文をそのまま問いにする) が原因。
  - 仕組み。`questions_of` は採点表の無い手順で ValueError (手順の key と rubrics.json を名指し) を投げ、judge は呼ぶ前に終了コード 1 で止まる。手順の文を問いにする既定は消した (`TAG_AND_SHOT` も不要になり消した)。`--dry-run` は問いの文も出す (何を問うかを呼ぶ前に目で確かめられる)。試験: `QuestionsTest.test_a_step_without_a_rubric_stops_instead_of_asking_the_step_sentence`・`MainTest.test_a_step_without_a_rubric_exits_1_before_any_call`・`MainTest.test_dry_run_prints_the_question_the_judge_will_be_asked`・`RepoFalseNoTest` (HBR-006/6 の採点表が見出しを「文字」として名指し、島の名前の文を問う)。直す前に 4 つとも赤 (3 failures + 1 error: 採点表無しでも偽の claude が呼ばれた)。試験の土台 (RunBase・MainTest) には採点表 `SEL_RUBRICS` (id S) を置いた。消した・題を変えた試験: `test_default_is_one_yes_no_question_made_of_the_step_sentence` (既定を消したので消した)、`test_rubrics_json_replaces_the_default` → `test_rubrics_json_gives_the_questions` (既定との比べを外した)。
  - 採点表 HBR-006/6 (Q1〜Q4) を rubrics.json に足した。正本 (scenarios.jsonl) は触っていない。
  - judge を 1 回: 画は auto の行なので `pnpm run shots` は書かない。spec の `isAuto` を一時的に外して scratchpad に撮り (spec は戻した。差分なし)、`--image` で当てた (記録は書かない)。結果は undecided: Q1 error/no/no、Q2〜Q4 error/yes/no (3 回、7 秒、0.085 USD)。1 票は呼び出しの失敗 (`--image` の回は根拠を出さないので中身は不明)、1 票は全部 yes、1 票は全部 no。目で見た画 (`.claude/review/m26-18/HBR-006-5.png`、git の外) では、港の口は左、閉港の文は板の下に小さく薄い字、見出し「この石板で最後に判定の出た島」も薄い灰の小さな字、その下に「港へ出す」と「ひとことを刻んで、ルワケミの島として港に並べる」が読める。全体の画では字が小さいので、SEL-003/3 と同じく切り抜き (crops.json) を当てるのが次の手。費用の上限 (1 回) に達したので 2 回目は回していない。
  - レビュー (読むだけの opus)。直す前の赤を HEAD の judge.py に当て直して確かめた (4 つとも赤)。取り込んだ指摘: (1) 採点表 Q3 の「…の島として」は島の呼び名の結びが「の島」「の環」「の洲」(src/harbor/names.ts の KIND) なので半分の回で偽の no になる → 「ひとことを刻んで、」で始まり「として港に並べる」で終わる文、結びは 3 つのどれか、に直した。(2) Q1 の「港の口 (引き出し)」は画にも src にも無い語 → 見出し「港」と「流れ着いた島の年代記」の板、に。(3) Q2 は「見出し」でなく「薄い小さな字の 1 行」と言い、no の条件 (文字列が無い・読めない) と no の理由にしないもの (下に島の絵が無い) を言い切った。(4) Q4 の「チップ」→「ひとことを選ぶ小さな札」。(5) `test_each_step_loads_its_own_rubric_not_the_fallback` は消えた既定 (id S) を前提にしていた → `test_every_llm_step_in_the_source_of_truth_has_a_rubric` に替え、正本の llm の手順すべて (OBS-002 を含む) に採点表があることを検める (無ければ pnpm run judge 全体が止まるため)。(6) `RepoFalseNoTest` は言い回しの試験なので、no の条件と 3 つの結びを見る形に強めた。
    取り込まなかった指摘 (候補): `--image` の回は no・error の票の根拠を出さないので次に原因を追えない → 根拠を標準出力に出す手 (別の票の候補)。shots の HBR-006 は lead が島の名前に替わる前に撮りうる (見込みは低い)。
  - 既存の文の書き換え (ユーザーの承認 2026-10-14、次のコミット): judge.py:10 と docs/operations/acceptance.md:72 の「何を何回呼ぶかだけ出す」(問いの文も出すようになった)、judge.py:241 の docstring「…無ければ手順の文を 1 つの問いにする」と acceptance.md:76 の同じ文 (既定を消した)、judge.py:8 と acceptance.md:70 の「任意の手順 (…) を当てる」(当てられるのは採点表のある手順だけ)。
