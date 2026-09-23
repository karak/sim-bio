---
id: M21-02
title: HUD の読みやすさ(材・拒否理由・迎撃の行・狼の波)
status: todo
milestone: M21
plan: docs/specs/plans/2026-09-23-roadmap.md#21-チケットになっていない負債既存-11-本の仕上げ
depends_on: []
evidence: []
---

# HUD の読みやすさ(材・拒否理由・迎撃の行・狼の波)

## What to build

プレイテストで記録した「分かりにくかった点」を直す(roadmap D2〜D5)。
- D2: 舟の行に徴収半径内の材を出す(林があと何年で舟を養えるか読めない。m10r-08 playtest)
- D3: 舟・迎撃の「押したが拒まれた」理由を行に出す(灰色のボタンと信仰の数値から推し量るしかない。m10r / m10r-08 playtest)
- D4: 三度砕いたあと(撃つ星が無い)は「迎撃」の行と「星を砕け」を畳む(m10r playtest)
- D5: 狼の波の警告から狼レイヤーを開けるよう促す(m10r-07 playtest)

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 舟の行に「材 X」(徴収半径内の鐘樹の材)。値を単体テストで、表示を E2E で確かめる(文言まで検証)
- [ ] 舟・迎撃を押して拒まれたとき、行に理由(信仰不足・材不足・備蓄不足など)が出る(E2E で文言を検証)
- [ ] 残りの星が 0 なら迎撃の行と「星を砕け」が隠れる(E2E)
- [ ] 狼の波の警告に狼レイヤーへの切り替え(ボタンか案内)がある(E2E)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
