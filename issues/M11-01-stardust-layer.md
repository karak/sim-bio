---
id: M11-01
title: 星砂層
status: todo
milestone: M11
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M8-01, M11-00]
evidence: []
---

# 星砂層

## What to build

隕石が落ちると星砂が堆積する。星砂は生気の生産を上げるが、閾値を超えると植物の適合度を下げる(土を焼く)。レイヤーとセル詳細に出て、保存に含まれる。

## Blocked by

M8-01, M11-00

## Acceptance criteria

- [ ] 隕石の半径内に星砂が積もり、海には積もらない(単体テスト)
- [ ] 星砂 < 閾値で分解速度が上がり、> 閾値で植物の成長係数が下がる(単体テスト、閾値の両側)
- [ ] 星砂は隣接へ少し拡散し、ゆっくり減る(性質テスト: 総量が増えない)
- [ ] LayerKind stardust の着色テスト、E2E でチップ切替、保存で一致
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

