---
id: M19-06
title: 年代記の記録と再生(Web Worker)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-04]
evidence: ["ec1d08f・e098fe3 tests/unit/chronicle.test.ts tests/unit/chronicle.store.test.ts tests/unit/chronicle.worker.test.ts tests/e2e/chronicle.spec.ts"]
---

# 年代記の記録と再生(Web Worker)

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §5。UI の `dispatch` を外から包んで tick 付きの命令を積む `recordChronicle`(World は変えない。予言の fromStar:false は載せない)、Web Worker で年代記を回し直す `replay`(tick の上限と中断を持つ)、結末の要約 `digestOf`(toPrecision(6)、正規化 JSON の SHA-256)。年ごとの種の総数の短い系列を添える(折れ線用)。

## Blocked by

M19-04

## Acceptance criteria

- [ ] seed + 年代記 → 同じ Digest を 1 本のテストで示す(設計書 §9 の最初の一手)
- [ ] 拒否された命令は年代記に載らない。自動保存からの復帰で年代記を引き継ぐ
- [ ] 壊れた年代記(tick の逆行・長すぎ)で replay が止まり、タブを落とさない
- [ ] 300 年の再生の所要時間を計測して作業ログに記す(照合を自動で走らせるか決める材料)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

### M19-04 からの引き継ぎ(2026-09-26)

- 再生の駆動は `tests/unit/scenario.determinism.test.ts` の `replay()` を元にする。形は「最初に `runner.update(snapshot)`(tick 0 の評価)→ 介入ごとに `stepByYear` でその tick まで進めて `runner.intervene` → `stepByYear` で判定まで」。
- 順序の契約: 境目ちょうど(tick = 360·Y)の介入は、その境目の `update` の後に打つ。ライブのクリックも、境目を越えたフレームの `update` の後に来るので同じになる。tests/slow の台本(`play`・`playTower`)は境目で「介入 → update」の逆順。台本の年代記をそのまま再生の golden にしないこと(同じ tick でも、力の収入の前後・年表の年・その年の判定が介入を数えるかが変わる)。
- `recordChronicle` が記録する tick は、クリックを受けたときの `world.snapshot().tick`(次の `stepOnce` で適用される tick)。
- M19-04 のレビュー(thermo-nuclear)で見送った作り替えをここでやる:
  - `ScenarioRunner` に `advance(n)` を持たせる(`RunnerWorld` に `step` を足す)。
  - `update` を境目専用の評価にし、tick 0 の評価は生成時に行う。onFrame は読むだけにする。`currentPrayer` と迎撃の pending は snapshot から求める。
  - `ticksToNextYear` を非公開に戻す。
  - テストの `replay()` を `src` の `replayChronicle` に移す。
  - tests/slow の 47 件の判定が変わらないように、台本の駆動は段階的に移す。
- 別の版の照合で気をつけること: 本体は毎 tick `Math.sin`・`Math.cos` を使う(`src/simulation/climate.ts:36-37`)。V8 どうしなら一致するが、エンジンが違うブラウザ(Safari・Firefox)で最後の桁まで一致するとは限らない。照合の Digest は `toPrecision(6)` に丸めるものの、差が年を追って育つかは実測していない。

### 設計(2026-09-26、M19-06 の担当)

