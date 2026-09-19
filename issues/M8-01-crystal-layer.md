---
id: M8-01
title: 輝石層
status: todo
milestone: M8
plan: docs/specs/plans/2026-09-19-m8-civilization-plan.md
depends_on: []
evidence: []
---

# 輝石層

## What to build

島に輝石の鉱脈が決定論で置かれ、レイヤー「輝石」で見え、セル詳細に数値が出て、保存・読込で残る。海は 0。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] World に crystal 層。同じ seed で 2 回 create して一致、陸だけに置かれ、総量が 0 でも全セル 1 でもない(性質テスト)
- [ ] LayerKind に crystal、着色テスト
- [ ] セル詳細に輝石。E2E: 輝石チップでレイヤーが切り替わる
- [ ] SaveData に crystal、serialize→restore で一致

## 作業ログ

