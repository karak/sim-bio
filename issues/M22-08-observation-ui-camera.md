---
id: M22-08
title: 観察画面の入り方・UI・自動カメラ
status: review
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-04]
evidence: ["E2E tests/e2e/observe.spec.ts 3 件(入る・戻る・速さ・個体を追う)、734c9c3 ほか"]
---

# 観察画面の入り方・UI・自動カメラ

## What to build

操作画面から観察画面に入る/戻る、速度(⏸/1x/10x)、警告と祈りの控えめな帯、自動の自然記録調カメラ(ショットを巡る)、触れば自由、個体を押すと追う。

## Blocked by

M22-04

## Acceptance criteria

- [ ] E2E: 入る・戻る・速度・個体を追う
- [ ] 自動カメラが 4 場面の引き金に合わせてショットを切り替える
- [ ] UI が極力消えている(手動で確認)

## 作業ログ
- 2026-09-24 本体の時間を流す(a885ad1)。自動の自然記録調カメラ(a833550、`src/observe/render/shotCamera.ts`)。観察画面を `view.ts` の createObservationView にし(8764fc7)、操作画面の「3D で見る」から入る/戻る(0e2dda6、E2E `tests/e2e/observe.spec.ts`)。
- 2026-09-24 場面: 沈降は海面の上がり(a21b1b0)、芽吹き・疫病の霧・雨(e3479ca)、飛び立ちと追うカメラ(07e9b04)。寄せ先・自動カメラは手前の木に塞がれない向きを選ぶ(f2d339c)。美観チェック https://claude.ai/artifact/LT6NoPbaBMqoopNHnQwDgH
- 残り: 個体を押して追う、帆を失うと灯りが消える、警告と祈りの控えめな帯、E2E の速度・個体を追う。
