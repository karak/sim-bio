---
id: M25-10
title: 港の札が #cell-info の行の札 (生気 / 枯死・輝石・草) を覆う
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: []
evidence:
  - tests/e2e/uncovered.spec.ts (M25-10 の 3 試験。直す前 3 画面とも赤・直した後緑)
  - tests/e2e/uncovered.ts (expectAllRowsUncoveredAtFivePoints)
  - src/ui/hud.css (.hud-bl の left 12px → 44px)
  - .claude/localreview/m25-10/ (前後の画。git の外)
  - commit SHA は README の作業ログの直後のコミット (git log feat/m25-10 -1)
---

# 港の札が #cell-info の行の札 (生気 / 枯死・輝石・草) を覆う

優先度: Must

## What to build

ADR 0001 の「この ADR の外で起こす票」。設計に依らない製品の欠陥。

自由モードで島を押してセルの詳細を出すと、左の縁の港の札 (`button.harbor-dock`、x 0〜36・y 336〜384、1280×720) が #cell-info (x 22〜262・y 270〜524) の「生気 / 枯死」「輝石」「草」の札を覆う (ADR の付録 B の 1。CRG-005-2・SEL-003-3 の画にも写る)。
今の `expectUncovered` は真ん中の 1 点しか見ないので通っていた。

直し方はこの票で決める (港の札を #cell-info の上か下へ逃がす、#cell-info の左の余白を港の札の幅ぶん取る、など)。石板の画面と判定の板の出ている画面でも覆わないこと。

## Blocked by

- なし (M25-01 の lens が入っていれば、直したことを lens が示す)

## Acceptance criteria

- [x] 直す前に tests/e2e/uncovered.spec.ts に「セルの詳細の行の札は港の札に覆われない」を足し、5 点で見て落ちるのを見る
- [x] 直した後に通る。自由モード・石板・判定の板の 3 つの画面で
- [ ] M25-01 (未着手のため未確認)  が入っていれば `pnpm run shots` の覆いの赤が消える

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の外の票 外-2)
- 2026-10-01: 試験を先に足した (行の札を左端・右端・上端・下端・真ん中の 5 点で全行見る。自由モード・石板・判定の板の 3 画面で、直す前は生気 / 枯死・輝石・草が港の札に覆われて赤)。直しは .hud-bl の left を 12px → 44px にして、板を港の札 (幅 36px) の右へ寄せた。レビューは codex が認証切れのため読むだけの別モデルの reviewer で代え、全行を見る・判定の待ちを 90 s にする・注を規則の前に置くを取り込んだ。前後の画は .claude/localreview/m25-10/。check 緑 (vitest 1157)、E2E 90 件 (全件では低 fps で observe 2 件・scenarioSave 1 件が落ちたが、その 2 ファイルの再実行は 12 件緑)
