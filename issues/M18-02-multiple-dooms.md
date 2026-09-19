---
id: M18-02
title: 複数の滅びの同時進行と偽の予言
status: todo
milestone: M18
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# 複数の滅びの同時進行と偽の予言

## What to build

1 本のシナリオで複数の滅びの進行を同時に走らせ、石板の予言は本当の原因を隠せる(偽の予言)。プレイヤーは兆候(グラフ・レイヤー・琥珀)から真の原因を読み解く。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] ScenarioDef.schedule が複数の進行を持て、dead 条件が any で複数の原因を持てる(既存の型で足りることを確認し、足りなければ拡張)。単体テスト
- [ ] ScenarioDef.prophecy とは別に hiddenCause を持て、勝敗のオーバーレイで初めて明かされる(E2E)
- [ ] 偽の予言でも節目は嘘の進行を告げ、本当の進行は石板に出ない
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

