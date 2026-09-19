---
id: M13-03
title: 地底セル
status: todo
milestone: M13
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M13-01]
evidence: []
---

# 地底セル

## What to build

霊脈上の生気が高いセルに地底の生息地ができる。地底では植物が育たず、分解者だけが生気を生む。海面が上がっても地底は残る。

## Blocked by

M13-01

## Acceptance criteria

- [ ] 地底の判定は純粋関数(線上かつ生気 > 0.8 が 5 年続く)。地底セルでは植物の成長 0、沈降で海になっても地底のままで動物が住める(単体テスト)
- [ ] レイヤーで地底が見える、セル詳細に「地底」。保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

