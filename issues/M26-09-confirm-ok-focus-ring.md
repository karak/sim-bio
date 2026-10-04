---
id: M26-09
title: 確かめのダイアログで押した OK にも focus の輪が一瞬出る
status: open
milestone: M26
plan: null
depends_on: [M25-15]
evidence: []
---

# 押した OK に focus の輪が出る

優先度: Should

## What to build

M25-15 で `src/ui/hud.css:88` の `.confirm-actions .chip:focus-visible` を `:focus` に広げた (マウスで開くと script の focus() の「やめる」に :focus-visible が当たらず、輪が出なかったため)。その副作用で、マウスで押した OK (と「やめる」) にも押した瞬間に輪が出る。

ユーザーの決定 (2026-10-04): 直す。開いた時の「やめる」の輪は今のまま。

やること:
1. 落ちる試験: E2E でマウスで OK を押した時 (pointerdown の後・閉じる前) に OK の outline が無い。M25-15 の試験 (マウスで開き「やめる」の outline を読む) は通るまま
2. 直す: 輪を出すのを「script が focus した時」と「キーボードの focus (:focus-visible)」に絞る (例: focus() の時に付け blur で外す class)。:focus-visible に戻すだけにはしない
3. 基準画 CNF-002-1〜3 が変わらない (「やめる」の輪は同じ画素)

## Acceptance criteria

- [ ] 押した OK に輪が出ない試験が通る。直す前に赤
- [ ] M25-15 の試験と shots の CNF-002 が通る (基準画を更新しない)
- [ ] `pnpm run check`、confirm.spec が通る

## 作業ログ

- 2026-10-04: 起票 (ユーザーの決定「focus は直す」)。
