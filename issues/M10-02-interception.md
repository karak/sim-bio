---
id: M10-02
title: 迎撃
status: done
milestone: M10
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: [M10-01, M10-05]
evidence: ["00d1dd0 docs/design/2026-09-22-level-design-devices.md", "3ce0429 tests/unit/civilizationLoad.test.ts tests/unit/world.civilization.star.test.ts", "9076a1e tests/unit/works.test.ts tests/unit/world.civilization.works.test.ts", "50968ac tests/unit/scenario.intercept.test.ts tests/e2e/smoke.spec.ts", "9a30d6e tests/slow/scenarios.playthrough.test.ts tests/unit/world.crystalScale.test.ts", "9a30d6e docs/specs/2026-09-19-ecosystem-sim-design.md#4.23"]
---

# 迎撃

## What to build

段階「星」の文明が輝石を十分に持てば、予定された隕石を撃ち落とせる。石板の予言が書き換わる。「迎撃の塔」を校正する。

## Blocked by

M10-01, M10-05

## Acceptance criteria

- [x] 校正の前にレベルデザイン文書(体験の芯・キーアイテム・ループ・判定行列)を書き、ユーザーの承認を得る(M10-05 に集約)
- [x] レバー感度・定着・副作用の確認がヘッドレスで通っている(通らなければ係数ではなく仕組みに戻る)
- [x] コマンド intercept: 段階 星 かつ 輝石 ≥ 必要量で、次に予定された隕石の予定コマンドを取り消す。条件を満たさなければ拒否(単体テスト)
- [x] 取り消した予定は石板の節目から消え、年表に「星が砕けた」が並ぶ(E2E)
- [x] 「迎撃の塔」: 星まで上げる採掘で生気が減る、信仰が低いと工事が止まる。tests/slow で放置 dead・素朴戦略 dead・想定解 2 つ alive
- [x] 設計書に校正の表と証跡
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
- 2026-09-22: 星の門(半径 12 + 信仰 0.8)、工事、intercept、薄い脈、隕石三度で校正。tests/slow 5 件、単体 399、E2E 20 通過。校正の表は設計書 §4.23、経緯は LD §8.1/8.2(9a30d6e)。
