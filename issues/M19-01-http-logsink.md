---
id: M19-01
title: HTTP LogSink
status: review
milestone: M19
plan: docs/design/2026-09-19-scenarios-and-world.md#5-システムへの逆算
depends_on: []
evidence: ["94fe98d dd3ceab 9b9c9d8 src/core/log/httpSink.ts src/core/log/appSink.ts src/vite-env.d.ts src/main.ts playwright.config.ts tests/unit/log.httpSink.test.ts tests/e2e/logsink.spec.ts"]
---

# HTTP LogSink

## What to build

JSON ログをサーバーへ流すアダプタ。バッチで送り、失敗しても本体は止まらない。設定で console / memory / http を切り替える。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] LogSink の HTTP アダプタ: N 件または T 秒でバッチ送信、失敗時は再試行して溢れたら捨てる(単体テスト: fetch をモック)
  - 証跡: `src/core/log/httpSink.ts` の `createHttpSink(url, opts)`(94fe98d で足し、dd3ceab で作り直した)。テストは `tests/unit/log.httpSink.test.ts`
    - バッチ: 「N 件たまったら 1 バッチで POST する」「N 件に満たなくても T 秒で送る」「1 バッチは N 件まで。残りは次のバッチに回る」
    - 再試行: 「通信の失敗は同じバッチを間をあけて送り直す」「5xx と 429 は送り直し、送り直しの間隔は倍々に延びる」「返事が来ない送信は requestTimeoutMs で打ち切って送り直し、送信は止まらない」
    - 捨てる: 「送り直しが尽きたらそのバッチを捨て、捨てた数を次のバッチで伝える」「4xx (429 を除く) は送り直さずに捨てる」「送っている間に上限を超えた分は古いものから捨てる」
    - 本体は止めない: 「fetch が同期で投げても write は投げない」「sendBeacon が投げても flushViaBeacon は投げず、送れなかった分を捨てた数に足す」
    - 受け口の 204: 「204 (受け口が黙って捨てた) は届いたものとして扱い、送り直さない」
    - 会計の不変条件: 「返事待ちの fetch が %s で終わっても、書いた件数 = 届いた件数 + 届いた dropped の和、同じ記録は二度届かない」。2xx・4xx・通信失敗・通信失敗のあと送り直しで 2xx の 4 通り(9b9c9d8)
    - 絞り込み: 「既定では warn/error と年ごとの要約 (sim.tick.summary) だけを送る」「絞り込みは設定で差し替えられる」「絞り込みなどの HTTP の設定はそのまま createHttpSink に渡る」
- [x] 本体のログ記録の形は変えない(既存の log テストが通る)
  - 証跡: `src/core/log/types.ts` は変えていない(feat/m19 との差分が空)。`tests/unit/log.sink.test.ts` と `tests/unit/world.log.test.ts` は 9b9c9d8 で通る
- [x] 設定(URL)がなければ console のまま。E2E で送信先をモックして 1 バッチ届く
  - 証跡: `src/core/log/appSink.ts` の `createAppLogSink`。単体テストは「URL が無ければ console のまま。HTTP へは送らない」と「URL があれば console にも出し、HTTP にも送る」
  - E2E は `tests/e2e/logsink.spec.ts` の「HTTP LogSink: warn/error と年ごとの要約がバッチで受け口に届き、console にも出続ける (M19-01)」
    - `page.route('**/api/v1/logs')` を `page.goto` より前に置き、204 で受ける
    - 届いたバッチについて、Content-Type、`dropped: 0`、info は sim.tick.summary だけであること、year 1 の要約があることを見る。console にも JSON 行が出続けることも見る
  - URL の無い dev サーバー(`VITE_LOG_URL` 無し、port 5198)に同じ spec を当てると、40 秒待っても 1 バッチも届かずに落ちた。spec が送信を本当に見ていることと、URL が無ければ HTTP へは出ないことを、E2E で確かめた
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - 証跡: 9b9c9d8 で `npm run check` の 766 件がすべて通った(86 ファイル)。Playwright は `E2E_PORT=5197` で 33 件すべて通った(このうち logsink.spec.ts が 1 件)

