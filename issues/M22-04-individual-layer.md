---
id: M22-04
title: 個体層(密度から個体、行動、群れ、狩り、生気に還る)
status: done
milestone: M22
plan: docs/design/2026-09-23-observation-view.md
depends_on: [M22-00]
evidence: ["59773a2 81f862b fd2b309 src/observe/{area,population,agents,scenes,director}.ts", "tests/unit/observe.{area,population,agents,scenes,director}.test.ts 48 件", "単体 571 green、本体・通し実行は無変更"]
---

# 個体層(密度から個体、行動、群れ、狩り、生気に還る)

## What to build

区域内の密度から個体を出し入れし、行動の状態機械(待機・歩く・食む・群れる・逃げる・追う・倒れる・還る)で動かす。頭数と場所は密度に忠実、個々の一生は演出。本体とバランスには触れない。

## Blocked by

M22-00

## Acceptance criteria

- [x] 頭数が密度に比例し、増減が生まれる・死ぬ・区域の出入りの演出で合う(単体テスト)
- [x] 狩りは狼と鹿が重なるセルでだけ起き、倒れた個体は生気の光になって還る
- [x] 民(知性ある月鹿)は材を運ぶ・舟に集う・夜は灯りに寄る
- [x] 10x でも個体は早送りしない
- [x] 通し実行と単体テストが変わらない(本体を変えていない)

## 作業ログ

## 作業ログ(2026-09-23)

- 純粋モジュール(area / population / agents / scenes / director)と単体 48 件を worktree で実装(59773a2、81f862b で merge)。
- 試作(observe.html)につないだ(fd2b309): 25 年目の保存で 鹿 49・狼 14・兎 37、民は 0(集落の近くの密度が低い)。
- 設計を超えて決めたことは設計書 §12。
