---
id: M12-04
title: 「太陽の病」「太陽の怒り」「気象塔で氷を作れ」の校正
status: todo
milestone: M12
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M12-02, M12-03, M10-01]
evidence: []
---

# 「太陽の病」「太陽の怒り」「気象塔で氷を作れ」の校正

## What to build

3 本を予算付きで書き、判定行列を通し実行で固定する。

## Blocked by

M12-02, M12-03, M10-01

## Acceptance criteria

- [ ] 校正の前にレベルデザイン文書(体験の芯・キーアイテム・ループ・判定行列)を書き、ユーザーの承認を得る
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] scenarios.json に 3 本(予言・予定・予算・節目・alive/dead)
- [ ] tests/slow: 各シナリオで放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive。既存も通る
- [ ] 設計書に係数と校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

