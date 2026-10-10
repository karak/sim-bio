---
id: M24-05
title: タイトルの「続きから」に石板の続きも出す (最後に遊んだ舞台の印)
status: review
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-01]
evidence:
  - tests/unit/persist.lastStage.test.ts (印の読み書きと壊れた印 9 行、scenarioProgressOf、continueTargetOf の表 13 行)
  - tests/unit/ui.titleMenu.test.ts (石板の続きの「続きから」(M24-05): 要約の文、titleChoiceOf の表 5 行)
  - tests/e2e/title.spec.ts (M24-05: 石板を進めてタイトルへ → 続きから、M24-04 の判定の出た石板の試験の末尾で続きにしないこと)
  - tests/unit/persist.lastStage.test.ts (印は見守り手ごと 2 本 (2026-10-10 の決定))、commit f50a82b・a1e7df5
  - src/persist/lastStage.ts、src/ui/titleMenu.ts (titleChoiceOf)、src/ui/Title.ts、src/main.ts (enterFromTitle・markStage)、src/persist/scenarioSave.ts (onSaved)
---

# 「続きから」に石板の続きも出す

優先度: Should

## What to build

M24-01 の「続きから」は自由モードの自動の枠だけを見る。設計の決定 3-A (続きがあれば先頭・既定) は石板の続きも含む (遷移図の `Title --> Scenario: 続きから (石板)`)。石板の続き (M19-14、src/persist/scenarioSave.ts) には一覧も時刻も無いので、「最後に遊んだ舞台」の小さな印を新しく持つ。

ユーザーの決定 (2026-10-05): 作る。

- 印: 最後に入った舞台 (自由 / 石板の id) と時刻。舞台に入った時・自動保存の時に書く。置き場は引数に取る (単体試験)。壊れた値は無いものとして扱う
- 「続きから」は印の舞台の続きを開く。石板なら `?scenario=<id>` (resumeScenario の道)、自由なら今のまま。判定の出た石板は続きにしない (初めからになるので)
- 要約の文: 「石板『…』 · N 年 · 月/日 時:分」

## Acceptance criteria

- [x] 印の読み書きと「続きから」の行き先を純粋な関数にし、表の単体試験 (自由だけ・石板だけ・両方で新しい方・判定の出た石板・壊れた印)。先に赤
- [x] E2E: 石板を少し進めてタイトルへ → 「続きから」が石板の題を言い、Enter で同じ年から続く
- [x] `pnpm run check`・通しの E2E

## 作業ログ

- 2026-10-05: 起票 (M24-01 の報告。ユーザーの決定「作る」)。

### 2026-10-05 (M24-05 の実装。ユーザーの審査待ち)

