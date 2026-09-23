---
id: M10R-07
title: 祈りに応えるなの作り直し(安定な集落、着地する波、若い信仰の記憶、予算)
status: done
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#86-再設計の部品案92-で判断
depends_on: [M10R-05]
evidence: ["33de804 cd29c40 d427d3c tests/unit/faith.test.ts tests/unit/world.civilization.prayer.test.ts tests/unit/scenario.runner.test.ts", "tests/slow/scenarios.playthrough.test.ts no-answer 8 件", "docs/specs/plans/2026-09-23-m10r-07-playtest.md"]
---

# 祈りに応えるなの作り直し

## What to build

LD §8.5 の計測と §8.6 の部品(§9.2 で承認 2026-09-23 09:40)。集落を 2063(振幅比 0.06)へ、狼 0.8 / 環 6 を 8 年ごと、
若い信仰(段階 ≤ 歌)は取り下げも上限 −0.1 で回復は応えのみ、年収を全部先回りできない値に校正。縮約モデル(scratchpad の m25.py)の
受入基準(放置 dead・応え dead・早すぎ dead・全部先回りは力不足・先回り k 回 + 見送りが alive で幅 ≥ 2)を本体で再現する。

## Blocked by

M10R-05(上限・夢喰い・runner の everyYears 修正)

## Acceptance criteria

- [x] 若い信仰の記憶(取り下げ −0.1、回復は応えのみ、石以上は変わらない)が単体テストで確かめられ、塔の重さ・霊脈枯れ・迎撃・舟の slow が変わらない(33de804 tests/unit/faith.test.ts、world.civilization.prayer.test.ts。通し実行は全 5 分割)
- [x] 祈りに応えるなの定義(集落 2063、北の谷 1366 の波 1.0/環 3、年収 12 = 実効 3、予言・節目・波の台詞)を書き換え、M12 の正体(年収は陸地率 × 生気率)・予算の釣り合い(先回り 6〜7 回)・H2 不要 を LD §8.10 に記した(33de804 cd29c40)
- [x] tests/slow で 放置・儀式だけ・応え・翌年・1:2・儀式なし dead、欲張り(7 回)・1:1 alive を固定(tests/slow/scenarios.playthrough.test.ts no-answer 8 件 373 秒、cd29c40)
- [x] 手動 1 回、記録(docs/specs/plans/2026-09-23-m10r-07-playtest.md: 警告を見て谷を叩き alive、先回り 8 回・見送り 4 回)。evidence に commit SHA とテストファイル

## 作業ログ(2026-09-23)

- 本体計測(scratchpad zz-m10r07-measure)で M12 の正体を突き止めた: 年収は `incomePerYear × 陸地率 × 生気率` で実効 ≈ 3/年。年収 12 のまま、先回りは 12 波中 7 回まで。
- 集落に落とす環 6 の波は、疫病を環 6 にしても波と同じ tick でしか追えず(狼の拡散 0.2/tick)、UI では打てなかった(手動 1 回目で発覚)。
  → 波を北の谷 1366(13 セル)に落とし、谷への疫病 環 4 で波の 3 か月後まで効く形に。疫病の半径は 4 のまま。予定コマンドの `text` を警告と年表に出す。
- レビュー(feature-dev:code-reviewer)3 件: 年表の台詞の二重表示(修正)、仕様書 §4.27〜4.31 の重複ブロック(merge の名残、除去)、通し実行の注記(修正)。
- H2(間接解)は若い信仰の記憶では取り下げ自体が刻まれるので不要と判断(LD §8.10)。

