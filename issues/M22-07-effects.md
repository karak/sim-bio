---
id: M22-07
title: 演出(芽吹き・疫病の霧・生気・灯り・海面・昼夜と天気)
status: todo
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-03, M22-04]
evidence: []
---

# 演出(芽吹き・疫病の霧・生気・灯り・海面・昼夜と天気)

## What to build

「種を放ったあと」「滅びの兆しと終わり」を演出で見せる。昼夜は実時間、季節と天気は本体から。

## Blocked by

M22-03, M22-04

## Acceptance criteria

- [ ] 介入(植える・疫病・雨)が区域の中で見える
- [ ] 沈没で区域が水に沈む
- [ ] 基準画(sheet-effects)との比較

## 作業ログ
- 2026-09-24 空気の層と昼夜(4948ec5): 高さで薄れる霞・奥に溜まる靄・日の方向の暖かい散乱・日の影の地図から光の筋(`src/observe/render/atmosphere.ts`)。昼夜 6 分で空・光・霧の色が巡る(`src/observe/daylight.ts`、`tests/unit/observe.daylight.test.ts`)。空は昼の暈、夜は月と星。
- 2026-09-24 光の粒(3e00713): 昼の塵・夜の蛍・還る個体から立つ生気の粒・夜の灯りの溜まり(`src/observe/render/motes.ts`)。夜は焼いた材質の発光を 2.1 倍、縁の光は光の色に合わせる。
- 未着手: 芽吹き・疫病の霧・雨・沈む(介入と場面の配線は M22-08 と一緒に)。保存を読むだけの試作では個体が死なないので、生気の粒は時間を流す配線の後に確かめる。
