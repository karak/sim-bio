---
id: M19-07
title: 港の契約(クライアントと Worker が共有する parse と型)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-06]
evidence: []
---

# 港の契約(クライアントと Worker が共有する parse と型)

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §5.2。`src/harbor/contract.ts`: Chronicle・Digest・Cargo・ChronicleCard の型、`parseChronicle`・`parseCargo`(unknown → Parsed<T>、不変条件: tick の単調、長さ ≤ 4000、8〜16 KB、カタログの id だけ)、`chronicleId`(正規化 JSON の SHA-256)。wire 型は `harbor/wire.ts` に閉じる。自由文を受ける項目を作らない。

## Blocked by

M19-06

## Acceptance criteria

- [ ] parse の受け入れと拒否(境界値・自由文・未知の種・大きすぎ)を単体テストで網羅
- [ ] 同じ年代記は同じ id になる(冪等の土台)
- [ ] npm run check が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
