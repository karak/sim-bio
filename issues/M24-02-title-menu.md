---
id: M24-02
title: タイトルのメニュー (新規ゲーム・ロード・コンフィグ)
status: todo
milestone: M24
plan: docs/uiux/2026-10-04-title-flow.md
depends_on: [M24-01]
evidence:
  - 5de0d6b titleStepOf・config (tests/unit/ui.titleMenu.route.test.ts, ui.titleMenu.panels.test.ts, persist.config.test.ts)
  - 4a2f1d7 板と runAtTitle (tests/unit/app.title.test.ts, app.restore.test.ts)
  - 1a64713 tests/e2e/titleMenu.spec.ts 4 本 (層 A: .claude/verify/20261020-0942-m24-02/)
  - bf34448 config を app/title.ts に寄せる
---

# タイトルのメニュー (新規ゲーム・ロード・コンフィグ)

優先度: Must

## What to build

M24-00 の W/F に沿って、タイトルのメニューの中身を作る。
- 新規ゲーム: 自由モードで新しい島 / シナリオ選択 (M24-03) へ
- ロード: 枠 (自動の枠を含む) とファイルから、元の舞台 (自由モード・石板) で開く
- コンフィグ: M24-00 で決めた項目。変えた値は保存され、次の起動で戻る

## Acceptance criteria

- [ ] 試験を先に書く: メニューの操作 → 行き先 (舞台・読む枠) を純粋な関数にし、表の単体試験で確かめる。確かめ (やり直しが効かない操作) の有無も表に入れる
- [ ] ロードは操作画面の枠の読込と同じ道 (feat/m19 の planSlotLoad・M21-07 の planOp) を通り、別の読み方を作らない
- [ ] コンフィグの値の読み書きは置き場 (Storage) を引数に取り、単体試験で確かめる。壊れた値は既定に戻す
- [ ] E2E: 新規ゲーム・ロード (枠・ファイル)・コンフィグの変更と次の起動での戻りを、それぞれ 1 本ずつ
- [ ] 手動の受入の行を正本 (docs/acceptance/scenarios.jsonl) に足す。見た目だけを人に任せ、行き先は auto にする

## Blocked by

- M24-01
- feat/m19 の main への取り込み。ロードの枠とファイル (src/persist) は feat/m19 にしかない (2026-09-29 時点で main より 137 コミット先)

## 作業ログ
- 2026-10-20: 実装・feat/m19 に取り込み (merge)。層 C (前後の画 .claude/localreview/m24-02-20261020-0617/) と scenarios.jsonl の 5 行の承認待ちで status は todo のまま。check:docs は E2E の数 21→22 の承認待ちで赤。perf 92.8→91.7 ms。既知: observeCharacterization.spec.ts:37 は変更前から落ちる。
- 2026-10-28 審査台 decisions-20261020 の判定: コンフィグの置き場は `src/persist/config.ts` のままでよい (d1020-config-place=ok)。正本に SAV-008/009/010・CFG-001 を足した (675a1b5)。TTL-001 (human) は ADR 0001 段 6 と衝突するので保留。死んだ PENDING_TEXT・openPanel を消した (429d70b)。層 C は未判定。
