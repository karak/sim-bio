---
id: M25-17
title: 表の試験が覆う E2E 2 件を間引く
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M21-07]
evidence:
  - "tests/e2e/confirm.spec.ts: confirm.spec:219 を消した (コミット『test(e2e): 表が覆う「M21-04: 判定の前の石板から石板を選び直すのは確かめない」を消す』)"
  - "tests/e2e/harbor.spec.ts:267 は残した (下の作業ログの対応表)"
  - "docs/acceptance/scenarios.jsonl: CNF-001 の covered_by から消した E2E の題を外した (uv run scripts/acceptance.py check が ok: 45 scenarios)"
---

# 表の試験が覆う E2E 2 件を間引く

優先度: Could

## What to build

ユーザーの決定 (2026-10-04): M21-07 の表の試験 (tests/unit/app.place.test.ts・harbor.dock.test.ts・harbor.cargo.test.ts) が覆う組み合わせの E2E を間引く。候補は M21-07 の作業ログの 2 件。

- `tests/e2e/confirm.spec.ts:219` 「M21-04: 判定の前の石板から石板を選び直すのは確かめない (続きは書き切ってから移り、戻れば続きから)」
- `tests/e2e/harbor.spec.ts:267` 「M19-10: 星の力が足りなければ積荷を受け取らず (1 種も放たない)、控えも残さない」

やること:
1. 各 E2E が確かめる断言を 1 つずつ挙げ、表の試験のどの行が覆うかを示す (ファイル・行・名前)
2. 表が覆わない断言 (例: harbor:267 の「控えも残さない」は保存の副作用) があれば、その E2E は残すか、その断言だけに縮める。消すのは全部が覆われているものだけ
3. 配線の E2E (操作 1 つ × 受ける/やめる 1 組) は残す
4. 消すときは試験の名前と覆う表の行をコミットの文に書く。既存のコメントの削除は、消す試験の中のものに限る (試験ごと消えるのは可)

## Blocked by

- なし

## Acceptance criteria

- [x] 2 件それぞれに「消す / 縮める / 残す」の結論と、覆う表の行の対応が作業ログにある
- [x] `pnpm run check` と E2E の confirm.spec・harbor.spec が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 10)。
- 2026-10-04: 基点は feat/m19 7ef5e90 (worktree m25-17、ブランチ feat/m25-17)。2 件の断言を 1 つずつ挙げ、表の試験の行と突き合わせた

  **confirm.spec「M21-04: 判定の前の石板から石板を選び直すのは確かめない」 → 消す**
  - 本体は test-quick を止めて (speed-0) tablet-select で sinking を選ぶだけ。断言は 3 つ
    1. 確かめが出ない (`dialog` が 0 件): tests/unit/app.place.test.ts:129 「planOp (M21-07): … : 石板を選ぶ × 走っている石板」(ask null・effects は flush → go)
    2. URL が `?scenario=sinking` になる: 同 :205 「searchFor (M21-07): scenario だけを差し替え…」(と、go の effect が表の :129 の行)
    3. 石板の題に「沈む」が出る (選んだ石板が開く): 表の試験は見ない (Hud の select → main.ts → 石板の読み込みの配線)。ただし同じ配線を同じ 3 つの断言で confirm.spec「M26-02: 訪問中に石板を選ぶと、確かめは出ず、URL から visit が消え、石板の島が自分のものとして開く」が見ている (起点が訪問か走っている石板かの違いだけ。表の :129 と :131 は同じ ask null・flush → go)。判定の出た島からの選び直し (やめる側) はconfirm.spec:171「M21-04: 判定の後に枠へ保存でき…石板を選ぶは確かめ、取り消せば判定の島のまま…」が残る (やめる側、と受ける側)
  - 試験の名前の「書き切ってから移り、戻れば続きから」は本体の断言に無い (書き切る = flush は表の :129 の effects が縛る。戻れば続きからは persist.spec M19-05 が閉じて開き直しで見る。M21-07 の作業ログの「ここで見ている」は名前だけで、本体は見ていなかった)
  - 全部が覆われるので消した。配線の E2E (操作 1 つ × 受ける/やめる 1 組) は M26-02 と、confirm.spec:171 (判定の出た島からの選び直し) が残る

  **harbor.spec「M19-10: 星の力が足りなければ積荷を受け取らず…、控えも残さない」 → 残す**
  - 本体は test-quick で積荷 4 種を流し着かせ、浜を見て受け取るを押す。断言は 4 つ
    1. 状態の文が「星の力が足りない。力が溜まってから、もう一度受け取る」: 文は tests/unit/ui.harborText.test.ts:80 (`receiveText('budget')`)、budget になる条件は tests/unit/harbor.cargo.test.ts:150 (power 5 < 2 種 × 3 = 6 で budget、6 で land)。ただし LandResult から板の文への配線 (main.ts:289 の `landing.kind`) は表が見ない
    2. 星の力が 10 / 30 のまま: harbor.cargo.test.ts:144 の「どちらも命令を 1 つも出さない」(`{ kind: 'budget' }` に commands が無い) が部分的に覆う。板の表示の更新は見ない
    3. 「受け取る」のボタンが残る (また押せる): tests/unit/harbor.client.test.ts:293 が控えを残さず再び受け取れることを見る (client の層)。ボタンの DOM は覆われない
    4. 保存した命令が無い (`storedCommands` が null): harbor.cargo.test.ts:144 の命令無しが部分的。保存の副作用 (dispatch の門・年代記) は覆われない
  - 表の試験は gate (`finished`・`budget.power`・`spawnCost`) を手で渡す。本番で runner.budget() の力と scenario の costs.spawn から gate を組む配線 (main.ts:285-288) は、この E2E だけが通す (4 種 × 3 = 12 > 10 になる実際の石板と)
  - 4 つとも「この操作 1 つ × 受けられない」の配線の観察で、表が覆うのは判断の部分だけなので残した。縮める余地は断言 1 つ (文) だけだが、1 つ減らしても試験の実行は変わらないので縮めない
