---
id: M7-02
title: 出来事の年表
status: todo
milestone: M7
plan: docs/specs/plans/2026-09-19-m6-playtest.md#まとめ
depends_on: []
evidence: []
---

# 出来事の年表

## What to build

石板に折りたたみの年表を置き、介入(放流・災害・気候)、予定イベント(毎年の沈降は除く)、力切れ、警告の初回、勝敗を年付きで並べる。100 倍速で見逃した力切れを後から読める。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] ScenarioRunner.timeline() が出来事を積む(単体テスト)。Tablet の details に直近 6 件。E2E: 放流すると年表に 1 件増える。
- [ ] npm run check と E2E が通る

## 作業ログ

