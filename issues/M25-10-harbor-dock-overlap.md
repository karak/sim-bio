---
id: M25-10
title: 港の札が #cell-info の行の札 (生気 / 枯死・輝石・草) を覆う
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: []
evidence: []
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

- [ ] 直す前に tests/e2e/uncovered.spec.ts に「セルの詳細の行の札は港の札に覆われない」を足し、5 点で見て落ちるのを見る
- [ ] 直した後に通る。自由モード・石板・判定の板の 3 つの画面で
- [ ] M25-01 が入っていれば `pnpm run shots` の覆いの赤が消える

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の外の票 外-2)
