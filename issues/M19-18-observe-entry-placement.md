---
id: M19-18
title: 「3D で見る」を時間の箱の端へ移し、集落の無い島でも島の真ん中から観察画面に入れる
status: review
milestone: M19
depends_on: [M19-15, M22-08]
evidence: ["a60992f tests/unit/observe.area.test.ts tests/unit/observe.fx.test.ts tests/e2e/observeEntry.spec.ts tests/e2e/harbor.spec.ts tests/e2e/observe.spec.ts"]
---

# 「3D で見る」を時間の箱の端へ移し、集落の無い島でも島の真ん中から観察画面に入れる

優先度: Must

## What to build

受入試験(2026-09-27、r2-publish-visit、判定 NG)のユーザーのメモ原文:「判定になる前の状態から石板のせいでボタンが押せない」

再現したこと:

1. 観察画面の入口「3D で見る」(`#observe-open`、`src/observe/entry.ts` の CSS で `left:50%; top:10px`)が、上の真ん中の石板(`#tablet`、`src/ui/Tablet.ts`)の真上にあり、石板の `<select>` と重なる。石板の行は自由モードにも出るので、どのモードでも起きる。
2. `/?scenario=test-quick` には集落ができないので、`open.disabled = !s.civ || s.civ.home < 0` のまま判定(2 年目に島が滅びる)まで押せない。観察画面は集落を中心に組む(`src/observe/view.ts` の `s.civ?.home ?? 2787`。civ があって home = -1 のこともある)。

ユーザーの判断(2026-09-27):

- A: 「3D で見る」を左上の時間の箱(Year / ⏸ 1x 10x 100x)の端へ移す。どのモード(自由・石板・判定の板が出ているとき・訪問)でも何にも覆われない。
- B: 島に集落が無いときは、観察画面は島の真ん中を中心にする(陸の重心に最も近い陸セルなど。決定論の純粋な関数にし、単体テストを書く)。ボタンは world の snapshot があればいつでも押せる(訪問でも)。集落を前提にしていたもの(小屋・民・個体の置き方・カメラなど)は集落が無くても落ちず、集落だけの形は描かない。

## Blocked by

M19-15, M22-08

## Acceptance criteria

- [x] 観察画面の中心を決める純粋な関数(集落があれば集落のセル、無ければ島の真ん中の陸セル、陸が無ければ地図の真ん中)と単体テスト
  - src/observe/area.ts の `observeCenter`(a60992f)。規則: civ.home ≥ 0 なら集落のセル。無ければ陸セル(標高 ≥ SEA_LEVEL)の列・行の平均(重心)に最も近い陸セル、同じ近さなら index の小さい方。陸が無ければ地図の真ん中。地形だけで決め、密度に依らない
  - tests/unit/observe.area.test.ts「観察画面 (M19-18): observeCenter」6 件(集落・civ 無し・home = -1・環の島で重心が海・陸なし・密度に依らない)
- [x] 集落が無いとき、観察画面は集落だけの形(小屋・灯り柱・巨石・石垣・衝立・船台・丸太の山・株)を置かず、民を出さず、踏み固めた道と切り開きを作らない。落ちない
  - src/observe/view.ts(a60992f)。集落が無いと落ちていた所: src/observe/render/puddles.ts の `puddleSpots` が空の踏み固めた所から乱数で引いていた → 空を返す。tests/unit/observe.fx.test.ts「踏み固めた所が無ければ (集落の無い島、M19-18) 水たまりも無く、乱数を引かない」
  - E2E で `__observeProps()`・`__observeHuts()` が空、`__observeStats.folk` が 0 を確かめる(下の 1 件目)
- [x] 「3D で見る」は時間の箱の速さの列の端にあり、world の snapshot があれば押せる
  - src/observe/entry.ts の `buttonHost`、src/main.ts で `#speed-row` を渡す(a60992f)
- [x] E2E: `/?scenario=test-quick` の判定の前に、ボタンが押せ・文言が「3D で見る」・中心の点の要素がボタン自身(覆われていない)・押すと `#observe-layer` が開き・Esc と「操作画面へ戻る」で戻る。判定の板が出ているときと、自由モード `/` でも覆われない
  - tests/e2e/observeEntry.spec.ts(a60992f)
    - 「M19-18: 集落の無い石板 (test-quick) でも判定の前から「3D で見る」を押せ、覆われず、島の真ん中の観察画面に入って戻れる」
    - 「M19-18: 判定の板が出ているときも「3D で見る」は覆われず、押せば観察画面に入る」
    - 「M19-18: 自由モード (/) でも「3D で見る」は時間の箱の端にあって覆われず、集落が無くても押せる」
  - 訪問: tests/e2e/harbor.spec.ts「M19-18: 集落の無い島 (test-quick) の訪問でも 3D 観察画面に入り、戻ると「3D で見る」は時間の箱の端で覆われず押せる」
  - tests/e2e/observe.spec.ts の自由モードのテストは「押せない」から「押せる」へ(ユーザーの判断 B)
- [x] pnpm run check と、観察画面・石板・判定に触る E2E が通る。evidence に commit SHA とテストファイルを記す
  - pnpm run check: vitest 109 files・1041 tests、worker 66 tests、scripts 42 tests(a60992f)
  - E2E を 1 worker で全 spec: observe・observeEntry・verdict 9 件、smoke 24 件、harbor 15 件、scenarioSave・persist・chronicle・devtools・logsink 22 件、計 70 件すべて通る

## 既知の制限

- 観察画面は初めて入ったときの snapshot で 1 度だけ組む(M22-08 のまま)。集落の無いときに入り、あとで集落ができても、入り直した画は島の真ん中のまま小屋も出ない(逆に集落が消えても小屋は残る)。組み直すには観察画面の後片付け(renderer の破棄)が要る

## 作業ログ

- 2026-09-27: ボタンは `#speed-row` の最後の子にし、絶対位置をやめた(石板・判定の板の下敷きにならない。判定の板は pointer-events: none で、板の箱は真ん中)。港の棚(左から開く)はユーザーが開いたときだけ左上に重なる。
- 古くなったが消していないコメント(ユーザーの承認待ち): src/observe/entry.ts の説明「入れるのは文明の集落があるとき (区域は集落を中心に切り出すので)。」。すぐ下に「(M19-18 で上の規則を変更: …)」を足した。src/observe/area.ts 先頭の「集落 (home) を中心に半径 radius セルを snapshot から切り出す」は、中心が島の真ん中のこともある(extractArea の引数名は home のまま)。
