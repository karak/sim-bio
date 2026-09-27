---
id: M4-04
title: 4 本の校正と証跡
status: done
milestone: M4
plan: docs/design/2026-09-19-scenarios-and-world.md
depends_on: [M4-02]
evidence: ["cbe4b84", "tests/slow/scenarios.playthrough.test.ts", "docs/specs/2026-09-19-ecosystem-sim-design.md"]
---

# 4 本の校正と証跡

## What to build

4 本それぞれについて「放置すると Dead」「決まった介入をすると Alive」をヘッドレスで再現する性質テストを書き、パラメータを校正する。設計書と企画書にシナリオ層を追記する。

## Blocked by

M4-02

## Acceptance criteria

- [ ] tests/unit/scenarios.playthrough.test.ts: 4 本 × (放置→Dead, 介入→Alive) の 8 ケース
- [ ] 設計書 §4/§6 に M4 の差分と証跡
- [ ] 企画書にシナリオ層の一節

## 作業ログ

