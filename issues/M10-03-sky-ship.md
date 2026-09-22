---
id: M10-03
title: 空の舟(持ち出し)
status: done
milestone: M10
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M10-01, M10-05]
evidence: ["3ad6a98 tests/unit/ship.test.ts", "3ad6a98 tests/unit/world.ship.test.ts", "3ad6a98 tests/unit/scenario.judge.test.ts tests/unit/ui.tablet.test.ts tests/e2e/smoke.spec.ts", "3ad6a98 npm run check (437 tests) / npx playwright test (21 tests)", "5969f4e tests/slow/scenarios.playthrough.test.ts (sky-ship 5 件)", "5969f4e docs/specs/2026-09-19-ecosystem-sim-design.md#4.24.1"]
---

# 空の舟(持ち出し)

## What to build

段階「帆」以上の文明は、種と民を空の舟に乗せて次の島へ逃がせる。逃がした時点でシナリオは「逃がす」の部分勝利。舟は森を伐り、信仰が低いと民が乗らない。「空の舟」を校正する。

## Blocked by

M10-01, M10-05

## Acceptance criteria

- [x] 校正の前にレベルデザイン文書(体験の芯・キーアイテム・ループ・判定行列)を書き、ユーザーの承認を得る(M10-05 に集約。2026-09-22 13:52 承認)
- [x] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [x] コマンド launch_ship: 段階 ≥ 帆、信仰 ≥ 0.5、周囲の森 ≥ 必要量で、種の密度と文明の状態を持ち出しデータに書き出す(単体テスト、JSON の形を固定)
- [x] 舟の建造中は森が減る(単体テスト)。信仰不足・森不足なら拒否
- [x] Verdict に escaped が増え、石板のオーバーレイが「次の島へ」を出す。持ち出しデータをダウンロードできる(E2E)
- [x] 「空の舟」: 回避不能の沈没(200 年)。tests/slow で放置 dead、舟だけ急ぐ(森切れ)dead、想定解 2 つ escaped
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す(機構の部分。校正は tests/slow で別途)

## 作業ログ

- 2026-09-22: 機構の実装(worktree)。`src/simulation/ship.ts` を新設し、launch_ship コマンド、舟の建造(材の伐採・進み)、完成時の信仰判定、崩壊時の破棄、持ち出し JSON (`exportCargo`)、Verdict `escaped`(`escape` 条件を dead より先に評価)、HUD `#hud-ship` 行、石板のオーバーレイ(「次の島へ」・持ち出しのダウンロード)を配線。シナリオ `sky-ship`・`test-ship` を追加。npm run check(437 テスト)・E2E(21 テスト)通過。tests/slow の校正(想定解・放置 dead・急ぎ dead)は未着手で、別セッションで行う。
- 2026-09-22: 校正。SHIP_NEED 10 → 120(開始時の森だけで飛べてしまうため)。森は鹿に食われて材にならず、鐘樹が唯一の材。tests/slow 5 件(放置 dead・開始時の森で着工 dead・森を放ち続ける dead・鐘樹を植えながら escaped・育ててから escaped)。単体 439、E2E 21 通過(5969f4e)。
