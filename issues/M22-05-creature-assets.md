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

- 2026-09-24 土兎: `assets/models/observe/rabbit.glb`(近 LOD `rabbit` 1,574 / 群れ LOD `rabbit_lod1` 502 三角形、骨 24、idle/hop/run/graze/alert/fall)。
  比較画 `docs/design/qa/observe/rabbit-compare.png`、記録 `docs/design/qa/observe/rabbit.md`。撮影・比較画・検証は種ごとの設定を持つ `tools/blender/observe_creature_{render,sheet,check}.py` に一般化(月鹿も同じ結果)。美観チェック待ち
