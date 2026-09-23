---
id: M10R-08
title: 空の舟の作り直し(枯れにくい鐘樹、一定量の伐採、民の林、UI 並みの放流)
status: todo
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#88-空の舟の机上検証2026-09-2393-の判断材料
depends_on: [M10R-05]
evidence: []
---

# 空の舟の作り直し

## What to build

LD §8.7〜8.8。手動受入で、通し実行の想定解(環 4 の放流)が UI(環 1)では再現できず、机上でも「林だけでは塔が飢え、舟の割合伐採では林の大きさが意味を持たない」
と分かった。仮説 → 縮約モデル(scratchpad の ship_desk.py)→ 本体計測 の順で: (a) 鐘樹を遅く枯れにくい樹に(生物の特性。塔の重さの校正に掛かる)、
(b) 舟は毎年一定量を伐る(舞台装置)、(c) 開始時の民の林、(d) 通し実行の台本を UI と同じ環 1 に揃える。空の舟の定義は M10 の状態(薪 800)に戻してある。

## Blocked by

M10R-05

## Acceptance criteria

- [ ] 縮約モデルで 林だけ dead・薄い植え足し dead・林 + 植え足し + 着工の時期 で escaped の幅があることを確かめ、LD §8 に記す
- [ ] 本体で (a)〜(d) を入れ、塔の重さ・霊脈枯れ・迎撃の slow が変わらない(鐘樹の変更は塔の重さを再校正)
- [ ] tests/slow で 放置 dead・薄い植え足し dead・遅い着工 dead・想定解 escaped を UI 並みの放流(環 1)で固定
- [ ] 手動 1 回、記録。evidence に commit SHA とテストファイル
