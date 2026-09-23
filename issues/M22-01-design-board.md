---
id: M22-01
title: デザインボード(キービジュアルと基準画)
status: review
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: []
evidence: []
---

# デザインボード(キービジュアルと基準画)

## What to build

絵画的な写実のキービジュアル 4 場面と、3D 化の基準画を作り承認を得る。動物は元の参照(`assets/textures/concept/*-angular.png`)に合わせる。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] キービジュアル 4 場面の採用案が決まっている(2026-09-23: 群れ v2・建造中 v1・飛び立ち v1・沈む海岸 v2。トーンの物差し)
- [x] 動物 3 種の基準画が元の参照の造形で描き直され、承認されている(2026-09-23 20:35、assets/textures/board/creatures/)
- [ ] 植物・集落・舟・地面・演出の基準画が承認されている。**動物側の世界観に寄せて描き直す**(衝突したら動物側を優先、申し送り)
- [x] 採用した絵を assets/textures/board/{key-visuals,creatures,sheets}/ に PNG(LFS)で置き、README に状態と出どころを書いてコミット

## 作業ログ

## 作業ログ(2026-09-23)

- 第 1 稿: キービジュアル 4 場面 × 2 案と基準画 9 枚(gemini-2.5-flash-image)。採用は群れ v2・建造中 v1・飛び立ち v1・沈む海岸 v2。
- ユーザー指示: 動物の造形を元の参照(concept/*-angular.png)に合わせる。Gemini 3 Pro Image に参照画とキービジュアルを渡して描き直し、承認。
- 申し送り: キービジュアルと他のアセットは動物の画風と揃っていない。衝突したら動物側を優先(assets/textures/board/README.md)。
