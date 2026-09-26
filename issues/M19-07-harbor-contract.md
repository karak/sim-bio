---
id: M19-07
title: 港の契約(クライアントと Worker が共有する parse と型)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-06]
evidence:
  - "6a6090e refactor(harbor): 年代記の契約を src/chronicle/contract.ts から src/harbor へ移し、呼び手を移す"
  - "8484812 feat(harbor): 港の契約 src/harbor/contract.ts と HTTP の形 src/harbor/wire.ts、年代記の形は src/harbor/chronicle.ts"
  - "06ad3ff refactor(harbor): レビュー対応(拒否の場所を相対の道に揃える、NO_BODY、MAX_BODY_BYTES を年代記の上限から導く)"
  - "tests: tests/unit/harbor.contract.test.ts, tests/unit/harbor.wire.test.ts, worker/test/harbor.contract.test.ts, tests/fixtures/chronicle.ts (FIXTURE_CHRONICLE_ID)"
---

# 港の契約(クライアントと Worker が共有する parse と型)

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §5.2。`src/harbor/contract.ts`: Chronicle・Digest・Cargo・ChronicleCard の型、`parseChronicle`・`parseCargo`(unknown → Parsed<T>、不変条件: tick の単調、長さ ≤ 4000、8〜16 KB、カタログの id だけ)、`chronicleId`(正規化 JSON の SHA-256)。wire 型は `harbor/wire.ts` に閉じる。自由文を受ける項目を作らない。

## Blocked by

M19-06

## Acceptance criteria

- [x] parse の受け入れと拒否(境界値・自由文・未知の種・大きすぎ)を単体テストで網羅
  - `tests/unit/harbor.contract.test.ts`(8484812・06ad3ff)
    - 境界値: 「正規化 JSON の UTF-8 の大きさは上限ちょうどまで受け、1 B 越えれば too_large」「1 件と 5 件、量の上限ちょうど (10) と、ごく小さい正の量を受ける」「0 件と 6 件は弾く」「量の境界: 0・負・10 を越える・数でないものは弾く」「digestOf の結末の要約を受ける (年 0 も)」
    - 自由文: 「カタログに無い石板・種 (放流の種と系列の鍵) は、id の形でも自由文として弾く」「公開の面に出る版は数字と点だけ」「カードを受け、知らない鍵 (名前・ひとことの自由文) は落とす」「碑文・石板がカタログに無い、id が SHA-256 の形でない、数が負や小数なら弾く」
    - 未知の種: 「カタログに無い種・自由文・同じ種の重ねは弾く」(積荷)、「判定・年・総数・絶滅・hash の誤りを、場所を付けて弾く」(要約の総数の鍵)
    - 大きすぎ: 「既定の上限は 16384 B。手元では読める長さ (4000 件以内) でも、越えれば港には出せない」、長さの上限 4000 は M19-06 の `tests/unit/chronicle.test.ts`「長すぎる年代記 (4000 件を超える) は弾く」
  - `tests/unit/harbor.wire.test.ts`(8484812・06ad3ff): 10 の要求と 5 の応答の往復(1 種ずつ)、「本文が道の上限を越えれば、JSON を読む前に too_large (照合の道は出港より狭い)」「出港の本文は、上限いっぱいの年代記と全種の要約を積んでも MAX_BODY_BYTES (20480 B) に収まる」「出港: 碑文の自由文・人間確認の札の欠け・カタログに無い石板・要約の誤りを弾く」「道が無い・method が違う・版の違う道は no_route」「道の id・取り下げ鍵・一覧の石板と頁の誤りを弾く」「拒否: JSON でない・一頁の件数の上限を越える・越えた数の回避・カタログに無い碑文」
  - テストが欠陥を捕まえることを変異で確かめた(scratchpad の使い捨ての脚本、コミットしていない): 積荷の同じ種の重ね・年代記の大きさの検査・量の 0 の扱い・積荷の件数の上限・系列の鍵のカタログ検査・canonicalJson の undefined の扱い・本文の大きさの検査・照合の道の上限を 1 つずつ外すと、8 つとも対応するテストが落ちる
