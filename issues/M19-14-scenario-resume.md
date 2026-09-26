---
id: M19-14
title: シナリオの続きから(runner の状態を持ち出す)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-05, M19-06]
evidence: ["df292a6 d041b88 900f1ca 54ff80b 832623a src/simulation/World.ts src/simulation/types.ts src/scenario/ScenarioRunner.ts src/persist/islandStore.ts src/persist/scenarioSave.ts src/main.ts tests/unit/world.save.test.ts tests/unit/scenario.resume.test.ts tests/unit/persist.scenarioSave.test.ts tests/fixtures/resumeIsland.ts tests/e2e/persist.spec.ts"]
---

# シナリオの続きから(runner の状態を持ち出す)

優先度: Must(設計書 B2「予言は 200〜500 年あり、1 回では終わらない」)

## What to build

M19-05 では、シナリオの途中で閉じると石板の初めからになる(runner の状態が SaveData に無い)。M19-06 で、年代記から回し直す案は開き直しに時間がかかりすぎると分かった(Chromium の Web Worker で size 64 の 300 年が 73.6 秒、size 128 は 4 倍)。そこで runner の状態そのものを持ち出す(M19-06 の作業ログの案)。

- `ScenarioRunner` に `save(): RunnerState` と `createScenarioRunner(def, world, opts, restored?)` を足す。状態は JSON にできるものだけ(力・年表・警告・履歴・fired と cancelled・前年の値)。
- シナリオの自動保存は、SaveData・RunnerState・年代記の 3 つを 1 つの transaction で書く(同じ tick のものしか並ばない)。開き直したら 3 つを戻し、`recorder.resume` で年代記を引き継ぐ。
- 先に確かめる: `World.restore` の続きが、閉じずに回した島と最後の桁まで一致するか(`civYearKeys` など、年の中の状態が SaveData に無い)。一致しなければ、年の境目でだけ書く案を試す。

## Blocked by

M19-05, M19-06

## Acceptance criteria

- [x] 途中で保存して戻した島を最後まで回した Digest が、閉じずに回した Digest と一致する(単体テスト、年代記で証明)
  - `tests/unit/scenario.resume.test.ts`「シナリオの続きから (M19-14): 途中で閉じて開き直しても、閉じずに回した結末と同じ」。d041b88
  - 3 つの石板(size 32 に縮めた `no-answer`・`sinking`・`test-intercept`)を、5 か所で閉じる: 年の途中で介入を積んだ直後、狼の予定が積まれたままの年の境目、沈降が積まれたままの年の境目、年の途中、迎撃を撃った直後(本体がまだ適用していない)
  - 閉じ方: SaveData・RunnerState・年代記を `JSON.stringify` → `JSON.parse` し、`World.restore`・`createScenarioRunner(…, restored)`・`recorder.resume` で開き直す(main.ts と同じ組み立て)
  - 比べるもの: Digest・年表・最後の `serialize()`・年代記が、どれも閉じずに回したものと同じ。さらに、開き直した島の年代記を `replay`(M19-06)で回し直すと、閉じずに回した Digest になる
  - 本体の側: `tests/unit/world.save.test.ts`「途中で閉じた島の続き (M19-14)」。年の境目・年の途中・山火事が燃えている最中・介入を積んだ直後で閉じ、毎年の終わりの `serialize()` の JSON が最後の桁まで同じ。閉じた時点で、火が燃えている・命令が積まれていることも確かめる。df292a6
  - 変異で確かめたこと: `save()` が `fired` を空で返すようにすると、5 件のうち 3 件が落ちる(予定が二度撃たれる)。memory の無い本体では、本体の側の 4 件がどれも落ちる
- [x] シナリオの途中で閉じて開き直すと、同じ年・同じ石板の状態から続く(E2E)
  - `tests/e2e/persist.spec.ts`「M19-14: シナリオの途中で閉じて開き直すと、同じ年・同じ石板の状態 (力・年表・年代記) から続く」。900f1ca
  - `test-quick` で草を 1 回放つ(力 10 → 7)→ 置き場(IndexedDB を直に読む)に `{tick, 命令 1}` → 10 倍速で 1 年目まで進めて止める → タブを隠す → 置き場の tick が止めた tick になる → 閉じる → 同じ石板を開き直す → `persist.scenario.resumed` がその tick で 1 回 → 石板の年「1 / 5 年」・HUD「Year 1」・力・力の増減・年表の件数が閉じる前と同じで、年表に 0 年の介入がある → もう一度放つと、置き場の年代記の命令が 2 件になる
  - 訪問の道(M19-09 の `?visit`): 同じファイル「M19-14: 同じ石板の他人の島を訪れても (M19-09 の ?visit)、自分の続きから戻さず、訪れた島を自分の続きとして書かない」。54ff80b。自分の続き(力 7)がある状態で訪れると、力 10・0 年から始まる。タブを隠しても自分の続きは変わらず、`persist.scenario.*` の記録が 1 件も無い。`resumed` の門(`&& !visitId`)を外すと、このテストが落ちることを確かめた
