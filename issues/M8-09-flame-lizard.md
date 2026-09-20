---
id: M8-09
title: 炎蜥蜴(熱でしか増えない肉食)
status: todo
milestone: M8
plan: docs/design/2026-09-20-level-design-tower.md
depends_on: [M8-08]
evidence: []
---

# 炎蜥蜴(熱でしか増えない肉食)

## What to build

噴火後の熱いセルだけで生き、鹿を食う肉食の種「炎蜥蜴」を足す。火で塔を支えるほど民が減る代償になる。疫病で減らせる。

## Blocked by

M8-08

## Acceptance criteria

- [ ] species.json に炎蜥蜴(carnivore、tempRange [30,80]、eats deer、色とアセット)。熱の無い島では自然に消える(単体テスト)
- [ ] 副作用テスト(ヘッドレス): 火山を 3 回噴火させると炎蜥蜴が湧き、集落周りの鹿が基準の 5 割を割る
- [ ] 凡例・放流チップ・住みやすさレイヤーに出る(E2E)。放流チップは出さない(見守り手は炎蜥蜴を放てない)か、出すかを LD で決める
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

