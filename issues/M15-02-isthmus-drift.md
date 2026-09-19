---
id: M15-02
title: 地峡の時間変化
status: todo
milestone: M15
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M15-01]
evidence: []
---

# 地峡の時間変化

## What to build

大陸移動で双子島の地峡が年ごとに細り、指定の年に切れる。切れると 2 つの島の種は行き来できない。

## Blocked by

M15-01

## Acceptance criteria

- [ ] コマンド erode_isthmus { amount } の予定で地峡の標高が下がり、指定の年に連結成分が 2 になる(単体テスト)
- [ ] 節目「地峡が切れる」、切れた年に年表とログ
- [ ] 保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

