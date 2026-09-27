---
id: M19-04
title: 決定論の刻み(年の境目で step を切る)と golden replay
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: []
---

# 決定論の刻み(年の境目で step を切る)と golden replay

優先度: Must(設計書のドライバの優先度)

## What to build

年代記の共有・照合・年表(設計書 §1.3 C6、§9)の前提。今は `core/runner.ts` が 1 フレームで最大 200 tick 進め、`ScenarioRunner.update`(`fireDue` と年の境目の予算)はフレームごとに 1 回しか呼ばれない。予定コマンドが本体に入る tick が速度とフレームの刻みで変わり、同じ seed と介入でも結末が一致するとは限らない。
1 回の step が年の境目を越えないようにし(または ScenarioRunner を tick 単位で進め)、速度とフレームの刻みに依らず同じ結末になることを固定する。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 速度 1x・10x・100x とフレーム間隔の違う 3 通りで、同じ seed・同じ介入の結末のダイジェストが一致する(単体テスト)
- [ ] golden replay: 固定の年代記の結末ダイジェストを vitest で固定し、SIM_VERSION の上げ忘れを落とす
- [ ] 予言の卒業(#30)など、本体と ScenarioRunner の乱数がすべて seed から来ていることを確かめて記す
- [ ] tests/slow の通し実行(47 件)の判定が変わらない。変わるなら理由を作業ログに書く
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
