---
id: M27-05
title: 舞台を 1 つの union にし、命令の作り方を本体の層へ下ろす (/simplify の深さの指摘)
status: review
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: [M27-03]
evidence:
  - 6f0e945
  - e03da61
  - 3a26ff3
  - 6b6db6d
  - d75f08e
  - 6942945
  - a8058b4
  - 9fa690b
  - tests/unit/architecture.test.ts
---

# 舞台を 1 つの union にし、命令の作り方を本体の層へ下ろす

優先度: Could (設計の変更。M27-03 の部品化の上に載せる。振る舞いは変えない)

## What to build

/simplify (2026-10-11、feat/m19 eca64ac) の「深さ」の指摘のうち、症状でなく仕組みを直すもの。1 つずつ票の中の段として進め、各段で柵 (tests/unit/architecture.test.ts) と E2E を通す。

| 段 | いまの形 (症状) | 直す形 |
|---|---|---|
| 1 | `visiting: boolean` が main.ts・intervene・scenarioSession・dock の `VerdictAt`・HUD の `inScenario`・港の `visit`/`scenarioId`/`land` に散る。`app/place.ts` の `At` は free / scenario / visit を既に持つ | 起動が `Stage` の union を 1 つ作る (`{kind:'free'} \| {kind:'scenario', def} \| {kind:'visit', id, def}`)。`at()` はその射影。各部品は `stage` を受け、`visiting` の真偽を自分で引かない |
| 2 | `Session` が可変の欄の袋。`runner`・`recorder`・`scenarioAutosave`・`restartScenario`・`scenarioStep` は一緒に変わり、`() => {}` の仮の値がある。`intervene` は `recorder` の null と `visiting` の 2 つを見る | `session.scenario: ScenarioSession \| null` を `createScenarioSession` が返す。介入の道 (島へ・記録器へ・受けない) は舞台ごとに 1 つに決める |
| 3 | `ui/clicks.ts` が `Command` を組む (`spawnClick`・`disasterClick`・半径) のに ui 層にあり、harbor と台本も読む。`SPAWN_RADIUS` は harbor/cargo.ts に置いて ui が読む形で凌いでいる | 命令の作り方を本体の層へ (`src/simulation/commands.ts` など)。ui・harbor・tests/slow はそこを読む。M21-01「UI と台本の同じ入口」はそのまま |
| 4 | `Chips` (災害・放流・気象塔) は互いに排他な 3 欄で、main.ts が HUD の手から写し、mapClick が読む | HUD が持つ 1 つの `Chip \| null` を `hud.chip()` か `onArm(chip)` で渡す。main.ts の写しを消す |
| 5 | 速さを変えるのに DOM の id (`speed-10`・`speed-0`) を押している (scenarioSession・main.ts)。app が ui の柵を id で迂回している | 速さの正を loop に置き、HUD が追う。`loop.setSpeed` を 0 以外にも広げる |
| 6 | `layering.config.mjs` が禁止の表 (denylist)。表に無い層は何の決まりも持たず、試験に `root` の逃げ道と entry/dev の除外がある。観察画面の試作 (prototype.ts) は試験では entry、eslint では observe の扱い | 許可の表 (allowlist) にし、入口のファイルを表に名指しする。知らない層は試験が落とす。package の決まり (three・simplex-noise) も表に置き、eslint の simulation の塊を 1 つの輪で作る (既存コメント「シミュレーション層は描画ライブラリに依存させない」の扱いは承認を得てから) |
| 7 | `ui/Harbor.ts` が `openHarborStore` を自分で開く (合成が入口の外にある) | main.ts が islandStore と同じ DB で開き、port を渡す |

見送り (今の深さで正しい): `harbor/store.ts` の port、年代記の型を chronicle へ、`describeEvent` を scenario へ、`Nav` の adapter、app の部品が宣言する小さな構造型 (`{ flash(): void }` など。名前を `app/ports.ts` に付けるのはよい)。

