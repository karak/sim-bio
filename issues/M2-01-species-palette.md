---
id: M2-01
title: 種パレットから種を放つ
status: todo
milestone: M2
plan: docs/specs/2026-09-19-ecosystem-sim-design.md#m2-3-階層--種を放つ
depends_on: []
evidence: []
---

# 種パレットから種を放つ

## What to build

Hud に「種を放つ」パレットが出る。種を選んで島をクリックすると、その場所の周辺に種の密度が増え、画面(個体)とグラフ(総量)に反映される。M1 の植物 2 種で動作する。災害の armed 状態と同じ操作感(選ぶ → 島をクリック → 解除)。

## Blocked by

なし(すぐ着手可)

## Acceptance criteria

- [ ] パレットの種ボタンが species.json の全種を表示する
- [ ] 選択中は armed 表示になり、島クリックで spawn_species が dispatch される
- [ ] 海をクリックした場合は cmd.rejected が出て何も起きない
- [ ] E2E: 種を選んで島をクリックすると cmd.received{spawn_species} が出て cmd.rejected が出ない

## 作業ログ

