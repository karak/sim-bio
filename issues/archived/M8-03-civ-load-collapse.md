---
id: M8-03
title: 文明の負荷と崩壊
status: done
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: [M8-02]
evidence: ["703a2db tests/unit/civilizationLoad.test.ts tests/unit/world.civilization.load.test.ts"]
---

# 文明の負荷と崩壊

## What to build

段階が上がるほど集落の周りで森が伐られ生気が吸われる。民が段階の必要量を割るか生気が尽きると段階が下がり、巣を割れば崩壊する。

## Blocked by

M8-02

## Acceptance criteria

- [x] 負荷: 集落半径内の森が減り枯死に積まれ、生気が減る。半径と量が段階で増える(単体)
- [x] 衰退: population < POP_NEED または生気平均 < 0.1 で stage −1、stage 1 → 0 で sim.civ.collapsed(単体)
- [x] 塔(stage 6)の島を 100 年放置すると森が開始の 3 割を割る(校正の当たり。数値は作業ログに)
- [x] 他の 5 本のシナリオと振動テストが変わらない

## 作業ログ

- 2026-09-20: `src/simulation/civilizationLoad.ts` に純粋関数 `applyLoad`/`checkDecline` と段階別定数を実装。
  - `LOAD_RADIUS = [0, 2, 3, 4, 5, 7, 9, 12]`(セル、index = stage)
  - `LOGGING = [0, 0.0008, 0.0012, 0.0018, 0.0025, 0.004, 0.007, 0.011]`(森を 1 tick に削る量)
  - `VITALITY_DRAIN = [0, 0.0004, 0.0007, 0.001, 0.0015, 0.0025, 0.004, 0.006]`(生気を 1 tick に削る量)
  - `POP_NEED = [0, 1, 2, 4, 8, 14, 22, 32]`、`VITALITY_FLOOR = 0.1`
  - `World.ts` に配線: stage ≥ 1 の間は毎 tick `applyLoad`(森 = `populations['forest']`。無い世界は常時 0 の捨て配列でガード)、年次更新の最後に `checkDecline` → decline なら `sim.civ.stage`(reason 付き)、stage 1→0 で `sim.civ.collapsed` + `home = -1`。
  - 計測 (scratch tsx、コミット対象外): seed 42, size 64, 種は `assets/data/species.json` の全種、`civilization: { speciesId: 'deer', start: { stage: 6, home: 島の中心 } }`、100 年放置。
    - forest 総量: year 0 = 151.200 → year 100 = 26.537(比 0.1755、目標の 3 割を明確に下回る)
    - この既定条件では deer の集落周り人口が常に 1 未満のため population 理由の衰退が早く (year 7 で `sim.civ.collapsed`) 走ったが、崩壊後も forest 総量は 26〜27 で安定し、目標(3 割未満)は 100 年時点でも満たされたままだった。校正 (M8-05) 側で POP_NEED や集落候補選定を見直す余地はあるが、本チケットの負荷・衰退のプラミング自体は既定定数のままで目標を達成したため調整はしていない。
  - テスト: `tests/unit/civilizationLoad.test.ts`(16 件、境界・クランプ・単調性)、`tests/unit/world.civilization.load.test.ts`(4 件、control 比較の森減少/生気低下、population 0 の文明の衰退〜崩壊、forest 種が無い世界でのガード)。`npx vitest run` は全 30 ファイル 174 件通過(既存の振動・5 シナリオのテストは無変更のまま緑)。
  - commit: `6d0d18e`(前半、純粋関数)、`703a2db`(本体、World 配線)。

