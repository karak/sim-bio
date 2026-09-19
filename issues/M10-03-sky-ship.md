---
id: M10-03
title: 空の舟(持ち出し)
status: todo
milestone: M10
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M10-01]
evidence: []
---

# 空の舟(持ち出し)

## What to build

段階「帆」以上の文明は、種と民を空の舟に乗せて次の島へ逃がせる。逃がした時点でシナリオは「逃がす」の部分勝利。舟は森を伐り、信仰が低いと民が乗らない。「空の舟」を校正する。

## Blocked by

M10-01

## Acceptance criteria

- [ ] コマンド launch_ship: 段階 ≥ 帆、信仰 ≥ 0.5、周囲の森 ≥ 必要量で、種の密度と文明の状態を持ち出しデータに書き出す(単体テスト、JSON の形を固定)
- [ ] 舟の建造中は森が減る(単体テスト)。信仰不足・森不足なら拒否
- [ ] Verdict に escaped が増え、石板のオーバーレイが「次の島へ」を出す。持ち出しデータをダウンロードできる(E2E)
- [ ] 「空の舟」: 回避不能の沈没(200 年)。tests/slow で放置 dead、舟だけ急ぐ(森切れ)dead、想定解 2 つ escaped
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

