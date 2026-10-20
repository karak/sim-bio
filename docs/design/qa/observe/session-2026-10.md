# 観察セッションの材料(M22-09、2026-10-20)

空の舟を本体 (`/?scenario=sky-ship`) で 1 回通し、「3D で見る」で 4 場面(舟が育つ・種を放ったあと・飛び立ち・滅び)の画を撮った記録です。
層 A(機械の数)と層 B(LLM の採点)の材料を並べます。10 分見ていられるか(所感)は層 C で、ユーザーが下の「所感」の欄に書きます。

HEAD は `aa4ce67`(feat/m19)、Apple M4・1280 × 720・Chromium(Playwright の `channel: 'chromium'`、GPU は ANGLE Metal)。
証拠の置き場は `.claude/verify/20261020-1033-m22-09/`(worktree と本体の両方)、4 場面の画は審査台の回 `.claude/localreview/m22-09-20261020-1033/` です。

## 出し方

試作のページ `observe.html` は石板(ScenarioRunner)と年表を持たないので、芽吹き・霧の場面は起きません。
`?depart=1`・`?sink=`・`?launched=1` は結果を作る指定なので使いませんでした。
代わりに本体の空の舟を、人と同じ UI の手(チップを押して島を押す、「舟を作れ」を押す)で通しました。
`__probe` は tick を進める (`advanceTo`)・画面の位置と計測を読む (`scene.cell`・`observe.stats`) だけに使っています。

1. 台本の年表を前もって数える(`plan.test.ts`、`tests/slow/observe.scenes.test.ts` の想定解 1 と放置を写したもの)。想定解は毎年 1 本鐘樹を植え、10 年目に集落の狼へ疫病、20 年目以降に門を越えたら着工します。
2. ブラウザで同じ手を同じ年に打つ(`session.spec.ts`)。セルは、何も構えずに押して `#cell-info` が狙いのセルになる点を探してから、チップを構えて押します。
   打った手は次の tick の `cmd.received` で、狙いのセルに届いたことを確かめました。力が足りない年は石板が弾きます(台本も同じに打ちます)。
3. 場面の年に「3D で見る」で入り、自動カメラのまま 1/60 秒ずつ手で進めた時計で撮る(`installFrames`・`stepFrames`)。

```sh
pnpm run dev --port 5191 --strictPort
pnpm exec vitest run -c .claude/verify/20261020-1033-m22-09/vitest.plan.config.ts --root .   # plan.json
E2E_PORT=5191 pnpm exec playwright test -c .claude/verify/20261020-1033-m22-09/pw.config.ts session
```

通しの結末: 想定解は 40 年目に「7 種と民を次の島へ逃がした」(escaped、node の台本と同じ年)。放置は 149 年目に文明の段階 0(dead)。

## 4 場面

| 場面 | 画 | 年・tick | 操作 | 自動カメラ(`stats().camera`)・舟の段 |
|---|---|---|---|---|
| 舟が育つ | `scene-1-ship-y24.png` | 24 年・tick 8641 | 20 年目に「舟を作れ」、24 年目に入る | `shipLookUp:scene`・`ship_ribs`(進み 24 / 120) |
| 舟が育つ | `scene-1-ship-y32.png` | 32 年・tick 11521 | 32 年目に入る | `shipLookUp:scene`・`ship_mast`(進み 72) |
| 舟が育つ | `scene-1-ship-y36.png` | 36 年・tick 12961 | 36 年目に入る | `coastWide:scene`・`ship_sails`(進み 96) |
| 種を放ったあと | `scene-2-sown-y11.png` | 11 年・tick 3961 | 11 年目に一度入って出て、鐘樹を植え (cell 2664)、入り直す | `herdClose:herd`(芽吹きの場面ではない) |
| 種を放ったあと | `scene-2-sown-y12-grove.png` | 12 年・tick 4321 | 12 年目に入り、集落へ寄せる (`look`) | 植えた鐘樹の若木 |
| 飛び立ち | `scene-3-departure-{5s,20s,45s}.png` | 40 年・tick 14401 | 39 年目に入ったまま 40 年目へ進める | `coastWide:scene` → `shipLookUp:scene`・`ship_flying`、帯「次の島へ逃れた」 |
| 滅び | `scene-4-sinking-y120.png` | 120 年・tick 43200 | 放置。118 年目に入ったまま 120 年目へ | `coastWide:scene`(区域の陸 185 → 118 セル) |
| 滅び | `scene-4-end-y149.png` | 149 年・tick 53641 | 148 年目に入ったまま 149 年目へ | `coastWide:scene`、帯「島は滅びた」 |

年ごとの手と、届いた・弾かれたの記録は `session.log`(想定解)と `session-idle.log`(放置)にあります。
想定解の通しで弾かれた手は 25 件で、15・18・21・25・28 年目は力が足りず(budget)、29 年目以降の植える手は島が受けませんでした(`cmd.rejected` の reason は `rejected`。`ScenarioRunner.intervene` が World の `dispatch` の拒みを返す形)。
帆を失う(`sailLost`)は、放置の通しでは舟を着工しないので出ません(場面の引き金は舟があって飛び立っていないときだけ)。

### 機械の記録で分かったこと(判断は層 C)