- [x] 同じ年代記は同じ id になる(冪等の土台)
  - `src/harbor/contract.ts` の `chronicleId`(`canonicalJson` の SHA-256)。8484812
  - `tests/unit/harbor.contract.test.ts`「JSON の往復・鍵の順・知らない鍵を経ても同じ id になり、固定の年代記は golden の id になる」「値が undefined の鍵は無い鍵と同じに扱う (記録器の命令と、JSON を往復した命令が同じ id になる)」「中身が 1 か所でも違えば id が変わる (seed・命令の tick・命令の値・系列)」
  - `worker/test/harbor.contract.test.ts`「固定の年代記の id が、Node の単体と同じ golden になる」: workerd の WebCrypto でも `FIXTURE_CHRONICLE_ID`(`tests/fixtures/chronicle.ts`)と同じ id になる
- [x] npm run check が通り、evidence に commit SHA とテストファイルを記す
  - 06ad3ff で `npm run check`(root と worker の tsc、`wrangler types --check`、eslint、vitest、worker のテスト)が通る。vitest の通し 93 ファイル 874 件(うち港は `harbor.contract.test.ts` 18 件と `harbor.wire.test.ts` 26 件)、worker 2 ファイル 22 件(うち `harbor.contract.test.ts` 2 件)
  - 既存コメントの削除なし: `git diff feat/m19...HEAD -U0 | grep -E '^-\s*(//|\*|/\*|#)'` が空

## 作業ログ

### 設計(2026-09-26、M19-07 の担当)

- 素描の 2 案(pstack:architect の考え方で、自分で)
  - A: 要求・応答ごとに `encodeX`・`decodeX` を並べる(`core/log/batch.ts` の形)。10 の要求と 5 の応答で 30 近い関数になり、道・method・header の知識が関数ごとに散る
  - B: 要求を `kind` の判別共用体 `HarborRequest` にし、応答は `HarborResponses`(kind → 本文の型)にする。HTTP の形は `wire.ts` の道の表 `ROUTES`(kind ごとに method・道・本文の上限・書き方・読み方)1 つに閉じ、公開は `writeRequest`・`readRequest`・`writeResponse`・`readResponse` の 4 つ
  - B を採った。公開の面が小さく、道を足すときは表に 1 行足すだけになる。往復のテストが表の書き方と読み方の食い違いを落とす
- 置き場
  - `src/harbor/chronicle.ts`: M19-06 の年代記の形(Chronicle・Digest・parseChronicle・ReplayOutcome)。`src/chronicle/contract.ts` を丸ごと移した(re-export の口は残さず、呼び手 7 つを移した)。記録・保存・再生は港に出さなくても使うので、港の約束とは分ける
  - `src/harbor/contract.ts`: 港の約束。ブランド型(ChronicleId・InscriptionId・CargoId・WithdrawKey・BrowseCursor・TurnstileToken)、`HarborCatalog`(石板・種・碑文の id の集まり)、`HARBOR_LIMITS`(年代記 16 KB・積荷 5 件・一頁 50 件)、`ChronicleCard`、`Cargo`・`DrawnCargo`、`HarborRequest`・`HarborResponses`、`chronicleId`、`parsePublicChronicle`・`parseDigest`・`parseCargo`・`parseCard` と札の parse
  - `src/harbor/wire.ts`: 道・header・本文の JSON(wire 型 `WireBody` は外へ出さない)、`MAX_BODY_BYTES`(Content-Length を先に比べる上限)
  - 設計書 §5.2 の素描は Chronicle も contract.ts に置くが、分けた。1 つのファイルに足すと元の 8 KB が 19 KB になり、git が rename と見なくなって、元のコメント行が三点の diff で削除に見える。分けると `src/{chronicle/contract.ts => harbor/chronicle.ts}` の rename と対になり、変わるのは見出しに足した 2 行と import・export だけ
