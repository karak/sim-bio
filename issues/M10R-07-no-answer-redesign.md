---
id: M10R-07
title: 祈りに応えるなの作り直し(安定な集落、着地する波、若い信仰の記憶、予算)
status: todo
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#86-再設計の部品案92-で判断
depends_on: [M10R-05]
evidence: []
---

# 祈りに応えるなの作り直し

## What to build

LD §8.5 の計測と §8.6 の部品(§9.2 で承認 2026-09-23 09:40)。集落を 2063(振幅比 0.06)へ、狼 0.8 / 環 6 を 8 年ごと、
若い信仰(段階 ≤ 歌)は取り下げも上限 −0.1 で回復は応えのみ、年収を全部先回りできない値に校正。縮約モデル(scratchpad の m25.py)の
受入基準(放置 dead・応え dead・早すぎ dead・全部先回りは力不足・先回り k 回 + 見送りが alive で幅 ≥ 2)を本体で再現する。

## Blocked by

M10R-05(上限・夢喰い・runner の everyYears 修正)

## Acceptance criteria

- [ ] 若い信仰の記憶(取り下げ −0.1、回復は応えのみ、石以上は変わらない)が単体テストで確かめられ、塔の重さ・霊脈枯れ・迎撃・舟の slow が変わらない
- [ ] 祈りに応えるなの定義(集落 2063、波、予算、予言・節目)を書き換え、判定行列 M1〜M12 の未達(M12 の未解明、予算の釣り合い、間接解 H2)を LD §8 に記す
- [ ] tests/slow で 放置 dead・応え dead・全部先回り(年収不足)・混合 alive・見送り過多 dead を固定
- [ ] 手動 1 回、記録。evidence に commit SHA とテストファイル
