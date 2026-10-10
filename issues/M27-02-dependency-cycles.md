---
id: M27-02
title: 周辺モジュールの循環を解く (年代記の型を chronicle へ、港と app を ui から切る)
status: todo
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#58-ディレクトリの依存実測2026-10-10
depends_on: [M27-01]
evidence: []
---

# 周辺モジュールの循環を解く (R1)

優先度: Must

## What to build

振る舞いを変えない移動だけ。契約 (wire・HTTP の形・IndexedDB の形) は変えない。

| 循環 | 直し |
|---|---|
| chronicle ↔ harbor | `src/harbor/chronicle.ts` (Chronicle・Digest・TimedCommand・ReplayOutcome・parseChronicle・CHRONICLE_LIMITS ほか) を `src/chronicle/chronicle.ts` へ移す。harbor は chronicle を読む (逆は無し) |
| harbor ↔ persist | `HarborStore`・`Outbound`・`Mark` の型を `src/harbor/store.ts` (港の側の port) へ移し、`persist/harborStore.ts` はそれを実装する。harbor/client は persist を読まない |
| harbor → ui | `receiveCargoClick` を `src/harbor/cargo.ts` へ、`visitHref` を `src/harbor/links.ts` へ移す。`ui/clicks.ts` は UI の放流・災害・出港の入口だけ残す (再 export しない。呼び手を移す) |
| app ↔ ui | `Risky`・`Ask`・`askOf` を `src/app/confirmAsk.ts` へ移す (純粋。DOM は ui/confirm.ts のまま) |
| observe → ui | `describeEvent` (年表の 1 行の文) と `DISASTER_LABEL` を `src/scenario/describe.ts` へ移す。Tablet と observe/notice がそれを読む |

## 受入基準

- [ ] `tests/unit/architecture.test.ts` の循環の試験と `pnpm run lint` が通る
- [ ] `pnpm run check` 通過 (単体・worker・scripts の数は前と同じ)
- [ ] 移した関数の試験は、import 先を変えるだけで中身を変えない (試験が守っている振る舞いが同じ)
- [ ] E2E harbor・chronicle・confirm・scenarioSave・observe 通過

## 作業ログ
