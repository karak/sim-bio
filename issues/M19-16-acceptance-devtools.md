---
id: M19-16
title: 受入試験を AI が確かめられる仕組み(状態の受け渡し・複数の見守り手・テストの近道)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: ["aa122ab 1cff4c0 bf1d2ae 73c5a76 12c1452 ec996cb 8b27224 1507997 bae580a src/dev/session.ts src/dev/snapshot.ts src/dev/panel.ts src/main.ts worker/src/guard.ts tools/acceptance-snapshots.ts tests/unit/dev.session.test.ts tests/unit/dev.snapshot.test.ts tests/unit/build.devtools.test.ts tests/unit/acceptance.snapshots.test.ts tests/fixtures/devSnapshot.ts tests/e2e/devtools.spec.ts tests/e2e-cloudflare/harbor.spec.ts worker/test/harbor.test.ts docs/operations/acceptance.md"]
---

# 受入試験を AI が確かめられる仕組み(状態の受け渡し・複数の見守り手・テストの近道)

優先度: Must

## What to build

受入試験(2026-09-27)でのユーザーの依頼。原文:
- a-cargo「追加依頼。こちらの受入試験の確認を開発者＝AIがするための仕組みをつくってほしい。localのセーブデータを保存してidをこうしたツールで渡せば済むようにするイメージ」
- a-browse「ほかの島の「通報」を押せていない。ローカルで複数のゲームユーザーアカウントを持つ手段が必要と思われる」
- a-avoidance「「沈む欠片」を試した。介入なしで流したため、島は滅びたとなった。結果、Nは0%。 / このシナリオにも、test用の成功にたどり着ける機能がほしい。また、時間がかかるので、その場合は1000xもありにしてほしい。」

