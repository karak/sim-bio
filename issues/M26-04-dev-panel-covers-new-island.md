---
id: M26-04
title: 開発の板 (?dev=1) が「新しい島」の口を覆う
status: review
milestone: M26
plan: null
depends_on: []
evidence:
  - "tests/e2e/uncovered.spec.ts M26-04 (4 通り: 自由/石板 × 1280x720/1024x640) 通る。直す前は 1280x720 で落ちた (コミット e8c6f6e)"
  - "src/dev/panel.ts: 板を右の列の下 (right 12px / top 388px) へ"
  - "pnpm run check exit 0。shots.spec.ts 6 件通る (ACCEPTANCE_DIR 付き、E2E_PORT=5445)。基準画の差なし"
---

# 開発の板 (?dev=1) が「新しい島」の口を覆う

優先度: Should

## What to build

ADR 0001 の付録 B で見つけた欠陥。`?dev=1` の開発の板 (`src/dev/panel.ts`、右下 250 px・z-index 40) が HUD の「新しい島」(自由モード) の口を覆い、押せない。

やること:
1. 覆いを 5 点で見る試験を `tests/e2e/uncovered.spec.ts` に足して落ちるのを見る (`expectAllRowsUncoveredAtFivePoints` の流儀)。1280×720 と 1024×640 で
2. 直す: 板を畳める / 位置をずらす / 「新しい島」の列を避ける、のどれかをこの票で決める。製品 (dev 無し) の見た目は変えない
3. lens (`pnpm run shots`) の HBR-006・TUR-001 は `?dev=1` で撮っているので、基準画が変わるなら回を出す (承認はユーザー待ち)

## Blocked by

- なし

## Acceptance criteria

- [x] uncovered.spec に「開発の板は『新しい島』を覆わない」があり通る
- [x] `pnpm run check`・uncovered・shots を含む E2E が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 5)。
- 2026-10-04: 試験を先に足し、1280x720 で落ちるのを見た (1024x640 は元から重ならず通る)。直し方は「位置をずらす」を選んだ。畳む案は板の中身 (状態送り・近道) を毎回開く手間が増える。「新しい島」の列を避ける案は下の行の幅を dev でだけ変えるので行の折り返しが変わる。最初は左上 (時間の箱の下) へ置いたが、レビューで、文明が現れて時間の箱が伸びると勅令・速度ボタン・「3D で見る」を覆うと指摘され、右の列のグラフの下・「種を放つ」札の上 (right 12px / top 388px) に置き直した。試験は「新しい島」・#speed-0・「3D で見る」・種を放つ札の先頭を 5 点で見る。製品 (dev 無し) の見た目は変わらない (src/dev は DEVTOOLS_BUILT の動的 import のみ)。
- 2026-10-04: shots は開発の板を隠して (HIDE_DEV) 撮るため、HBR-006・TUR-001 を含め基準画に差は出ず、回は出していない (画の承認待ちは無い)。
- 2026-10-04: M26-01 でグラフの板が 152 px になり、固定の top 388px の板が右のグラフの板を覆った。板を右の列 (.hud-right) の末尾へ積む形に変えた (位置は列の流れで決まり、top の固定値は無い)。試験に右の板の全行・#local-graph を足した。詳しくは M26-01 の作業ログ。
