---
id: M25-13
title: 訪問の画面の見た目・読みやすさを lens と基準画で見る
status: in_progress
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-04, M25-08]
evidence: []
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

- [ ] `uv run scripts/acceptance.py check` が通り、HBR-007 の手順が lens を持つ
- [ ] `pnpm run shots` が HBR-007 を撮り、lens と基準画の比べが通る
- [ ] 続けて 2 回撮って、差が閾値の内に収まる
- [ ] `pnpm run check` と E2E の全件 (shots を含む、CI 無し) が通る

## 作業ログ

- 2026-10-04: 起票。
