---
id: M19-05
title: 手元の保存(IndexedDB、自動保存と手動の枠)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: []
---

# 手元の保存(IndexedDB、自動保存と手動の枠)

優先度: Must(設計書のドライバの優先度)

## What to build

B2。SaveData と年代記を IndexedDB に置く(`src/persist/islandStore.ts`)。localStorage は 5 MB 前後で SaveData を複数持てない。サーバーは関わらない。今の `onSave: () => world.serialize()` の延長。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 自動保存(N tick ごと)と手動の枠の保存・読込・一覧(fake-indexeddb で単体テスト)
- [ ] 閉じて開き直すと続きから遊べる(E2E)
- [ ] シナリオ中の読込は予言と矛盾するので無効、の既存の規則を保つ
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
