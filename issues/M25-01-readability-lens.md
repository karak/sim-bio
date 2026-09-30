---
id: M25-01
title: 読みやすさの検査 (lens) を shotsOf に入れ、HBR-006 を auto に移す
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: []
evidence: ["tests/e2e/lens.ts", "tests/e2e/lens/contrast.ts", "tests/e2e/lens/fontSize.ts", "tests/unit/lens.pure.test.ts", "tests/e2e/shots.spec.ts", "docs/acceptance/scenarios.jsonl HBR-006", "tools/acceptance-probe/README.md"]
---

# 読みやすさの検査 (lens) を shotsOf に入れ、HBR-006 を auto に移す

優先度: Must

## What to build

ADR 0001 の段 1。人が「読める」と判じていたものを、機械の性質に言い換えて `pnpm run shots` の撮る前の確かめに入れる。
今の `expectUncovered` (tests/e2e/uncovered.ts:9-14) は部品の真ん中の 1 点しか見ないので、港の札が #cell-info の札を覆っていても通る (ADR の付録 B の 1)。

作るもの:
- `tests/e2e/lens.ts`: `expectLegible(page, targets)`。写す要素の中の文字の箱ごとに 5 点 (左右の中・上下の中・真ん中) を elementFromPoint にかけて覆われていないこと、画面の内にあること、切れていないこと (scrollWidth。横に送ってよい欄は許す欄の表に書く)、コントラスト比 4.5 以上 (文字を透明にして撮った画から背景を取る。押せない札は除く)、画面の上の字が 11px 以上 (canvas は `font × clientWidth / width`) を確かめる
- コントラスト比と画面の上の字の大きさの計算は `src/` に置かない純粋な関数 (`tests/e2e/lens/` の下) にし、vitest の node の試験で固定する
- shots.spec.ts の shotsOf が撮る前に `expectLegible` を呼ぶ
- 正本の HBR-006 (読みやすさだけ) を auto に移し、covered_by を shots.spec.ts の HBR-006 の試験にする
- scratchpad の試し (judge.sh・rubric.md・schema.json・contrast.py・fontdrift.spec.ts・occlusion.spec.ts・jitter.spec.ts) を `tools/acceptance-probe/` へ写す。scratchpad はセッションで消える。judge.sh は M25-06 の元、fontdrift は M25-03 の閾値の根拠

## Blocked by

- なし。M25-10・M25-11 を直すまで `pnpm run shots` は赤のまま (それがこの票の完了の条件)

## Acceptance criteria