- 形: `src/chronicle/` に 5 つ。M19-07 が `contract.ts` を `src/harbor/contract.ts` へそのまま移せるよう、契約の型と parse は `core/parse` と本体の型だけに依らせた。
  - `contract.ts`: `Chronicle`・`TimedCommand`・`Digest`・`ReplayOutcome` と `parseChronicle`。命令は UI から打てる 7 種だけを読み、知らない鍵を落として作り直す(同じ中身は同じ年代記。M19-07 の年代記の id に効く)。`sink`・`tower_power` は予言と力の自動処理が出す命令なので、載っていれば弾く。半径は 128、量は 10 までにした(大きすぎる値は 1 回の適用で重くなる)。
  - `recorder.ts`: `recordChronicle(target, head, yearly)`。シナリオ中の UI の介入(`ScenarioRunner.intervene`)を包み、受理された命令だけを、受けたときの tick と積む。予言の命令は runner が World へ直に流すので、ここを通らない(fromStar:false を見分ける分岐が要らない)。
  - `digest.ts`: `canonicalJson`(鍵を辞書順)・`sha256Hex`(WebCrypto。ブラウザ・Worker・Node・Cloudflare Worker で同じ)・`digestOf`。
  - `replay.ts`: 順序の契約を持つ `runChronicle(world, runner, commands, {maxTicks, onYear, signal})` と、parse から Digest までの `replay(input, island, opts)`。例外を投げず `ReplayOutcome` の kind で返す。
  - `replayInWorker.ts`・`replay.worker.ts`: Web Worker で回す。中断は Worker ごと `terminate` する(Worker の中の同期の再生は割り込めないため)。時間の上限は呼び手が `AbortSignal.timeout` で渡す。
- 設計書 §5.2 の素描との違い(M19-07 へ):
  - `Digest.verdict` は `'alive' | 'dead' | 'escaped'`。空の舟の石板は escaped で終わるので、2 値にすると結末が 1 つ消える。
  - `replay(c, onYear?, signal?)` は `replay(input: unknown, island: {def, config}, {maxTicks, onYear, signal})` にした。本体を回すには石板の `ScenarioDef` と島の `WorldConfig` が要る。main.ts の `?scenario` からの組み立て(石板の start の上書き)は src に移していない。移すと main.ts の既存のコメントを消すことになるので、ユーザーの判断が要る。訪問者の照合(M19-09)は他の石板の島も組むので、そこで組み立てを 1 つにする。それまでは呼び手が同じ組み立ての config を渡す。
  - 年ごとの系列は `ScenarioRunner.totalsByYear()`(境目ごとの評価の総数、足したのはこの読み取りだけ)を 4 桁に丸め、48 点までに間引く。フレームの snapshot から取ると、速度によって年の中の tick がずれて再生と合わない。
  - `SimVersion`・`ChronicleId` の brand と、年代記の大きさ(バイト)の上限は M19-07 に残した。今の上限は命令の件数(4000)だけ。
- 年代記の置き場: IndexedDB の版 2 で `chronicles` を足した(`UPGRADES` の末尾)。key は scenarioId、石板ごとに最後の 1 本。読むときに `parseChronicle` を通す。書くのは、受理された介入の後・判定のとき・タブが隠れたとき。
- main.ts: 石板の runner を作った直後に tick 0 の評価(`update`)を済ませる。今までは最初のフレームの onFrame が行っていた。最初のフレームより前にクリックが来ると、年 0 の予定より先に介入が入り、再生と順が変わる。

### `ScenarioRunner.advance(n)` の提案: 見送る

- 案 A(採った): 今の `stepByYear(world, runner, n)` と `update` をそのまま使い、再生の駆動を `src/chronicle/replay.ts` の `runChronicle` に置く。ライブと再生の一致は、本物のフレームの runner を 1x・100x で回すテストで示した(`tests/unit/chronicle.test.ts` の 1 本目)。
- 案 B: `runner.advance(n)` が `world.step` を持ち、`update` を境目専用にし、tick 0 の評価を生成時に行い、onFrame は読むだけにする。
- A を採った理由:
  - 再生の順序の契約は、A のままで構造として守られている。1 回の step は境目を越えず、境目の `update` は stepByYear が必ず呼ぶ。B で新しく保証されるものは、年代記の側には無い。
  - B は tests/slow の 47 件の台本の順(境目で「介入 → update」)を変え、段階的な移行と数分の通し実行が要る。
  - 別の agent が ScenarioRunner の警告と E2E の揺れを調べている。runner の中を作り替えると重なる。
  - B の利点は読みやすさ(onFrame が読むだけになる、`ticksToNextYear` を閉じられる)。tick 0 の評価だけは main.ts で先に済ませた(上)。残りは M19-14 案(下)と一緒に、ScenarioRunner の状態を持ち出せる形へ作り替えるときに行う。
