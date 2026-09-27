---
id: M4-03
title: 石板 UI とシナリオ選択、勝敗表示
status: done
milestone: M4
plan: docs/design/2026-09-19-scenarios-and-world.md
depends_on: [M4-02]
evidence: ["b09d573", "tests/e2e/smoke.spec.ts"]
---

# 石板 UI とシナリオ選択、勝敗表示

## What to build

URL の ?scenario=id または HUD のセレクトでシナリオを選ぶ。画面上部に石板パネル(題名、予言、残り年数、状態)。Alive / Dead が確定したら結果を大きく表示し、シミュレーションを止める。

## Blocked by

M4-02

## Acceptance criteria

- [ ] E2E: ?scenario=sinking で石板パネルに予言が出て、100x で年が進む
- [ ] E2E: 判定結果のオーバーレイが出る(短いテスト用シナリオで Dead を起こす)
- [ ] シナリオ無し(自由モード)では石板が出ない

## 作業ログ

