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
- [ ] `pnpm run check`・通しの E2E

## 作業ログ

- 2026-10-05: 起票 (M24-01 の報告の申し送り。ユーザーの決定「作る」)。

### 2026-10-05 (M24-04 の実装。ユーザーの審査待ち)

- 作業の場: worktree `.claude/worktrees/m24` (feat/m24、c699d27 から)
- 単体試験を先に書いて赤を見た: planOp の表 (`tests/unit/app.place.test.ts`) に「タイトルへ」の 4 行と、行き先の中身の 1 本。5 件が `TypeError: Cannot read properties of undefined (reading 'ask')` (planOp が title を知らず undefined を返す) で落ちるのを見てから実装した
- `Op { kind: 'title' }` と `Effect { kind: 'to_title' }` を src/app/place.ts に。確かめは `leaving(at)` (石板を選ぶ・自由モードへと同じ表): 走っている島は確かめず、判定の出た石板は「判定の出た島を離れる」、訪問は確かめない。効果は `flush` → `to_title` (訪問の flush は何も書かない)。確かめと行き先の道は planOp / runPlan / askOf のまま (別の道を持たない)
- main.ts の `to_title`: `putOpenTitle(sessionStorage)` (舞台に入った印を消して一回きりの合図) → `location.assign('/')`。起動の判断 `bootRouteOf` は合図を最初に見るので、E2E の開発の印 (storageState) があってもタイトルが出る
- HUD: 下の帯の「新しい島」の後に区切りと `#to-title`「タイトルへ」(button なのでキーボードで押せ、名はラベルの文)。`slotControlsOf` には入れない (訪問でも押せる)
- 観察画面からは、観察画面を出て操作画面の「タイトルへ」を押す 2 段 (決定 7)。観察画面の中には置いていない
- E2E (tests/e2e/title.spec.ts): 自由モードを進めて止め、focus + Enter で「タイトルへ」→ 確かめ無しでタイトル (検索語は空) → 「続きから」の要約の年が離れた年 → Enter で seed 42 の島の離れた tick 以後に戻る → 再読み込みはタイトルへ戻さない。判定の出た石板 (`?scenario=test-quick&shortcut=alive`) では「タイトルへ」が判定の板に覆われず、確かめの「やめる」で URL も判定の板もそのまま、「離れる」でタイトル
- 基準画: `pnpm run shots` の 6 本は通った (下の帯の札が 1 つ増えても基準画の差の内)。更新はしていない
- 移る先は票のとおり素の `/`。検索語の修飾 (`dev=1`・`player=` など) は残らない (開いた問いへ)

### 開いた問い (M24-04)

- 「タイトルへ」は素の `/` へ移るので、開発の `?player=<名前>` (置き場の DB を分ける) と `?dev=1` は落ちる。タイトルとその後の「続きから」は既定の見守り手の置き場を読む。石板の選択の「自由モードへ」(`searchFor`) のように修飾を残すかはユーザーの判断を待つ
