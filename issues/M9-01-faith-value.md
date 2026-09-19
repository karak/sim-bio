---
id: M9-01
title: 信仰の値
status: todo
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M8-02]
evidence: []
---

# 信仰の値

## What to build

文明を持つ種が信仰を持つ。同じ種類の介入を繰り返す(予測可能)と上がり、種類がばらつく介入や災害で下がり、何もしなければゆっくり減衰する。値が HUD に出て、大きく動いた年は年表に並ぶ。

## Blocked by

M8-02

## Acceptance criteria

- [ ] 純粋関数で信仰を更新する。同じ種類のコマンドが 10 年内に 3 回続くと上がり、直近 10 年で 3 種類以上のコマンドが混ざると下がる。災害は必ず下げる(単体テスト、境界値つき)
- [ ] 介入がなければ年ごとに一定率で減衰し 0 未満・1 超にならない(性質テスト)
- [ ] 文明のない世界では信仰の値も表示も存在しない(既存テストが変わらない)
- [ ] HUD の文明の行に「信仰 0.62」が出る。snapshot と保存データに含まれ、serialize→restore で一致する
- [ ] ログ sim.civ.faith を年 1 回、年表に ±0.1 以上動いた年だけ出す
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

