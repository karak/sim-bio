---
id: M25-13
title: 訪問の画面の見た目・読みやすさを lens と基準画で見る
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-04, M25-08]
evidence:
  - "AC1: uv run scripts/acceptance.py check ok: 45 scenarios (HBR-007 の 5 手順のうち 3 つが lens の checks を持つ)"
  - "AC2: pnpm run shots の HBR-007 (tests/e2e/shots.spec.ts) が lens と基準画 4 枚 (tests/e2e/baselines/HBR-007-*) の比べを通る。lens は初め「訪れている島」の字が 3.26 で落ち、src/ui/harbor.css の .harbor-visit .harbor-sub で直した"
  - "AC3: 基準画を書いたあと、HBR-007 を続けて 2 回ずつ (直しの前後で計 4 回) 回して全部 passed。島の名前は 4 回とも同じ (基準画と閾値内で合う)"
  - "AC4: pnpm run check 通る (vitest 124 files 1225 passed・worker 66・scripts)。E2E 98 passed (E2E_PORT=5465、ACCEPTANCE_DIR 付きで shots を含む、CI 無し、feat/m19 99cfcf5 を merge した木)" 
---

# 訪問の画面の見た目・読みやすさを lens と基準画で見る

優先度: Must

## What to build

M25-08 で TUR-001・TUR-002 の人の手順が 1 分に縮み、訪問の画面 (別の見守り手の島を `visit=` で開く。島の名前・碑文の板・年表を読んだ後の「港の記録と同じ結末」の文) の【見た目】【読みやすさ】を誰も見なくなった (HBR-001 は出る・出ないしか見ない。OBS-002 は観察画面の 3 枚だけ)。ADR 0001 の「読める」の性質 (lens) と基準画で、ここを機械に移す。

作るもの:
- 正本に新しい行 HBR-007 (mode auto、手順に `checks: [{lens: "legible", target}]`)。既存の行は変えない
- `tests/e2e/shots.spec.ts` に撮影を足す (driver を使う。reducedMotion・手で進める時計 (`installFrames`)・港の写し)。lens で読みやすさを確かめ、要素ごとの基準画を足す

## Blocked by

- M25-03 (lens の撮影・基準画)
- M25-04 (driver)
- M25-08 (TUR の吸収先の表)

## Acceptance criteria

- [x] `uv run scripts/acceptance.py check` が通り、HBR-007 の手順が lens を持つ
- [x] `pnpm run shots` が HBR-007 を撮り、lens と基準画の比べが通る
- [x] 続けて 2 回撮って、差が閾値の内に収まる
- [x] `pnpm run check` と E2E の全件 (shots を含む、CI 無し) が通る

## 作業ログ

- 2026-10-04: 起票。
- 2026-10-04: 実装 (feat/m25-13、feat/m19 の d05ae6c から。bdf2d59・99cfcf5 を merge)。
  - 正本に HBR-007 を足した (既存の行は変えていない)。画 1 (島の名前・訪問の板)・画 2 (観察画面の帯)・画 3 (年表の結末・読み終えた訪問の板)。
  - 撮り方: 別のタブの見守り手が出港のリンクを開く (港の写しは分け合う)。installFrames で時計を手で進め、撮る間だけ withRealFrames。帯は 3D の上なので画素の基準は持たない (OBS-002 と同じ、lens は掛ける)。
  - lens が見つけた欠陥: 板の頭の「訪れている島」が面の明るい上端でコントラスト比 3.26 (< 4.5)。訪問の板の中だけ #cddcd6 にした (--harbor-dim は共有なので触らない)。
  - 基準画 4 枚の置き場は tests/e2e/baselines/HBR-007-<n>-<要素>.png。島の名前は年代記の hash から決まるので、年代記か版が変わると基準画も変わる。島の名前・年表の結末の 1 行の帯は TEXT_STRIPS (0.12) に足した。
  - 審査台の回は .claude/localreview/m25-03-20261004-0324/ (shots_update.py が回の名前に m25-03- を固定で付ける。auto mode の拒否で m25-13- への改名はできなかった)。基準画は agent が仮の合格 (scratchpad の verdicts) で写した。**基準画の承認はユーザー待ち**。
  - レビュー (読むだけの opus)。直した: 入る待ちの timeout 60 s、島の名前・碑文・進みの棒の断言、細い帯の閾値。直さない: 画 1・2 の札 (【見た目】) は基準画で見るので残した、TUR-001 の judge に HBR-007 を書かない (既存の行)、from は空。
