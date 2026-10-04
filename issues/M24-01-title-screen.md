---
id: M24-01
title: タイトル画面 (ロゴ・背景のデモ・メニューの枠)
status: review
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-00]
evidence:
  - tests/unit/app.place.test.ts (起動の行き先 bootRouteOf (M24-01)、13 行の表)
  - tests/unit/persist.tabMarks.test.ts
  - tests/unit/ui.titleMenu.test.ts
  - tests/unit/dev.session.test.ts (タイトルを飛ばす開発の印 (M24-01))
  - tests/unit/build.devtools.test.ts (MARKERS に biotope-dev-skip-title)
  - tests/e2e/title.spec.ts (3 本)
  - .claude/localreview/m24-01-20261004-1950/index.html
---

# タイトル画面 (ロゴ・背景のデモ・メニューの枠)

優先度: Must

## What to build

M24-00 の遷移図と W/F に沿って、起動したときにタイトル画面を出す。
- ロゴ (M24-00 で決めた意匠)
- 背景のデモ (M24-00 で決めた方式。操作できない・音を出さない・読みを邪魔しない)
- メニューの枠 (新規ゲーム・ロード・コンフィグ・港。中身は M24-02・M24-03)
- URL で直に開く場合の扱いは M24-00 の図のとおり

## Acceptance criteria

- [x] 試験を先に書く: 起動の行き先 (タイトルを出すか・どの舞台へ飛ぶか) を純粋な関数にして単体試験の表で確かめる
- [x] 背景のデモが M23 の予算 (三角形・draw call) の内にあり、タイトルを離れたら止まって資源を返す (計測を作業ログに)
- [x] メニューはキーボードだけで選べる (矢印・Enter・Esc)。role とラベルが付いている
- [x] E2E: 起動するとタイトルが出て、メニューの文が見える (toHaveText)。いまの E2E は URL で直に開く道でそのまま通る
- [ ] 前後の画を審査台に置き、ユーザーが見る

## Blocked by

- M24-00

## 作業ログ

### 2026-10-04 (M24-01 の実装。ユーザーの審査待ち)

- 作業の場: worktree `.claude/worktrees/m24` (feat/m24、12ded58 から)
- 起動の行き先: `bootRouteOf` (src/app/place.ts)。タイトルの合図 → 移る途中の枠 → 検索語 → このタブで舞台に入った後 → 開発の印 → タイトル。舞台の中身は `bootPlanOf` のまま (起動の道は 1 つ)。表の単体試験を先に書いて赤 (13 件 `bootRouteOf is not a function`) を見てから実装した。このタブの印は src/persist/tabMarks.ts (sessionStorage)、開発の印は src/dev/session.ts の `SKIP_TITLE_KEY` (localStorage、本番のビルドに入らないことを build.devtools の MARKERS で確かめる)
- 「タイトルを開く」合図 (`putOpenTitle`) は表に入れたが、置く側 (HUD の「タイトルへ」と planOp の `title`) はまだ無い。設計の「タイトルへ戻るときの約束 (M24-01 への申し送り)」は、この票の What to build に無いので残した (開いた問い)
- タイトル: src/ui/Title.ts・title.css。舞台の起動より前に出し、選ばれたら舞台を組む。メニューは `role="menu"`・`menuitem` (roving tabindex)、↑↓・Home・End・Enter、板は Esc・戻るでメニューのその行へ。板の間はメニューを inert にする
  - 続きから: 自動の枠 (自由モード) があるときだけ先頭・既定。押すと自由モードの続き。石板の続き (決めること 3 の案 A の「最後に遊んだ舞台」の印) はまだ無い
  - 新規ゲーム: 続きが無ければ自由モードの最初の島 (seed 42)。続きがあるとき (確かめと新しい seed、M24-02) とロード・港・コンフィグは準備中の板
  - 置き場の一覧 (`list()`) は 2 s で打ち切る (一覧が答えなくてもタイトルは出す)。置き場を開く (`openIslandStore`) が止まった時は、前と同じくタイトルも舞台も待つ
- 背景のデモ: 観察画面で撮った画 4 枚 (docs/design/screenshots の 06-deer・07-wolf・08-rabbit・10-coast を JPEG q68、1600×900、計 0.99 MB) を assets/textures/title/ に (git LFS)。1 枚 20 s、1 周 80 s。最初の 1 枚だけをすぐ読み、残りは 4 s 後。reduced-motion は止めた 1 枚
- 計測 (dev サーバー、Chromium、title.demo.start / title.demo.stop の記録):
  - M23 の予算: 三角形 0・draw call 0 (WebGL を作らない。止めた画と CSS の transform だけ)
  - 1 s で離れた時: 画 4 枚のうち読んだ 1 枚、転送 201,587 B、アニメ 4 本を止めた
  - 8 s で離れた時: 読んだ 4 枚、転送 989,963 B、アニメ 4 本を止めた
  - 離れた後: タイトルの画の `<img>` 0・title-slide のアニメ 0 (src を外して DOM から外す。残りを読む timer も消す)
- E2E: playwright.config.ts の `use.storageState` で開発の印を置き、spec の素の `goto('/')` はそのまま操作画面を開く。`browser.newContext()` で手で作る文脈も use の既定 (storageState) を引き継ぐことを確かめた (Playwright Test の既定)。タイトルの spec だけ印を外す
- tests/e2e-cloudflare/harbor.spec.ts の素の `goto('/')` 5 つを `/?seed=42` に (本番のビルドでは印が効かない)。この spec は手元では流していない
- 受入: SAV-001・HBR-005 の「もし」の文をタイトルを経る形に直した (ユーザーの承認 2026-10-04 19:20)。SAV-001 の covered_by に title.spec の続きからの試験を足した。`uv run scripts/acceptance.py check` は ok
- レビュー: 別の agent (sonnet、読むだけ)。直したもの: 板の間もメニューが押せて板が重なる (inert に)、一覧が答えないとタイトルが出ない (一覧を 2 s で打ち切り、間に合えば timer を消す)、背の低い画面で上にはみ出す (max-height 480 の型)、空白で二重に決める恐れ (空白は button の既定に任せる)、reduced-motion と板の inert の E2E を足した
- 審査台: `.claude/localreview/m24-01-20261004-1950/index.html` (前後の 1280×720・390×844、止めた画、板)。ユーザーの審査: 未

