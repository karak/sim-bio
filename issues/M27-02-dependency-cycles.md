---
id: M27-02
title: 周辺モジュールの循環を解く (年代記の型を chronicle へ、港と app を ui から切る)
status: done
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#58-ディレクトリの依存実測2026-10-10
depends_on: [M27-01]
evidence:
  - "c16527a refactor(chronicle): src/harbor/chronicle.ts → src/chronicle/chronicle.ts (git mv。呼び手 30 件。grep \"harbor/chronicle'\" src worker tests は空)"
  - "cac879d refactor(harbor): HarborStore・Outbound・Mark → src/harbor/store.ts。persist/harborStore.ts は実装 (openHarborStore・createMemoryHarborStore) だけ"
  - "5dcc794 refactor(harbor): receiveCargoClick → src/harbor/cargo.ts、visitHref → src/harbor/links.ts (ui/clicks.ts に再 export は無い)"
  - "2523679 refactor(app): src/ui/confirmAsk.ts → src/app/confirmAsk.ts (試験 tests/unit/ui.confirmAsk.test.ts は名前を変えず import だけ)"
  - "7ea4b85 refactor(scenario): describeEvent・DISASTER_LABEL・PRAYER_LABEL → src/scenario/describe.ts (試験 tests/unit/ui.tablet.test.ts は名前を変えず import だけ)"
  - "tests/unit/architecture.test.ts 'src の層の間に、値の import の循環が無い' 通過 (19 本 → 0 本)。pnpm run lint の no-restricted-imports 10 件 → 0 件"
  - "tests/unit/harbor.cargo.test.ts 'receiveCargoClick は積荷の種ごとに 1 つの放流 (量は積荷の量、半径は UI の放流と同じ)' は ui/clicks の SPAWN_RADIUS と比べたまま (UI の半径を 2 にすると赤になるのを確認)"
  - "pnpm run typecheck・lint 通過。unit 1373 件 (前と同じ。落ちるのは M27-03 の main.ts のラチェット 2 件だけ)・worker 66 件 (前と同じ)"
  - "E2E harbor・chronicle・confirm・scenarioSave・observe: 44 本通過 (E2E_PORT=5451、6.2 分)"
  - "pnpm run test:scripts 319 件・lint:py・check:readme 通過 (docs/acceptance/scenarios.jsonl は触っていない)"
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

- [x] `tests/unit/architecture.test.ts` の循環の試験と `pnpm run lint` が通る
- [x] `pnpm run check` 通過 (単体・worker・scripts の数は前と同じ)。ただし architecture.test.ts の main.ts の大きさのラチェット 2 件は M27-03 の赤のまま
- [x] 移した関数の試験は、import 先を変えるだけで中身を変えない (試験が守っている振る舞いが同じ)
- [x] E2E harbor・chronicle・confirm・scenarioSave・observe 通過

## 作業ログ

- 2026-10-10: 5 つの移動を 1 つずつコミットした。各コミットの後で typecheck・lint・循環の試験を回し、数をメッセージに書いた。
  - 数: lint の層の違反 10 → 5 (c16527a) → 4 (cac879d) → 2 (5dcc794) → 1 (aa3d5cc) → 0 (41436c9)。循環 19 → 14 → 14 (型だけの辺) → 2 → 0 → 0。
  - 受け取りの半径: receiveCargoClick は SPAWN_RADIUS を読む。harbor は ui を読めないので、cargo.ts の中に同じ値の定数 SPAWN_RADIUS (export しない) を置き、関数の本体は変えていない。UI と揃っていることは harbor.cargo.test.ts が ui/clicks の SPAWN_RADIUS と比べて見る (試験は層の外なので ui を読んでよい)。
  - PRAYER_LABEL: describeEvent は Tablet.ts の PRAYER_LABEL (祈りの文言の表) も読んでいた。DISASTER_LABEL と同じ純粋な表なので一緒に scenario/describe.ts へ移し、石板の祈りの行 (tabletViewOf) はそこから読む。
  - 試験のファイル名は変えない (agent は app.confirmAsk.test.ts・scenario.describe.test.ts に改名し、受入の正本 scenarios.jsonl の cover 5 か所も写していたが、正本の行の書き換えは承認制なので親が元の名前に戻した)。中身は import の行だけ変えた。
  - 置き場の変わった古いコメント (消さず書き換えず残した。直すかはユーザーの承認を待つ):
    - src/chronicle/chronicle.ts:8「M19-07 で chronicle/contract.ts から harbor/chronicle.ts へ移した。…」(今は chronicle/chronicle.ts。M27-02 で戻した経緯が無い)
    - src/harbor/cargo.ts:10「受け取った積荷は放流の命令 (ui/clicks.ts の receiveCargoClick) として…」(今は同じ cargo.ts の中)
    - src/app/confirmAsk.ts:4「(ダイアログの DOM は confirm.ts)」(confirm.ts は ui/ に残り、app/ から見ると ui/confirm.ts)
    - src/ui/Hud.ts:368「…確かめのダイアログ (confirm.ts) で。文は confirmAsk.ts)」(confirmAsk.ts は app/ へ移った)
    - src/harbor/store.ts の HarborStore の説明「島の置き場 (islandStore) と同じ DB の別の store に置く」(港の側の port に移ったので、persist の実装の話が型の側に残る)
  - 文書: docs/design/2026-09-26-cloudflare-architecture.md:463 の表が年代記の型を src/harbor/chronicle.ts と書く。過去の issue の作業ログの道は記録なので残した。
  - 依頼にあった docs/design/2026-10-10-architecture-review.md はこの worktree にも履歴にも無かった。この票の表を仕様として進めた。
- 2026-10-11: ユーザーが票の審査で承認 (done)。
