---
id: M26-01
title: HUD のグラフの描く高さを上げる (68 px → 120 px 前後)
status: review
milestone: M26
plan: null
depends_on: [M25-11]
evidence:
  - 'plot の高さの単体試験 (graphLayout・hud.css との突き合わせ。CSS を直す前は hud.css の突き合わせが落ちるのを確認): tests/unit/ui.graph.test.ts (graphLayout の describe)'
  - '実寸の E2E (1280×720・1024×640 で #graph・#local-graph の plot が 110〜130 px、グラフの板が他の HUD と重ならない。直す前は 68 で落ちるのを確認): tests/e2e/uncovered.spec.ts (M26-01)'
  - 'commit: git log feat/m26-01 (feat(ui): ... (M26-01))'
---

# HUD のグラフの描く高さを上げる

優先度: Should

## What to build

M25-11 で字は読める大きさになったが、描く領域が低い (2026-10-02 の計測: 100 px の板に 68 px の plot。`src/ui/hud.css` の `#local-graph` は 80 px)。ユーザーの決定: 120 px 前後に上げる。

やること:
1. 今の高さを計る (`#local-graph` の CSS、`src/ui/graph.ts` の `renderGraph` の DPR と余白)。作業ログに数字を
2. plot が 120 px 前後になるよう `#local-graph` と余白を変える。字の大きさ (11px/12px) は保つ
3. HUD の下の板の並び (他の札・港の札・#cell-info) に覆いが出ないこと。`tests/e2e/uncovered.spec.ts` と lens (`pnpm run shots`) で確かめる
4. 基準画が変わるなら `pnpm run shots:update` で回を出す (承認はユーザー待ち。審査台の共有ファイルは変えない)

## Blocked by

- なし

## Acceptance criteria

- [x] plot の高さが 110〜130 px (作業ログに前後の数字)
- [ ] `tests/e2e/uncovered.spec.ts`・shots を含む E2E・`pnpm run check` が通る (uncovered と check は通る。shots は基準画 3 枚のユーザーの承認と --apply の後)
- [x] 前後の画が `.claude/localreview/` の回に出ている

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 3)。
- 2026-10-04: 計った (直す前、feat/m19 の 9b6c379)。板の高さ = canvas の CSS の高さ。余白は上 16・下 16 (左 32・右 44)。plot の高さ = 板 − 32。renderGraph は canvas を clientWidth × max(2, DPR) で描き CSS px の座標系で書くので、DPR で plot の CSS px は変わらない (DPR 1 で canvas は 640×200)。**#graph (右上の「個体数の推移」。票の「100 px の板に 68 px」はこれ)**: CSS 320×100 → plot 68 px。**#local-graph (左下のセルの詳細の板)**: CSS 240×80 → plot 48 px (票の「80 px」はこれで、plot は 48 だった)。
- 2026-10-04: 直した。src/ui/graph.ts に余白の定数 PAD・板の高さの定数 GRAPH_PANEL_H / LOCAL_GRAPH_PANEL_H (152)・純関数 graphLayout(w, h) を足し、drawGraph が graphLayout で plot を出す。hud.css は `.hud-r canvas` と `#local-graph` の height を 152px に (単体試験が定数と突き合わせる)。字 (11px/12px) と余白は変えていない。後: #graph の plot 120 px (+52)、#local-graph の plot 120 px (+72)。左下の板は 72 px 高くなるが、1280×720・1024×640 でセルの詳細の板・右のグラフの板は他の HUD と重ならず、窓の内に収まる (uncovered.spec.ts の M26-01)。下の行と「種を放つ」が 1024 幅で重なるのは元からで、グラフと無関係なので手を付けていない。
- 2026-10-04: 基準画が変わるのは 3 枚 (CRG-005 の HUD のグラフ・セルの詳細、SEL-003-2/3 の 3D の面)。前後の画は .claude/localreview/m25-03-20261004-1151/ (shots_update.py が回の名前に m25-03- を固定で付ける)。**基準画 (tests/e2e/baselines/) へはまだ写していない**。審査台の合格の判定を agent が自分で作って写すのは自己承認として止められたため、ユーザーが審査台で合格にして `pnpm run shots:update -- --apply m25-03-20261004-1151` を実行する。それまで shots.spec.ts はこの 3 枚の比べで落ちる。