- テストの `replay()` は `runChronicle` を呼ぶ形にした。`tests/unit/scenario.determinism.test.ts` の golden(`efc90e40…`)は変わらずに通る。コメントは消していない。

### 300 年の再生の所要時間

- 年代記: `sinking` の石板を 300 年・予定なし・`year_reached 300` にし、介入 3 件。size 64。ほかの負荷の無いときに 1 本ずつ背景で回した。
- Node 24(vitest、V8): 207.3 秒(1 年 691 ms)。50 年ごと: 35.9・26.7・26.7・26.6・36.9・54.5 秒。後半は島の状態で重くなる。
- Chromium の Web Worker(Playwright、headless、`replayInWorker`): 73.6 秒(1 年 245 ms)。50 年ごと: 11.1・10.8・10.6・12.9・14.4・13.8 秒。結末は Node と同じ hash(`3f81b469…`)で、300 年回しても Chromium と Node の V8 で差が出なかった。Node が 3 倍ほど遅い理由は調べていない(vitest の変換の下で回したことが効いているかもしれない)。利用者に効くのはブラウザの数字。
- 参考(本体の step だけ、Node): size 32 は 1 年 209 ms、size 64 は 837 ms、size 128 は 3,377 ms。size 128 の 300 年は 17 分ほどになる。
- 決めたこと: 照合を自動では走らせない。ブラウザでも 100 年の石板(size 64)で 25 秒ほど、size 128 の石板(落ちる星など、本体の step は size 64 の 4 倍)は 90 年で 1 分半ほどかかる。M19-09 の照合は「年表を読む」の明示の操作にし、進み(`onYear`)と中断を見せる。

### M19-05 の残り(シナリオの途中で閉じると石板の初めからになる): 範囲に入れない

- 年代記から島と runner を回し直す案は、上の実測で開き直しに時間がかかりすぎる。閉じた年までの再生が要るので、ブラウザでも沈む欠片(size 64)の 99 年目で 25 秒ほど、空の舟(size 64、200 年)の終わり近くで 45 秒ほど、size 128 の石板では 1 分半を超える。タブを開くたびにこれを待たせることになる。再生は Worker で回るが、島と runner はメインスレッドに要るので、Worker の再生の結果をそのまま使うこともできない(runner の状態を持ち出せない)。
- このチケットでは置き場と引き継ぎの口までを作った: 年代記は石板ごとに IndexedDB へ書かれ(`chronicles`)、`recorder.resume(saved)` が命令を引き継ぐ(`tests/unit/chronicle.store.test.ts`)。アプリの起動では、まだ読まない。
- 新しいチケットの案(M19-14「シナリオの続きから(runner の状態を持ち出す)」):
  - `ScenarioRunner` に `save(): RunnerState` と `createScenarioRunner(def, world, opts, restored?)` を足す。状態はすべて JSON にできる(力・年表・警告・履歴・fired と cancelled・前年の値)。
  - シナリオの自動保存は、SaveData・RunnerState・年代記の 3 つを 1 つの transaction で書く(同じライブの同じ tick のものしか並ばない)。開き直したら 3 つを戻し、`recorder.resume` で年代記を引き継ぐ。
  - 受入の証明は年代記で行う: 途中で保存して戻した島を最後まで回した Digest が、閉じずに回した Digest と一致する。
  - 先に確かめること: `World.restore` の続きが、閉じずに回した島と最後の桁まで一致するか(`civYearKeys` などの年の中の状態が SaveData に無い)。一致しなければ、年の境目でだけ書く案を試す(年の中に溜まる状態が境目で空になるかも確かめる)。
  - M19-05 の「SaveData に runner の状態を足す案より、予言との矛盾が起きない」は、再生の所要時間が分かる前の見立て。状態を持ち出しても、年代記の Digest の一致で矛盾が無いことを示せる。
