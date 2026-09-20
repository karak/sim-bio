---
id: M8-08
title: 塔の燃料モデルと火の山の導線
status: done
milestone: M8
plan: docs/design/2026-09-20-level-design-tower.md
depends_on: [M8-07]
evidence: ["cdeccc9 tests/unit/civilizationFuel.test.ts tests/unit/world.civilization.fuel.test.ts tests/e2e/smoke.spec.ts"]
---

# 塔の燃料モデルと火の山の導線

## What to build

塔は燃料で立つ。集落半径内の熱(heat)と鐘樹の材から年に一度燃料を徴収し、不足が続けば段階が下がる。石板と HUD に燃料の残りと必要量が出る。火山セルが分かり、そこに火山を打てば熱が燃料になる。

## Blocked by

M8-07

## Acceptance criteria

- [x] 年次で fuel = 半径内の heat の和 × HEAT_FUEL + 鐘樹の立木 × TIMBER_RATE を徴収(heat と鐘樹を減らす)。FUEL_NEED[stage] に足りない年が FUEL_YEARS 続くと段階 −1(単体テスト) — `src/simulation/civilizationFuel.ts` の `collectFuel`、`tests/unit/civilizationFuel.test.ts`、`tests/unit/world.civilization.fuel.test.ts`(「熱が全く無い状態が FUEL_YEARS 年続くと段階が 1 下がる」)
- [x] HUD の文明の行に「燃料 12 / 必要 8」、石板の警告 fuel_low、年表に燃料切れの衰退 — `src/ui/Hud.ts`(`formatCiv`)、`src/scenario/warnings.ts`(`fuel_low`)。年表は既存の `civ_stage` イベントがそのまま reason: 'fuel' の段階下げも描画する(テキストは from/to のみで reason 非表示、既存仕様どおり)
- [x] 火山セル(標高最大、または `WorldConfig.volcanoCell` で上書き)を World が公開し、HUD の火山チップを持つとそのセルが強調される。噴火の熱が翌年の燃料に入る(単体 + E2E) — `World.volcanoCell()`、`SceneView.setVolcanoHint`、`tests/e2e/smoke.spec.ts`(`volcano hint: ...`, `tower fuel: ...`)
- [x] レバー感度テスト(ヘッドレス、tests/unit か tests/slow): 噴火 1 回で塔の燃料が必要量の 2 年分以上入る — `tests/unit/world.civilization.fuel.test.ts`(「レバー感度: 噴火 1 回の熱だけで...」)。設計上 fuel は 1 年に need を超えて溜め込まないので、2 年連続で fuel.last >= need を満たすことで検証(下の作業ログに詳細)
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

### 2026-09-20

M8-08 実装。`wip/m8-06-tower-rebalance` の校正(伐採の立木比例化、MINE_RATE ÷10、canAdvance によ
る段階上昇の民条件、POP_NEED/POP_FULL 校正、DECLINE_YEARS=4)を先に取り込み(前半コミット)、そ
の上に塔の燃料モデルを実装(後半コミット)。

**選んだ定数** (`src/simulation/civilizationFuel.ts`):
- `FUEL_NEED = [0, 0, 0, 0, 4, 6, 9, 14]` — stage 1〜3 は 0 (design §3.1 のとおり初期文明は燃料を
  気にしない)、4(石)以降だけ必要。4〜7 で単調増加
- `HEAT_FUEL = 0.5` (熱 1 単位 → 燃料 0.5)、`TIMBER_RATE = 0.1` (鐘樹立木の年 10% を伐る)、
  `FUEL_YEARS = 3` (3 年連続の不足で段階 −1)。`VOLCANO_HEAT` (=6、disaster.ts) は変更していない

**測定: 噴火 1 回 → 燃料** (`tests/unit/world.civilization.fuel.test.ts`、stage 6 = need 9、
LOAD_RADIUS[6] = 9 の全域に火山を 1 回打った場合):
- 噴火直後の熱だまり: 半径 9 内 253 セル × VOLCANO_HEAT 6 = 1518 (熱単位)
- 1 年後 (HEAT_DECAY^360 ≈ 0.487): 約 738 まで減衰。1 年の必要熱量は need/HEAT_FUEL = 18 なので
  year1 の `fuel.last` は need の 9 で頭打ち(collectvFuel は 1 年に need を超えて取らない設計)
- year1 で使った分 (18) を引いた残り (~720) はさらに 1 年で ~350 まで減衰してもなお 18 を大きく
  上回るので、year2 も `fuel.last = need = 9` を満たす(実測では 2 年よりずっと長く持つ)
- 結論: 噴火 1 回で塔の燃料が必要量の「2 年分以上」入るという判定行列 (§5) の基準は満たすが、
  実際には「単年の量が 2 倍になる」のではなく「1 回の熱だまりが複数年の需要を賄える」形で満た
  される(design のとおり、fuel を溜め込まない設計のため)。テストはこの形で検証している

**火山セルの上書き (コーディネーターからの追加要望への対応)**: M8-09 (炎蜥蜴) の校正で、標高最
大セルは LAPSE (標高による気温低下) で冷えすぎ、噴火を 3 回打っても半径 3 で ~22.6℃ にしかなら
ず、炎蜥蜴の適温 [30, 80] に届かないと分かった(暖かい低地セルなら噴火 1 回で 31.5℃ に届く)。
`VOLCANO_HEAT` 自体は変えず、`WorldConfig.volcanoCell?: number` を追加して火山セルを上書き可能
にした(既定は従来どおり標高最大の陸セル)。`ScenarioDef.start.volcanoCell` (-1 = 島の中心、他の
セル指定と同じ規約) を `main.ts` が解決する。**M8-05 v2 への申し送り**: 塔シナリオでは
`start.volcanoCell` に暖かい低地セル(炎蜥蜴が湧く場所)を明示的に指定すること。標高最大セルの
ままだと火の山で炎蜥蜴が湧かず、design §3.2 の副作用(炎で民が減る)が機能しない

**逸脱**: なし(挙動面)。テストの検証方法を「単年 fuel.last >= 2×need」ではなく「2 年連続で
fuel.last >= need」に変えた理由は上記のとおり(fuel を溜め込まない設計と矛盾しないようにした)。

