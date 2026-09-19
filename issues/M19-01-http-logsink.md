---
id: M19-01
title: HTTP LogSink
status: todo
milestone: M19
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: []
---

# HTTP LogSink

## What to build

JSON ログをサーバーへ流すアダプタ。バッチで送り、失敗しても本体は止まらない。設定で console / memory / http を切り替える。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] LogSink の HTTP アダプタ: N 件または T 秒でバッチ送信、失敗時は再試行して溢れたら捨てる(単体テスト: fetch をモック)
- [ ] 本体のログ記録の形は変えない(既存の log テストが通る)
- [ ] 設定(URL)がなければ console のまま。E2E で送信先をモックして 1 バッチ届く
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

