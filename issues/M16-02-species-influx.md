---
id: M16-02
title: 種の流入イベント
status: todo
milestone: M16
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M16-00]
evidence: []
---

# 種の流入イベント

## What to build

予定命令で「土兎が湧く」ように、指定の種が周期的に指定の場所に増える。

## Blocked by

M16-00

## Acceptance criteria

- [ ] コマンド influx { speciesId, cell, radius, amount } と everyYears の予定で繰り返し放たれる(単体テスト)
- [ ] 年表とログ
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

