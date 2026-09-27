---
id: M21-02
title: HUD の読みやすさ(材・拒否理由・迎撃の行・狼の波)
status: done
milestone: M21
plan: docs/specs/plans/2026-09-23-roadmap.md#21-チケットになっていない負債既存-11-本の仕上げ
depends_on: []
evidence: ["748f4d2 8b292ed ea2c1d5 b84ca9f e511c91 tests/unit/ui.hud.test.ts tests/unit/scenario.runner.test.ts", "tests/e2e/smoke.spec.ts 24 件(D3 押せない理由・D4 迎撃の行を畳む・D5 狼を見る)", "単体 521・E2E 24 green"]
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

- [x] 舟の行に「材 X」(徴収半径内の鐘樹の材)。値を単体テストで、表示を E2E で確かめる(文言まで検証)
- [x] 舟・迎撃を押して拒まれたとき、行に理由(信仰不足・材不足・備蓄不足など)が出る(E2E で文言を検証)
- [x] 残りの星が 0 なら迎撃の行と「星を砕け」が隠れる(E2E)
- [x] 狼の波の警告に狼レイヤーへの切り替え(ボタンか案内)がある(E2E)
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

## 作業ログ(2026-09-23)

- sonnet のサブエージェントが worktree で実装(748f4d2 8b292ed ea2c1d5 b84ca9f)、レビューして e511c91 で feat/m21 に merge。既存コメントの削除なし。
- 検証テスト用の hidden シナリオ test-event(狼の波の警告)・test-ship-gate(段階不足)・test-intercept-low(備蓄不足)を追加。
- 自由モードで #tablet-warnings が無いときの例外を E2E で見つけて直した(querySelector で確かめる)。