- [x] 今の feat/m19 で `pnpm run shots` が赤になり、差分に「港の札 (button.harbor-dock) が #cell-info の 生気 / 枯死・輝石・草 を覆う」と「#graph の字が 5px・9px」が出る (作業ログに出力を写す)
- [x] 仕込んだ変異 2 つで赤になる: hud.css の `.confirm` の z-index を下げる (CNF-002 の板が石板に覆われる)、確かめの文を板の幅より長くする (切れる)。戻すと元の赤 (上の 2 つ) だけに戻る
- [x] コントラスト比と字の大きさの純粋な関数に vitest の試験がある (WCAG の例の値、canvas の縮尺)
- [x] `pnpm run test:e2e` (ACCEPTANCE_DIR なし) の数と時間が変わらない
- [x] HBR-006 が auto になり、`uv run scripts/acceptance.py check` が通る
- [x] `tools/acceptance-probe/` に試しの 7 つが写り、README に使い方がある
- [x] M25-10・M25-11 を取り込むと `pnpm run shots` が緑になる (取り込んだ後に確かめ、作業ログに書く)

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 1)
- 2026-10-01: 実装 (feat/m25-01、feat/m19 の 28fdf5f から。途中で 626f179 (M25-11) を merge)。
  - `tests/e2e/lens.ts` の `expectLegible(page, targets)` を shotsOf が撮る前に呼ぶ。`installLens` を beforeEach で入れる (canvas の fillText の font と ctx の変換の拡大を拾う)。計算は `tests/e2e/lens/contrast.ts`・`fontSize.ts` (純粋。`tests/unit/lens.pure.test.ts` 19 件: WCAG の例 #767676=4.54・#777777=4.48・黒白=21、10 パーセンタイル、canvas の縮尺 10px×320/640=5px)。
  - 許す欄の表 `SCROLLS_X_ALLOWED` は訪問のリンクの欄だけ。幕の下の字 (pointer-events: none の暗い幕が上にある字。判定の板の背の幕の下の石板) と押せない札は、コントラストの検査から除く。
  - 証跡 1 (今の feat/m19 で赤): M25-10・M25-11 が feat/m19 に入る前の 28fdf5f の木では、`pnpm run shots` (M25-10 はすでに入っていたので覆いは出ない) は CRG-005 が赤で、差分は `"HUD のグラフ": ["画面の上の字が 11px 未満 (#graph): 5px・9px"]` だった。M25-11 を merge した今は緑。港の札の覆いは、`.hud-bl` の left を 44px → 12px に戻す変異で、差分に `覆い: button.harbor-dock が 生気 / 枯死・草 を覆う` と `覆い: span.harbor-dock-glyph が 輝石 を覆う` が出る (CRG-005・SEL-003 の 2 件とも赤)。
  - 証跡 2 (変異、どれも戻すと緑): graph.ts の AXIS_FONT を 11px → 6px で `"HUD のグラフ": ["画面の上の字が 11px 未満 (#graph): 6px"]`。hud.css の `.confirm` の z-index 70 → 1 で CNF-002 が `"確かめの板": "div#."` (覆われる。既存の expectUncovered が先に落とす)。確かめの文を 120 字の X にして `切れ: XXXX… (p#confirm-message.confirm-message が div.confirm-box の外へはみ出す)`。`.confirm-message` の color を #3a4a5a にして `コントラスト比が 4.5 未満: 今の島を捨てて、新しい島を始めま 1.91`。
  - 証跡 4: `playwright test --list` は変異前後とも 90 件、ACCEPTANCE_DIR なしで shots の 4 件は skipped のまま (beforeEach も回らない)。`pnpm run test:e2e` は 86 passed・4 skipped (4.3 分)。2 回目は harbor.spec.ts の M19-09 が 30 s の待ち (年の進み) で 1 回落ち、単独で再実行すると通った (shots に関係しない時間の揺れ)。
  - 証跡 5: HBR-006 を正本で `mode: auto` に移した。既存の行の変更: mode を human → auto、auto の行が持てない鍵 `when`・`minutes`・`links`・`judge` を消した (acceptance.py check がそう求める)。消した `judge` の文は「読みやすさだけ。出す・出さないと数は HBR-001・HBR-004・HBR-005・AVD-001・AVD-002・CRG-001 の自動試験が見る」、when は round、minutes は 1、links は空。title・steps・covered_by は変えていない。`uv run scripts/acceptance.py check` は ok: 43 scenarios。
  - auto の行の画: `check_shots` は auto の行の画を「active の human の行が無い」と落とすので (`acceptance.py page` が止まる)、shotsOf は正本で auto の行では撮る前の確かめだけをして画を撮らない (HBR-006-1〜5.png は出なくなる)。steps の「画 n」の文は正本に残してある。
  - 証跡 6: `tools/acceptance-probe/` に judge/judge.sh・rubric.md・schema.json・contrast.py・probe-specs/{fontdrift,occlusion,jitter}.spec.ts の 7 つと、cmp.py・cmp2.py・probe-specs/occlusionShip.spec.ts を写した。python は PEP 723 の依存 (numpy・pillow) と型注釈をつけ、`lint:py` を tools/acceptance-probe まで広げた (ruff check と format が通る)。README に使い方。
  - 証跡 7: 626f179 (M25-11) を merge した木で `ACCEPTANCE_DIR=<scratchpad> pnpm run shots` (4 件) が緑。
  - レビュー: codex は認証が切れて動かず (access token could not be refreshed)、読むだけの別モデルのレビュアーで代えた。指摘 (幕の下の字の比・auto の行の画と acceptance.py page の衝突・試験の題名と 10 パーセンタイルを固定する試験) は直した。訪問のリンクの欄の末尾まで見えることは、ADR の表どおり許す欄なので検査しない。
  - `pnpm run check`: typecheck・lint・lint:py・vitest 121 files 1197 tests・worker 66・scripts 73 が通る。