- 芽吹きと霧の場面は、本体から入った観察画面では出ませんでした。
  `src/observe/view/frame.ts` の `start()` が入るたびに `state.baseline = true` に戻し、入る前に積まれた年表(介入)を再生しません(M22-08 の e3479ca「入る前の介入は再生しない」)。
  介入は操作画面でしか打てないので、植えた・疫病を落とした場面の効果(金の粒・紫灰の霧)は、通しのプレイでは見えません。
  11 年目に植えて入り直したときのカメラは `herdClose:herd` でした。場面の引き金そのものは `tests/slow/observe.scenes.test.ts` が確かめています。
- `scene-1-ship-y24.png`・`scene-1-ship-y32.png` は、`shipLookUp` のカメラが船台の脇の低い所にあり、画の下半分に砂色の帯状の面が写っています。

## 層 A(Lane 1): enterObserve と 3 視点

`tests/driver/observe.ts` の `enterObserve`(空の舟 10 年目の春、時計を止める)→ `lookFrom` の 3 視点。画は `m22-09-lane1.png`(3 枚を並べたもの)と `m22-09-lane1-{集落,群れ,海岸}.png`、数は `stats.txt` です。
fps は手で進めた時計(1 コマ 1/60 秒)の値なので、いつも 60 です。性能は下の bench で見ます。

| 視点 | 三角形 | draw call | 鹿・狼・兎 | 鐘樹 | 草 |
|---|---:|---:|---|---:|---:|
| 集落 | 349,627 | 79 | 45・47・54 | 75 | 3,829 |
| 群れ | 251,484 | 96 | 45・47・54 | 75 | 6,607 |
| 海岸 | 169,081 | 68 | 45・47・54 | 75 | 5,893 |

## 層 B(Lane 2): OBS-002 の judge

本体の受入の画面の置き場(`.claude/acceptance`)を書き換えないように、置き場を証拠の置き場へ写してから撮り直し、採点しました。

```sh
ACCEPTANCE_DIR=<証拠の置き場>/acceptance E2E_PORT=5191 pnpm exec playwright test tests/e2e/shots.spec.ts -g OBS-002
ACCEPTANCE_DIR=<証拠の置き場>/acceptance pnpm run judge -- --step OBS-002/2 --step OBS-002/3 --step OBS-002/4
```

撮り直した 3 枚は、本体の置き場の画(2026-10-14)とバイト単位で同じでした。

| 手順 | 画 | 結果 |
|---|---|---|
| OBS-002/2 | `OBS-002-1.png`(集落) | O1〜O5・O7〜O9 すべて 3 票 yes |
| OBS-002/3 | `OBS-002-2.png`(群れ) | O1〜O9 すべて 3 票 yes |
| OBS-002/4 | `OBS-002-3.png`(海岸) | O1〜O5・O7〜O9 すべて 3 票 yes |

写しの `results.json` の OBS-002 は `verdict: "pass"`・`by: "llm"`(claude-sonnet-5-5、9 回、0.196 USD、2026-10-20T02:51:03Z)。
judge は「画・承認済みの画・採点表が変わったので、前の pass を消した」と出しました(写しの中の 2026-10-05 の記録)。
本体の置き場の `results.json` は書き換えていません。結果は `results-OBS-002.json`・`judge-stdout.txt`・`m22-09-lane2.png`(3 枚を並べたもの)です。

## 性能: bench:observe

`npm run bench:observe -- --url http://localhost:5191`(observe.html、空の舟 25 年目・朝・時間を止める・舟は肋材の段)。
基準は M22-11 の 3 回目(2026-10-17、`issues/M22-11-flora-polish-2.md` の「後」の値)。今の値は 4 回目(画面を起こしたまま、`caffeinate -d`)です。

| 画 | 三角形 (千) 基準 → 今 | draw call 基準 → 今 | fps 基準 → 今 |
|---|---|---|---|
| 集落 | 399.9 → 399.9 | 97 → 97 | 356 → 346 |
| 船台 | 252.8 → 252.8 | 92 → 92 | 376 → 376 |
| 群れ | 230.1 → 230.1 | 78 → 78 | 439 → 427 |
| 林 | 319.4 → 319.4 | 91 → 91 | 345 → 320 |
| 狼 | 347.5 → 347.5 | 103 → 103 | 334 → 329 |
| 海岸 | 256.5 → 256.5 | 74 → 74 | 400 → 378 |

三角形と draw call は基準と同じです。fps は 1 回で 5% ほど揺れます。林(−7%)と海岸(−6%)は揺れの幅を少し超えますが、どの画も 60 fps を大きく上回っています。
1・2 回目(`caffeinate -i` だけで、画面が眠っていた間)は fps が低く出ました(集落 82・林 99 など)。集落の 4 回の読みのうち 2 回が 34・32 fps でした(1・2 回目とも 3・4 回目の読み)。3・4 回目には出ていません。
各回の数は `bench-{1,2,3,4}.json`・`bench-{1,2,3,4}.txt` にあります。

## 直した点

直しなし。

## 所感(層 C)

10 分見ていられるか、場面の強さと長さ(霧 90 秒・雨 45 秒・飛び立ち 70 秒)、直したい点を書く欄です。

- 見た日:
- 所感:
- 直したい点:
