---
id: M6-02
title: 住みやすさレイヤー
status: todo
milestone: M6
plan: docs/specs/plans/2026-09-19-m6-playable-dilemma-plan.md#32-住みやすさレイヤー-m6-02
depends_on: []
evidence: []
---

# 住みやすさレイヤー

## What to build

レイヤー列の種チップで「住みやすさ」を選ぶと、その種がいまの気温と水分で住める場所が色で見える(0 は暗く、1 はその種の色)。海は地形のまま。「密度」との切り替えができる。これで「高地は寒くて鹿が住めない。雨で帯が上がる」が読める。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] `LayerKind` に `suit:<id>` が増え、`layerToColors` が適合度 0→暗、1→種の色で塗る(長さ size²×3、海は地形色)
- [ ] 種チップが「密度 / 住みやすさ」を切り替えられる。選択中のチップが分かる
- [ ] 単体テスト: 適合度 1 のセルが種の色、0 のセルが暗色、海が地形色
- [ ] E2E: 住みやすさチップを押すとレイヤーが切り替わる(スクリーンショットではなく状態で確認)

## 作業ログ

