---
id: M9-02
title: 祈り
status: done
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-01, M9-06]
evidence: ["ad80ea3 tests/unit/prayer.test.ts", "ad80ea3 tests/unit/faith.test.ts", "ad80ea3 tests/unit/world.civilization.prayer.test.ts", "ad80ea3 tests/unit/civilization.test.ts", "ad80ea3 tests/unit/scenario.budget.test.ts", "ad80ea3 tests/unit/ui.tablet.test.ts", "ad80ea3 tests/e2e/smoke.spec.ts"]
---

# 祈り

## What to build

民の困りごとが石板に「祈り」として届く。集落周辺の草が少なければ「雨を」、捕食者が多ければ「狼を減らして」、輝石が尽きれば「星の砂を」。期限内に対応する介入をすれば信仰が上がり、無視すれば下がる。

## Blocked by

M9-01

## Acceptance criteria

- [x] 祈りの生成は純粋関数。条件(草の密度・捕食者比・輝石量)ごとに 1 種類、同時に 1 つだけ、期限 5 年(単体テスト)
- [x] 期限内に対応する種類の介入があれば「応えた」と判定して信仰 +、期限切れで −(単体テスト)
- [x] 石板に現在の祈りと残り年数が出て、応えた・無視したが年表に並ぶ(E2E: 試し読みシナリオで祈りが出て、対応する介入で消える)
- [x] ログ scenario.prayer(issued / answered / ignored)
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 純粋関数 `src/simulation/prayer.ts`(`issuePrayer`/`isAnswer`)に分離。`PrayerKind`/`PrayerState` を定義し、`CivState` に `prayer?`/`prayersAnswered?`/`prayersIgnored?`/`crystalStart?` を追加(既存セーブ・テストと互換)。
- 実測(seed 42 / size 64 / 全種、`civilization: { speciesId: 'deer', start: { stage: 3, home: 2635 } }` で 100 年放置): 支え半径 8 の草の密度平均は 0.074〜0.132(中央値 0.107)、捕食者比(肉食トロフィックの総量 / 民の総量)は 0.165〜1.924(中央値 0.301)。輝石比は 0.621〜0.842 でこのレンジでは「星の砂を」は出ない。issuePrayer を優先度どおりに 100 年通し「雨を」4〜12 回・「狼を減らして」1〜6 回になる組を探索して `PRAYER_GRASS_LOW = 0.15`、`PRAYER_PREDATOR_HIGH = 0.33` を選んだ(この組で雨を 10 回・狼を減らして 3 回)。使い捨ての計測スクリプトはコミットしていない。
- `World` の `dispatch` が civ に有効な祈りがあり `isAnswer` が真なら即座に解決(`prayersAnswered++`)し、`stepCivYearly` が期限切れを無視(`prayersIgnored++`)で解決してから空いていればクールダウン明けに `issuePrayer` で新しい祈りを出す。`faith.ts` に `FAITH_ANSWER`/`FAITH_IGNORE`(各 0.15)を足し、`updateFaith` に今年の answered/ignored を渡す。
- `ScenarioRunner` が `snapshot.civ` の prayer と answered/ignored の変化を前年と比べて `TimelineEvent { kind: 'prayer' }` を積み、`opts.onPrayer?.()` を呼ぶ(civ_stage/civ_faith と同じ前年比較の作り)。`runner.prayer()` が現在の祈りと残り年数を返し、`Tablet` の `#tablet-prayer` に「祈り: 雨を(残り 3 年)」の形で表示する。`main.ts` の `onPrayer` が `scenario.prayer` をログする。
- `scenarios.json` の `test-civ` に `"prayer": "rain"` を足し、E2E の決定論を確保(`resolveCivilizationStart`/`CivilizationConfig` に `prayer?: PrayerKind` を追加)。
- TDD: `prayer.test.ts`(純粋関数)→ `faith.test.ts`(answered/ignored の境界値)→ `world.civilization.prayer.test.ts`(World 配線)→ `scenario.budget.test.ts`/`ui.tablet.test.ts`(年表・表示)→ `smoke.spec.ts`(E2E)の順に赤→緑で実装した。

