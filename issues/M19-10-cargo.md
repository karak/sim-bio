---
id: M19-10
title: 舟の積荷(流す・漂着・外来種として受け取る)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-09]
evidence: []
---

# 舟の積荷(流す・漂着・外来種として受け取る)

優先度: Should(設計書のドライバの優先度)

## What to build

B5。空の舟の積荷(種 id と量、1〜5 件、量 (0, 10])を港に流し、ほかの見守り手が漂着をランダムに 1 件引く。受け取るかは UI で選ばせ、受け取ったら外来種として `dispatch` する(年代記に載り、再生できる)。M14(持ち込みと外来種)の土台。

## Blocked by

M19-09

## Acceptance criteria

- [ ] 流す・引く・受け取る・追い払うの単体テストと E2E
- [ ] 同じ積荷を二重に受け取らない(手元に控える)
- [ ] 受け取った外来種が年代記に載り、replay で同じ結末になる
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
