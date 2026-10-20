---
id: M19-03
title: 回帰の通し実行
status: done
milestone: M21
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence:
  - 6634acf scripts/slow_report.py, scripts/test_slow_report.py (50 tests), test:slow:table
  - 07a3c5f caffeinate -ims・timeout・負荷・compare
  - b98e22c 分けの重さ
  - 055ff90 docs/specs/2026-10-18-decisions-current.md「回帰の通し実行の時間」、issues/README.md の判定行列のテンプレート
  - 層 A: .claude/verify/20261020-0607-m19-03/ (slow.md 1 本 43:11、slow-par2.md 2 本 23:11、compare 違い 0 件。端末の出力なので png は無し)
  - 取り込み 38978bb
---

# 回帰の通し実行

## What to build

全シナリオの判定行列を一括で回し、時間を管理する。長いものは並列に分け、結果を表にする。
2026-09-23 に M21(仕上げ)へ移した(id は保つ)。通し実行は 47 件・5 分割で約 55 分、並列 vitest は不可で、マイルストーンごとに 8 件前後増える(roadmap D7)。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] tests/slow を並列(worker)で回し、シナリオごとの結果と所要時間を表で出す
- [x] 合計時間の上限を決め、超えたら size を落とすかケースを間引く方針を設計書に書く
- [x] 新しいシナリオを足すときの手順(判定行列のテンプレート)を issues/README に
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-10-20: 実装・取り込み。並列不可の原因は 2 つ: (A) vitest の並列の単位はファイルで 47 件が 1 ファイル → describe ごとに -t で分けて処理を並べる。(B) 蓋を閉じた Mac の DarkWake で眠り、壁時計の時間切れが偽の失敗に → caffeinate -s が要る (-i では足りない)。49 件 (47+2。「34+2」は vitest list の畳んだ行数) すべて期待どおり、1 本 43:11・2 本 23:11、上限 30 分の内。書き換え候補 (承認待ち): README.md:41・:60、docs/architecture/fitness-functions.md:69 の「15〜20 分」と caffeinate の説明。