## 受入基準

- [x] 段ごとに 1 コミット以上。各段で `pnpm run check` と、触った部品の E2E (smoke・harbor・confirm・scenarioSave・verdict・title・observe) が通る
- [x] 段 1 の後: `grep -rn "visiting" src/app src/ui` が `Stage` の射影 1 か所だけになる
- [x] 段 3 の後: `tests/unit/harbor.cargo.test.ts` の「UI の半径と同じ」の比べが要らなくなる (1 つの定数を両方が読む)
- [x] 段 6 の後: `tests/unit/architecture.test.ts` の `'root'` と entry/dev の除外が消え、知らない層を置くと落ちる (作業ログに確かめの結果)
- [x] 基準画 (`pnpm run shots`) と観察画面の特性試験 (`tests/e2e/observeCharacterization.spec.ts`) が変わらない
- [x] 既存コメントの削除・書き換えは候補として報告し、承認を得てから

## 作業ログ

- 2026-10-11 00:45 起票。元は /simplify の altitude の指摘 9 件 (feat/m19 eca64ac のとき)。
- 2026-10-11 10:10 柵を先に赤で置いた (6f0e945、6 本: 舞台の射影 1 か所・Session の仮の値なし・命令を組むのは simulation・main.ts がチップを写さない・速さの DOM id を押さない・置き場を開くのは入口だけ。基点で 6 本とも落ちることを確認)。
- 2026-10-11 10:20 段 6 (親、枝 s6 → e03da61): `layering.config.mjs` を `ALLOWED` (層ごとに読んでよい層)・`ENTRY` (入口の名指し)・`PACKAGES` (層ごとに読んでよい外部パッケージ) の許可の表にし、eslint 用の `FORBIDDEN` は裏返しとして導く。試験は ALLOWED で型だけの辺も見る。entry/dev の除外と `root` の逃げ道は層の向きの試験から消えた (循環の試験の entry/dev の除外とその注釈はそのまま。知らない層は落ちる)。eslint は three の禁止を表から導き、層の塊は入口のファイルを除く。わざと置いた違反 6 つ (知らない層 src/zzz、src 直下のファイル、ui が three を読む、app が dev を型だけで読む、harbor が lodash を読む、prototype.ts が ui を読む) で、試験と eslint が期待どおり落ちる・許すのを確認。eslint の simulation の塊と既存コメント「シミュレーション層は描画ライブラリに依存させない」はそのまま (1 つの輪にするには書き換えの承認が要る)。
- 2026-10-11 10:25 段 3 (agent、枝 s3 → 3a26ff3): `src/simulation/commands.ts` に `SPAWN_RADIUS`・`SPAWN_AMOUNT`・`DISASTER_RADIUS`・`spawnCommand`・`spawnClick`・`disasterClick`。`harbor/cargo.ts` は `spawnCommand` で組む。`ui/clicks.ts` は `publishClick` だけ。re-export なし。読み手 (mapClick・台本 2 本・単体 5 本) を付け替え。smoke・harbor の E2E 43 件通過。`tests/unit/harbor.cargo.test.ts:97` の「半径は UI の放流と同じ」は両側が同じ定数を読むので恒真 (受入基準どおり比べは要らなくなった。試験は題名を変えずに残した)。
- 2026-10-11 10:50 段 1・2 (agent、6b6db6d・d75f08e): `src/app/stage.ts` の `Stage` (free / scenario / visit) を起動が 1 つ作り、`atOf`・`createIntervene`・`createScenarioSession`・`mountHarbor` (visit・scenarioId の代わりに stage と config)・`slotControlsOf` ({ own }) が舞台を受ける。`harbor/dock.ts` は `StageKind` を受ける。`visiting` の識別子は app・ui・main.ts で 6 ファイル → 0。`Session` は { world, selected, scenario, viewing } の 4 欄、`ScenarioSession` = { runner (getter), recorder, autosave, restart, step } を `createScenarioSession` が返す。訪問の進め方は `playback: Playback | null` の名前のある状態。介入は `stage.kind` の switch で道を 1 つ選ぶ。単体 1412 通過、新しい試験 app.stage (3)・app.scenarioSession (4、わざと壊して落ちるのを確認)・app.effects (+2)。E2E: smoke・confirm・scenarioSave・verdict・title・chronicle・devtools 57 件、harbor を 3 回で 57 件、observe 系 8 件、全部通過。
  - 置き場が変わって指す先がずれた注釈 (承認の後に直す): src/main.ts:85「他人の島を訪れている (M19-09)。介入を受けず、年代記を記録しない (recorder を作らない)。港から引いた命令を記録の tick で打ち直す」(今は `const stage = stageOf(booted)` の上)、src/app/intervene.ts:17「他人の島を訪れている (M19-09)。介入を受けない」(欄が `stage: Stage` に)、src/app/scenarioSession.ts:31「他人の島を訪れている (M19-09)。介入を受けず、年代記を記録しない」(同じ)、src/app/scenarioSession.ts:24-25「…自動保存を作って Session に置き、… / 作ったものは Session に置くので、何も返さない」(今は ScenarioSession を返す)、src/app/session.ts:16「…石板を始め直したとき (restartScenario) に…」(`session.scenario.restart`)、src/ui/Harbor.ts:62「漂着を島の浜に放つ (M19-10)。訪問では null (浜の漂着を出さない)」(`land` は null を取らない)、src/ui/Harbor.ts:80「訪問の道 (?scenario=…&visit=…) で開いたとき。island は照合の再生に渡す、main.ts が組んだその石板の島」(組むのは Harbor の `visitOf`)、src/app/place.ts:51「今いる舞台を、訪問か・石板の頭・石板の判定 (runner が無ければ null) から決める」(訪問かは Stage から)、src/harbor/cargo.ts:10「受け取った積荷は放流の命令 (ui/clicks.ts の receiveCargoClick) として…」(receiveCargoClick は cargo.ts、作り方は simulation/commands)、tests/slow/scenarios.playthrough.test.ts:57・290「UI の DISASTER_RADIUS.plague」(simulation/commands の定数)。コードと一緒に動かして文言を変えていないもの: Harbor.ts:83、session.ts:24・26・28・30、scenarioSession.ts:95。
  - 前からある食い違い (直していない): src/app/restore.ts:23「石板の島の頭。自由モードと訪問では null」だが main.ts は訪問でも head を渡す (訪問では restore の並びが空なので振る舞いに効かない)。
  - docs の古い置き場の参照 (refactoring の範囲外): docs/design/2026-10-10-architecture-review.md:24,76,101,170,447、2026-09-26-cloudflare-architecture.md:59、2026-09-22-level-design-faith-economy.md:348 (ui/clicks を指す)。memory `project-headless-spawn-ui-parity` の「src/ui/clicks.ts を台本も使う」は simulation/commands.ts に直す (親が直す)。
