---
id: M19-09
title: 港のクライアントと、出港・一覧・訪問・照合の UI
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-08, M19-05]
evidence: []
---

# 港のクライアントと、出港・一覧・訪問・照合の UI

優先度: Should(設計書のドライバの優先度)

## What to build

設計書 §5.2。`createHarbor`(例外を投げず kind で返す。人間確認・閉港の読み替え・outbox・再送・取り下げ鍵の保管を裏に隠す。baseUrl が無ければ常に閉港)。UI は `src/ui/clicks.ts` に入口を足す(台本と UI が同じ入口)。訪問は 3D 観察画面へ。版違いの年代記は要約だけを見せる。島の名前は seed から作り、ひとことは碑文のカタログから選ぶ。

## Blocked by

M19-08, M19-05

## Acceptance criteria

- [ ] page.route() で API を決定論的にモックし、出港 → リンク → 訪問 → 照合の E2E
- [ ] API を全部閉じた状態で 1 シナリオ遊べ、出港が outbox に入り、開いたら同じ id で再送される(E2E)
- [ ] 不変条件: main.ts は静的アセット以外のネットワークに頼らずに起動する
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