- 作業の場: worktree `.claude/worktrees/m24` (feat/m24、M24-04 の 0ace5a8 の上)
- 単体試験を先に書いて赤を見た: tests/unit/persist.lastStage.test.ts は `Cannot find module '../../src/persist/lastStage'`、tests/unit/ui.titleMenu.test.ts の M24-05 の 6 件は `expected 'test-quick · 3 年 · 10/04 18:40' to be '石板『試し読み』 · 3 年 · 10/04 18:40'` と `titleChoiceOf is not a function`
- 印: src/persist/lastStage.ts。localStorage の `biotope.last-stage` に `{ stage: 'free' | 'scenario', scenarioId?, at }` の JSON。置き場は引数。壊れた値 (JSON でない・知らない舞台・時刻が有限の数でない・石板の id が無い/空) と投げる置き場は null、書けない置き場は何もしない
- 書く時: 舞台に入った時 (起動の後、訪問では書かない) と、自動保存を書き終えた時 (自由モードは localSave の onSaved、石板は createScenarioAutosave に足した onSaved)。「タイトルへ」の flush の書き終わりでも書く
- 「続きから」の行き先 `continueTargetOf` (純粋な関数): 候補は自動の枠 (自由モード、時刻は保存の時刻) と、印の指す石板の続き (同じ石板・判定がまだ・題の分かる石板、時刻は印の時刻)。両方あれば新しい方、同じ時刻なら石板。印は書いた順に最後の舞台を指すので普段は印の舞台になるが、2 つのタブが交互に書く場合に備えて時刻で比べる。印が無い・壊れていれば自動の枠だけ (M24-01 と同じ)
- 判定の出た石板は続きにしない (開き直すと初めから、M19-14)。読めない石板の続き (この版・この石板・この seed の島でない、`checkScenarioSave`) も、開くと脇へ退けて初めからになるので出さない (main.ts の scenarioProgressFor)
- 石板の年は石板の初めの tick から数える (石板の板の「N / 5 年」と同じ)。要約は「石板『試し読み』 · 1 年 · 10/05 08:50」
- 石板の続きを選ぶと、読み込み直さずに検索語を `?scenario=<id>` に差し替え (`searchFor`、修飾は残す)、`bootPlanOf` の restore scenario → `resumeScenario` の道で開く (起動の道は 1 つのまま)
- 石板の続きの読みは、置き場の一覧と同じ 2 s の打ち切りの内 (答えなければ続きからを出さない)
- 新規ゲームの決め方を `titleChoiceOf` に出した。M24-01 は「続きが無ければ自由モードの最初の島」だったが、続きが石板だけのとき新規ゲームが準備中の板になって自由モードへ入れなくなるので、「自動の枠が無ければ」にした (石板の続きは自動の枠を上書きしない)。TitleDeps に `freeSaved` を足した
- E2E (tests/e2e/title.spec.ts): test-quick を 10x で「1 / 5 年」まで進めて止め、「タイトルへ」(確かめ無し) → メニューの先頭が「続きから石板『試し読み』 · 1 年 · …」で既定 → Enter で `?scenario=test-quick` の「1 / 5 年」、離れた tick 以後。判定の出た石板を離れた後のタイトルは 4 行 (続きからが出ない) を M24-04 の試験の末尾で確かめる
- 基準画: `pnpm run shots` の 6 本は通った。更新はしていない

- レビュー: 別の agent (sonnet、読むだけ)。直したもの: 石板の続きの確かめ (`checkScenarioSave`) が投げるとタイトルが出なくなる (try/catch で続きからに出さないだけにした)、同じ時刻の行の試験が無い (表に足した)。直していないもの: 印が石板で自動の枠もあるとき、新規ゲームの準備中の板の文「いまは「続きから」で島へ入れます」が石板へ入ることになる (文の書き換えは承認待ち、下の開いた問い)

### 開いた問い (M24-05)

- 印は見守り手ごと (開発の `?player=`、置き場の DB を分ける) に分けていない。「タイトルへ」が素の `/` へ移るので、タイトルはいつも既定の見守り手の置き場と印を読む (M24-04 の開いた問いと一緒に決める)
- 「続きから」が石板を指すとき、自動の枠 (自由モード) の続きはタイトルからは開けない (ロードの板は M24-02)。操作画面の石板の選択の「自由モード」からは開ける
- src/ui/Title.ts の PENDING_TEXT の new「いまは「続きから」で島へ入れます」は、続きからが石板を指すときは自由モードの島へ入れない。文を変えるか (既存の文なので承認が要る)、M24-02 で板の中身ができるのを待つか

### 2026-10-10 (開いた問いの決定と実装)

- ユーザーの決定 1: 印は見守り手 (`?player=`) ごとに分ける。「タイトルへ」は `?player=` と `?dev=1` を残す (M24-04)
- ユーザーの決定 2: 新規ゲームの変わった振る舞い (自動の枠が無ければ、石板の続きがあっても seed 42 の自由モードの島で始める) はこのままでよい
- ユーザーの決定 3: 新規ゲームの準備中の板の文は「新しい島の始め方 (いまの島を残すかの確かめ) は準備中です。」だけにする (2 つ目の文を外す)
- 先に赤を見た: 印の試験が `expected { stage: 'scenario', …(2) } to deeply equal { stage: 'free', at: 100 }` (見守り手の印が既定の印を上書きした)
- 鍵: 見守り手が無ければ前からの `biotope.last-stage`、あれば置き場の DB の名前 (`biotope-island@<名前>`) と同じく `biotope.last-stage@<名前>`。`readLastStage` / `writeLastStage` が見守り手の名を引数に取り、main.ts は `dev?.player?.name` を渡す (名の形が通らない見守り手は開発の側が捨てるので、DB と同じく既定の鍵になる)
- 板の文の E2E は tests/e2e/title.spec.ts の M24-04 (2026-10-10 の決定) の 1 本の中 (自動の枠があるときの新規ゲームの板)
- 結果は M24-04 の同じ日の節

