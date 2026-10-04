---
id: M26-10
title: 自由モードの「新しい島」は押すたびに新しい seed を引き、HUD と URL の seed= に出す
status: done
milestone: M26
plan: null
depends_on: []
evidence:
  - tests/unit/app.place.test.ts (自由モードの島の seed (M26-10)、6 件。実装前に赤: bootSeedOf ほか is not a function)
  - tests/e2e/freeIslandSeed.spec.ts (新しい島で seed= と地形が変わる・seed= で開き直すと同じ地形・石板は 42 のまま、2 件)
  - tests/e2e/sameTickIsland.spec.ts (M26-05 の試験の新しい島の期待を、元の島に戻る → 読んだ別の島と違う、へ)
  - pnpm run check 通過 (vitest 126 files / 1251 tests)、shots 6 passed (基準画は変わらず・回なし)、関わる E2E 78 passed
  - commit は git log feat/m26-10 (M26-10)
---

# 自由モードの「新しい島」で seed を変える

優先度: Should

## What to build

今は自由モードもすべての石板も seed 42 (`assets/data/world.default.json`・`assets/data/scenarios.json`) で、「新しい島」(`src/main.ts` の new_world 効果 → `World.create(config)`) は毎回同じ地形になる。

ユーザーの決定 (2026-10-04): 案 ① を「いったん」採る。
- **自由モードだけ**。「新しい島」を押すたびに新しい seed を引く (整数。暗号の乱数でよい)
- 石板の seed は 42 のまま (石板の地形はレベルデザインの一部。港の回避率も同じ地形どうしで比べる)。「石板を初めから」も 42
- 今の seed を HUD に小さく出し、URL に `?seed=<整数>` を書く。`?seed=` 付きで開くと、その seed の新しい島になる (自由モードのみ。石板・訪問では無視して URL から落とす)
- 初めて開いた時 (戻す枠も seed= も無い) の島は seed 42 のまま (親の判断。基準画・E2E・LLM の採点表が seed 42 の画を前提にしている。変えるならユーザーに聞く)
- 枠・自動の枠・ファイルの読み込みは保存の seed で戻る (World の config に seed がある。今どおり)

試験の道: E2E・shots・judge は seed 42 で決まる。`?seed=42` を明示しなくても初回が 42 なので今の試験は変わらないはず。乱数は差し替えられる口 (関数の引数) にして単体で決定論に。

## やること

1. 落ちる試験: 単体 (seed の決め方の純粋な関数: 初回 42・押すと引いた値・URL の seed= が勝つ・石板では無視)。E2E (自由モードで「新しい島」→ URL の seed= が変わり、地形が変わる (M26-05 の terrainDigest)。seed= で開き直すと同じ地形)
2. 実装。HUD の表示は既存の HUD の字の大きさ・色に合わせる
3. 既存の E2E・shots が変わらないこと

## Acceptance criteria

- [x] 上の試験が通る (直す前に赤)
- [x] 石板の島は seed 42 のまま (試験)
- [x] `pnpm run check`、関わる E2E、`pnpm run shots` が基準画を変えずに通る。HUD に seed を出して基準画が変わるなら回を出し、承認待ちと書く

## 作業ログ

- 2026-10-04: 起票 (ユーザーの決定「いったん 1」。案は ① 押すたびに乱数・② 日替わり・③ 回数で進む・④ 石板も変える)。
- 2026-10-04: 実装。pure な決め方は src/app/place.ts (bootSeedOf・freshSeed・newWorldSeed・seedSearchFor・seedMatches・DEFAULT_SEED)、main.ts に配線、HUD は #hud-seed (dim mono、年の行の後ろ)、World.seed の getter、localSave.resume の accept。決めたこと: URL の seed= があれば自動の続きはその seed の島のときだけ戻す (違えば seed= の新しい島。自動の枠は次の書きで上書き)。枠・ファイルを読んだ後は URL の seed= を読んだ島の seed に揃える。最初の島 (42・seed= 無し) は URL を変えない。基準画は要素単位で HUD の seed は写らず、変わらなかった (回なし)。
- 2026-10-04: opus の読むだけのレビューを受けて直した: (1) seed= が違って断った自動の続きは、黙って上書きされないよう脇へ退けて persist.resume.skipped を記録 (localSave.resume の accept)。(2) 壊れた seed= は URL から落とす。試験を足した (localSave 単体・bootSeedOf・同じ seed= で続きに戻る E2E)。
