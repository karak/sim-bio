---
id: M21-03
title: 迎撃の塔の作り直し(応えだけで勝てる・後半 100 年の空白)
status: todo
milestone: M21
plan: docs/specs/plans/2026-09-23-roadmap.md#21-チケットになっていない負債既存-11-本の仕上げ
depends_on: [M21-01]
evidence: ["6bb33d5 本体計測 (試作)", "7122b46 見える星 K1 (stepWorks の窓・star_sign・警告・HUD)", "eb62770 scenarios.json 2 星 60・105 / 110 年", "6a191d3 tests/slow の判定行列", "e0a34c9 test_check_docs", "tests/slow/scenarios.playthrough.test.ts", "tests/unit/scenario.starSign.test.ts", "tests/unit/works.test.ts", "tests/unit/world.civilization.works.test.ts", "tests/unit/ui.hud.test.ts", ".claude/verify/20261029-0922-m21-03-impl/"]
---

# 迎撃の塔の作り直し(応えだけで勝てる・後半 100 年の空白)

## What to build

三度砕いたあとの約 70 年は「星の砂を」を無視するだけで緊張が無い(m10 playtest、roadmap D6)。
150 年を短く切るか、後半に別の困りごと(キーアイテム)を置くかを LD で決めてから校正する。M21-01 で環 1 に直した判定行列の上で行う。
M21-01 の再計測で問題が広がった(docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md §3.1〜3.2):
応えだけ(儀式なし)で信仰 0.88・30 年目に星・50 年目までに三度砕いて alive。どの手でも 50 年で撃ち終わり、後半 100 年は空白。
生死は信仰が工事の門 0.6 を割る時期の偶然で決まる。「着弾の 10 年前からしか撃てない」窓だけでは戻らなかった(試作)。
仮説 → 部品(キーアイテム) → 縮約モデル → 本体計測 → 実装の順で作り直す。

## Blocked by

M21-01

## Acceptance criteria

- [x] LD に作り直しの設計(仮説、キーアイテム、縮約モデル、判定行列。応えだけ・儀式だけ・止めよ無しがそれぞれどうなるか)を書き、ユーザーの承認を得る
- [x] 想定解の台本は UI と同じ手(放流 環 1・0.5、力 4)で書き、通し実行で放置・素朴戦略 dead と想定解 alive を固定する
- [ ] 手動 1 回、記録(後半に悩む余地があるか)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

- 2026-10-28: LD を書いた(docs/design/2026-10-28-level-design-intercept-2.md)。推奨のキーアイテムは K1「見える星」(工事が備蓄に積めるのは着弾 12 年前からの窓の間だけ)。縮約モデルと本体の trace は .claude/verify/20261028-0857-m21-03-ld/。ユーザーの承認待ち
- 2026-10-28: 審査台の答え: K1「見える星」・K3 は本体計測で応えだけが落ちなかったときだけ・W 12・窓の外は「灯に焚く」、いずれもはい。150 年は「短く切る」(年は未定、「数学モデルを作って検証可能なアプローチにしてください。pstackの原則を参考にして。」)。LD §9 に答え、§10 に長さの走査を足した。縮約モデルを本体の trace 4 本に校正(信仰の減りを ×0.99 に直し、応えだけの §5 ※の食い違いが消えた)し、82 並びを走査した。推奨は 2 星 60・105 / 110 年。年は次の審査台で選ぶ。証跡は .claude/verify/20261028-0857-m21-03-ld/(model.py・calibration-output.txt・sweep-output.txt・sweep.tsv)
- 2026-10-29: 本体計測 (K1 を試作、2 星 60・105 / 110 年、W 12)。LD §6 の 8 行は期待どおり: 放置・止めよだけ dead 61、応えだけ・儀式だけ・止めよ無し・旧想定解 (備蓄 9) dead 106、想定解 1・2 alive 110 (58・102 年目に砕く)。応えだけは信仰が 77 年目に 0.6 を割り二つ目の窓で工事が動かず落ちるので K3 は足さない。感度: 窓の外は脈が窓の中と同じだけ減り備蓄は増えない、窓の中は年 0.36 積み 9 年で撃てる、窓の外で止めよの間は脈が減らない。証跡 .claude/verify/20261029-0922-m21-03-impl/ (matrix-proto.md・matrix-impl.md・trace-*.tsv・verdicts-*.tsv)
- 2026-10-29: 実装。stepWorks は civ.starVisible === false の年に備蓄へ積まない。ScenarioRunner は def.starSignYears があれば次の星から窓を求めて star_sign を World へ流し (続き・古いセーブでも揃え直す)、警告 star_visible・star_dark を出す。HUD の迎撃の行に見えているかを添える。scenarios.json の intercept-tower を 2 星 60・105 / 110 年・starSignYears 12・intercepted 2 に、予言と節目を書き直した。保存の形は省略可の欄 1 つなので SaveData・RUNNER_STATE_VERSION は上げず、SIM_VERSION も上げていない (golden replay は通る。上げるかはユーザーに問う)
- 2026-10-29: tests/slow の迎撃の塔を 10 行に (上の 8 行 + 旧想定解 2 (備蓄 6) dead 106 + 遅い儀式と門の止めよ dead 106)。10 本 533 秒 (jobs 1)、全部通る。表は .claude/verify/20261029-0922-m21-03-impl/slow-table.md。slow_report.py の GROUPS を 7.4 → 8.9 分に。E2E smoke 24 本通る (試し読みの石板は窓を持たせず今のまま)
- 2026-10-29: 残り: check:docs が decisions-current の「Command は 9 種」(star_sign で 10 種) で落ちる。既存の文の書き換えなのでユーザーの承認待ち。手動 1 回 (後半に悩む余地があるか) も未。status は todo のまま
