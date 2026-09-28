# 受入の確かめの手順 (M19-16)

受入の画面 (`.claude/acceptance`、http://localhost:5392) で人が確かめた状態を、AI がテストで同じに再現するための手段。
どれも開発・受入のビルドだけにあり、本番のビルド (`pnpm run build:cloudflare`) には入らない。
入らないことは `tests/unit/build.devtools.test.ts` が本番と同じ環境で vite build して確かめる。

## 手順書の正本 (M21-06)

受入の手順の正本は `docs/acceptance/scenarios.jsonl` (Gherkin の 1 シナリオが 1 行、id は `HBR-004` の形)。
受入の画面の `items.json` は正本から作る。手で書かない (`base` もコマンドが wrangler.jsonc から決める)。

```sh
pnpm run dev:acceptance                           # 港つきの受入のビルド (別の端末)
pnpm run acceptance:page                          # 人の 1 周 (TUR-*) の items.json を書く。書く前に画面の origin を GET する
pnpm run acceptance:page -- --when deploy         # 配ったあとの本番 (OPS-*)
uv run scripts/acceptance.py feature              # Gherkin の文で読む
uv run scripts/acceptance.py next HBR             # 行を足すときの次の id
```

人が判じるのは mode が human の行だけで、1 回 15 分まで (待ちを含む)。複数の見守り手・2 つの島・閉港・成功までの待ち・組み合わせは auto の行で、covered_by の自動の試験が見る。
行は消さず、要らなくなったら `status: "retired"` にする。設計は docs/design/2026-09-29-acceptance-redesign.md。

## 画面の立て方

| 用途 | コマンド | 港 |
| --- | --- | --- |
| 港つきで受入 | `pnpm run dev:acceptance` (`VITE_DEVTOOLS=1` でビルドして wrangler dev) | ローカルの D1 |
| 港なしで手早く | `pnpm run dev` (vite。開発のビルドなので手段は常に入る) | 閉港 |
| 本番と同じ | `pnpm run dev:cloudflare` | 手段は入らない |

受入の画面のサーバーは `node .claude/acceptance/server.mjs`。
`.claude/acceptance` は git の外なので、状態の写しの道は `tools/acceptance-snapshots.ts` を `.claude/acceptance/snapshots.ts` に写して使う (node 24 は .ts をそのまま読む)。
`tools/acceptance-snapshots.ts` を直したら写し直し、サーバーを立て直す。

## URL の指定

| 指定 | 効き目 |
| --- | --- |
| `dev=1` | 右下に「開発」の板を出す。速さの札に 1000x を足す |
| `player=<名前>` | 別の見守り手になる。名前は英数字と `_` `-` で 24 字まで。読めない名前は無視する |
| `shortcut=alive` | 近道の島。石板の判定を次の年の境目で alive にする |
| `acceptance=<URL>` | 状態の写しの送り先 (既定 http://localhost:5392)。手元の http の URL だけ受ける |

## 人がすること

1. 確かめたい画面の URL に `dev=1` を足して開く。
2. 気になる状態になったら、板の「状態を受入の画面へ送る」を押す。
3. 出た id (`s-20260927-050607-ab12` の形) を、受入の画面のその項目の「状態 id」に貼る。

別の人として試すときは、タブごとに `player=a`・`player=b`・`player=c` を付ける。
手元の保存・年代記・outbox・取り下げ鍵・控え (IndexedDB) は名前ごとの DB (`biotope-island@<名前>`) に分かれる。
港への要求には `x-dev-sender: <名前>` が付き、wrangler dev (loopback の host) の港はそれを送り手の IP の代わりに数える。
本番の港は Host が loopback にならないので、この header を読まない (`worker/test/harbor.test.ts` の M19-16 の 2 件)。

石板を成功まで早く見たいときは、板の「近道: 次の年の境目で alive にする」を押す。
今の島の続きから開き直し、次の年の境目で「島は生き延びた」になる。
近道の判定は港へ出さない (出港の板・回避率・空の舟の積荷のどれも出ない)。偽の Alive が港に並ばないため。

## AI がすること

受入の画面の `results.json` の各項目の `snapshot` が状態 id。
写しは `.claude/acceptance/snapshots/<id>.json` にあり、`GET http://localhost:5392/api/snapshots/<id>` でも読める。

写しの中身 (`src/dev/snapshot.ts` の `DevSnapshot`):

- `url`: 送ったときの画面の道。
- `player`: 見守り手の名前。
- `db`: IndexedDB の 1 つの DB の全 store (saves・slots・chronicles・outbox・keys・scenarios・marks・finished) の鍵と値。
- `current`: 送る直前の島の SaveData と、石板なら年代記。

再現は `tests/fixtures/devSnapshot.ts` を使う。

```ts
import { openSnapshot, readSnapshot } from '../fixtures/devSnapshot';

// E2E: page の origin の IndexedDB に流し込み、送ったときの道を開く
const snap = readSnapshot('s-20260927-050607-ab12');
await openSnapshot(page, snap);

// 単体: 島だけなら World.restore、置き場ごとなら fake-indexeddb に restoreDb
World.restore(snap.current.save, { log });
await restoreDb(new IDBFactory(), snap.db);
```

worktree から読むときは `ACCEPTANCE_DIR` に本体の `.claude/acceptance` を渡す。
写しには手元の取り下げ鍵が入る。リポジトリに入れない (`.gitignore` が `.claude/acceptance/snapshots/` を外す)。

## 1000x と決定論

1000x は 1 秒に 1000 tick を求めるが、runner は 1 フレームに 200 tick まで進め、残りを持ち越さない。
60 fps なら 1 フレーム 16〜17 tick で上限に当たらず、フレームが遅れたときだけ 200 tick で止まる。
石板の島は `stepByYear` が年の境目で刻むので、速度とフレームの間隔に依らず結末が同じになる。
`tests/unit/scenario.determinism.test.ts` が 1x・10x・100x・1000x の 4 通りで確かめる。
