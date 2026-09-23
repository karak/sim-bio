---
id: M18-01
title: 琥珀(通しの年表と再生)
status: todo
milestone: M18
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M18-00]
evidence: []
---

# 琥珀(通しの年表と再生)

## What to build

1 プレイのログとスナップショットを琥珀として保存し、年表をスクラブすると各年の島が再生される。森が燃えると琥珀が消える(琥珀は森のセルに宿る)。

## Blocked by

M18-00

## Acceptance criteria

- [ ] 年ごとのスナップショット(圧縮)を保持し、任意の年を SceneView に表示できる(単体: 保持と復元の一致)
- [ ] 石板の年表からスクラブ UI を開ける(E2E)
- [ ] 琥珀は森の密度 > 0.5 のセルに宿り、山火事でそのセルの琥珀が消える(単体テスト)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

