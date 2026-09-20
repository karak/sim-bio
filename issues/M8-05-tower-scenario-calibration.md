---
id: M8-05
title: 判定条件と「塔の重さ」の校正
status: in_progress
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-03, M8-08, M8-09, M8-10]
evidence: ["2f54853 tests/slow/scenarios.playthrough.test.ts tests/unit/scenario.judge.test.ts tests/unit/scenario.warnings.test.ts"]
---

# 判定条件と「塔の重さ」の校正

## What to build

シナリオ条件 civ_stage と警告 civ_declining を足し、「塔の重さ」を予算付きで書き、放置と素朴戦略は dead、力を配分する 2 通りは alive を通し実行で固定する。

## Blocked by

M8-03

## Acceptance criteria

- [x] Condition civ_stage { min?, max?, years? }(直近 years 年の最小段階)。単体テスト
- [x] 警告 civ_declining(段階が下がった年)。単体テスト
- [x] scenarios.json に塔の重さ(予言・start.civilization・予算・節目・alive/dead)
- [x] tests/slow: 放置 dead、森の放流だけ dead、疫病だけ dead、雨 + 放流 alive、疫病で間引き + 放流 alive。既存 15 件も通る
- [x] 設計書 §4.14 に係数と校正の表

## 作業ログ

### 2026-09-20

- 前半(条件・警告・下書き): `civ_stage` 条件と `civ_declining` 警告を追加。`WorldSnapshot.civ` が M8-02 未着地のため、暫定で `civ?: { stage } | null` を先行定義し防御的に読んだ。`JudgeInput` に `history` と並ぶ `civHistory?: number[]` を追加(`species_mean` の `history` 型は変えず最小侵襲)。「塔の重さ」を `hidden: true` で下書きし、`tests/slow` に 5 ケースを `describe.skip` で用意。コミット 762a609。
- feat/m8 に M8-02(b73a5df)・M8-03(703a2db)・M8-04(a942548)がマージされたのを確認し `git merge feat/m8`(コミット 45998ed)。競合は `assets/data/scenarios.json`(test-civ と tower を両方残す)・`ScenarioRunner.ts`(civHistory 積みと civ_stage の年表ログを両方残す)・`simulation/types.ts`(`civ: CivState | null` を採用)。マージ直後に `WorldSnapshot.civ` が `{ stage } | null` から `CivState | null` に変わったことで civ_stage/civ_declining のテストの `snap()` が型エラーになったため、簡易な `CivState` を組み立てるよう修正(コミット 2ad7af9)。
- 校正で実測した事実(seed 42, size 64, 鹿の文明を stage 6 で開始):
  - `POP_NEED = [0,1,2,4,8,14,22,32]` は島全体で数十規模を想定していたが、`populationAround`(集落半径内の密度の和)は鹿のように薄く広がる種では stage 6 でも 0.1〜0.3 程度にしかならず、毎年 population 理由で衰退し 7 年で崩壊した。輝石の残りで stage 6→7 に一時的に上がってから落ちる(既知の挙動、stepMining は population を見ずに progress だけで進む)。
  - `POP_NEED` を実測スケールに合わせ `[0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05]` に変更。人口・生気の判定半径を発生判定用の `HOME_RADIUS`(3、変更なし)と新設の `SUPPORT_RADIUS`(8、`populationAround` と decline の生気平均に使用)に分離。
  - `applyLoad` に人口ベースの負荷減衰(`civPopulation` 省略可、既存呼び出し・単体テストは全力の負荷のまま)を追加。「疫病で民を間引いて負荷を下げる」を機能させる意図だが、実測では疫病の射程(半径 4)が島全体からの流入に対して狭く、間引きが森の総量に与える効果は小さかった。
  - `ScenarioRunner.intervene()` が `fireDue`(予定コマンド)と違って `resolve()`(`cell: -1` → 島の中心、`radius` の縮尺)を通さず生のコマンドを `world.dispatch` していたバグを発見・修正。既存の台本は具体的なセル番号しか使っていなかったため表面化していなかった。
  - 罠: `rainScale` を 1.25 以上にすると集落周りの鹿が急増し、狩猟圧と塔自体の生気消費が重なって `VITALITY_FLOOR`(0.1)を割り段階が 5(帆)まで下がる。疫病で間引いても局所人口はすぐ補充されて防げなかった。1.2 が段階 6 を保てる上限に近い。
- 校正結果(詳細は設計書 §4.14): 放置・森の放流だけ・疫病だけは forest が開始の 0.17 倍で dead。雨 1.2 倍 + 放流(forest 0.34 倍、段階 6)、雨 1.15 倍 + 疫病(15 年おき)+ 放流(forest 0.33 倍、段階 6)はどちらも alive。節目を実測に合わせて「10 年目: 森はすでに大きく痩せた」等に修正。scenarios.json の `hidden` を解除。
- 検証: `npm run typecheck && npm run lint`、`npx vitest run`(189 件)、`npx playwright test`(11 件)、`SLOW=1 npx vitest run tests/slow`(20 件、既存 15 + 新規 5)すべて通過。コミット 2f54853。

- 2026-09-20: M8-06 の手動プレイで「森の総量は塔にも介入にも鈍感」と判明。森の 3 割条件と森の放流前提を捨て、
  レベルデザイン(M8-07)で燃料モデル・火の山・炎蜥蜴・鐘樹を設計。本チケットは M8-08〜10 の後に
  「塔の重さ v2 の判定行列(感度・定着・副作用・放置/素朴/配分)を tests/slow で固定」として再開する。
  校正の試行は wip/m8-06-tower-rebalance に退避(伐採の立木比例・採掘 1/10・段階上げの民条件・衰退 4 年連続・HUD 表示は v2 で取り込む)。