- 決めたこと
  - 自由文の抜け道を塞ぐ: 形だけの id の検査(`/^[a-z0-9_-]{1,40}$/`)では `visit_my_site` のような言葉が通る。港に出す年代記・要約・カード・積荷は、石板・種・碑文を `HarborCatalog` の集まりにあるかで検査する(`parsePublicChronicle` は放流の種と系列の鍵まで見る)。公開の面に出る `simVersion` は数字と点だけにした(手元の `parseChronicle` は 16 文字までの文字列のまま)。SIM_VERSION は今の '1' のまま、この形で上げる
  - 大きさ: 年代記の上限は正規化 JSON の UTF-8 で 16,384 B。手元の 4,000 件の上限より狭く、放流だけなら 150 件ほどで届く。長く遊んだ島は港に出せないことがある(M19-09 はクライアントで先に `parsePublicChronicle` をかけて同じ理由で断る)。出港の本文の上限は 16 KB + 4 KB = 20,480 B、ほかの道は 2 KB か本文なし
  - 人間確認の札は `cf-turnstile-response` header、取り下げ鍵は `Authorization: Bearer`。本文にも道にも載せない
  - 積荷は同じ種を重ねない(5 件並べて量の上限 10 を越えさせない)。量の上限は放流の命令と同じ `MAX_AMOUNT`(受け取れば放流として年代記に載るので)
  - `Digest.extinct` は `totals` から決まるので、食い違えば `inconsistent`
  - `canonicalJson` は値が undefined の鍵を飛ばす(JSON.stringify と同じ)。記録器が作った命令に `tempOffset: undefined` があっても、JSON を往復した年代記と同じ id になる。既存の Digest の hash(`FIXTURE_HASH`)は変わらない
  - `isInt`・`isFiniteNumber` を `src/core/parse.ts` に移し、年代記と `core/log/batch.ts` の同じ 1 行を消した
- M19-08・M19-09 へ渡すこと
  - Digest の hash の検算と、訪問の応答の `card.id` と `chronicleId(chronicle)` の一致は、SHA-256 が非同期なので parse ではしない。Worker は出港で id を自分で計算し、クライアントは訪問で一致を確かめる
  - 碑文のカタログはまだ無い。M19-09 で `assets/data` に足し、`HarborCatalog.inscriptions` に渡す。Worker が石板・種のカタログをどこから読むか(`assets/data/*.json` の import か、ビルドで焼くか)は M19-08 で決める
  - `readRequest` の拒否の理由は `no_route`(404/405)・`too_large`(413)・ほか(400)に読み替える
  - 回避率の応答は率ではなく数(`finished`・`avoided`)にした。率と「出さない閾値」はクライアントで決める

### レビュー(thermo-nuclear、自分で、`git diff feat/m19...HEAD`)

- 直した(06ad3ff)
  - 拒否の場所の約束が 2 つ混ざっていた(parseChronicle は相対の道、新しい parse は既定値つきの path 引数)。相対の道に揃え、前置は `core/parse.ts` の `under` 1 つにした。path 引数 7 つが消えた
  - 本文を取らない道の `maxBytes: 0` に `NO_BODY` と名前を付けた。`MAX_BODY_BYTES` を直書きの 20 KB から `HARBOR_LIMITS.chronicleBytes + 4 KB` に直した
  - `chronicleId` が後で宣言する helper を使っていたので、helper の後へ移した。応答の読みの `HarborResponses['browse']['cards'][number]` を `ChronicleCard` に直した
- 見送った
  - `ROUTES` の表は 130 行ほどで、本文の要る 4 つの道が `isObject` を繰り返す。道ごとに読む鍵が違い、まとめると readRequest に分岐が増えるだけなので残す
  - `writeResponse` は JSON.stringify に kind を足しただけだが、kind が値の型を `HarborResponses[K]` に結ぶので、型の門として残す
- 大きさ: chronicle.ts 157 行、contract.ts 182 行、wire.ts 290 行
