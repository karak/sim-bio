---
id: M27-03
title: main.ts を配線だけにする (再開・効果・介入・積荷・石板の組み立てを src/app へ)
status: todo
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: [M27-02]
evidence: []
---

# main.ts を配線だけにする (R2)

優先度: Should

## What to build

設計書 2026-09-19 §4「main.ts ── 配線のみ」に戻す。振る舞いは変えない。`main.ts` が持っている規則を、`src/app/place.ts` と同じ流儀 (純粋な関数と、deps を受ける小さな factory) で `src/app/` へ出す。

候補 (main.ts 1f83a26 の行):
- `scenarioConfigOf(base, species, scenario)` (石板の start の上書き、113〜130 行) → `src/app/worldConfig.ts`。純粋。単体試験 (seed・size・気候・文明・輝石・火山セル -1 の規約)
- `restoreFrom` の連鎖 (164〜203 行) と `openSlot` → `src/app/restore.ts`。`Restored` の型もここ
- `perform(Effect)` (268〜320 行) と `replaceWorld`・`slotSave` → `src/app/effects.ts` (`createEffects(deps)`)
- `intervene` と `landCargo` (223〜238・374〜392 行) → `src/app/intervene.ts`
- 石板の組み立て (`newRunner`・recorder・scenarioAutosave・`restartScenario`、470〜560 行) → `src/app/scenarioSession.ts`
- 地図のクリック (572〜605 行) → `src/ui/mapClick.ts` (press と同じ場所)
- タイトルからの入り (`enterFromTitle`・`scenarioProgressFor`、73〜109 行) → `src/app/title.ts`

`main.ts` に残るのは、fetch・DOM の取得・各部品の生成と接続・`loop.start()` だけ。

## 受入基準

- [ ] `tests/unit/architecture.test.ts` の main.ts ≤ 300 行と boot ≤ 250 行が通る
- [ ] 出した純粋な関数に単体試験 (scenarioConfigOf・restore の順・landCargo の門)
- [ ] `pnpm run check` 通過。E2E 通し通過 (smoke・title・persist・scenarioSave・confirm・harbor・chronicle・verdict・observe)
- [ ] 基準画 (`pnpm run shots`) が変わらない

## 作業ログ
