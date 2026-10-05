---
id: M25-12
title: ADR 0001 の積み残し 5 つ (LLM の pass の失効・空の問い・CSS 変数・AUTOSAVE_TICKS の写し・閾値の例外の注)
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-06, M25-07, M25-10, M25-11]
evidence:
  - "1: scripts/judge.py (digest_of・prune_stale・run)、scripts/test_judge.py の StaleTest (11 件。judge の試験は 78 件)"
  - "2: docs/acceptance/rubrics.json の O9 (OBS-002/2〜4)。実機の票は作業ログ"
  - "3: src/ui/harbor.css (--harbor-dock-w)・src/ui/hud.css、tests/e2e/uncovered.spec.ts の M25-10 の 3 試験、shots の基準画 20 枚 (CI 無し)"
  - "4: src/persist/autosave.ts、tests/e2e/confirm.spec.ts"
  - "5: docs/decisions/0001-acceptance-automation.md (例外の段落と決定 4 の 1 文)"
  - "commit: git log feat/m25-12 -1"
---

# ADR 0001 の積み残し 5 つ

優先度: Should

## What to build

M25-03・06・07・10 と M21-10 の「ユーザーの判断が要る点」「分かっている限り」に残った、小さな積み残しを 1 票で片づける。

1. **LLM の pass の失効** (M25-07 の「直さない」): judge.py が results.json に pass (by: llm) を書くとき、判じた画・承認済みの画・採点表 (その手順の問い) の内容の hash を一緒に書く。次に `pnpm run judge` が走って hash が合わなければ、その pass を消して判じ直す。
2. **空の問い** (M25-07): 観察画面の採点表に、空が描かれているかの問い (O9) を足す。基準画の空を画像処理で黒くした画を 3 票とも no で見つける。
3. **CSS 変数** (M25-10): `.harbor-dock` の幅 (36px) を `--harbor-dock-w` にし、`.hud-bl` の left をその変数 + 余白から出す。見た目は変えない。
4. **AUTOSAVE_TICKS の写し** (M21-10): `tests/e2e/confirm.spec.ts` の写しをやめる。
5. **ADR の注** (M25-03): 「基準画の閾値」の節に、字だけの細い板 4 要素の 0.12 の例外を足す。決定 4 の行にも 1 文足す。

## Blocked by

- M25-03・M25-06・M25-07・M25-10・M25-11 (どれも review 以降)

## Acceptance criteria

- [x] 1: 偽の応答の試験で、pass の記録に digest が付き、画・承認済みの画・採点表のどれが変わっても次の judge で pass が消え、変わらなければ残る。今回当てない手順の pass も消える。人の判定・--image の試しは触らない (scripts/test_judge.py の StaleTest)
- [x] 2: O9 を rubrics.json の OBS-002/2〜4 に足す。空を黒くした画を実機の claude -p で 3 票とも no、承認済みの 3 枚は 3 票とも yes (作業ログに票と費用)
- [x] 3: `--harbor-dock-w` と `.hud-bl` の left。uncovered.spec の M25-10 の 3 試験が通り、基準画 20 枚が通る (CI 無しの shots)
- [x] 4: confirm.spec.ts が src の定数を import する。confirm.spec が通る
- [x] 5: ADR に 1 段落と決定 4 への 1 文を足す。既存の文は変えない
- [x] `pnpm run check`・shots・uncovered・confirm の E2E が通る

## 作業ログ

