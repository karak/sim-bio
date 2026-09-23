---
id: M17-00
title: レベルデザイン(伝説の生き物)
status: todo
milestone: M17
plan: docs/specs/plans/2026-09-23-roadmap.md#4-組み直したロードマップ提案
depends_on: []
evidence: []
---

# レベルデザイン(伝説の生き物)

## What to build

#15 巨人の道・#22 夢喰いの影 のレベルデザインを `docs/design/<date>-level-design-creatures.md` に書く。体験の芯(何で悩ませるか)、キーアイテム(舞台装置・生物の特性を 1〜2 個)、ループ、判定行列。
縮約モデルで成立を確かめてから、M17 の実装チケットの What to build と受入基準を LD に合わせて見直す(仕組みが足りなければチケットを足す)。数値上成立しないときは係数ではなくキーアイテムで仕組みを足す。
夢喰いは M10R-03 で状態機械として先行している。種にするか、状態機械のまま石板を立てるかを判断する。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 石板ごとに体験の芯・キーアイテム・ループ・判定行列(レバー感度・定着・副作用・UI で同じ手が打てるか)が LD にある
- [ ] 縮約モデル(scratchpad)で放置 dead・素朴戦略 dead・想定解 alive が成立し、結果を LD に記す
- [ ] 想定解の手はすべて UI で打てる大きさ(放流 環 1・0.5、力 4)で書かれている
- [ ] M17 の実装・校正チケットの What to build と受入基準を LD に合わせて更新した
- [ ] ユーザーの承認を得て、承認日時を LD に記す。evidence に LD のパスと commit SHA

## 作業ログ
