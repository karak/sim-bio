---
id: M10R-08
title: 空の舟の作り直し(枯れにくい鐘樹、一定量の伐採、民の林、UI 並みの放流)
status: done
milestone: M10R
plan: docs/design/2026-09-22-level-design-faith-economy.md#89-空の舟の作り直し-仮説--部品--縮約モデル--本体計測m10r-082026-09-23
depends_on: [M10R-05]
evidence: ["e746bf2 ba9bbac 970ed4e tests/unit/ship.test.ts tests/unit/scenario.runner.test.ts tests/unit/ui.hud.test.ts", "tests/slow/scenarios.playthrough.test.ts sky-ship 8 件 / tower scenario v2 5 件", "docs/specs/plans/2026-09-23-m10r-08-playtest.md"]
---

# 空の舟の作り直し

## What to build

LD §8.7〜8.8。手動受入で、通し実行の想定解(環 4 の放流)が UI(環 1)では再現できず、机上でも「林だけでは塔が飢え、舟の割合伐採では林の大きさが意味を持たない」
と分かった。仮説 → 縮約モデル(scratchpad の ship_desk.py)→ 本体計測 の順で: (a) 鐘樹を遅く枯れにくい樹に(生物の特性。塔の重さの校正に掛かる)、
(b) 舟は毎年一定量を伐る(舞台装置)、(c) 開始時の民の林、(d) 通し実行の台本を UI と同じ環 1 に揃える。空の舟の定義は M10 の状態(薪 800)に戻してある。

## Blocked by

M10R-05

## Acceptance criteria

- [x] 縮約モデルで 林だけ dead・薄い植え足し dead・林 + 植え足し + 着工の時期 で escaped の幅があることを確かめ、LD §8 に記す(LD §8.9、scratchpad ship_desk2/3.py、e746bf2)
- [x] 本体で (a)〜(d) を入れ、塔の重さ・霊脈枯れ・迎撃の slow が変わらない(鐘樹の変更は塔の重さを再校正)(e746bf2 ba9bbac 970ed4e。tower scenario v2 5 件 273 秒、据え置き。霊脈枯れ・迎撃は鐘樹を使わない)
- [x] tests/slow で 放置 dead・薄い植え足し dead・遅い着工 dead・想定解 escaped を UI 並みの放流(環 1)で固定(tests/slow/scenarios.playthrough.test.ts sky-ship 8 件 473 秒、970ed4e)
- [x] 手動 2 回、記録(docs/specs/plans/2026-09-23-m10r-08-playtest.md: 想定解 escaped 40、林だけは着工できず)。evidence に commit SHA とテストファイル

## 作業ログ(2026-09-23)

- 仮説 → 部品 → 縮約モデル(scratchpad ship_desk2/3.py)→ 本体計測 A〜C を LD §8.9 に記した。
- 計測で分かったこと: 枯れにくい樹は拡散を残すと島中に広がって草を絶やす(拡散 0 が必須)。成長 0.002 は林が尽きて全滅、0.003 は薄く植えても逃げられる。
  **0.0025 / 0.0005 / 拡散 0** で 林だけ dead・薄い dead・早い着工 dead・遅い着工 dead・毎年 1 本 + 20〜45 年目に着工 escaped 40〜65 の行列が出た。
- (a)(b) を e746bf2 でコミット。塔の重さの通し実行 5 件は据え置きで通る(272 秒)。
- (c) 民の林は空の舟の schedule の 0 年目の予定放流(環 4・0.6)、(d) 通し実行は環 1・0.5 の台本で固定(sonnet に委譲)。
- 手動受入 2 回(想定解が UI で 40 年目に escaped、林だけは信仰 0.45 で着工できず)。レビュー(feature-dev:code-reviewer)は指摘 0(証跡の未記入のみ、§4.30 のファイル欄を補った)。単体 510、E2E 21、通し実行 塔 5 + 空の舟 8。

