---
id: M8-01
title: 輝石層
status: done
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: []
evidence: ["d82ce67 tests/unit/world.determinism.test.ts tests/unit/world.save.test.ts tests/unit/render.layerToColors.test.ts tests/e2e/smoke.spec.ts"]
---

# 輝石層

## What to build

島に輝石の鉱脈が決定論で置かれ、レイヤー「輝石」で見え、セル詳細に数値が出て、保存・読込で残る。海は 0。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] World に crystal 層。同じ seed で 2 回 create して一致、陸だけに置かれ、総量が 0 でも全セル 1 でもない(性質テスト)
- [x] LayerKind に crystal、着色テスト
- [x] セル詳細に輝石。E2E: 輝石チップでレイヤーが切り替わる
- [x] SaveData に crystal、serialize→restore で一致

## 作業ログ

- 2026-09-20: 実装完了。`generateCrystal(seed, elevation, size)` を `src/simulation/terrain.ts` に追加。
  seed とは別系統のノイズ (`seed ^ 0x5bd1e995`) を空間スケール 2.5 で取り、陸セルのノイズ値の
  上位 8% (`CRYSTAL_COVERAGE = 0.08`) を輝石の塊とする閾値をその場で逆算する方式にした
  (固定閾値だと地形の起伏でシードごとの被覆率が 0%〜60% までばらついたため、
  百分位で閾値を決めることでシードによらず被覆率をほぼ一定に保てるようにした)。
  既定シード(42, size=32)での実測値: 陸セル中 7.6% に輝石(> 0)が置かれ、連結成分(塊)は 2 個。
  他シード(1,2,3,7,99,123,555,2026,7777)でも 7.6%〜8.0% で安定し、2%〜15% の目標範囲に収まることを確認。
  `World` は create/restore どちらも constructor で `generateCrystal` を必ず走らせ、
  restore 時に `save.crystal` があればそれで上書きする(無ければ決定論生成のまま = 後方互換)。

