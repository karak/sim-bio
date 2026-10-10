---
id: M27-03
title: main.ts を配線だけにする (再開・効果・介入・積荷・石板の組み立てを src/app へ)
status: review
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: [M27-02]
evidence:
  - "b6d8959 refactor(app): scenarioConfigOf → src/app/worldConfig.ts。試験 tests/unit/app.worldConfig.test.ts (7 件: 石板無し・start 無し・seed/size/気候/輝石・base を書き換えない・種・文明・火山セル -1)"
  - "e110d9e refactor(app): Restored・openSlot・restoreFrom と restore の並びの輪 → src/app/restore.ts の restoreIsland。試験 tests/unit/app.restore.test.ts (7 件: 並びと最初に戻せた島で止まる・fromSlot・違う舞台の枠は投げる・頭が無いと石板の続きを読まない・seed=・persist.slot.load.failed・何も戻せない)"
  - "f936d6f refactor(app): main.ts の島の状態の let を src/app/session.ts の Session 1 つに (下ごしらえ)"
  - "7dc7a15 refactor(app): perform・replaceWorld・slotSave・showSeed → src/app/effects.ts の createEffects (nav の向こうに location・history)。試験 tests/unit/app.effects.test.ts (6 件: refuse・replace の拒み・replace の差し替え・地図の作り直し・go/assign/to_title・flush が両方を待つ)"
  - "758e919 refactor(app): intervene・landCargo → src/app/intervene.ts の createIntervene・createLandCargo。試験 tests/unit/app.intervene.test.ts (6 件: 漂着の門 refused・budget と揺れ・受け取り・入口が弾く、入口の訪問・自由・記録器)"
  - "5845156 refactor(app): if (scenario) の石板の組み立て → src/app/scenarioSession.ts の createScenarioSession (E2E が見る)"
  - "42e0f4d refactor(ui): 地図のクリック → src/ui/mapClick.ts の mountMapClick (押しの判別は tests/unit/press.test.ts)"
  - "1a6c766 refactor(app): enterFromTitle・scenarioProgressFor → src/app/title.ts の createTitle (E2E title が見る)"
  - "2c0ac0d refactor(app): onFrame の本体 → src/app/frame.ts の createOnFrame。tests/unit/architecture.test.ts 'main.ts は配線だけ (設計書 §4)' と '本体 150 行を超える関数は表のものだけで、表の上限を超えない' が通る (main.ts 623 → 261 行、boot 568 → 220 行。柵の値は変えていない)"
  - "pnpm run check 通過: unit 1399 件 (前 1373 + 新しい試験 26)・worker 66 件・scripts 319 件・typecheck・lint・lint:py・check:readme"
  - "E2E 通し (E2E_PORT=5452、2c0ac0d): 118 通過・6 skip (shots は ACCEPTANCE_DIR が無いと skip)・失敗 0 (6.7 分)。途中 5845156 で scenarioSave・verdict・harbor・chronicle 33 本通過"
  - "基準画: ACCEPTANCE_DIR を scratchpad にして tests/e2e/shots.spec.ts を回し、6 本通過 (darwin なので tests/e2e/baselines の 24 枚と toHaveScreenshot で比べる)"
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

- [x] `tests/unit/architecture.test.ts` の main.ts ≤ 300 行と boot ≤ 250 行が通る
- [x] 出した純粋な関数に単体試験 (scenarioConfigOf・restore の順・landCargo の門)
- [x] `pnpm run check` 通過。E2E 通し通過 (smoke・title・persist・scenarioSave・confirm・harbor・chronicle・verdict・observe)
- [x] 基準画 (`pnpm run shots`) が変わらない

## 作業ログ

