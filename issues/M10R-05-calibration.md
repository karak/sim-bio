---
id: M10R-05
title: 校正: 祈りに応えるな・空の舟・迎撃の塔(判定行列 → 3 本の書き換え → slow の固定)
status: done
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#5-判定行列校正の前にヘッドレスでレバーが効くことを確かめる
depends_on: [M10R-02, M10R-03, M10R-04]
evidence: ["753bf42 tests/slow/scenarios.playthrough.test.ts", "7eff673 レビュー修正", "docs/specs/plans/2026-09-23-m10r-playtest.md"]
---

# 校正: 祈りに応えるな・空の舟・迎撃の塔

## What to build

LD §5 の判定行列(S1〜S4、D1、E1〜E3)をヘッドレスで通してから、3 本の予言・節目・schedule を書き換える
(狼 4 年ごと、薪 0、迎撃の脈を戻せるか)。感度が通らなければ係数ではなく仕組みに戻る(LD §8 に追記)。

## Blocked by

M10R-02, M10R-03, M10R-04

## Acceptance criteria

- [x] §5 の各行の結果を LD §8 に記す(通らなかった行と足した仕組みも)
- [x] tests/slow で 3 本の 放置 dead・素朴 dead・想定解 alive/escaped を固定。塔の重さ・霊脈枯れの既存テストが通る
- [x] 通し実行 40 本 + 追加分が前面の分割で全通過。evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-09-23: 迎撃の塔・空の舟の校正が通った(753bf42、cb65cd1、7faa028)。祈りに応えるなは §8.4〜8.6 の計測の結果、部品の作り直しが要ると分かり M10R-07 に切り出した(§9.2 承認)。E1〜E3 通過、レビュー 10 件修正(7eff673)。
- 2026-09-23 11:25: 迎撃の塔の校正(脈 1.0、止めよで工事も止まる)は通った。空の舟は §8.7〜8.8 の結果、M10 の定義に戻し M10R-08 に切り出した。祈りに応えるなは M10R-07。
