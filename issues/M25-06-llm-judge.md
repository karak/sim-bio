---
id: M25-06
title: pnpm run judge: 手元の claude -p で採点表に当て、3 票の多数決を results.json に書く
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-05]
evidence:
  - "scripts/judge.py・scripts/test_judge.py (42 件)。pnpm run judge (package.json)。採点表は docs/acceptance/rubrics.json"
  - "欠陥 2 つ (ピンを海の色に・確かめの文を切る) を 3 回ずつ流して、どれも 3 票とも no (作業ログの表)。観察画面の木は M25-07 の画が無いので未"
  - "承認済みの画 (SEL-003-1・CNF-002-1) は 3 回とも 3 票とも yes"
  - "48 回 (12 手順・手順ごとの画 16 枚 x 3 票、--jobs 4) が 85 秒・0.608 USD (sonnet)"
  - "scripts/test_judge.py の WriteTest.test_the_written_entry_passes_check_results_and_the_review_pages_verdict_values (check_results を通る)"
  - "鍵の環境変数を渡さない: test_judge.py の RunClaudeTest。実機も ANTHROPIC_API_KEY を外して回した"
---

# pnpm run judge: 手元の claude -p で採点表に当て、3 票の多数決を results.json に書く

優先度: Should

## What to build

ADR 0001 の段 5。2026-10-01 のユーザーの判断 2 (手元の `claude -p` で回す。API の鍵は持たない)。
試した呼び方と数は ADR の付録 B の 4 (1 回 10〜14 秒、換算 0.015〜0.033 USD、5 問 × 2 枚 × 3 回で答えがそろった)。元は tools/acceptance-probe/judge.sh (M25-01 で写す)。

作るもの:
- `scripts/judge.py`: 正本の `judge: "llm"` の手順ごとに、画と採点表 (rubric) と JSON schema で `claude -p` を 3 回呼ぶ。`--system-prompt`・`--setting-sources ""`・`--strict-mcp-config`・`--disable-slash-commands`・`--tools Read` で手元の CLAUDE.md・MCP・スキルを読ませない。標準入力は閉じる。答えの言語を問いに書く
- 問いごとの多数決。3 票そろわない問いと no の問いだけを人に出す
- results.json に `judge: "llm"` と、票・根拠・CLI の版・モデル・換算額・時刻を書く
- 画素の基準を持つ画は LLM の yes だけでは合格にしない (ADR の「LLM の判定」)
- `pnpm run judge` を package.json に足す。CI では回さない

## Blocked by

- M25-03 (承認済みの基準画を並べて渡す)
- M25-05 (judge の欄)

## Acceptance criteria

