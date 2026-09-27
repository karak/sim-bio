---
id: M6-02
title: 住みやすさレイヤー
status: done
milestone: M6
plan: docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md#32-住みやすさレイヤー-m6-02
depends_on: []
evidence: ["73869bb tests/unit/render.layerToColors.test.ts tests/e2e/smoke.spec.ts"]
---

# 住みやすさレイヤー

## What to build

レイヤー列の種チップで「住みやすさ」を選ぶと、その種がいまの気温と水分で住める場所が色で見える(0 は暗く、1 はその種の色)。海は地形のまま。「密度」との切り替えができる。これで「高地は寒くて鹿が住めない。雨で帯が上がる」が読める。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] `LayerKind` に `suit:<id>` が増え、`layerToColors` が適合度 0→暗、1→種の色で塗る(長さ size²×3、海は地形色)
- [x] 種チップが「密度 / 住みやすさ」を切り替えられる。選択中のチップが分かる
- [x] 単体テスト: 適合度 1 のセルが種の色、0 のセルが暗色、海が地形色
- [x] E2E: 住みやすさチップを押すとレイヤーが切り替わる(スクリーンショットではなく状態で確認)

## 作業ログ

- 2026-09-19: sonnet 委譲で実装、セッション上限で中断したため引き継ぎ。列が伸びて石板・グラフと重なり E2E が落ちたので、右側 HUD を縦積みコンテナに変更。
