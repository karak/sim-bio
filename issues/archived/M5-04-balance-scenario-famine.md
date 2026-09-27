---
id: M5-04
title: バランス維持とシナリオ「生気の飢饉」
status: done
milestone: M5
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M5-02, M5-03]
evidence: ["084f3b9 tests/unit/data.test.ts tests/unit/world.oscillation.test.ts tests/slow/scenarios.playthrough.test.ts"]
---

# バランス維持とシナリオ「生気の飢饉」

## What to build

生気を入れても 100 年共存と振動のテストが通るよう係数を決める。シナリオ「生気の飢饉」(分解者が一か所しかなく、放置すると生気が尽きて植生が崩れる。胞子苔を湿潤地に広げれば回避)を追加し、通し実行テストで放置→滅び、介入→回避を固定する。

## Blocked by

M5-02, M5-03

## Acceptance criteria

- [x] data.test.ts / world.oscillation.test.ts が通る
- [x] scenarios.json に vitality-famine。scenario judge に vitality_ratio 条件
- [x] tests/slow: 生気の飢饉 の放置→dead、介入→alive
- [x] 設計書 §4/§6 に M5 の差分と証跡

## 作業ログ

- 2026-09-19: 「苔が一か所だけ」案は苔が指数的に広がり必ず自力回復するため成立せず(拡散を下げても山火事を足しても同じ)。「島に苔がなく、見守り手だけが胞子を運べる」に変更。放置→生気が 20 年で尽き dead、5 年目に湿潤地へ苔を放てば alive。
- 2026-09-19: 通し実行で「星が落ちる夜」「火の山の目覚め」の介入が dead に。隕石・火山が苔も消し、草と獣だけ戻すと生気が尽きて飢えるため。予言に「苔も戻せ」を足し、台本に苔を追加。狼は 9 セルに 1 つ・0.15 だと紙一重で消えるので 6 セルに 1 つ・0.3 に。
