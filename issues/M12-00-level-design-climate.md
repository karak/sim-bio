---
id: M12-00
title: レベルデザイン(気候の帰還)
status: todo
milestone: M12
plan: docs/specs/plans/2026-09-23-roadmap.md#4-組み直したロードマップ提案
depends_on: []
evidence: []
---

# レベルデザイン(気候の帰還)

## What to build

#4 気象塔で氷を作れ・#10 太陽の病・#11 太陽の怒り・#12 氷期の到来 のレベルデザインを `docs/design/<date>-level-design-climate.md` に書く。体験の芯(何で悩ませるか)、キーアイテム(舞台装置・生物の特性を 1〜2 個)、ループ、判定行列。
縮約モデルで成立を確かめてから、M12 の実装チケットの What to build と受入基準を LD に合わせて見直す(仕組みが足りなければチケットを足す)。数値上成立しないときは係数ではなくキーアイテムで仕組みを足す。
#12 は #10 と芯(氷アルベドの正帰還)が重なるので、違い(氷の前線の南下、渡り、文明「火」から始まる)を LD で決める。渡りが要るならチケットを足す。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 石板ごとに体験の芯・キーアイテム・ループ・判定行列(レバー感度・定着・副作用・UI で同じ手が打てるか)が LD にある
- [ ] 縮約モデル(scratchpad)で放置 dead・素朴戦略 dead・想定解 alive が成立し、結果を LD に記す
- [ ] 想定解の手はすべて UI で打てる大きさ(放流 環 1・0.5、力 4)で書かれている
- [ ] M12 の実装・校正チケットの What to build と受入基準を LD に合わせて更新した
- [ ] ユーザーの承認を得て、承認日時を LD に記す。evidence に LD のパスと commit SHA

## 作業ログ
