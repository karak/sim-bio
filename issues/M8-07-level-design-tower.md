---
id: M8-07
title: レベルデザイン: 塔の重さ(燃料・火の山の心臓・炎蜥蜴・鐘樹)
status: done
milestone: M8
plan: docs/design/2026-09-20-level-design-tower.md
depends_on: []
evidence: ["docs/design/2026-09-20-level-design-tower.md", "a4b2014"]
---

# レベルデザイン: 塔の重さ(燃料・火の山の心臓・炎蜥蜴・鐘樹)

## What to build

塔を「燃料」で立たせ、火(火山の熱と炎蜥蜴)と樹(鐘樹の材と陰)の 2 通りの取り方で悩ませる設計を文書にし、ユーザーの承認を得る。文書は docs/design/2026-09-20-level-design-tower.md。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 体験の芯・キーアイテム・ループ・判定行列(感度・定着・副作用・放置/素朴/配分)・必要システム・捨てた案が書かれている
- [x] ユーザーがキーアイテムの採否(火の山の心臓・炎蜥蜴・鐘樹)を決め、作業ログに記録する
- [x] 採用したキーアイテムごとに実装チケット(M8-08〜10)の範囲が確定している
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 2026-09-20: ユーザー決定「3 点セット(火の山の心臓・炎蜥蜴・鐘樹)で進める。ART-01 と M20-01 は並行」。炎蜥蜴は見守り手が放てない(熱でしか湧かない代償として扱う)。
