---
id: M25-18
title: observeCharacterization.spec の三角形の数の差 (fixture 20379 / コード 20496) の原因を突き止めて fixture を更新する
status: todo
milestone: M25
plan: docs/specs/plans/2026-10-18-plan.md
depends_on: []
evidence: []
---

# observeCharacterization.spec の三角形の数の差

優先度: Should (E2E が変更の前から落ちている。CI の E2E も落ちているはず)

## 経緯

`tests/e2e/observeCharacterization.spec.ts:37` が、fixture の三角形 20379 とコードの 20496 の差で落ちる。M24-02 の agent (2026-10-20) が d072620 の src でも同じ差で落ちることを確かめた (変更の前から)。

## What to build

どの草木 (M22-11 の磨き上げの後の木・切り株・丸太など) の三角形が増えたかを突き止め、意図した増え方なら fixture を今の数に更新する。意図しない増え方なら直す。fixture を数だけ合わせて済ませない (審査台 d1020-observe-char=ticket)。

## Acceptance criteria

- [ ] 差 117 の内訳 (どのメッシュが何枚) を記録
- [ ] fixture の更新 (または描きの直し) の後、`observeCharacterization.spec.ts` が通る
- [ ] evidence に commit SHA

## 作業ログ
- 2026-10-28: 起票 (審査台 decisions-20261020 d1020-observe-char=ticket)。
