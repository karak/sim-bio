---
id: M12-06
title: 「氷期の到来」の校正
status: todo
milestone: M12
plan: docs/design/2026-09-19-scenarios-and-world.md#b-天から--隕石太陽氷期6
depends_on: [M12-00, M12-02, M12-03]
evidence: []
---

# 「氷期の到来」の校正

## What to build

200 年で氷期が来る(scenarios-and-world §3 #12)。氷が南下して餌が減る。文明「火」から始まり、氷期を越えて 3 階層と文明が存続すれば alive、絶滅で dead。
「太陽の病」(#10)と芯が重なるので、違いは M12-00 の LD で決めたものに従う。予算付きで判定行列を固定する。

## Blocked by

M12-00, M12-02, M12-03

## Acceptance criteria

- [ ] M12-00 のレベルデザイン(承認済み)に従う。想定解の台本は UI と同じ手(放流 環 1・0.5、力 4)で書き、手で勝てない想定解は成立と数えない
- [ ] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [ ] scenarios.json に氷期の到来(予言・予定・予算・節目・alive/dead)
- [ ] tests/slow: 放置 dead、素朴戦略 2 つ dead、想定解 2 つ alive。既存も通る
- [ ] 設計書に係数と校正の表
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