- [x] 「シナリオ中の読込は予言と矛盾するので無効」の規則との関係を整理して記す(自動の枠からの復帰は矛盾しない)
  - 下の作業ログ「「予言と矛盾するので無効」の規則との関係」。`src/persist/scenarioSave.ts` の冒頭にも同じ整理を書いた
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - `pnpm run check`(54ff80b): typecheck・eslint・ruff・vitest 100 ファイル 954 件・worker 5 ファイル 64 件・scripts 42 件、すべて通る
  - E2E: `pnpm exec playwright test`(E2E_PORT=5314、832623a)43 件すべて通る。うち M19-14 は 2 件。1 回目(54ff80b)は M19-14 の続きからの E2E だけが落ちた: 並べて回すと 100 倍速の 1 年目(3.6 秒)のうちに止め損ね、2 年目の判定の板が止めるボタンを覆った。10 倍速に替えて(832623a)全体を回し直した
  - tests/slow(ScenarioRunner を変えたため): caffeinate を付けて背景で 5 分割(`tower scenario v2`・`idle → dead|scripted intervention`・`naive|save-then-rain|too much rain`・`no-answer|vein-drain`・`intercept-tower|sky-ship`)。15・5・18・13・14 件で、どれも落ちない(900f1ca の本体と runner。M19-09 の取り込みは src/scenario・src/simulation に触れていない)
  - 既存コメントの削除なし: `git diff feat/m19...HEAD -U0 | grep -E '^-\s*(//|\*|/\*|#)'` は空

## 作業ログ

### 先に確かめたこと: `World.restore` の続きは一致しなかった(2026-09-26)

- 確かめ方: 使い捨てのテストで、size 64 の `no-answer`・`vein-drain`(文明・祈り・信仰)を 12 年回す。途中で `serialize` → JSON → `restore` し、毎年の終わりの `serialize()` の hash を、閉じずに回した島と比べた
- 結果: どこで閉じても、閉じた年のうちに食い違った。年の境目(4 年目の初め)、年の途中、山火事の最中、介入を積んだ直後、9 年目の初めの 5 通りすべて
- 年の境目でだけ書く案は効かない。年の中に溜まる数え(`civYearKeys`・`civYearDisasters`・`civYearAnswered`・`civYearIgnored`・`civYearWithdrawn`)は境目で空になる。ところが、年をまたいで持つ数えも SaveData に無い(`civFaithHistory`・`civPrayerHistory`・`civPrayerCooldownUntil`・`civUnrestStreak`・`civDeclineStreak`・`civHistory`・`civCandidate`)。さらに、境目では予言の命令(沈降・狼)が積まれたまま step を待っている(`queue`)
- ほかに SaveData に無かったもの: 燃えている火と燃え跡(`fire`・`burnt`)、霊脈の細り(`veinLoss`)。`veinLoss` は年に 1 回だけ更新するので、年の途中の輝石から求め直すと違う値になる
- 求め直せるので持たないもの: `prevTotals`(restore の `refresh` で同じ値になる)、`temperature`・`moisture`・`meanTemperature`(毎 step の初めに `stepClimate` が求め直す。本体の続きには効かない。restore の直後の 1 フレームだけ、HUD の平均気温が閉じる前と少し違う)

### 形: SaveData に `memory?` を足す(df292a6)

