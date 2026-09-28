---
id: M21-06
title: 受入の確かめの正本を jsonl (Gherkin) にし、受入の画面をそこから作る
status: review
milestone: M21
plan: docs/design/2026-09-29-acceptance-redesign.md
depends_on: []
evidence: []
---

# 受入の確かめの正本を jsonl (Gherkin) にし、受入の画面をそこから作る

優先度: Must

## What to build

2026-09-29 のユーザーの依頼(原文):
- 「いまある全ての受入試験の手順書の正本を適切なjsonl形式でSoT化。Gherkin形式。IDを固有のアルファベットコードつきで採番して管理」
- 「正直な話、待機時間も含めても手間がかかりすぎます。複数人ケースやバリエーションのあるものなどはロジックテストに任せる方向で再設計してください」

いまの作り: 手順は `.claude/acceptance/items.json`(git の外)に手で書き、回ごとに `a-*`・`r2-*` の id を付け直していた。
2026-09-29 に `base` を説明文で上書きし、全部のリンクが壊れた(r2-browse の保留)。
手順の多くは E2E の対がすでに CI で通っているのに、人が同じことを 100x で待ち、3 つのタブと DevTools で繰り返していた。

作るもの:
1. 正本 `docs/acceptance/scenarios.jsonl`。1 行が code (領域: Gherkin の機能) か scenario (Gherkin の 1 シナリオ)。ID は `<領域 3 字>-<連番 3 桁>`(例 `HBR-004`)。行は消さずに `retired` にし、番号は使い回さない。
2. `scripts/acceptance.py`(check・page・feature・next)と `scripts/test_acceptance.py`。正本の検査は `pnpm run check` の `test:scripts` の中で回る。
3. `pnpm run acceptance:page` で受入の画面の `items.json` を書く。`base` は wrangler.jsonc から作り、手で書かない。書く前に base を GET して、答えなければ落ちる。
4. 旧い 25 件と H9・H10 を正本に移す。複数人・二つの島・DevTools・成功までの待ち・組み合わせは、自動の試験に任せる。

## Acceptance criteria

- [ ] 正本に旧い 25 件と H9・H10 のどの id も、どれかの行の `from` に入っている(`test_acceptance.py` の `test_every_legacy_procedure_is_claimed`)
- [ ] 人の 1 周は TUR-001・TUR-002 の 2 行 (9 分)、配ったあとの本番は OPS-001・OPS-002 (H9・H10)。どれも `player=` を使わず、2 つ目の島・DevTools を要らない
- [ ] `check` が次を落とす(壊した正本を渡して落ちることを単体試験で見る)
  - ID の形・宣言の無い領域・重なり・領域の中の連番の抜け(行を消した)
  - Gherkin の順(前提 か もし で始まり、ならば を持つ)
  - links の path が `/` で始まる根からの道でない(`http://`・`//`・github の URL・説明文)。人の確かめの links の `player=`
  - covered_by の題名がそのファイルに無い。planned のチケットが無い・done・試験がもうある
  - active の auto に今ある試験が 1 つも無い
  - 1 回 (round・deploy ごと) の human の minutes の和が 15 を越える
- [ ] `page` は results.json を読むだけで書き換えない。results.json のどの鍵も、どれかの id か from に当たる(当たらなければ書かずに落ちる)
- [ ] 受入の画面で、旧い結果(1 回目・2 回目のメモ)が新しい行の下に読め、任せた行の一覧(判定の札なし)が読める

## 作業ログ

## 分かっている限り

- 領域の連番の抜けで「行を消した」は見つかるが、領域の最後の行を消して同じ番号で書き直すのは見つからない(git の差分の検査は付けていない)
- 人の 1 周の【見た目】の多くは、E2E が撮った画で済ませられる (M21-08)。港の閉港の知らせの読みやすさは、今の人の 1 周には入っていない (閉港を作るのに DevTools が要る)
