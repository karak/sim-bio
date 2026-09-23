---
id: M21-01
title: 通し実行の台本の UI パリティ監査
status: done
milestone: M21
plan: docs/specs/plans/2026-09-23-roadmap.md#21-チケットになっていない負債既存-11-本の仕上げ
depends_on: []
evidence: ["a54f1b1 876079f src/ui/clicks.ts tests/unit/clicks.test.ts", "tests/slow/scenarios.playthrough.test.ts 47 件(intercept-tower answer-only alive)", "docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md"]
---

# 通し実行の台本の UI パリティ監査

## What to build

tests/slow の台本が UI で打てない大きさの手を打っていないか監査し、UI と同じ手(放流 環 1・0.5、力 4)に直す(roadmap D1)。
迎撃の塔の儀式台本(`ritualFrom`・`answerOnly`)は草を環 3 で放っている。環 1 に直して、想定解が手で勝てるかを通し実行で再計測する。
沈む欠片・塔の重さの一部にも環 3〜4 の放流が残っている(memory)。勝てなくなったら係数ではなく LD に戻る。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] tests/slow の全台本の手(放流の半径と量、災害の半径、力)を表にし、UI で打てない手を列挙した(docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md §1。UI より強いのは迎撃の塔の 2 本だけ)
- [x] 放流はすべて 環 1・0.5 に揃え、災害の半径は UI の上限内。量に依らない台本(儀式の連続、勅令)はそのまま(a54f1b1 src/ui/clicks.ts、ガード tests/unit/clicks.test.ts 876079f)
- [x] 迎撃の塔の判定行列を環 1 で再計測: 応えだけが alive に変わり、原因(以前の dead は環 6 の偶然)を trace で特定。ユーザー判断で alive と固定し、作り直しは M21-03 へ(監査記録 §3、LD faith-economy §8.11)
- [x] 通し実行 全分割 green(47 件、answer-only は alive で再実行)。単体 519・E2E 21 green

## 作業ログ

## 作業ログ(2026-09-23)

- 監査: 台本の方が UI より強い手は迎撃の塔の儀式(草 環 3)と応え(疫病 環 6・草 環 3)だけ。他は台本の方が弱いか同じ。
- 全部を spawnClick / disasterClick に揃えて 5 分割で再計測(18:30〜19:25): 46 件は不変、迎撃の塔の応えだけが dead → alive。
- trace(疫病 環 4/6 × 草 環 1/3): 疫病の環だけが効く。応えで信仰 0.88・30 年目に星・50 年目までに三度。環 6 の dead は 50 年目の祈り 1 回の差の偶然。
- 試作「着弾の 10 年前からしか撃てない」: 応えだけ alive のまま、遅い儀式 alive、想定解 2 dead。戻した。
- レビュー(feature-dev:code-reviewer): 高確信度の指摘なし。ガードが tests/slow の下位ディレクトリを見ない点を直した(876079f)。
