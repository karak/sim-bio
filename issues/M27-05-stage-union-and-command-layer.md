---
id: M27-05
title: 舞台を 1 つの union にし、命令の作り方を本体の層へ下ろす (/simplify の深さの指摘)
status: todo
milestone: M27
plan: docs/design/2026-10-10-architecture-review.md#6-所見と推奨優先順
depends_on: [M27-03]
evidence: []
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

- [ ] 段ごとに 1 コミット以上。各段で `pnpm run check` と、触った部品の E2E (smoke・harbor・confirm・scenarioSave・verdict・title・observe) が通る
- [ ] 段 1 の後: `grep -rn "visiting" src/app src/ui` が `Stage` の射影 1 か所だけになる
- [ ] 段 3 の後: `tests/unit/harbor.cargo.test.ts` の「UI の半径と同じ」の比べが要らなくなる (1 つの定数を両方が読む)
- [ ] 段 6 の後: `tests/unit/architecture.test.ts` の `'root'` と entry/dev の除外が消え、知らない層を置くと落ちる (作業ログに確かめの結果)
- [ ] 基準画 (`pnpm run shots`) と観察画面の特性試験 (`tests/e2e/observeCharacterization.spec.ts`) が変わらない
- [ ] 既存コメントの削除・書き換えは候補として報告し、承認を得てから

## 作業ログ

- 2026-10-11 00:45 起票。元は /simplify の altitude の指摘 9 件 (feat/m19 eca64ac のとき)。
