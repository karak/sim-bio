---
id: M19-12
title: 課金にしない構成検査と運用スクリプト
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-02]
evidence: []
---

# 課金にしない構成検査と運用スクリプト

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §3.3・Q4。`scripts/check_free_tier.py` を CI の check に入れる(使わない binding・有料の usage model・.assetsignore の欠け・20,000 ファイル/25 MiB 超えを落とす)。`scripts/mod.py`(隠す・戻す・消す・予算を見る、中身は `wrangler d1 execute --remote`)。このゲーム専用の Cloudflare アカウントで、支払い方法を登録しない運用を README に書く。

## Blocked by

M19-02

## Acceptance criteria

- [ ] check_free_tier.py が違反の各例で落ち、今の構成で通る(単体テスト)
- [ ] mod.py の各操作をローカル D1 で確かめる
- [ ] README に配備・運用・「課金にしない」の決まりを書く
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
