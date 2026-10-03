---
id: M25-12
title: ADR 0001 の積み残し 5 つ (LLM の pass の失効・空の問い・CSS 変数・AUTOSAVE_TICKS の写し・閾値の例外の注)
status: in_progress
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-06, M25-07, M25-10, M25-11]
evidence: []
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

- [ ] 1: 偽の応答の試験で、pass の記録に digest が付き、画・承認済みの画・採点表のどれが変わっても次の judge で pass が消え、変わらなければ残る。今回当てない手順の pass も消える。人の判定・--image の試しは触らない (scripts/test_judge.py の StaleTest)
- [ ] 2: O9 を rubrics.json の OBS-002/2〜4 に足す。空を黒くした画を実機の claude -p で 3 票とも no、承認済みの 3 枚は 3 票とも yes (作業ログに票と費用)
- [ ] 3: `--harbor-dock-w` と `.hud-bl` の left。uncovered.spec の M25-10 の 3 試験が通り、基準画 20 枚が通る (CI 無しの shots)
- [ ] 4: confirm.spec.ts が src の定数を import する。confirm.spec が通る
- [ ] 5: ADR に 1 段落と決定 4 への 1 文を足す。既存の文は変えない
- [ ] `pnpm run check`・shots・uncovered・confirm の E2E が通る

## 作業ログ

- 2026-10-04: 起票。worktree m25-12 (feat/m25-12、feat/m19 の d05ae6c から)
