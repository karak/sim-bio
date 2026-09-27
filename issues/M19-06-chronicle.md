---
id: M19-06
title: 年代記の記録と再生(Web Worker)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-04]
evidence: []
---

# 年代記の記録と再生(Web Worker)

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §5。UI の `dispatch` を外から包んで tick 付きの命令を積む `recordChronicle`(World は変えない。予言の fromStar:false は載せない)、Web Worker で年代記を回し直す `replay`(tick の上限と中断を持つ)、結末の要約 `digestOf`(toPrecision(6)、正規化 JSON の SHA-256)。年ごとの種の総数の短い系列を添える(折れ線用)。

## Blocked by

M19-04

## Acceptance criteria

- [ ] seed + 年代記 → 同じ Digest を 1 本のテストで示す(設計書 §9 の最初の一手)
- [ ] 拒否された命令は年代記に載らない。自動保存からの復帰で年代記を引き継ぐ
- [ ] 壊れた年代記(tick の逆行・長すぎ)で replay が止まり、タブを落とさない
- [ ] 300 年の再生の所要時間を計測して作業ログに記す(照合を自動で走らせるか決める材料)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
