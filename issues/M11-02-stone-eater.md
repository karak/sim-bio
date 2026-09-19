---
id: M11-02
title: 石喰い
status: todo
milestone: M11
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M11-01]
evidence: []
---

# 石喰い

## What to build

星砂と輝石を食べる鉱物食の種「石喰い」を放てる。ゆっくり増え、星砂を減らす。

## Blocked by

M11-01

## Acceptance criteria

- [ ] trophic mineral の種。餌は星砂と輝石で、食べた分だけ層が減る(単体テスト)
- [ ] 餌がないと減り、餌があっても増加率が草食獣より遅い(単体テスト)
- [ ] 種の一覧・放流チップ・凡例・住みやすさレイヤーに出る(E2E)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