- 2026-10-10: 7 つの部品と、その下ごしらえ (Session) と、onFrame を 1 つずつコミットした。各コミットの後で typecheck・lint・vitest を回した (柵の 2 件だけ赤のまま、最後の 2c0ac0d で通る)。
  - 数 (main.ts の行 / boot の本体の行): 35a458c 623 / 568 → b6d8959 608 / 553 → e110d9e 567 / 514 → f936d6f 549 / 497 → 7dc7a15 493 / 440 → 758e919 460 / 408 → 5845156 374 / 329 → 42e0f4d 324 / 280 → 1a6c766 292 / 251 → 2c0ac0d 261 / 220。title まで出しても boot が 251 行で 1 行足りず、票の「残るもの」に挙げた onFrame を app/frame.ts へ出した。
  - 状態: 閉包が捕まえていた let (world・selected・runner・recorder・scenarioAutosave・restartScenario・scenarioStep・viewing) は src/app/session.ts の Session 1 つにまとめ、部品は同じ Session を読み書きする。各 let の説明のコメントは Session の欄へ移した。HUD のチップ (armed・spawnArmed・towerArmed) は地図のクリックだけが読むので、Session ではなく ui/mapClick.ts の Chips にした。地図 (SceneView) は render の型なので Session に入れず main.ts の let のまま。部品へは view を引く thunk で渡す。
  - 層: app は ui・render・observe・dev を型でも読めない (eslint の no-restricted-imports は import type も止める)。石板・HUD・港・観察画面・タイトルの画面は、部品の中で形だけの型として受ける。intervene は石板より先に作るので、揺らしは thunk で渡す。
  - 開発用の近道: createScenarioSession に dev を渡すと、本番のビルドに shortcut の名が残り tests/unit/build.devtools.test.ts が赤になった。dev を読む式 (dev?.scenarioDef(scenario) ?? scenario と !!dev?.shortcut) は main.ts に置き、部品は defOf と forced で受ける。forced は判定のときではなく作るときに 1 回読む (dev.shortcut は起動の URL で決まる定数)。
  - 純粋にするための 1 か所: scenarioConfigOf は浅い写しの下の base.climate を書き換えていた。上書きの前に climate を写す行を足した。base.climate を後で読む所は無いので振る舞いは同じ (試験 'base を書き換えない' が押さえる)。
  - 返り値: 依頼は createScenarioSession が runner などを返す形だったが、作ったものは Session に置くので何も返さない (返すと同じ状態を 2 か所に持つ)。landCargo は createLandCargo(deps) にした。
  - 置き場の変わった古いコメント (消さず書き換えず残した。直すかはユーザーの承認を待つ):
    - src/simulation/types.ts:76「(main.ts が scenario.start.volcanoCell を解決してここに入れる)」と :81「舞台装置 (main.ts が scenario.start.crystalScale を解決してここに入れる)」(今は app/worldConfig.ts の scenarioConfigOf)
    - src/simulation/civilization.ts:286「(main.ts がシナリオの start.civilization をこの形へ解決する)」(同じく app/worldConfig.ts)
    - src/chronicle/replay.ts:12「(main.ts が ?scenario から組み立てるものと同じ)」と tests/fixtures/resumeIsland.ts:10「main.ts の ?scenario の組み立てと同じにする」(組み立ては app/worldConfig.ts)
    - src/ui/HarborVisit.ts:17「(main.ts は島を進めない)」(訪問の再生は app/scenarioSession.ts)
    - src/ui/Hud.ts:216・490「main.ts が毎フレーム setNextMeteor で揃える」(毎フレームの配りは app/frame.ts)
    - tests/unit/chronicle.test.ts:31・scenario.determinism.test.ts:51「main.ts と同じ組み立て … onFrame が毎フレーム」、persist.scenarioSave.test.ts:28・persist.slotSave.test.ts:16・app.place.test.ts:22・scenario.resume.test.ts:23「main.ts と同じ組み立ての石板」(石板の組み立ては app/scenarioSession.ts、onFrame は app/frame.ts)
    - M27-03 より前から場所の違うもの (この票で動かしていない): src/ui/Hud.ts:91「main.ts の planOp」(planOp は app/place.ts)、src/ui/Hud.ts:368「main.ts の onNewIsland が確かめのダイアログで」
  - タイトル (title.ts) と石板の組み立て (scenarioSession.ts) と onFrame (frame.ts) には単体試験を足していない。E2E title・scenarioSave・verdict・harbor・chronicle・observe が通しで見る。
