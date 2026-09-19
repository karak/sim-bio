---
id: M8-02
title: 文明の発生と段階
status: done
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-01]
evidence: ["b73a5df tests/unit/civilization.test.ts tests/unit/world.civilization.test.ts tests/unit/world.save.test.ts"]
---

# 文明の発生と段階

## What to build

config で知性種を指定した島で、その種が安定して餌に余剰があると集落が生まれ(巣)、集落の周りの輝石を掘って段階が上がる。輝石が尽きれば上がらない。snapshot に文明の状態が入り、発生・段階変化がログに出る。

## Blocked by

M8-01

## Acceptance criteria

- [x] stepCivilization(純粋関数): 振幅比 < 0.15 かつ集落候補の植生 > 0.4 で stage 1。振動している種では発生しない(単体)
  - `checkEmergence` (`src/simulation/civilization.ts`)。証跡: `tests/unit/civilization.test.ts` (`checkEmergence` の 4 ケース) commit b73a5df
- [x] 掘った輝石の分だけ progress が増え、NEED を超えると stage +1。輝石 0 なら止まる(単体)
  - `stepMining` (`src/simulation/civilization.ts`)。証跡: `tests/unit/civilization.test.ts` (`stepMining` の 5 ケース) commit b73a5df
- [x] World: config.civilization があるときだけ動く。既定の世界とテストの世界では文明なし(既存テストが変わらない)
  - `src/simulation/World.ts`。証跡: `tests/unit/world.civilization.test.ts`「config.civilization が無い既定の世界では civ は null」、既存 130 テストは無変更のまま全通過 (commit b73a5df 時点で vitest 154 件通過)
- [x] ログ sim.civ.emerged / sim.civ.stage。tick.summary に civStage
  - 証跡: `tests/unit/world.civilization.test.ts`「発生条件を満たすと stage 0 → 1」「NEED に到達すると sim.civ.stage をログに出す」「summary に civStage/civProgress」 commit b73a5df
- [x] シナリオの start.civilization で初期段階と集落を上書きできる
  - `resolveCivilizationStart` (`src/simulation/civilization.ts`) を `src/main.ts` から適用。証跡: `tests/unit/civilization.test.ts`「resolveCivilizationStart」の 3 ケース commit b73a5df

## 作業ログ

### 2026-09-20

実装は commit b73a5df。`src/simulation/civilization.ts` の校正用定数 (段階 0..7 = なし・巣・火・歌・石・帆・塔・星):

- `HOME_RADIUS = 3`(集落半径。人口カウントと発生判定の植生平均の両方に使う)
- `MINE_RADIUS = [0, 2, 2, 3, 3, 4, 4, 5]`(段階が上がるほど掘削範囲が広がる)
- `MINE_RATE = [0, 0.004, 0.005, 0.006, 0.007, 0.008, 0.01, 0]`(1 tick あたりの採掘上限。stage 7 は最大段階なので 0)
- `NEED = [Infinity, 0.6, 1.0, 1.4, 1.8, 2.4, 3.2, Infinity]`(次の段階に必要な progress の累計)
- `EMERGE_VEGETATION = 0.4`, `EMERGE_AMPLITUDE = 0.15`(指定どおり固定。校正対象にしていない)
- 採掘は「半径内の輝石の残量に比例して(多いセルほど多く)取り除く」方式を採用(nearest-first ではなく proportional)。輝石が均等でない塊状の鉱脈でも、枯渇したセルに固執せず残っている場所から取れるようにするため

**実測(scratchpad の使い捨て tsx スクリプトで計測。スクリプト自体は未コミット):**

- 縮小した安定種構成 (`grass` + `moss` のみ、捕食者なし、seed 42, size 32) で `civilization: { speciesId: 'grass' }` を stage 0 から開始すると、**10 年目に発生 (stage 0→1)**。草食獣が居ないため個体数が単調に平衡密度 (≈0.5、捕食が無い分 `EMERGE_VEGETATION` を超える) に収束し、振幅比も速やかに 0 になるため、`EMERGE_HISTORY_YEARS`(10 年) 到達と同時に発生する。`World` の配線 (`sim.civ.emerged` ログ、`stage` 遷移) はこのケースで単体テスト済み (`tests/unit/world.civilization.test.ts`)。
- 一方、チケット記載どおり **seed 42, size 64, 種構成 `assets/data/species.json` の全種(鹿込み)で `civilization: { speciesId: 'deer' }` を計測したところ、400 年ステップしても発生しなかった**(`emergedYear: null`)。原因は鹿の総量が持続的に振動しており(振幅比はおよそ 0.42〜0.45 で下げ止まり)、`EMERGE_AMPLITUDE`(0.15)を一度も下回らないため。狼・ウサギを除いた縮小構成 (`grass`+`forest`+`deer`+`moss`) でも、鹿の総量自体は約 10〜20 年で振動が収まる(振幅比→0)ものの、鹿の密度最大セル周辺の植生平均は約 0.185 で頭打ちになり `EMERGE_VEGETATION`(0.4)に届かない(鹿の採食圧が強く、密度最大点=植生最低点になりやすい構造のため)。true default (size 128, 全種) でも 120 年時点で振幅比 0.34〜0.8・植生 0.11〜0.29 で同様に未発生。
- 上記より、**現行の `species.json` の鹿パラメータ(growthRate 3.5 など)のままでは、既定の島で鹿の文明が実用的な年数で発生しない**ことを確認した。発生条件の閾値定数 (`EMERGE_VEGETATION`/`EMERGE_AMPLITUDE`) はチケット指定どおり固定し、メカニズム自体は上記の草のケースで動作確認済みなので M8-02 の受入条件は満たしているが、この非発生は M8-03 (負荷・崩壊) / M8-05 (校正) で `POP_NEED` 等と合わせて見直すべき既知の課題として記録する(計画書 §5 のリスク「発生条件と POP_NEED は既定の島で先に測ってから決める」に該当)。stage 2 到達の年数は、そもそも stage 1 に到達しなかったため計測不能。
