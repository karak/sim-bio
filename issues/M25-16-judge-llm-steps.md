---
id: M25-16
title: SEL-003 の 2〜4 と CNF-002 の 2〜3 を judge: "llm" にする
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-05, M25-06, M25-12]
evidence:
  - scenarios.jsonl の SEL-003 の手順 2〜4・CNF-002 の手順 2〜3 が judge llm (commit e7bb148、uv run scripts/acceptance.py check が ok)
  - docs/acceptance/rubrics.json の SEL-003/2・3・4、CNF-002/2・3 (commit 38fd06d)、scripts/test_judge.py の RepoLlmStepsTest・RepoBaselinedStepsRunTest
  - pnpm run judge の結果は作業ログ (2026-10-04)
---

# SEL-003 の 2〜4 と CNF-002 の 2〜3 を judge: "llm" にする

優先度: Should

## What to build

ユーザーの決定 (2026-10-02 の一覧の 8、2026-10-04 に実行の指示): 【見た目】の手順のうち、lens と基準画では言い切れない「らしさ」を LLM に判じさせる。TUR-001 の 3D の手順は M25-08 で OBS-002 に移っているので対象外。

作るもの:
- 正本 SEL-003 の手順 2〜4 と CNF-002 の手順 2〜3 の 3 つ目の要素に `{"judge": "llm"}` を足す (checks があれば残す。**この票で名指しされた手順だけ**。ほかの行・文は変えない)
- `docs/acceptance/rubrics.json` に各手順の採点表を足す (SEL-003/2 は M25-06 の試しの分がある。見直してよい)。問いは画で判じられる性質に限り、yes/no で答えられる形に
- `scripts/judge.py` が基準画のある手順をどう扱うかを ADR 0001 の段 5 に合わせる (観察画面でない手順は fail/undecided だけ results.json に書く。pass は書かない)
- `pnpm run judge` を 1 回だけ回し、結果を作業ログに (費用も)

## Blocked by

- なし

## Acceptance criteria

- [x] `uv run scripts/acceptance.py check` が通り、5 手順が judge: "llm" を持つ
- [x] rubrics.json に 5 手順の採点表があり、test_judge が通る
- [x] `pnpm run judge` が 5 手順を判じ、結果 (票と費用) が作業ログにある
- [x] `pnpm run check` が通る

## 作業ログ

- 2026-10-04: 起票。
- 2026-10-04 (実装): 正本の 5 手順に judge llm を足し (SEL-003 の 2〜4 は human から、CNF-002 の 2 は human から、3 は checks を残して足した)、採点表を 5 手順分作った。SEL-003/2 は Q3 (ピンが縁の板に隠れない) を足しただけ。scripts/judge.py は基準画のある手順を既に ADR 段 5 どおりに扱っていた (3 票 yes は writes_pass が偽で results.json に残らず、no・割れだけ by llm で書く) ので変えず、試験を足して固めた。
- 2026-10-04 (judge の 1 回、27 回の呼び出し、46 秒、換算 0.441 USD、sonnet、3 票): `pnpm run judge -- --step SEL-003/2 … --step CNF-002/3`。
  - SEL-003/2 (画 1): 3 問とも yes/yes/yes。基準画があるので合格は書かない (results.json に残らない)。
  - SEL-003/3 (画 2): fail。Q3 (帯が 1 本の細い線でなく幅を持つ) が no/no/no (「細い線で、幅はピンの頭の直径の 4 分の 1 に届かない」)。Q4 (地形に沿う) が no/no/yes で割れ。Q1・Q2・Q5 は yes/yes/yes。M25-06 の試しの「帯が細い線に見える」と同じ。
  - SEL-003/4 (画 3): undecided。Q2 (ピンが色で見分けられる) が no/yes/no、Q4 (ピン全体が板に隠れない) が yes/no/yes で割れ。Q1・Q3 は yes/yes/yes。
  - CNF-002/2 (画 1〜3): fail。Q3 (「やめる」にだけ focus の輪・光がある) が 3 枚とも no/no/no (「灰青の塗りだけで、輪・縁取り・光が見えない」)。Q1・Q2・Q4 は 3 枚とも yes/yes/yes。M25-06 の試しと同じ。
  - CNF-002/3 (画 1〜3): 4 問 x 3 枚とも yes/yes/yes。基準画があるので合格は書かない。
  - results.json には SEL-003 (fail)・CNF-002 (fail) が by llm で書かれた。fail の 2 手順が製品の欠陥か判じ方の問題かは M25-15 が調べる。
- 2026-10-04 (レビュー後): 別モデルの読むだけのレビューで、SEL-003/3 Q3 の「幅がピンの頭の 4 分の 1 以上」は src/render/cellHighlight.ts の帯の太さ (outlineWidth) とピンの大きさ (markerScale) の比が約 0.21 で常に届かず、製品を見ずに必ず no になる問いと分かった。上の 3×no はこの問いの結果で、製品の欠陥の証拠にはならない。Q3 を「四辺とも淡い琥珀の色として見える」に直し、あわせて SEL-003/3 の Q1・Q4、SEL-003/4 の Q3、SEL-003/2 の Q3 の言い回しを直した。judge は 1 回だけの約束なので回し直していない。上の票は直す前の問いへの票で、次に pnpm run judge が走るときに新しい問いで当て直る。
- 2026-10-04 (M25-15 への引き継ぎ): CNF-002/2 Q3 の 3×no は、「やめる」の focus の輪が .confirm-actions .chip:focus-visible だけ (src/ui/hud.css) で、撮影が page.click で板を開く (script からの focus には Chromium が :focus-visible を当てない) ため、画に輪が写らない可能性が高い。キーボードで開くか、.confirm-cancel に :focus の見える印を足すかは M25-15 が決める。
