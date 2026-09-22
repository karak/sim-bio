---
id: M10R-02
title: 民の記憶(信仰の上限)と絶え間ない祈り
status: in_progress
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#31-民の記憶--信仰の上限民の特性m10r-02
depends_on: [M10R-01]
evidence: []
---

# 民の記憶(信仰の上限)と絶え間ない祈り

## What to build

LD §3.1/§3.2。`CivState.faithCap`(初期 1.0)を足し、祈りの無視で −0.10、応えで +0.10、祈りの無い年に +0.01 回復。
毎年の信仰の更新の後で `min(faith, faithCap)` に抑え、内乱の戻りは min(0.4, 上限)。祈りの間隔(PRAYER_COOLDOWN)を 0 にする。
HUD の信仰行に上限、石板の年表に「民は忘れない」、保存に含める。

## Blocked by

M10R-01

## Acceptance criteria

- [ ] faith.ts の純粋関数で上限の更新(無視/応え/回復/クランプ)が単体テストで確かめられる
- [ ] World で無視 → 上限が下がり、儀式を続けても信仰が上限を超えない。内乱の後の信仰が min(0.4, 上限)。save/restore で往復
- [ ] 祈りが解決/無視/取り下げになった翌年に、困りごとが続いていれば次の祈りが出る
- [ ] HUD・石板に上限が出る(内容検証のテスト)。E2E が通る
- [ ] npm run check と単体・E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
