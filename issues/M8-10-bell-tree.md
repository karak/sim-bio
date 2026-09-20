---
id: M8-10
title: 鐘樹(遅く育ち、材と生気を生み、草に陰を落とす)
status: done
milestone: M8
plan: docs/design/2026-09-20-level-design-tower.md
depends_on: [M8-08]
evidence: ["089de92 tests/unit/vegetation.test.ts tests/unit/belltree.test.ts tests/e2e/smoke.spec.ts"]
---

# 鐘樹(遅く育ち、材と生気を生み、草に陰を落とす)

## What to build

放流が定着する遅い樹「鐘樹」を足す。落葉は生気を豊かにし、立木は塔の材になるが、陰で草の成長を落とす。

## Blocked by

M8-08

## Acceptance criteria

- [x] species.json に鐘樹(plant、成長は森の 1/3、死亡率 1/3)。SpeciesDef に shade(同セルの他の植物の成長倍率)と litterBoost(死亡分を枯死に積む倍率)を足し、vegetation.ts が使う(単体テスト、省略時は既存と同じ)
- [x] 定着テスト(ヘッドレス): 5 か所に放った鐘樹が 10 年後も放流量の 5 割以上残る
- [ ] 感度テスト: 鐘樹 5 か所の放流が 30 年後に材で必要量の 5 割以上を賄う(M8-08 の塔の燃料モデル (材) が別チケットで並行実装中のため本チケットでは未実施。fuel モデル側の完成後に M8-05 の判定行列で測る。belltree の totals は snapshot.totals.belltree として既に露出済み)。副作用テスト: 島の 3 割に植えると鹿が基準の 7 割を割る → 実施・通過
- [x] 凡例・放流チップ・住みやすさレイヤー・3D の描画に出る(E2E)
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

### 2026-09-20

- SpeciesDef に `shade?: number`(同セルの他植物の成長倍率 `1 − shade・自分の密度`、下限 0)と `litterBoost?: number`(死亡分の枯死への積み増し倍率、省略時 1)を追加。`src/simulation/vegetation.ts` の `stepVegetation` に実装。shade を持つ種が居ないときは shadeMul が常に 1、litterBoost 省略時は等倍のままなので、既存の vegetation/oscillation/data のテストは無変更で全通過。
  - 単体テスト: `tests/unit/vegetation.test.ts` に `shade / litterBoost (M8-10)` を追加 (shade の理論値一致、litterBoost の 2 倍化、shade/litterBoost を持つ種が密度 0 のときは既存結果と完全一致、の 3 本)。
- species.json に `belltree`(鐘樹)を追加。`growthRate: 0.005`(= 森の 1/3)。`mortality` は当初「森の 1/3 (= 0.0033333)」で入れたが、定着テスト(5 か所に amount 0.5 radius 1 で放流 → 10 年後)で残存率が 12.6% にしかならず失敗したため、**mortality を 0.002 → 0.0026 まで調整して着地**させた(下記「逸脱」参照)。tempRange は森と同じ `[2, 26]`、moistureRange は森よりわずかに広い `[0.4, 1.0]`。diffusion 0.005(自力ではほぼ拡散しない)。shade 0.8、litterBoost 2、initialDensity 0(放流でのみ増える)。color `#3E8E6A`、assetId `belltree`。
- `src/render/assetTable.ts` に鐘樹専用ジオメトリ(細く高い ConeGeometry(0.1, 1.1, 5))と perCell 1 を追加。
- 凡例・放流チップ・住みやすさレイヤーは `src/ui/Hud.ts` が `s.species` から自動生成するため、コード変更は不要。E2E (`tests/e2e/smoke.spec.ts`)に `#spawn-belltree` の表示と凡例の「鐘樹」表示・`#legend-belltree` の数値表示を確認するテストを追加して確認。
- `tests/unit/data.test.ts` の 100 年共存テストは、initialDensity 0 の種(放流でしか増えない鐘樹など)を自然発生の総量 > 0 チェックから除外するよう更新(既存種の挙動は変更なし)。
- `tests/unit/belltree.test.ts` を新規作成し、定着・副作用の 2 本のヘッドレステストを実装(いずれも size 48, seed 42, ticksPerYear 360、`assets/data/species.json` の実データを使用)。

#### 実測値

- **定着**: 5 か所(適合度 > 0.95 の陸セルを互いに距離 > 2 で選択)に amount 0.5 radius 1 で放流。放流量(半径 1 内の陸セル数 × 0.5)= 9。10 年後の `totals.belltree` ≈ 6.99(残存率 ≈ **77.7%**、閾値 50% を通過)。
- **副作用**: 陸 576 セル中 173 セル(≈30%)に amount 0.5 で植樹。20 年後の `totals.deer`: 植樹世界 ≈ 0.11 / 対照世界 ≈ 15.67(比 ≈ **0.68%**、閾値 70% を大きく下回って通過)。副作用が閾値に対してかなり過剰(鹿がほぼ全滅)なのは、島全体で実施した種 species.json(鹿・狼・ウサギ込み)かつ mortality を下げたことで鐘樹が拡散し切って牧草地を広く奪ったため。ゲームバランス上はもう少し穏当な値が望ましい可能性があるが、本チケットの受入基準(7 割を割る)自体は満たしている。

#### 逸脱 (deviations)

- `mortality` を「森の 1/3 (0.0033333)」から `0.0026` に変更した。理由: 森の 1/3 のままだと、鐘樹は草(growthRate 0.04)・森との容量共有競争に負けて 10 年で残存率 12.6% まで落ち、定着テストの閾値(50%)を満たせなかった。逆に mortality を 0.002 まで下げると鐘樹が容量競争に勝ちすぎて 10〜20 年で島の大部分を占有してしまい(副作用が過剰)、0.0026 で「定着は通るが極端な独占はしない」バランスを取った。チケット本文の「tune growth/mortality/moisture so this holds」の指示に基づく調整。moistureRange は森の `[0.45, 1.0]` から下限を `0.4` にわずかに広げたのみで、この調整自体は数値に大きくは効いていない(容量競争のほうが支配的)。
- 感度テスト(材の産出)は M8-08 の塔の燃料モデルが別ワークツリーで並行実装中(fuel model は本チケットの対象外として明示的に不可触)のため未実施。`snapshot().totals.belltree` は既に露出しているので、燃料モデル側の実装が入り次第、M8-05 の判定行列で測れる状態にしてある。

