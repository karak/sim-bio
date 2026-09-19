---
id: M2-05
title: 3 階層が 100 年共存するデフォルト設定を固定
status: todo
milestone: M2
plan: docs/specs/2026-09-19-ecosystem-sim-design.md#m2-3-階層--種を放つ
depends_on: [M2-03, M2-04]
evidence: []
---

# 3 階層が 100 年共存するデフォルト設定を固定

## What to build

species.json のデフォルト設定と固定シードで 100 年回して、植物・草食獣・肉食獣のいずれも絶滅しない。疫病が動物だけを減らすことをブラウザで確認する。設計書 §6 M2 の表に証跡を記入する。

## Blocked by

M2-03, M2-04

## Acceptance criteria

- [ ] 性質テスト: デフォルト設定・固定シードで 100 年後に全種の total > 0(tests/unit/data.test.ts)
- [ ] ブラウザで疫病を落とすと動物が減り植物は残る
- [ ] 設計書 §6 M2 に commit SHA を追記

## 作業ログ

