---
id: M25-01
title: 読みやすさの検査 (lens) を shotsOf に入れ、HBR-006 を auto に移す
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: []
evidence: []
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

- [ ] 今の feat/m19 で `pnpm run shots` が赤になり、差分に「港の札 (button.harbor-dock) が #cell-info の 生気 / 枯死・輝石・草 を覆う」と「#graph の字が 5px・9px」が出る (作業ログに出力を写す)
- [ ] 仕込んだ変異 2 つで赤になる: hud.css の `.confirm` の z-index を下げる (CNF-002 の板が石板に覆われる)、確かめの文を板の幅より長くする (切れる)。戻すと元の赤 (上の 2 つ) だけに戻る
- [ ] コントラスト比と字の大きさの純粋な関数に vitest の試験がある (WCAG の例の値、canvas の縮尺)
- [ ] `pnpm run test:e2e` (ACCEPTANCE_DIR なし) の数と時間が変わらない
- [ ] HBR-006 が auto になり、`uv run scripts/acceptance.py check` が通る
- [ ] `tools/acceptance-probe/` に試しの 7 つが写り、README に使い方がある
- [ ] M25-10・M25-11 を取り込むと `pnpm run shots` が緑になる (取り込んだ後に確かめ、作業ログに書く)

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 1)