- 2026-10-11 11:40 段 4・5・7 (agent、6942945・a8058b4・9fa690b): 段 4 は `Chip = { kind: 'disaster' } | { kind: 'spawn' } | { kind: 'tower' }` を HUD が `chip: Chip | null` 1 つで持ち、出口は `chip()`・`setChip()`、main.ts への知らせは `onArm(chip)` 1 つ (火山のヒントにだけ使う)。main.ts の `chips` と handler 3 つ (11 行) が消え、mapClick の `armedOf` は 3 枝の switch。段 5 は速さの正を `core/runner` に置き、HUD は `speed: () => Speed` を受けて `update` と札の click で `.on` を追う (`followSpeed`)。scenarioSession (訪問の年代記が届いた時)・観察画面の setSpeed・dev の paused は `loop.setSpeed` を呼ぶ。`Hud.speedRow` を出して観察画面の `buttonHost` に渡す (DOM の id を main.ts が引かない)。段 7 は main.ts の `Promise.all` で `openHarborStore({ indexedDB, dbName: dev?.dbName })` を開き (失敗は `harbor.store.unavailable` の warn と `createMemoryHarborStore()`、起動の warn は `warnAtBoot` にまとめた)、`mountHarbor` は `store: HarborStore` を受ける。DB の名前・version・store は同じ。main.ts 263 → 261 行、boot 225 → 218 行で、ラチェットも 261・218 に下げた。
  - 確かめ: 柵の M27-05 の 6 本すべて緑 (architecture.test.ts 15/15)、単体 140 files・1425 tests 緑、tsc・eslint 通過。新しい試験 `tests/unit/ui.hud.dom.test.ts` (6 件。段 4 の 3 件は API を変える前に赤を確認)、app.scenarioSession に「訪問の年代記が届いたら loop に 10x」を追加。E2E (E2E_PORT=5455) は段ごとに 45・58 件、HEAD で 78 + 15 件 (harbor・persist・devtools・confirm・verdict・title・scenarioSave・smoke・cellHighlight・freeIslandSeed・observe・observeEntry・observeCharacterization・sceneIdle) 全部通過。`pnpm run shots` 6/6 (darwin、基準画との比べ有効)。
  - 見える変化 (票の「HUD が追う」の帰結): 判定の瞬間と、始め直しで判定が running でない時に HUD の ⏸ が光る (前は前の速さの札が光ったまま)。港の置き場は mountHarbor の時でなく起動の最初に開く。`harbor.store.unavailable` の warn は tick 0 で書く。
  - 置き場が変わって指す先がずれた注釈 (承認の後に直す): src/ui/mapClick.ts:11「HUD で持ったチップ。main.ts が HUD の手から書き、次の島のクリックで使う」(Chips 型は無い)、:12「気象塔チップを持っているか (M10-01)。次の島クリックで build_tower を送る」(欄が無く、今は MapClickDeps の JSDoc に見える)、:22「持っているチップが出す命令と、HUD の目印の文と色、チップを放す手。何も持っていなければ null」(放す手も null も返さない)、src/ui/Hud.ts:93-95「災害ボタンを押した…」「種パレットで種を選んだ…」「気象塔チップを押した…」(handler は onArm 1 つ)、:109「気象塔チップの武装状態を外から揃える (M10-01)」(setChip は 3 種)、:227「気象塔チップを持っているか (M10-01)。災害・種パレットと排他」(`let chip` の上)、:297「気象塔チップ (M10-01): 災害・種パレットと同じ「武装 → 次のクリックで発火」の流儀。三者は排他 (どれか 1 つだけ武装できる)」(排他は値が 1 つで成る)、src/main.ts:214「観察画面 (M22-08): … 速さは操作画面の速さの列を押して揃える」(後半が古い)、src/ui/Harbor.ts:66「開発用の見守り手 (M19-16)。手元の置き場の DB の名前と、港への要求に添える名乗りの header。本番では無い」(DB の名前は持たない)、tests/e2e/observe.spec.ts:26「下の帯が時間の流れとカメラを示し、帯の速さは操作画面の速さのボタンを押す」(loop に言う)。
  - 前からある穴 (直していない): `createHud` の `ensureSpecies` が `#spawn-row` を innerHTML で作り直すと、放流のチップを持っている間は `.armed` の光だけ消える (`chip()` は持ったまま)。
- 2026-10-11 段 1 の確かめ (grep): `grep -rn "visiting" src/app src/ui src/main.ts` は 2 行 (src/ui/Harbor.ts:196 の CSS クラス名 `harbor-visiting` と src/ui/harbor.css:106 のセレクタ)。識別子としての `visiting` は app・ui・main.ts に 0 で、受入基準の「射影 1 か所以下」を満たす (文字列のクラス名は柵 FF-28 の対象外)。