- 2026-10-04: 起票。worktree m25-12 (feat/m25-12、feat/m19 の d05ae6c から)
- 2026-10-04: 実装 (feat/m25-12)。
  - 1: 手順の記録 (results.json の llm.steps と judge.json) に `digest` を足した。digest は、手順の画ごとに (画の名前と中身の sha256、承認済みの画の名前と中身、問いの id・文・ref) を JSON にして sha256。run は呼ぶ前に、expected (正本の judge が llm の手順) と今回の手順の digest を plan_of から出し、verdict が yes の記録の digest が合わない・無い (古い記録)・元が揃わない (画が無い) ものを results.json から消す。今回当てない手順の pass も消す。消した後は項目を組み直す (残りが無ければ項目ごと消え、足りない手順は「まだ当てていない手順」で undecided)。人の判定・fail・undecided・`--image` の試しには触らない。`run` の戻り値に消した手順を足した (5 つ組)。試験を先に書き (偽の応答、StaleTest)、`rec.get("verdict") == "yes"` の条件を外す変異で赤になるのを確かめた。入れていない元: 画素の基準画の有無・プロンプトの雛形・モデル (モデルが変わったときの失効は、ADR の「確かめていない仮定」のとおり results.json の cli・model を見て人が判じる)。
  - 2: O9「画の上の縁に、空 (または水平線の上の霞) が、淡い青・灰・白のうす色の階調 (上から下へ色が少しずつ移る) として描かれている」を OBS-002/2〜4 に足した。肯定の文にした (レビューの指摘。M25-07 で否定の文が割れた)。実機 (claude -p、sonnet、`--image`、results.json に書かない。置き場は scratchpad の m25-12/acc、画は基準画 3 枚の写し):

    | 画 | O9 の票 | 1 回の時間・換算 |
    |---|---|---|
    | 集落の空を黒く (画像処理、上 13% の空・霞の色の画素) | no/no/no | 11 秒・0.100 USD |
    | 集落の空を白く (同じ範囲を 255) | no/no/no | 12 秒・0.098 USD |
    | 海岸の空を黒く (上 12%) | no/no/no | 10 秒・0.099 USD |
    | 承認済みの 3 枚 (集落・群れ・海岸) | 3 手順とも yes/yes/yes | 9 回の呼び出しで 28 秒・0.231 USD |

    最初の問い (否定の文を含む版) でも、黒い画 2 回と海岸の黒い画で no/no/no (0.113・0.030・0.097 USD)、承認済みで yes/yes/yes だった。群れの画は空の範囲が三角で、画像処理の塗りが木を巻き込んだので試していない。実機の合計は約 0.9 USD・約 2 分。
  - 3: `.harbor-dock` に `box-sizing: border-box; width: var(--harbor-dock-w)`、変数は harbor.css の :root に 36px。`.hud-bl` の left は `calc(var(--harbor-dock-w) + 8px)` (= 44px)。札の中身は 20px の字で padding 16px なので、幅は今までの自然な幅と同じ。uncovered.spec の M25-10 の 3 試験と、shots の基準画 20 枚 (CI 無し、ACCEPTANCE_DIR は scratchpad) が通った。`.harbor-drawer { left: 34px }` は変数にしていない (別の値)。
  - 4: 同値を縛るのでなく import にした。tests/e2e は src/main.ts を import できない (起動の副作用がある) ので、定数を src/persist/autosave.ts へ移し、main.ts と confirm.spec.ts が同じものを読む。
  - 5: ADR に例外の段落を足し (「基準画の閾値」の節の末尾)、決定 4 の行に 1 文を足した。既存の文は変えていない。
  - レビュー (読むだけの opus)。直した: ADR の段落の事実 (確かめ方は toHaveText だけでなく正規表現もある・日付)、O9 を肯定の文に、白い空の試し、StaleTest に「fail は消さない」「人の項目は llm があっても触らない」を足し、試験名を中身に合わせた。直さない: digest にモデル・プロンプトを入れること、`expected` の既定が空のとき今回当てない手順の pass が全部消える (呼び手は main と試験だけで両方渡す)、`--step` の重複指定。
  - 検査: `pnpm run check` exit 0 (vitest 1225・worker 66・scripts 182)。E2E (CI 無し、E2E_PORT=5464) shots・uncovered・confirm の 18 件 passed (5.3 分)。
