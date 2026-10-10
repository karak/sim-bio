---
id: M24-03
title: タイトルからシナリオ選択と港への導線
status: todo
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-01]
evidence: []
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
