---
id: M14-02
title: 外来種イベント
status: todo
milestone: M14
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M14-01]
evidence: []
---

# 外来種イベント

## What to build

環の周期で隣島から外来種が来て、在来種と競合し、疫病を持ち込む。シナリオの予定命令で起こせる。

## Blocked by

M14-01

## Acceptance criteria

- [ ] コマンド arrive_species { speciesId, cell, amount, plague? }。plague なら着地点に疫病(単体テスト)
- [ ] 外来種は種の一覧に「外来」の印で出て、凡例・住みやすさに並ぶ(E2E)
- [ ] 年表とログ
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

