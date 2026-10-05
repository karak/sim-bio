---
id: M26-09
title: 確かめのダイアログで押した OK にも focus の輪が一瞬出る
status: review
milestone: M26
plan: null
depends_on: [M25-15]
evidence:
  - "tests/e2e/confirm.spec.ts 'M26-09: マウスで押した OK ...' (直す前に赤: OK の outlineStyle が solid、直した後に緑)"
  - "tests/e2e/confirm.spec.ts 全 8 件緑 (M25-15 の試験を含む)、shots CNF-002 緑 (基準画は更新せず)"
  - "src/ui/confirm.ts focusWithRing、src/ui/hud.css .confirm-ring / :focus-visible"
  - "pnpm run check 緑 (vitest 1245 件)"
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

- [x] 押した OK に輪が出ない試験が通る。直す前に赤
- [x] M25-15 の試験と shots の CNF-002 が通る (基準画を更新しない)
- [x] `pnpm run check`、confirm.spec が通る

## 作業ログ

- 2026-10-04: 起票 (ユーザーの決定「focus は直す」)。
- 2026-10-04: 落ちる試験 (M26-09、マウスで OK を押している間の outline) を足して赤を確かめた。`focusWithRing` (script の focus に class `confirm-ring` を付け、blur で外す) と CSS を `.chip.confirm-ring, .chip:focus-visible` に絞って緑。confirm.spec 8 件・CNF-002・check が通る。
- 2026-10-04: 別 agent のレビューを受け、blur で activeElement がその札のままなら (窓の focus 喪失) 輪を残すようにし、Tab で移る試験を足した。confirm.spec 9 件・CNF-002 緑。
