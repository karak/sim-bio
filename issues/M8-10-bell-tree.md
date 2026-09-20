---
id: M8-10
title: 鐘樹(遅く育ち、材と生気を生み、草に陰を落とす)
status: todo
milestone: M8
plan: docs/design/2026-09-20-level-design-tower.md
depends_on: [M8-08]
evidence: []
---

# 鐘樹(遅く育ち、材と生気を生み、草に陰を落とす)

## What to build

放流が定着する遅い樹「鐘樹」を足す。落葉は生気を豊かにし、立木は塔の材になるが、陰で草の成長を落とす。

## Blocked by

M8-08

## Acceptance criteria

- [ ] species.json に鐘樹(plant、成長は森の 1/3、死亡率 1/3)。SpeciesDef に shade(同セルの他の植物の成長倍率)と litterBoost(死亡分を枯死に積む倍率)を足し、vegetation.ts が使う(単体テスト、省略時は既存と同じ)
- [ ] 定着テスト(ヘッドレス): 5 か所に放った鐘樹が 10 年後も放流量の 5 割以上残る
- [ ] 感度テスト: 鐘樹 5 か所の放流が 30 年後に材で必要量の 5 割以上を賄う。副作用テスト: 島の 3 割に植えると鹿が基準の 7 割を割る
- [ ] 凡例・放流チップ・住みやすさレイヤー・3D の描画に出る(E2E)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

