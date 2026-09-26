---
id: M19-11
title: 予言ごとの回避率
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-08]
evidence: ["3b7f037・6f63e63・fc03159・833a146 tests/unit/harbor.cargo.test.ts tests/unit/harbor.client.test.ts tests/e2e/harbor.spec.ts"]
---

# 予言ごとの回避率

優先度: Could(設計書のドライバの優先度)

## What to build

B6。シナリオを終えたら 1 回数え(D1 の集計の加算)、予言ごとの回避率を石板に見せる。検証できない数なので順位は作らない。

## Blocked by

M19-08

## Acceptance criteria

- [x] 報告と取得の単体テスト、日次予算の内で数える → harbor.client.test.ts「港のクライアントの回避率 (M19-11、設計書 B6)」3 件(同じ年代記は二度数えない・滅びも数える・カタログに無い石板は rejected)。港の側の日次予算は M19-08 の worker/test で確かめ済み
- [x] 石板に「この予言を越えた見守り手は N%」(閉港時は出さない) → E2E「M19-11: 石板を終えると 1 回数え、石板と判定の板に回避率を出す。同じ年代記は二度数えない」「M19-11: 閉港なら回避率を出さない」、文は tests/unit/ui.harborText.test.ts
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す → 833a146 で check・E2E 49・Cloudflare の E2E 5 がすべて通過(親が確認)

## 作業ログ

### 2026-09-27

- 石板を終えたら判定の要約と一緒に 1 回だけ数える(`harbor.settle`、同じ年代記は手元の控えで二度数えない)。回避率は港が返す数(finished・avoided)から画面で割り、石板と判定の板に出す。閉港のときは出さない。順位は作らない。
- M19-10 と同じ worktree・同じコミット群(6f63e63・fc03159)。
