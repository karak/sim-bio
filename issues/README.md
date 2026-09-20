# issues — チケット管理

ツールを使わず、このフォルダの Markdown ファイルでチケットを管理する。

## 規約

- 1 チケット = 1 ファイル。ファイル名は `<milestone>-<連番>-<slug>.md`(例: `M1-07-world.md`)。
- 先頭の frontmatter で状態を持つ。

```yaml
---
id: M1-07
title: World
status: todo        # todo | in_progress | blocked | review | done
milestone: M1
plan: docs/specs/plans/2026-09-19-m1-implementation-plan.md#task-7-world
depends_on: [M1-03, M1-04, M1-05, M1-06]
evidence: []        # done 時に commit SHA とテストファイルを列挙
---
```

- 状態遷移は frontmatter の `status` を書き換える。着手時 `in_progress`、テスト通過とコミット後 `done`。
- `done` にする時は `evidence` に commit SHA とテストファイルパスを必ず入れる(受入基準の証跡)。
- 一覧は `tools/issues.sh` で表示する。

```bash
tools/issues.sh          # 全チケットを状態付きで一覧
tools/issues.sh todo     # 状態で絞り込み
```

## シナリオの作り方(レベルデザイン → 実装 → 校正)

シナリオが数値上成立しないとき、閾値や係数を動かして通すのは「完走の成立」であって「体験の成立」ではない。
シナリオを含むマイルストーンでは、校正チケットの **前** に必ずレベルデザインのチケットを置く。

1. **レベルデザイン**(`docs/design/<date>-level-design-<scenario>.md`): 体験の芯(何で悩ませるか)、キーアイテム
   (舞台装置・生物の特性を 1〜2 個)、ループ、判定行列。判定行列には「レバー感度」(各レバーが目的変数を動かす)と
   「定着」(放流が残る)と「副作用」(レバーの代償)の確認を含める。
2. **キーアイテムの実装**: レベルデザインで決めた仕組みを縦切りで入れる。
3. **校正**: 感度・定着・副作用がヘッドレスで通ってから数値を合わせ、放置 dead・素朴戦略 dead・配分 alive を tests/slow で固定する。
   感度が通らなければ係数ではなく仕組みに戻る(1 へ)。
4. **手動受入**: ビルド済みで 3 回遊び、記録する。