作るもの(どれも開発・受入のときだけ効き、配った本番では出ない。出し分けは Vite のビルドの切り替えか `?dev=1` のような明示の指定で、本番のビルドに入らないことをテストで確かめる):
1. 状態の受け渡し: 画面の開発用の操作で、手元の状態(IndexedDB の saves・scenarios・chronicles・outbox・keys・marks と、今の島の SaveData・年代記・URL)を JSON にまとめ、受入の画面(.claude/acceptance のサーバー、http://localhost:5392)へ送って id を得る。受入の画面の各項目のメモ欄の横に、その id を添えられる。AI は id から状態を読み、同じ状態をテスト(Playwright の fixture か単体テスト)に読み込んで再現できる。
2. 複数の見守り手: 手元で別の見守り手として振る舞う(通報・受け取りを他人として試す)。送り手の数え方(日替わりの salt の HMAC、港は IP で数える)と手元の取り下げ鍵・控えが、見守り手ごとに分かれるようにする(例: `?player=<名前>` で IndexedDB の名前と送り手の見分けを変える。港の側の送り手の見分けは wrangler dev のときだけ header で差し替えを許す)。
3. テストの近道: どの石板でも、成功(予言を越える)まで短くたどり着ける開発用の手段(例: 判定を alive で打ち切る、またはテスト用の介入の束)。1000x の速度(開発用のみ)。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 状態を受入の画面へ送って id を得、その id から同じ状態をテストに読み込んで再現できる(E2E で往復)
  - E2E `tests/e2e/devtools.spec.ts`「M19-16: 状態を受入の画面へ送って id を得、その id の写しを別のブラウザに流し込むと、同じ島・同じ枠から続く」(ec996cb・bae580a)。受入の画面の写しの道 `tools/acceptance-snapshots.ts` を spec が立て、別の context に `tests/fixtures/devSnapshot.ts` の `openSnapshot` で流し込み、枠の一覧と `persist.resumed` の tick が一致する
  - 単体 `tests/unit/dev.snapshot.test.ts`(写し → fake-indexeddb へ流し込み、枠・年代記・取り下げ鍵・控えが同じに読める)、`tests/unit/acceptance.snapshots.test.ts`(POST → id → GET、よその origin・形違い・道を外れた id を断る)
- [x] 2 人の見守り手を手元で切り替え、ほかの人の島を通報でき、3 人で隠れることを手で確かめられる(E2E)
  - `?player=<名前>` で IndexedDB の DB を `biotope-island@<名前>` に分け、港への要求に `x-dev-sender` を添える(`src/dev/session.ts`、aa122ab・bf1d2ae・73c5a76)。単体 `tests/unit/persist.harborStore.test.ts`「見守り手ごとの置き場」、`tests/unit/harbor.client.test.ts`「見守り手の header」
  - 港は loopback の host のときだけ `x-dev-sender` を送り手の IP の代わりにする(`worker/src/guard.ts` の `devSenderOf`、1cff4c0)。worker `worker/test/harbor.test.ts`「wrangler dev (loopback の host) では x-dev-sender で見守り手を分けられ、同じ IP の 3 人の通報で隠れる」と「本番の host では x-dev-sender を読まず、同じ IP の通報は名乗りを変えても 1 人に数える」
  - E2E `tests/e2e/devtools.spec.ts`「?player= で見守り手を分けると…」(alice が出港、bob が通報、鍵と置き場が分かれる)と、wrangler dev の `tests/e2e-cloudflare/harbor.spec.ts`「手元の 3 人の見守り手 (M19-16)」(2 人では並び、3 人目で一覧から消える)
- [x] 沈む欠片などで、開発用の手段で成功にたどり着ける。1000x が開発のときだけ選べる
  - 近道 `?shortcut=alive`(開発の板の札から)は石板の予言の年を 1 年目にし、alive を `year_reached 0` にし、dead・escape を外す。判定は本物の judge が出す。単体 `tests/unit/dev.session.test.ts`「沈む欠片でも次の年の境目で alive」、E2E `tests/e2e/devtools.spec.ts`「沈む欠片でも、開発の板の近道で…港へ出さない」
  - 近道の判定は港へ出さない(出港の板・回避率・積荷のどれも出さず、POST が 0 件)。偽の Alive を港に並べないため
  - 1000x は `?dev=1` のときだけ札が出る(`src/dev/session.ts` の `speeds`)。runner の 1 フレーム 200 tick の上限は変えない。単体 `tests/unit/runner.test.ts`「1000x (開発用、M19-16)」、決定論 `tests/unit/scenario.determinism.test.ts` を 1000x を足した 4 通りで確かめる(年の境目の刻みで同じ結末)
- [x] 本番のビルド(build:cloudflare)にこれらが入らないことをテストで確かめる。check_free_tier.py や構成に影響しない
  - `tests/unit/build.devtools.test.ts`: build:cloudflare と同じ環境(NODE_ENV=production)で vite build し、出た JS に写し・名乗り・写しの道・近道の印が 1 つも無い。VITE_DEVTOOLS=1 の受入のビルドには 4 つとも入る(空振りしていない)
  - `main.ts` は `import.meta.env.DEV || VITE_DEVTOOLS === '1'` のときだけ `src/dev/session` を動的に読む。wrangler.jsonc・check_free_tier.py・policy は変えていない。受入のビルドは `pnpm run build:acceptance`・`dev:acceptance`(package.json)
- [x] 受入の画面(.claude/acceptance)の使い方を、画面の「始める前に」と docs/operations に書く
  - `docs/operations/acceptance.md`(8b27224)。受入の画面(git の外)の server.mjs・index.html(状態 id の欄)・items.json(「始める前に」)の新しい版は作業ログを見る
- [x] pnpm run check・E2E が通り、evidence に commit SHA とテストファイルを記す
  - 作業ログ「確かめ」

## 作業ログ

### 形(2026-09-27)

- 開発用の手段は `src/dev/` に集め、`main.ts` からは `devSessionOf(URL)` の返す 1 つの値(`dbName`・`player`・`speeds`・`scenarioDef`・`shortcut`・`mount`)だけを見る。本番のビルドでは動的 import ごと消える。
- 近道は runner に「判定を強いる」口を足さず、石板の定義を差し替える。判定は本物の judge が年の境目で出すので、stepByYear の刻みも年代記の記録もそのまま。
- 送り手の差し替えは Worker が受けた Host を見る。Cloudflare の網は Host で Worker を選ぶので、本番の Worker に loopback の Host の要求は届かない。secret や env の切り替えを足さずに済む。
- 状態の写しは IndexedDB の 1 つの DB の全 store を鍵と値のまま写す(store を足しても写しの形は変わらない)。流し込みは `restoreDb` 1 つで、Playwright には `toString` で渡す。

### 受入の画面(git の外)

`.claude/acceptance` は git の外で、worktree の agent からは書き換えられなかった。新しい版を agent の scratchpad の `m19-16/acceptance/` に置いた(server.mjs・index.html・items.json・snapshots.ts)。`snapshots.ts` は `tools/acceptance-snapshots.ts` の写しで、`.claude/acceptance/snapshots.ts` にはもう置いてある。

- server.mjs: `/api/snapshots` の道を足し、判定に `snapshot`(状態 id)を持たせる
- index.html: 各項目のメモの下に「状態 id」の欄と「写しを見る」のリンク
- items.json: 「始める前に」に 5 行(受入のビルド・状態の送り方・見守り手・近道と 1000x・手順書)
- 手元で PORT=5399 に立て、POST → id・判定の snapshot の保存・index の 200 を確かめた。置き換えたら :5392 のサーバーを立て直す

### 確かめ

- `pnpm run check`(bae580a): typecheck・eslint・ruff・vitest 106 ファイル 1017 件・worker 5 ファイル 66 件・scripts 42 件、すべて通る。1 回目は E2E と並べて回し、`world.civilization.prayer.test.ts` の儀式の 1 件が既定の 5 秒を越えて落ちた(feat/m21 の 18a3ff1 で timeout を延ばしたものと同じ。M19-16 は触れていない)。単独で回し直して通った
- E2E(`E2E_PORT=5251 --workers=1`、bae580a): 52 件中 51 件通る。落ちた `harbor.spec.ts:330`(M19-14 の直し)は単独で回すと通る。機械の load average が 20〜47(10 コア、ほかの agent の Chromium)で、出港の知らせの既定 5 秒を越えた。並べて回したときは harbor.spec の 127・144 も同じ形で落ちた。127・144 は feat/m19(baa07d5)の worktree でも M19-16 の worktree でも、単独なら通る
- Cloudflare の E2E(`E2E_PORT=8796 pnpm run test:e2e:cloudflare`、bae580a): 6 件すべて通る。うち M19-16 の「手元の 3 人の見守り手」は本番のビルド(開発用の手段の無いもの)を wrangler dev に配り、3 つの context が `x-dev-sender` を名乗る
- 既存コメントの削除なし: `git diff feat/m19...HEAD -U0 | grep -E '^-\s*(//|\*|/\*)'` は空
- 途中で、前の回の vite dev(5231)が残って `reuseExistingServer` に拾われ、harbor.spec が落ち続けた。止めて別のポートで回し直した