## 作業ログ

- 2026-09-26 設計書(docs/design/2026-09-26-cloudflare-architecture.md)に合わせた方針: 送るのは warn/error と年ごとの要約だけ。受け口は Workers Logs(7 日)に構造化ログで書き、D1 には入れない。受け口の日次の粗い上限を超えた分は 204 で黙って捨てる(失敗しても本体は止まらない)。
- 2026-09-26: 実装(94fe98d)→ レビュー → 修正(dd3ceab)→ 再レビュー → 修正(9b9c9d8)。
  - codex CLI は認証切れ(`Your access token could not be refreshed`)で動かなかった。代わりに `pstack:thermo-nuclear-code-quality-review` の手順で、別の agent に 2 回レビューを頼んだ。コメントの監査は `pstack:no-comments`(comment-sicko)に頼んだ。
  - 形: `createHttpSink(url, opts)` は `LogSink & { flushViaBeacon() }` を返す。`write` は同期で、投げない。
    - 状態は `Phase`(`idle` / `waiting` / `sending` / `backingOff`)1 つと、queue と、まだ誰も運んでいない捨てた数 `pendingDropped` だけにした。
    - バッチは不変の `{ records, dropped, attempt }`。捨てた数はバッチの持ち分にした。バッチを切るときに `pendingDropped` を移して 0 にし、届かずに終わったら records と dropped の両方を戻す。
    - 最初の形(94fe98d)は累計のカーソルを 3 本持っていた。beacon と返事待ちの fetch が重なり、その fetch が 4xx か通信失敗で終わると、捨てた数が消えた(レビューの H1。10 件書いて 8 件分しか数えられない)。不変条件のテストを先に書き、落ちるのを見てから、この形に作り直した。
  - 既定値: N = 20 件、T = 10 秒、たまる上限 200 件、送り直し 3 回(2・4・8 秒)、1 回の送信の期限 10 秒。どれも `HttpSinkOptions` で変えられる。
    - T は手が空いてから数える。返事待ち・送り直し待ちの間に来た記録は、そのあとから T を数える。
  - 送り直すのは、通信失敗・期限切れ・429・5xx。ほかの 4xx は送り直しても通らないので捨てる。2xx(受け口が上限で黙って捨てる 204 も含む)は届いたものとして扱う。
  - 本文は `{ records: LogRecord[], dropped: number }`(`LogBatch`)。`dropped` は、受け口(M19-02)が捨てられた件数を運営に見せるためのもの。
  - 絞り込みの既定は `shipsToServer`(`level !== 'info' || event === 'sim.tick.summary'`)。今は `error` を出す箇所が無いので、実際に届くのは warn と年ごとの要約になる。
  - 設定はビルド時の `VITE_LOG_URL`(型は `src/vite-env.d.ts`)。無いか空なら console だけ。
    - URL があっても console には出し続ける。E2E と chrome-devtools が console の JSON 行を読むため。
    - URL クエリにしなかった理由: リンク 1 つで、送り先を他のサイトへ向けられてしまうため。
    - 本番の値(`/api/v1/logs`、同じ Worker)は、M19-08 の配備で渡す。
  - `navigator.sendBeacon` を使うと決めた。
    - いつ呼ぶか: `visibilitychange` が `hidden` になったとき(`src/main.ts`、自動保存の flush の隣)。タブを切り替えるだけでも走るので、flush のあとも通常の送信は続ける(テスト「beacon のあとも、タブが戻れば通常の送信が続く」)。
    - 理由: ページが隠れたあとや閉じたあとでも、送信をブラウザが引き受けるのが sendBeacon の契約だから。閉じる間際には送り直す機会が無いので、送れなければ捨てるという sendBeacon の性質で足りる。
    - 受け口は同じ origin なので、`application/json` の Blob でも CORS の preflight は起きない。
    - beacon に載せるのは、queue と送り直し待ちのバッチ。返事待ちのバッチは載せず、fetch に任せる。fetch は `keepalive: true` なので、タブを閉じても取り消されない。
    - 断られた分と例外が出た分は、捨てた数に足す。
    - keepalive の枠(64 KiB)は、年ごとの要約が 1 件 300 B 前後なので、20 件で約 6 KB に収まる。
    - keepalive の fetch 1 本にまとめて sendBeacon をやめる案も、レビューで出た。設計書と受入基準が sendBeacon を名指ししているので、見送った。
  - E2E: `playwright.config.ts` の webServer に `VITE_LOG_URL=/api/v1/logs` を渡す。
    - ほかの spec では送り先が dev サーバーの 404 になるが、失敗しても本体は止まらないので影響は無い(33 件が通った)。
    - `E2E_PORT` でポートをずらせるようにした(既定は 5181)。`reuseExistingServer: true` のせいで、別の worktree の dev サーバーを拾うのを避けるため。拾ってしまったときに分かるよう、logsink.spec の poll に message を付けた。
  - テストが欠陥を捕まえるかの確かめ: `src/core/log/httpSink.ts` に次の 14 通りの変異を 1 つずつ入れ、どれでも必ずどこかのテストが落ちることを確かめた。
    - 429 を捨てる / 新しい方を捨てる / 倍々にしない / 捨てた数を戻さない / 届かなかったバッチの dropped を戻さない
    - 待ちのバッチを beacon に載せない / 絞り込みを外す / 断られた beacon を数えない / 期限を付けない / keepalive を外す
    - N 件で即送らない / 4xx も送り直す / 送り直しで捨てた数を取り直す / 返事待ちのバッチも beacon に載せる
  - レビューの指摘と対応:
    - H1(beacon と返事待ちの fetch が重なると、捨てた数が消える): 捨てた数をバッチの持ち分にし、不変条件のテストを足した(dd3ceab)
    - M1(状態が別々の変数に割れていた): `Phase` にまとめ、バッチを不変にした(dd3ceab)
    - M2(閉じるときに fetch が取り消される): `keepalive: true` を付けた(dd3ceab)
    - M3(返事が来ないと送信が止まる): 期限 `requestTimeoutMs` を付け、期限切れは送り直しへ回した(dd3ceab)
    - L1(sendBeacon の例外): try で包み、送れなかった分として数えた(dd3ceab)
    - L2(T が返事のあとから数え直しになる): 意図どおりとして、`maxWaitMs` の doc に書いた
    - L3(テスト名と中身のずれ): describe の名前を「隠れたとき」にした。タイマーが残らないことと、beacon のあとも送信が続くことのテストを足した(dd3ceab)
    - L4(E2E の環境と、フィルタを設定する層): `createAppLogSink` が `HttpSinkOptions` をそのまま渡すようにし、poll に message を付けた(dd3ceab)
    - 再レビューの low(会計のテストが送り直しの道を通っていない): 「通信失敗のあと送り直しで 2xx」の場合と、同じ記録が二度届かないことの確かめを足した(9b9c9d8)
    - 再レビューの medium(コメントの規則): dd3ceab で書き換えたコメント 3 つは、どれも同じブランチの 94fe98d で自分が足したもの。feat/m19 にあったコメントではなく、feat/m19 との差分で消えたコメント行は 0 行。
  - 残した差: 受け口(M19-02)はまだ無い。本文の形 `LogBatch` は、受け口を作るときに `src/harbor/contract.ts` へ移すか、そこから import する。
- 2026-09-26 訂正: Workers Logs の保持は無料プランで 3 日(1 日 200,000 件)。上の「7 日」は Paid の値だった(M19-02 で docs を確認)
- 2026-09-27 受入試験(.claude/acceptance、http://localhost:5392): a-logs 保留(メモなし) → 直しは M19-15・M19-16・M19-17、登録は M21-04・M22-10
