---
id: M15-00
title: レベルデザイン(地形と津波)
status: todo
milestone: M15
plan: docs/specs/plans/2026-09-23-roadmap.md#4-組み直したロードマップ提案
depends_on: []
evidence: []
---

# レベルデザイン(地形と津波)

## What to build

#2 大津波の年・#17 地峡が切れる のレベルデザインを `docs/design/<date>-level-design-terrain.md` に書く。体験の芯(何で悩ませるか)、キーアイテム(舞台装置・生物の特性を 1〜2 個)、ループ、判定行列。
縮約モデルで成立を確かめてから、M15 の実装チケットの What to build と受入基準を LD に合わせて見直す(仕組みが足りなければチケットを足す)。数値上成立しないときは係数ではなくキーアイテムで仕組みを足す。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 石板ごとに体験の芯・キーアイテム・ループ・判定行列(レバー感度・定着・副作用・UI で同じ手が打てるか)が LD にある
- [ ] 縮約モデル(scratchpad)で放置 dead・素朴戦略 dead・想定解 alive が成立し、結果を LD に記す
- [ ] 想定解の手はすべて UI で打てる大きさ(放流 環 1・0.5、力 4)で書かれている
- [ ] M15 の実装・校正チケットの What to build と受入基準を LD に合わせて更新した
- [ ] ユーザーの承認を得て、承認日時を LD に記す。evidence に LD のパスと commit SHA

## 作業ログ