- `SaveData.memory?: WorldMemory`。中身は `queue`・`veinLoss`・`fire`・`burnt` と、文明があれば `civ?: CivMemory`(上の数え)。どれも JSON にできる。まだ一度も解決していない祈りの間 `-Infinity` は、JSON に書けないので `null` にする
- 後方互換: 既存の `?` の流儀に合わせた。memory の無い古いセーブは、今までどおり restore の直後から数え直す(`tests/unit/world.save.test.ts`「memory の無い古いセーブも読め…」)。`SaveData.version` は 1 のまま
- SIM_VERSION は上げない。理由: 本体の規則・係数・刻みは変えていない。同じ年代記は同じ結末のまま(`tests/unit/scenario.determinism.test.ts` の golden `efc90e40…` と `tests/fixtures/chronicle.ts` の `c8c2ea44…` がそのまま通る)。memory は、閉じる前の島の状態をもれなく写すためのもの
- 手動の枠(M19-05)にも memory が載るので、自由モードの読込の続きも、閉じずに回した島と同じになる
- 大きさ: size 128 では `fire`・`burnt`・`veinLoss` の 3 層(各 16,384 値)ぶん増える。測ってはいない

### 形: RunnerState(d041b88)

- `ScenarioRunner.save(): RunnerState` と `createScenarioRunner(def, world, opts, restored?)`。`RunnerState` は `version`・`scenarioId` と、runner の中の変数すべて(力・収入と維持費・使った力・年表・警告・告知・履歴 3 本・fired と cancelled と warned(配列にする)・前年の値・祈りの数え・迎撃の pending)。石板の定義と島から決まるもの(大きさ・縮尺・力の上限)は持たず、生成のときに求め直す
- 作りの選び方(案を 2 つ比べた)

| 案 | 中身 | 採否 |
|---|---|---|
| A. 今の `let` を残し、初期値を `init` から読む | `freshState(def, first)` か `restoredState(def, saved)` で `init` を作り、`let power = init.power` のように読む。`save()` が全部を写す | 採った |
| B. 状態を 1 つの `st` オブジェクトにまとめる | `st.power` のように読む。型・初期値・保存が 1 か所になる | 見送った |

- A を採った理由: B は runner の変数の宣言を消すので、宣言の上にある既存のコメントが宙に浮くか消える。既存コメントは消さない決まりがある。A でも、`freshState` と `save()` の戻り値は `RunnerState` の型で縛られ、欠けると型検査で落ちる。残る穴は「新しい `let` を足して `RunnerState` に足し忘れる」だけ。これは `scenario.resume.test.ts` が、年表・島・Digest の食い違いとして拾う
- 版と石板の確かめは `runnerStateMismatch` 1 つにした。置き場から読んだ続きの確かめ(`resumeScenario`)と、`restored` の門の両方が使う

### 形: 置き場と自動保存(900f1ca)

- IndexedDB の版 4 で `scenarios` を足した(`UPGRADES` の末尾。版 3 は M19-09 の `outbox`・`keys`)。key は scenarioId、値は `{save, runner}`。年代記は M19-06 と同じ `chronicles` に置く
- `saveScenario` は `scenarios` と `chronicles` を 1 つの transaction で書く。`loadScenario` も 1 つの transaction で両方を読み、年代記は `parseChronicle` に通す
- 方針は `src/persist/scenarioSave.ts`
  - `resumeScenario`: 続きが無い → 石板の初めから。判定の出た石板 → 石板の初めから(次の挑戦。続きと年代記は消さない)。読めない続き(年代記が壊れている、年代記の版・石板・seed が違う、runner の状態の版・石板が違う、`World.restore` が投げる) → `unreadable:<石板>` へ退けて石板の初めから(記録に理由を残す)
  - `createScenarioAutosave`: 自由モードと同じ 90 tick の周期で書く。書き込み中は次を書かない。ほかに、受理された介入の後・判定のとき・タブが隠れたときにも書く(M19-06 で年代記を書いていた 3 か所。main.ts の `saveChronicle` がそのまま `flush` を呼ぶ)
  - 記録の名前は `persist.scenario.saved`・`resumed`・`finished`・`resume.failed`・`save.failed`・`load.failed`。自由モードの `persist.saved`・`persist.resumed` と分けた(M19-05 の E2E「シナリオ中は…自動の枠にも書かない」は変えずに通る)
- 自動の枠(自由モード)は今までどおり、シナリオの島を書かず、シナリオでは戻さない
- 周期の数え(8 行)は `localSave.ts` と同じ形を写した。1 つの関数に出すと、`localSave.ts` の `let last` の上の既存コメントが宙に浮くので、出していない

### 「予言と矛盾するので無効」の規則との関係

