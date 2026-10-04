---
id: M7-01
title: 力が上限に達したときの警告
status: done
milestone: M7
plan: docs/specs/plans/2026-09-19-m6-playtest.md#まとめ
depends_on: []
evidence: ["97a1327 tests/unit/scenario.warnings.test.ts tests/unit/scenario.budget.test.ts tests/unit/ui.tablet.test.ts tests/e2e/smoke.spec.ts"]
---

# 力が上限に達したときの警告

## What to build

石板の警告に「力が上限に達している(収入を捨てている)」を足す。budget.max に達した年に出る。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] scenarioWarnings に power_capped。PowerInfo に max。単体テストで真偽。
- [x] npm run check と E2E が通る

## 作業ログ

- 2026-09-19: 実装・テスト通過(97a1327)。
