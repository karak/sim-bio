---
id: M21-01
title: 通し実行の台本の UI パリティ監査
status: todo
milestone: M21
plan: docs/specs/plans/2026-09-23-roadmap.md#21-チケットになっていない負債既存-11-本の仕上げ
depends_on: []
evidence: []
---

# 通し実行の台本の UI パリティ監査

## What to build

tests/slow の台本が UI で打てない大きさの手を打っていないか監査し、UI と同じ手(放流 環 1・0.5、力 4)に直す(roadmap D1)。
迎撃の塔の儀式台本(`ritualFrom`・`answerOnly`)は草を環 3 で放っている。環 1 に直して、想定解が手で勝てるかを通し実行で再計測する。
沈む欠片・塔の重さの一部にも環 3〜4 の放流が残っている(memory)。勝てなくなったら係数ではなく LD に戻る。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] tests/slow の全台本の手(放流の半径と量、災害の半径、力)を表にし、UI で打てない手を列挙した(監査表を LD か roadmap に)
- [ ] 放流はすべて 環 1・0.5 に揃え、災害の半径は UI の上限内。量に依らない台本(儀式の連続、勅令)はそのまま
- [ ] 迎撃の塔の判定行列(放置・応えだけ・止めよ無し dead、想定解 alive)が環 1 で成立する。成立しなければ LD を直して再計測した記録
- [ ] 通し実行 全分割 green。evidence にテスト名と commit SHA

## 作業ログ
