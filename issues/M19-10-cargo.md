---
id: M19-10
title: 舟の積荷(流す・漂着・外来種として受け取る)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-09]
evidence: ["3b7f037・6f63e63・fc03159・833a146 tests/unit/harbor.cargo.test.ts tests/unit/harbor.client.test.ts tests/e2e/harbor.spec.ts"]
---

# 舟の積荷(流す・漂着・外来種として受け取る)

優先度: Should(設計書のドライバの優先度)

## What to build

B5。空の舟の積荷(種 id と量、1〜5 件、量 (0, 10])を港に流し、ほかの見守り手が漂着をランダムに 1 件引く。受け取るかは UI で選ばせ、受け取ったら外来種として `dispatch` する(年代記に載り、再生できる)。M14(持ち込みと外来種)の土台。

## Blocked by

M19-09

## Acceptance criteria

- [x] 流す・引く・受け取る・追い払うの単体テストと E2E → tests/unit/harbor.client.test.ts「港のクライアントの積荷 (M19-10、設計書 B5)」6 件、tests/unit/harbor.cargo.test.ts(cargoOfHold・landingCell)、tests/e2e/harbor.spec.ts「M19-10: 浜の漂着を引き、追い払う・受け取る…」「M19-10: 星の力が足りなければ積荷を受け取らず…」「M19-10: 空の舟で次の島へ逃れると、積荷 (種と量) を港に流す」(3b7f037・6f63e63・fc03159)
- [x] 同じ積荷を二重に受け取らない(手元に控える) → harbor.client.test.ts「受け取りは 1 つの積荷に 1 回だけ: 二度目は land を呼ばずに already。二度押し (同時) でも land は 1 回」、E2E で開き直しても二度は受け取れない。手元の控え marks は IndexedDB の版 5
- [x] 受け取った外来種が年代記に載り、replay で同じ結末になる → harbor.cargo.test.ts「年の途中で受け取った島の Digest と、その年代記を replay した Digest が同じ」
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す → feat/m19 と合わせた 833a146 で pnpm run check(単体 996・worker 64・scripts 42)、E2E 49、Cloudflare の E2E 5 がすべて通過(親が確認)

## 作業ログ

### 2026-09-27(M19-10・11 をまとめて進めた)

- agent が 600 秒の無応答で何度も止まったので、2 人目の agent が同じ worktree を引き継ぎ、最後は親が書きかけを WIP として commit して(fc03159)、確かめとチケットを仕上げた。
- 積荷は空の舟で逃れた(escaped)瞬間の持ち出し(exportCargo)と同じ snapshot から作る(`cargoOfHold`: 総数の多い順に 5 件まで、量は総数の 1/100 を 3 桁に丸めて 10 で頭打ち)。判定の板の出港と一緒に港へ流す(`harbor.settle`)。
- 漂着は港の口から引き、受け取るか追い払うかを選ぶ。受け取ると浜のセル(`landingCell`、海に接する陸、同じ積荷はいつも同じセル)に、積荷の種ごとに 1 つの放流として `intervene` を通す(年代記に載る)。石板では放流の値段を種の数だけ先に確かめ、足りなければ 1 種も放たない。
- 二重の受け取りは手元の控え(IndexedDB 版 5 の marks)で防ぐ。
