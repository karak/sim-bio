---
id: M19-08
title: 港の Worker と D1(ルート・日次予算・閉港の返事・Cron)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-07, M19-02]
evidence: []
---

# 港の Worker と D1(ルート・日次予算・閉港の返事・Cron)

優先度: Should(設計書のドライバの優先度)

## What to build

設計書 §3・§6。Worker 1 本(静的アセットと同梱、`/api/v1/*` だけ fetch handler)。ルート: 出港・一覧・1 件・照合・通報・取り下げ・積荷・回避率・ログ。D1 のマイグレーション(年代記・通報・積荷・回避の集計・日次予算)。Turnstile の siteverify(出港と通報)、Rate Limiting binding(無料プランで使えなければ D1 の日次予算だけで締める)、日次予算と捨てる順(ログ > 確認 > 一覧 > 積荷 > 出港 > 訪問)、保存 400 MB の内部の栓、取り下げ鍵(D1 にはハッシュ)、通報 3 件で自動で隠す、IP は日替わりの salt の HMAC で数えるだけ。Cron 1 本で掃除と保存量の集計。

## Blocked by

M19-07, M19-02

## Acceptance criteria

- [ ] @cloudflare/vitest-pool-workers とローカル D1 で、各ルートの正常・不正な形(400/422)・予算切れ(503)・回数制限(429)を単体テスト
- [ ] D1 の上限エラーと 1027 を、クライアントが closed に読み替えられる一貫した返事にする
- [ ] 同じ年代記の出港が 2 回で 1 件(INSERT OR IGNORE)
- [ ] CPU 10 ms の内に収まることを計測して記す
- [ ] Rate Limiting binding が無料プランで使えるかを確かめて記す
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
