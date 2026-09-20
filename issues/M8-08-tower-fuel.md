---
id: M8-08
title: 塔の燃料モデルと火の山の導線
status: in_progress
milestone: M8
plan: docs/design/2026-09-20-level-design-tower.md
depends_on: [M8-07]
evidence: []
---

# 塔の燃料モデルと火の山の導線

## What to build

塔は燃料で立つ。集落半径内の熱(heat)と鐘樹の材から年に一度燃料を徴収し、不足が続けば段階が下がる。石板と HUD に燃料の残りと必要量が出る。火山セルが分かり、そこに火山を打てば熱が燃料になる。

## Blocked by

M8-07

## Acceptance criteria

- [ ] 年次で fuel = 半径内の heat の和 × HEAT_FUEL + 鐘樹の立木 × TIMBER_RATE を徴収(heat と鐘樹を減らす)。FUEL_NEED[stage] に足りない年が FUEL_YEARS 続くと段階 −1(単体テスト)
- [ ] HUD の文明の行に「燃料 12 / 必要 8」、石板の警告 fuel_low、年表に燃料切れの衰退
- [ ] 火山セル(標高最大)を World が公開し、HUD の火山チップを持つとそのセルが強調される。噴火の熱が翌年の燃料に入る(単体 + E2E)
- [ ] レバー感度テスト(ヘッドレス、tests/unit か tests/slow): 噴火 1 回で塔の燃料が必要量の 2 年分以上入る
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

