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
