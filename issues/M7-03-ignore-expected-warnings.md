---
id: M7-03
title: 予言どおりの進行を警告にしない
status: done
milestone: M7
plan: docs/specs/plans/2026-09-19-m6-playtest.md#まとめ
depends_on: []
evidence: ["97a1327 tests/unit/scenario.warnings.test.ts tests/unit/scenario.budget.test.ts tests/unit/ui.tablet.test.ts tests/e2e/smoke.spec.ts"]
---

# 予言どおりの進行を警告にしない

## What to build

沈む欠片では「陸が減っている」が常に出て他の警告を押し出す。シナリオが無視する警告の種類を宣言できるようにし、沈む欠片は land_low を無視する。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] ScenarioDef.ignoreWarnings。単体テストで除外。scenarios.json の沈む欠片に設定。
- [x] npm run check と E2E が通る

## 作業ログ

- 2026-09-19: 実装・テスト通過(97a1327)。
