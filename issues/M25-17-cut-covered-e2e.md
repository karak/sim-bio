---
id: M25-17
title: 表の試験が覆う E2E 2 件を間引く
status: open
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M21-07]
evidence: []
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

- [ ] 2 件それぞれに「消す / 縮める / 残す」の結論と、覆う表の行の対応が作業ログにある
- [ ] `pnpm run check` と E2E の confirm.spec・harbor.spec が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 10)。
