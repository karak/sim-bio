---
id: M24-03
title: タイトルからシナリオ選択と港への導線
status: todo
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-01]
evidence:
  - 749ecd8 行き先の表の行 RED (tests/unit/ui.titleMenu.route.test.ts, app.title.test.ts, ui.titleMenu.panels.test.ts)
  - 8985dc4 tests/e2e/titleHarbor.spec.ts 4 本 (層 A: .claude/verify/20261020-1019-m24-03/、15 passed)
  - 8f62234 実装 (石板の板 scenarioRowsOf、港の板 案 A、runAtTitle の assign)
---

# タイトルからシナリオ選択と港への導線

優先度: Should

## What to build

M24-00 の W/F に沿って、タイトルから次へ行けるようにする。
- シナリオ選択: 石板の一覧 (題・あらすじ・判定の有無) から選んで始める。いまの操作画面の Tablet の選び方と同じ行き先にする
- 港: 判定の出た島の一覧と訪問への入口。港が閉じているとき・まだ判定の無いときの見せ方は M24-00 のとおり

## Acceptance criteria

- [ ] 試験を先に書く: シナリオ選択と港の入口の行き先を純粋な関数にし、表の単体試験で確かめる (M21-07 の searchFor・finishedScopeOf を使い、作り直さない)
- [ ] 操作画面の石板の選択とタイトルのシナリオ選択が、同じ石板で同じ始まりになる (単体試験)
- [ ] E2E: タイトル → シナリオ選択 → 石板の操作画面、タイトル → 港 → 訪問 (tests/fixtures/fakeHarbor.ts)、港が閉じているときの知らせ
- [ ] 前後の画を審査台に置き、ユーザーが見る

## Blocked by

- M24-01
- feat/m19 の main への取り込み。港 (src/harbor) と訪問は feat/m19 にしかない
- M21-07 (searchFor・finishedScopeOf)

## 作業ログ
- 2026-10-20: 実装・feat/m19 に取り込み (merge)。層 C (前後の画 .claude/localreview/m24-03-20261020-0954/) と scenarios.jsonl の 4 行 (同じ置き場の scenarios-proposal.jsonl) の承認待ちで status は todo のまま。perf 92.1→93.8 ms。未決: 自動の枠が無く閉港だとタイトルから石板を選ぶ道が無い (案 a いつも板 / 案 b 閉港の板にも「石板を選ぶ」)。「初めから始める」は未実装。check:docs は E2E の数 21→23 の承認待ちで赤。