- [ ] 仕込んだ欠陥 3 つ (ピンを海の色にする・確かめの文を切る・観察画面の木を消す) を、3 票とも no で見つける (作業ログに票を写す)
- [x] 承認済みの画は 3 票とも yes
- [x] 1 回の受入 (画 16 枚 × 3 票) の時間と換算額を作業ログに書く (見積もりは直列 10 分・4 並列 2.5 分・約 1 USD)
- [x] results.json の書き方が acceptance.py の check_results を通る (test_acceptance.py)
- [x] 鍵の環境変数が無くても回る

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 5)
- 2026-10-01: 実装。`scripts/judge.py` (PEP 723、ruff、test_judge.py 42 件) と `pnpm run judge`。正本は変えない。今は judge が llm の手順が無いので、`--step <ID>/<n>` (と欠陥の画を当てる `--image`) で任意の手順を当てる。`claude -p` の呼び出しは引数 (`Runner`) で、単体試験は偽の応答。
  - 呼び方: ADR 付録 B の 4 のとおり (`--system-prompt`・`--setting-sources ""`・`--strict-mcp-config`・`--disable-slash-commands`・`--tools Read`・標準入力を閉じる)。`--bare` は使わない。`ANTHROPIC_API_KEY`・`ANTHROPIC_AUTH_TOKEN` は子に渡さない。Claude Code 2.1.285、モデルは `--model sonnet` (claude-sonnet-5-5)。opus は要らなかった。
  - 画の選び方: 手順の文の「画 N」「画 N〜M」が指す `shots/<ID>-<N>.png`、指さなければその行の画すべて。問いは `docs/acceptance/rubrics.json` (<ID>/<n>) か、無ければ手順の文 1 つ。
  - 書き方: fail (3 票とも no)・undecided (割れ・呼び出しの失敗) だけ `results.json` に `{verdict, note, at, by: "llm", llm: {cli, model, cost_usd, steps}}`。合格は書かない。人の判定 (by が llm でない) は上書きしない。受入の画面 (index.html) は合格・保留・不合格の 3 つだけを知り、`undecided` は「未判定」として出て note に根拠が出る (画面の server は人が押すと by と llm を落とす)。全部の票は `judge.json`。画素の基準を持つ画は 3 票 yes でも `writes_pass: false`。
  - 欠陥の試し (scratchpad の m25-06/defects、`SEL-003-1.png` と `CNF-002-1.png` を画像処理で作った)。票は yes/no の並び、3 回流した。

    | 画 | 問い | 1 回目 | 2 回目 | 3 回目 |
    |---|---|---|---|---|
    | SEL-003-1 (承認済み) | Q1 ピンが見える・Q2 色で見分けられる | yes/yes/yes・yes/yes/yes | 同じ | 同じ |
    | SEL-003-1 のピンを海の色 (48,92,121) に | 同じ | no/no/no・no/no/no | 同じ | 同じ |
    | CNF-002-1 (承認済み) | 手順の文 (文が何を失うかを言っている) | yes/yes/yes | 同じ | 同じ |
    | CNF-002-1 の文の右 150px を板の色で塗って切る | 同じ | no/no/no | 同じ | 同じ |

    問いを rubrics.json に書く前の既定の問い (手順の文だけ) では、ピンの欠陥は no/yes/no と割れた (undecided になる)。ピンの 2 問を rubrics.json に書いて 3/3 になった。問いの書き方が質を決める (ADR の「悪い面」のとおり)。
  - 時間と費用: 1 回の呼び出しは 5〜10 秒、0.014〜0.023 USD (ADR の 10〜14 秒・0.015〜0.033 より速く安い)。1 枚 3 票は 6〜9 秒・0.015〜0.065 USD。`SEL-003/2・CNF-002/2・CNF-002/3・HBR-006/2〜6・CRG-005/2〜3・SEL-003/3〜4` の 手順ごとの画 16 枚 (13 枚の画、CNF-002 の 3 枚は 2 手順で重なる) x 3 票 = 48 回を `--jobs 4` で 85 秒・0.608 USD (見積もりの 4 並列 2.5 分・約 1 USD より速く安い)。
  - 実際の画に当てた 48 回の結果: HBR-006/6 (「この石板で最後に判定の出た島」の直下に島の表示が無い)・CNF-002/2 (「やめる」に光が当たって見えない)・SEL-003/3 (帯が「淡い琥珀」でなく細い黄色の線) が 3 票とも no、ほかの 9 手順は 3 票とも yes。本物の欠陥か採点表の問いの粗さかは人が画を見て決める (チケットの外)。
  - 残り: 観察画面の木を消した欠陥は、観察画面の撮影 (M25-07) が無く画が無いので試していない。
- 2026-10-01: レビュー。codex は認証が切れていて動かず (`Your access token could not be refreshed`)、読むだけの別モデル (opus) のレビュアーで代えた。直した: (1) `--image` で画を替えた試しは results.json・judge.json に書かない (欠陥の fail が記録に残るため)、(2) results.json・judge.json が壊れていれば呼び出しの前に止まる、(3) 一時ファイル名を一意にする (画面のサーバーの `results.json.tmp` と衝突)、(4) 呼び出しがすべて失敗した手順は記録を書き換えず終了コード 1、stderr を票の error に入れる、(5) note の票の数は実際の数、(6) 手順が指す画が欠けていれば止まる、(7) `--image` の基準は手順本来の画で見る。試験は 42 件から 53 件へ。直した後の欠陥の試しも 3 票とも no・承認済みの画は 3 票とも yes のまま (2 手順、6〜7 秒、0.014〜0.016 USD)。
