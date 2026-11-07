---
id: M22-09
title: 観察セッション(手動受入)
status: done
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-03, M22-05, M22-06, M22-07, M22-08]
evidence:
  - "4 場面 10 枚: 審査台 items.json の群 M22-09 (回 m22-09-20261020-1033)、記録 docs/design/qa/observe/session-2026-10.md"
  - "層 C: 審査台 decisions-20261028 d1028-c-m22-09 = 承認 (2026-11-07)。所感のメモは無し"
---

# 観察セッション(手動受入)

## What to build

実際の空の舟を 1 回通して観察し、4 つの場面が出ることと「10 分見ていられるか」を確かめる。

## Blocked by

M22-03, M22-05, M22-06, M22-07, M22-08

## Acceptance criteria

- [x] 4 場面(舟が育つ・飛び立ち・種を放ったあと・滅び)が実プレイで出た記録
- [x] 10 分の観察の所感と直した点 (層 C の承認。所感のメモは無く、直した点も無し)
- [x] デスクトップ Chrome で 60fps の計測 (bench 6 画とも 60 fps 以上)

## 作業ログ
- 2026-09-24 4 場面の引き金を実プレイで確認(自動): `tests/slow/observe.scenes.test.ts`(SLOW=1、95 秒)。想定解 1 で 舟の 6 段(keel→done)・飛び立ち・芽吹き・霧・結末 escaped、放置で 沈む・結末 dead。画としての確認と 10 分の観察の所感は手動(ユーザー)。
- 2026-10-20 観察セッションの材料 (層 A・B と bench、HEAD aa4ce67): 本体の空の舟を UI の手で通し (想定解は 40 年目に escaped、放置は 149 年目に dead)、「3D で見る」で 4 場面の画を撮った。記録は `docs/design/qa/observe/session-2026-10.md`、画は審査台の回 `.claude/localreview/m22-09-20261020-1033/`、証拠は `.claude/verify/20261020-1033-m22-09/`。OBS-002 の judge は 3 手順とも 3 票 yes (受入の画面の置き場の写しで回した)。bench は三角形・draw call が M22-11 の 3 回目と同じ、fps はどの画も 60 を上回る。芽吹き・霧の場面は、入るたびに年表の基準を取り直すので通しのプレイでは出なかった。直しなし。所感は層 C (ユーザー)。
- 2026-10-28 審査台 decisions-20261020 の判定: 「種を放ったあと」は今のまま (植えた若木で受入を満たす。seenEvents の持ち越しはしない。d1020-m22-09-seen=a)。OBS-002 は写しの結果 (3 手順とも 3 票 yes、2026-10-20) を本体の `.claude/acceptance/results.json`・`judge.json` に取り込んだ (d1020-m22-09-obs002=import)。舟の寄りの画 (scene-1-ship-y24/y32) の下半分の砂色の帯は票にせず所感に書くだけ (d1020-m22-09-camera=note)。層 C (所感・10 分) は未判定。
- 2026-11-07 層 C 承認 (d1028-c-m22-09) で done。所感のメモは付かなかった (session-2026-10.md の所感の欄は空のまま)。
