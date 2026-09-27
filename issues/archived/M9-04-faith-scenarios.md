---
id: M9-04
title: 「祈りに応えるな」「霊脈枯れ(簡易版)」の校正
status: done
milestone: M9
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M9-03, M9-06, M9-00]
evidence: ["6b75c9b tests/slow/scenarios.playthrough.test.ts", "6b75c9b assets/data/scenarios.json tests/unit/scenario.judge.test.ts", "1e342f0 tests/unit/world.vein.test.ts"]
---

# 「祈りに応えるな」「霊脈枯れ(簡易版)」の校正

## What to build

祈りに一度も応えず 100 年存続する「祈りに応えるな」と、採掘を止めさせて生気を戻す「霊脈枯れ(簡易版: 輝石の枯渇で生気が減る)」を予算付きで書き、放置と素朴戦略が滅び、力を配分する 2 通りが生き延びることを通し実行で固定する。

## Blocked by

M9-03

## Acceptance criteria

- [x] 校正の前にレベルデザイン文書(体験の芯・キーアイテム・ループ・判定行列)を書き、ユーザーの承認を得る
- [x] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [x] scenarios.json に 2 本(予言・開始の文明段階・予算・節目・alive/dead)
- [x] tests/slow: 各シナリオで 放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive。既存の通し実行も通る
- [x] 設計書 §4 に係数と校正の表、§6 に証跡
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-09-22: 2 本を定義し、放置・素朴 2〜3 通り dead、想定解 2 通り alive を tests/slow に固定(10 件)。既存 20 件も通過。校正で足した仕組み: 12 年ごとの狼(舞台装置)、応えるなの alive を段階 ≥ 3 に、民が望んだ災害は信仰に数えない。設計書 §4.20、LD §8.3。
