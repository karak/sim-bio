---
id: M22-05
title: 動物アセット(月鹿・灰狼・土兎、民の飾り)
status: todo
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-02]
evidence: []
---

# 動物アセット(月鹿・灰狼・土兎、民の飾り)

## What to build

M22-02 で決めた作り方で 3 種をデフォルメしたモデル・リグ・アニメにする。造形は元の参照、塗りは基準画。

## Blocked by

M22-02

## Acceptance criteria

- [ ] 3 種の比較画が合格(造形は元の参照、塗りは基準画)
- [ ] アニメ一式(M22-00 の一覧)
- [ ] 予算内

## 作業ログ

- 2026-09-24 灰狼: `assets/models/observe/wolf.glb`(近 2,541 / 群れ 650 三角形、骨 29、idle/walk/stalk/run/pounce/fall)。比較画と記録は `docs/design/qa/observe/wolf.md`。美観チェック待ち(面の立ち方・鼻づらが狐寄り)
- 2026-09-24 土兎: `assets/models/observe/rabbit.glb`(近 LOD `rabbit` 1,574 / 群れ LOD `rabbit_lod1` 502 三角形、骨 24、idle/hop/run/graze/alert/fall)。
  比較画 `docs/design/qa/observe/rabbit-compare.png`、記録 `docs/design/qa/observe/rabbit.md`。撮影・比較画・検証は種ごとの設定を持つ `tools/blender/observe_creature_{render,sheet,check}.py` に一般化(月鹿も同じ結果)。美観チェック待ち
- 2026-09-24 試作に配線: 個体の描画を種ごとの表(`RIGS`、`src/observe/render/creatures.ts`)にし、狼・兎も近くは SkinnedMesh・群れは VAT。狼は忍び寄り stalk、獲物に 3 m まで迫ると pounce、兎は歩きを hop、立ち止まりの 3 頭に 1 頭は alert(9243491、`tests/unit/observe.clips.test.ts`)。
- 未解決: 兎の担当の検証で、月鹿の `fall` の最も低い頂点が地面下 0.93 m まで潜る(角が刺さる)と報告あり。deer.md では対策済みとされているので、作り直しのときに確かめる。
- 未解決: 草の丈(0.7〜1.3 m)に兎(座高 0.35 m)が埋もれて見えにくい。美観チェックで判断を仰ぐ。