- 規則(main.ts の `load`・`onSlotLoad`・`onNewIsland`): シナリオの途中で、別の島(手動の枠・ファイル・新しい島)を差し込むことを禁じる。runner の年表・力・判定の履歴は今の島を見て積んだものなので、別の島に差し替えると、予言の続きと島が合わなくなる
- 続きからの復帰は、同じ石板・同じ島の、閉じたのと同じ tick の島・runner・年代記を 3 つそろえて戻す。3 つは同じ transaction で書くので、別の tick のものが並ぶことはない。戻した続きを最後まで回した結末は、閉じずに回した結末と同じ(上の単体テスト)で、年代記を回し直しても同じ Digest になる。だから予言と矛盾しない
- 規則はそのまま残した。シナリオの途中の手動の枠の読込・ファイルの読込・新しい島は、今までどおり無効
- 訪問(M19-09)は、他人の島を見ているだけなので、自分の続きから戻さず、書きもしない(下)

### M19-09 との取り込み(54ff80b)

- `feat/m19` の b029053 を取り込んだ。衝突は 2 か所
  - `UPGRADES`: M19-09 が版 3(`outbox`・`keys`)を取ったので、`scenarios` を版 4 にした
  - main.ts の `recorder = …`: M19-09 の `recorder = visitId ? null : recordChronicle(` を残し、自動保存は recorder がある島(自分の島)だけ作る。続きからの復帰は `scenario && !visitId` のときだけ行う
- 訪問で戻したり書いたりすると、訪れた他人の島が自分の石板の続きとして残ってしまう。E2E で確かめた(上)
- 訪問では recorder が無いので、自動保存も作らない。「記録する島だけ書く」を recorder の有無 1 つで決め、main.ts に訪問の分岐を増やしていない

### レビュー(`pstack:thermo-nuclear-code-quality-review` を自分で 2 回当てた)

- 1 回目で直したこと
  - runner の状態の版・石板の確かめが、`resumeScenario` と `restoredState` の 2 か所に別々に書かれていた → `runnerStateMismatch` 1 つにした
  - `currentPrayer` の型を `NonNullable<WorldSnapshot['civ']>['prayer']` から `CivState['prayer']` にした
  - 本体の memory から `prevTotals` を外した(restore の `refresh` で同じ値になる。持つと余計な形が増える)
- 2 回目で見て、直さなかったこと
  - main.ts の `saveChronicle` が `scenarioAutosave?.flush()` を呼ぶだけの薄い包みになった。上の既存コメントを消さずに残すため、名前と置き場を変えなかった。変更の注記を 1 行足した
  - `RunnerState` の欄が、型・`freshState`・`save()`・`let` の初期値の 4 か所に並ぶ(上の案 B の見送り)
  - 年代記の頭(版・石板・seed)の確かめが、`resumeScenario` と `recorder.resume` に 2 つある。`resumeScenario` の側で先に確かめるので、`recorder.resume` の throw は main.ts では起きない。`recorder.resume` の throw は M19-06 の契約として残した
  - World.ts は 929 行から 980 行になった(1,000 行の手前)。memory の写しを文明の数えの 1 つのオブジェクトにまとめれば短くなるが、各欄の宣言の上の既存コメントを消すことになるので見送った
- codex CLI は使っていない(レビューは別の agent に頼まず自分で行う、という今回の指示)

### 残したこと

- 判定の出た石板を開き直すと、石板の初めから始まり、90 tick 後の自動保存で `chronicles` の年代記が新しい挑戦のものに上書きされる。M19-06 までは、新しい挑戦で最初の介入が受理されたときに上書きしていた。判定の後に出港しないまま開き直すと、終わった挑戦の年代記が早く消える。出港は判定の板から行い、閉港なら outbox に入る(M19-09)ので、多くの場合は困らない。判定の後に閉じてから出港したい、という使い方を受けるなら、終わった年代記を outbox とは別に残す形が要る
- 開き直した島では、HUD の時系列の折れ線と介入の目印(`hud.addMarker`)が空から始まる。石板の年表・力・警告は戻る
- 保存の大きさの実測(size 128 の SaveData に memory が足す分)はしていない
- 2026-09-27 直し(M19-10 と同じ worktree、fc03159): 判定の出た石板を開き直すと、次の挑戦の自動保存で終わった年代記が上書きされていた。判定の出た島(年代記と要約)を石板ごとに最後の 1 つ別に残し、港の板からあとで出港できるようにした。tests/unit/persist.scenarioSave.test.ts「判定の出た年代記は、次の挑戦の自動保存に上書きされない」、tests/unit/harbor.client.test.ts「判定の出た島を手元に残す」、E2E「M19-14 の直し: 判定の後に閉じて開き直し…港の板から出港できる」。
