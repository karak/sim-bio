---
id: M24-04
title: 操作画面 (自由モード・石板・訪問) から「タイトルへ」戻る
status: review
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-01]
evidence:
  - tests/unit/app.place.test.ts (planOp の表に「タイトルへ」× 自由・走っている石板・判定の出た石板・訪問の 4 行、タイトルへ戻る planOp title (M24-04))
  - tests/e2e/title.spec.ts (M24-04 の 2 本: 自由モード → タイトルへ → 続きから、判定の出た石板の確かめ)
  - src/app/place.ts (Op title・Effect to_title)、src/main.ts (to_title の perform)、src/ui/Hud.ts (#to-title)
  - tests/unit/app.place.test.ts (タイトルへ移る先 titleHrefOf の表 5 行と、合図のある起動の 1 本 (2026-10-10 の決定))
  - tests/e2e/title.spec.ts (M24-04 (2026-10-10 の決定): ?player= と ?dev=1 を残す 1 本)
  - src/app/place.ts (titleHrefOf)、commit 0788b0f
---

# 操作画面から「タイトルへ」戻る

優先度: Must

## What to build

設計 `docs/uiux/2026-10-04-title-flow.md` の「タイトルへ戻るときの約束 (M24-01 への申し送り)」の節のとおり、操作画面の HUD に「タイトルへ」を置く。M24-01 で `bootRouteOf` は openTitle の合図を扱い、`putOpenTitle` もあるが、呼ぶ所が無い (M24-01 の報告)。

ユーザーの決定 (2026-10-05): 作る。

- Op `{ kind: 'title' }` と Effect を `src/app/place.ts` の planOp に足す。確かめ (やり直しの効かない操作) は M21-04 の離れる確かめと同じ表で決める (走っている島は書き切ってから移る、判定の出た石板は確かめる、訪問は確かめない)
- 移る前に flush し、タブの印 (入った印) を外すか openTitle の合図を置いてから素の `/` へ
- 観察画面からは、操作画面を経る 2 段でよい (決定 7)

## Acceptance criteria

- [x] planOp の表の単体試験に title の行 (自由・走っている石板・判定の出た石板・訪問) を足す。先に赤
- [x] E2E: 自由モード → タイトルへ → タイトルが出て「続きから」で同じ島へ戻る。判定の出た石板では確かめが出る
- [x] キーボードで押せる・ラベルがある
- [x] `pnpm run check`・通しの E2E

## 作業ログ

- 2026-10-05: 起票 (M24-01 の報告の申し送り。ユーザーの決定「作る」)。

### 2026-10-05 (M24-04 の実装。ユーザーの審査待ち)

- 作業の場: worktree `.claude/worktrees/m24` (feat/m24、c699d27 から)
- 単体試験を先に書いて赤を見た: planOp の表 (`tests/unit/app.place.test.ts`) に「タイトルへ」の 4 行と、行き先の中身の 1 本。5 件が `TypeError: Cannot read properties of undefined (reading 'ask')` (planOp が title を知らず undefined を返す) で落ちるのを見てから実装した
- `Op { kind: 'title' }` と `Effect { kind: 'to_title' }` を src/app/place.ts に。確かめは `leaving(at)` (石板を選ぶ・自由モードへと同じ表): 走っている島は確かめず、判定の出た石板は「判定の出た島を離れる」、訪問は確かめない。効果は `flush` → `to_title` (訪問の flush は何も書かない)。確かめと行き先の道は planOp / runPlan / askOf のまま (別の道を持たない)
- main.ts の `to_title`: `putOpenTitle(sessionStorage)` (舞台に入った印を消して一回きりの合図) → `location.assign('/')`。起動の判断 `bootRouteOf` は合図を最初に見るので、E2E の開発の印 (storageState) があってもタイトルが出る
- HUD: 左上の時間の箱の速さの列の下の行に `#to-title`「タイトルへ」(button なのでキーボードで押せ、名はラベルの文)。`slotControlsOf` には入れない (訪問でも押せる)
- 観察画面からは、観察画面を出て操作画面の「タイトルへ」を押す 2 段 (決定 7)。観察画面の中には置いていない
- E2E (tests/e2e/title.spec.ts): 自由モードを進めて止め、focus + Enter で「タイトルへ」→ 確かめ無しでタイトル (検索語は空) → 「続きから」の要約の年が離れた年 → Enter で seed 42 の島の離れた tick 以後に戻る → 再読み込みはタイトルへ戻さない。判定の出た石板 (`?scenario=test-quick&shortcut=alive`) では「タイトルへ」が判定の板に覆われず、確かめの「やめる」で URL も判定の板もそのまま、「離れる」でタイトル
- 置き場の変更 (2026-10-05、通しの E2E で): 初めは下の帯の「新しい島」の後に置いたが、1280×720 の石板 (「石板を初めから」で帯が長い) で帯が 2 行に折り返し、種を放つ板が「石板を初めから」の上端を覆った (tests/e2e/uncovered.spec.ts の M26-04、`div#.hud hud-palette`)。左上の時間の箱の新しい行へ移し、uncovered.spec は通った
- 基準画: `pnpm run shots` の 6 本は移した後も通った (基準画の場面に左上の箱が入らないか差の内)。更新はしていない
- 狭い画面 (390 幅) では左上の時間の箱が右の板に覆われ、「タイトルへ」も速さの列と同じく押せない (前からある重なり、審査台の画)
- 移る先は票のとおり素の `/`。検索語の修飾 (`dev=1`・`player=` など) は残らない (開いた問いへ)

### 開いた問い (M24-04)

- 「タイトルへ」は素の `/` へ移るので、開発の `?player=<名前>` (置き場の DB を分ける) と `?dev=1` は落ちる。タイトルとその後の「続きから」は既定の見守り手の置き場を読む。石板の選択の「自由モードへ」(`searchFor`) のように修飾を残すかはユーザーの判断を待つ

### 2026-10-10 (開いた問いの決定と実装)

- ユーザーの決定: 「タイトルへ」は `?player=` と `?dev=1` を残す (自由モードへと同じ)。印も見守り手ごとに分ける (M24-05)
- 作業の場: worktree `.claude/worktrees/m24` (feat/m24)。先に feat/m19 を取り込んだ (64f5458、衝突なし、`pnpm run check` は通った)
- 先に赤を見た: `titleHrefOf` の表 6 件が `TypeError: titleHrefOf is not a function`。E2E は `Expected: "?player=e2e-title&dev=1" / Received: ""`
- `titleHrefOf(search)` (src/app/place.ts): `player` と `dev=1` だけを残し、石板・訪問・seed・近道などは落とす。main.ts の to_title が `location.assign(titleHrefOf(location.search))`。残した検索語があっても、移った先の起動は openTitle の合図でタイトルを出す (bootRouteOf は合図を最初に見る)
- `acceptance=`・`clock=`・`paused=` も落とす (舞台に入った後の受入の手順でタイトルを経ることは今は無い)
- E2E: `?player=e2e-title&dev=1&seed=42` で進めて「タイトルへ」→ 検索語は `?player=e2e-title&dev=1`、続きからはその見守り手の島の年、印は `biotope.last-stage@e2e-title` にだけある、Enter で戻った島に 1000x の札がある
- 結果: `pnpm run check` (単体 1361 件・worker 66 件・scripts 286 件) 通過。通しの E2E (`E2E_PORT=5461`、1 回で通し) は 115 件通過・6 件飛ばし (shots.spec の基準画、ACCEPTANCE_DIR が無いときは飛ばす)・落ち 0・揺れ 0、5.7 分
- レビュー: 別の agent (sonnet、読むだけ)。確信の高い指摘は無し。低い指摘: 空の `?player=` は `/?player=` で残る (開発の側が名を捨てるので害は無い、直していない)

