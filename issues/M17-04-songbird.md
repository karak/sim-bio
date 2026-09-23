---
id: M17-04
title: 歌鳥
status: todo
milestone: M14
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M14-00]
evidence: []
---

# 歌鳥

## What to build

歌鳥を放つと種子が運ばれ、植物の拡散率が上がる。
2026-09-23 に M14 へ移した(id は保つ)。鐘樹の拡散 0(M10R-08)の受け皿として、どの石板で使うかは M14-00 の LD で決める。

## Blocked by

M14-00

## Acceptance criteria

- [ ] 特殊枠の種。いるセルの周りで植物の diffusion が上がる(単体テスト)。放流チップに出る
- [ ] 凡例と年表に出る
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

