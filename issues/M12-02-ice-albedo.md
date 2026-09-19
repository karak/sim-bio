---
id: M12-02
title: 氷アルベドと氷の前線
status: todo
milestone: M12
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M12-01]
evidence: []
---

# 氷アルベドと氷の前線

## What to build

寒い緯度から氷が張り、氷は日射を返して気温をさらに下げる(正帰還)。氷の上では植物が育たない。レイヤーで氷の前線が見える。

## Blocked by

M12-01

## Acceptance criteria

- [ ] セルごとの氷。年平均気温 < 0℃ で張り、> 2℃ で溶ける(単体テスト、ヒステリシス)
- [ ] 氷の面積が増えると平均気温が下がる(単体テスト)。係数 0 なら何も起きない
- [ ] 氷の上は植物の適合度 0(単体テスト)。地形レイヤーに白く出る(着色テスト)、保存に含まれる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

