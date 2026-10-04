---
id: M25-07
title: 観察画面の 3 枚 (集落・群れ・海岸) を撮り、採点表 O1〜O8 で LLM に判じさせる
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-02, M25-06]
evidence:
  - "正本 OBS-002 (scenarios.jsonl)、採点表 docs/acceptance/rubrics.json の OBS-002/2〜4 (O1〜O8)、撮影 tests/e2e/shots.spec.ts の OBS-002、時計 tests/driver/frames.ts・observe.ts、判定 scripts/judge.py (ref・records_pass)、試験 scripts/test_judge.py (65 件)"
  - "2 回撮って 3 枚とも差 0 画素 (作業ログ)"
  - "承認済み相当の 3 枚は 3 回とも 3 票 yes (9 回 x 3 = 27 回の呼び出し)。仕込んだ欠陥 (木・光・動物・地面の穴) は 3 票 no (作業ログの表)"
---

# 観察画面の 3 枚 (集落・群れ・海岸) を撮り、採点表 O1〜O8 で LLM に判じさせる

優先度: Should

## What to build

ADR 0001 の段 5。TUR-001 の「観察画面の島が絵として成り立って見える」を、画素の基準ではなく採点表 (ADR の付録 A、O1〜O8) に落とす。

作るもの:
- shots に観察画面の 3 枚を足す: `freeze=1&dynres=0&auto=0&shot=` の 集落・群れ・海岸 (src/observe/view.ts:709-723 の preset)。M25-02 の時計で止める
- 採点表 O1〜O8 を `docs/acceptance/rubrics/observe.md` に置き、承認済みの基準画 (動物 3 種は assets/textures/board/creatures/ を正とする) を並べて渡す
- 正本に観察画面の行を足し (`next OBS`)、手順に `judge: "llm"` を持たせる
- 観察画面は画素の基準を持たないので、3 票そろった yes で合格。人は並べて渡す基準画を替えるときにだけ承認する

## Blocked by

- M25-02 (観察画面の時計)
- M25-06 (judge の器)

## Acceptance criteria

- [x] 3 枚を 2 回撮り、木と動物の位置が同じ (freeze と時計で止まっている)
- [x] 仕込んだ欠陥 (木を消す・地面に穴を開ける・光を消す) を、それぞれ O2・O4・O3 が 3 票とも no で見つける
- [x] 今の観察画面の 3 枚は O1〜O8 が 3 票とも yes (no があれば票に起こす)
- [x] `uv run scripts/acceptance.py check` が通る

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 5)
- 2026-10-02: 実装。
  - 撮影: `OBS-002` を shots.spec.ts に足した。空の舟を tick 3600 (10 年目の春) まで進め、`?freeze=1&dynres=0&auto=0` で入り、tests/driver/frames.ts で performance.now と rAF を手で進める (1/60 秒 x コマ数)。`?clock=` だけでは個体が実時間で歩くので止まらない。視点は bench の 集落・群れ・海岸 (`__probe.observe.look`)。撮る間だけ本物の rAF に戻す。1 回 約 2.8 分。
  - 2 回撮った差: 3 枚とも 1280x720 で差のある画素 0 (最大差 0)。木と動物の位置は同じ。3D の画素の基準は持たない (基準画との比べは `pixels=false` で飛ばす)。
  - 正本: OBS-002 (auto、手順 3 つが judge: llm)。auto でも judge が llm の手順を持つ行の画は shots/ に書く (acceptance.py の check_shots も同じ)。既存の行は変えていない。
  - 合格の道: 問いに `"ref": true` を付けると docs/acceptance/observe-approved/<画と同じ名前> を基準画として並べて渡す (O7)。承認済みの画を持つ画だけの手順が 3 票 yes なら、results.json に `{verdict: "pass", by: "llm"}`。項目の pass は judge が llm の手順をすべて当てて全部 3 票 yes のときだけ。画素の基準を持つ画・人の判定は従来どおり書かない・上書きしない。
  - **ユーザーの承認待ち**: docs/acceptance/observe-approved/OBS-002-{1,2,3}.png は今の画 (承認の前の初期値)。ユーザーが見て、この 3 枚を基準にしてよいか決める。
  - 採点表: 最初の O4 「1 割を超えない」・O5 「見当たらない」は否定の文で、根拠が「無い」と書きながら no と答えて票が割れた (O5 no/yes/yes、O4 no/yes/yes)。「9 割以上が絵で埋まっている」「描きは正しい」の肯定の文に直したら割れなくなった。O6 は群れの画だけ。
  - 実機 (claude -p、sonnet、`--jobs 4`、ACCEPTANCE_DIR を scratchpad に): 承認済みの 3 枚 x 3 回 = 3 回の実行はすべて 3 手順が 3 票 yes (合格として記録)。9 回の呼び出しで 27〜31 秒、換算 0.095〜0.241 USD (初回は 0.24、キャッシュ後 0.1)。
  - 欠陥 (three.js の子を visible=false にして撮り直した画。--image で当て、記録には書かない) を 2 回ずつ:

    | 欠陥 | 画 | 見つけた問い | 1 回目 | 2 回目 |
    |---|---|---|---|---|
    | 木を消す (集落) | 手順 2 | O2 | no/no/no | no/no/no |
    | 光を消す (集落、真っ暗) | 手順 2 | O3 と O7 | no/no/no | no/no/no |
    | 動物を消す (群れ) | 手順 3 | O6 | no/no/no | no/no/no |
    | 地面を消す (群れ) | 手順 3 | O3・O4・O5・O7 | 3 票 no | 3 票 no |
    | 地面を消す (海岸) | 手順 4 | O2〜O5・O7 | 3 票 no | 3 票 no (O2 は割れ) |
    | 木を消す (海岸) | 手順 4 | O2 | no/no/no | no/no/no |
    | 空を消す (集落、白くなった) | 手順 2 | O7 (画風) | yes/yes/no で割れ | no/no/no |

    チケットの「木・地面の穴・光」は O2・O4(O3・O4)・O3 で 3 票 no。空の欠陥は専用の問いが無く O7 頼みで、1 回は割れた (undecided なので人に出る)。空の問いを足すかは判断が要る。
  - 費用・時間: 欠陥の 14 回の試し (1 回 3 呼び出し) は 1 回 9〜15 秒、0.03〜0.1 USD。
- 2026-10-02: レビュー。codex は認証切れ (`Your access token could not be refreshed`)、読むだけの opus で代えた。直した: (a) 承認済みの基準画は ref の問いがある手順でだけ「承認済み」とみなす (問いが無いのに pass になる穴)、(b) 正本に無い古い手順の記録を項目の verdict に入れない。試験を 65 件から 67 件へ。直さない (ユーザーの判断): 画・承認済みの画・問いが変わっても古い pass が残る (内容の hash を記録に足す案)、auto の行の judge の結果が受入の画面に出ない (acceptance.py の items.json は human の行だけ。docs/operations/acceptance.md の「合格は書かない」の文も古い)、`--image` は手順の先頭の画の承認済みの画と並べる、手動 rAF の中で本物の rAF を使った撮影の間の時刻。
- 2026-10-02: 検査。`pnpm run check` は vitest 1225 件・scripts 67 件を含め exit 0、`uv run scripts/acceptance.py check` ok (44 行)、E2E 全件 97 件 passed (6.3 分、shots の OBS-002 を含む)。
- 2026-10-02 19:00 ユーザーの承認: docs/acceptance/observe-approved/OBS-002-1〜3.png(集落・群れ・海岸)を承認済みの画として使う。
