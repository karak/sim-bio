---
id: M14-01
title: 持ち込み(次の島)
status: todo
milestone: M14
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M10-03, M14-00]
evidence: []
---

# 持ち込み(次の島)

## What to build

空の舟の持ち出しデータを新しい島に読み込むと、種と民が着いて文明の段階と信仰を引き継ぐ。石板が「前の島から来た」を告げる。

## Blocked by

M10-03, M14-00

## Acceptance criteria

- [ ] 読込 UI で持ち出しデータを受け取り、指定の海岸セルに種を放ち、文明を初期化する(単体テスト: 持ち出し→持ち込みで種の一覧と段階が一致)
- [ ] 不正なデータは拒否して理由を出す(単体 + E2E)
- [ ] 年表に「舟が着いた」。ログ scenario.ship.arrived
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

