---
id: M2-02
title: 草食獣 1 種(鹿)を追加
status: done
milestone: M2
plan: docs/specs/2026-09-19-ecosystem-sim-design.md#m2-3-階層--種を放つ
depends_on: []
evidence: ["9e9768a", "tests/unit/populations.test.ts", "tests/unit/world.trophic.test.ts"]
---

# 草食獣 1 種(鹿)を追加

## What to build

鹿が草を食べて増え、草が減ると鹿も減る。島を歩き回る(拡散)。箱モデルで描画され、グラフに線、レイヤー切替に「鹿」が出る。初期状態では鹿は 0 で、種パレットか固定の初期投入で島に入る。

## Blocked by

なし(すぐ着手可)

## Acceptance criteria

- [ ] 性質テスト: 鹿を放つと、放たない場合より草の総量が減る方向に動く(tests/unit/world.trophic.test.ts)
- [ ] 性質テスト: 草が 0 のセルでは鹿が減る
- [ ] 鹿が 4 近傍へ拡散する
- [ ] ブラウザで鹿が箱として表示され、グラフに線が出る

## 作業ログ

