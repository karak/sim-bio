---
id: M17-02
title: 夢喰い
status: todo
milestone: M17
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-01]
evidence: []
---

# 夢喰い

## What to build

信仰が低く文明があると夢喰いが現れ、知性種を食う。信仰を上げれば去る。

## Blocked by

M9-01

## Acceptance criteria

- [ ] 信仰 < 0.3 が 5 年続き段階 ≥ 歌なら出現。出現中は知性種の集落の民が年ごとに減る。信仰 ≥ 0.5 で去る(単体テスト)
- [ ] SceneView に影、年表とログ、保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

