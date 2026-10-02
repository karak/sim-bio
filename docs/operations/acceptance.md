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
pnpm run acceptance:page --when deploy            # 配ったあとの本番 (OPS-*)
uv run scripts/acceptance.py feature              # Gherkin の文で読む
uv run scripts/acceptance.py next HBR             # 行を足すときの次の id
```

人が判じるのは mode が human の行だけで、1 回 15 分まで (待ちを含む)。複数の見守り手・2 つの島・閉港・成功までの待ち・組み合わせは auto の行で、covered_by の自動の試験が見る。
行は消さず、要らなくなったら `status: "retired"` にする。設計は docs/design/2026-09-29-acceptance-redesign.md。

### 人の 1 周は 1 分 (M25-08)

ADR 0001 の段 6。2026-10-02 から、round の human の行は TUR-001 だけで、1 分である。
流れ: `pnpm run acceptance:page` → 受入の画面で TUR-001 を開く → `/?scenario=test-ship&dev=1` で 1000x にして判定の板を出し、取っ手でドラッグして付いてくる手触りを見る → 合否を付ける。
そのほかは機械が見る。3D の絵は OBS-002 (`pnpm run judge`)、読みやすさは HBR-006・CRG-005・CNF-002・SEL-003 (lens と基準画)、順と数と保存は auto の行の自動試験である。
TUR-002 は retired にした (代わりは SEL-003・CRG-005・CNF-002・CNF-001・CRG-002・DEV-001)。行と `from` の旧 id は残すので、results.json にある旧い判定は鍵 (r2-cargo など) で TUR-002 の行に結べる (受入の画面は active の human の行しか出さないので、画面には出ない。今の results.json にこの 4 つの鍵は無い)。

### 手順ごとの checks と judge (M25-05)

steps の【見た目】【読みやすさ】【手触り】の札の付いた手順は、何が判じるかを 3 つ目の要素に持つ。
ADR 0001 の段 4。`uv run scripts/acceptance.py check` は、持たない手順を落とす (active の行はすべて。auto の行も同じ)。

```json
["ならば", "【読みやすさ】板の文が読める", {"checks": [{"lens": "legible", "target": "判定の板の回避率"}]}]
["ならば", "【見た目】島が絵として成り立って見える", {"judge": "human"}]
```

- `checks`: 機械が見る。`lens` は `tests/e2e/lens.ts` の `LENSES` の名前 (今は `legible`)、`target` は shotsOf に渡す要素の名前。知らない lens は check が落とす。lens を足すときは `LENSES` に足す。
- `judge`: `"llm"` か `"human"`。`llm` は `pnpm run judge` (M25-06) が採点する手順、`human` は人が見る手順。
- `checks` と `judge` は両方書いてよい。どちらも無い手順は check が落ちる。札の無い手順には要らない。
- `acceptance:page` の `items.json` は、項目ごとの `marks` (手順・checks・judge) を出す。auto の行の `delegated` にも付く。

### 基準画と更新の手順 (M25-03)

ADR 0001 の段 3。`tests/e2e/shots.spec.ts` は、shotsOf に渡した要素ごとの画 (3D の面は `#scene` を別の画) を、`tests/e2e/baselines/` の基準画と比べる。
auto の行 (HBR-006・CRG-005・CNF-002・SEL-003) も同じに比べる。基準画は Playwright の snapshot の置き場 (`playwright.config.ts` の `snapshotPathTemplate`) で、受入の画面の `shots/` とは別なので、`check_shots` には見えない。
名前は `<ID>-<画の番号>-<要素名>.png`。閾値は `threshold: 0.2`・`maxDiffPixelRatio: 0.02` (`tests/e2e/baseline.ts`)。字だけの細い板は 0.12 (理由はそこのコメント)。

基準画は手元の Mac だけで持つ。CI (`CI` が空でない) と Mac 以外では比べを回さず、lens の検査だけ回す (`shouldCompareBaselines`、`tests/unit/baseline.pure.test.ts`)。
`tests/e2e/baselines/VERSIONS.json` に、撮った Chromium と macOS の版を添える。
比べは `pnpm run shots` (`ACCEPTANCE_DIR` のあるときだけ回る) の中で走り、`updateSnapshots: 'none'` なので基準画を黙って書かない。

```sh
pnpm run shots:update                          # 撮って比べ、前後と差の画を審査台の回 (.claude/localreview/m25-03-<日時>/) に出す。基準画は書き換えない
pnpm run shots:update -- --apply <回の名前>    # 審査台で「合格」にした画だけ基準画に写し、VERSIONS.json を書く
```

1. CSS や文を直して `pnpm run shots` が落ちたら、意図した変わりかを `pnpm run shots:update` で確かめる。回の `items.json` は 1 つの group で、共有の `items.json` の `groups` に足すと審査台に並ぶ (共有の `items.json`・`index.html` は書き換えない)。
2. 審査台で前・後・差の画を見て、意図した変わりだけ「合格」にする。押さない画は基準画のまま。
3. `--apply` は審査台の `verdicts.json` を読み、合格の画だけ写す。`git add tests/e2e/baselines` して、直した CSS と同じコミットに入れる (`*.png` は LFS)。

### LLM の採点 (M25-06)

ADR 0001 の段 5。`pnpm run judge` は、手元の `claude -p` で画を採点表に当てる。鍵は持たず、Claude Code の認証を使う (`--bare` は使わない)。CI では回さない。

```sh
pnpm run judge                                     # 正本の judge が "llm" の手順を、その手順の画に当てる (今は llm の手順が無い)
pnpm run judge -- --step SEL-003/2                 # 任意の手順 (ID/手順の番号) を当てる。正本は変えない
pnpm run judge -- --step SEL-003/2 --image x.png   # 画を指す (仕込んだ欠陥の画を当てるとき)
pnpm run judge -- --dry-run                        # 何を何回呼ぶかだけ出す
```

- 画は、手順の文が「画 N」「画 N〜M」で指す画 (受入の画面の `shots/<ID>-<N>.png`)。指さなければその行の画すべて。
- 問いは `docs/acceptance/rubrics.json` の `<ID>/<手順の番号>` に書く (yes / no の問い)。無ければ手順の文を 1 つの問いにする。
- 1 枚の画に 3 回呼び、問いごとに多数決を取る。3 票とも yes なら yes、3 票とも no なら fail、割れた問い (呼び出しの失敗を含む) は undecided。
- `results.json` には fail と undecided を `{verdict, note, at, by: "llm", llm: {cli, model, cost_usd, steps}}` で書く。合格は、観察画面の画 (画素の基準を持たず、人が承認した同じ場面の画を `docs/acceptance/observe-approved/` に持つ画。OBS-002) だけの手順で 3 票とも yes のときに、同じ形の `verdict: "pass"`・`by: "llm"` で書く。項目が pass になるのは、正本の llm の手順をすべて当ててどれも合格のときだけ。ほかの手順の合格は書かない。人が判定した項目 (`by` が llm でない) は上書きしない。受入の画面は `undecided` を「未判定」と読み、note に LLM の根拠が出る。
- 全部の票と根拠は、受入の画面の置き場の `judge.json` に書く。画素の基準 (`tests/e2e/baselines/`) を持つ画は、3 票とも yes でも `writes_pass: false` (LLM の yes だけでは合格にしない)。
- `--image` で画を替えたとき (仕込んだ欠陥の試し) は、標準出力だけで `results.json` にも `judge.json` にも書かない。呼び出しがすべて失敗した手順 (認証切れ) は記録を書き換えず、終了コード 1 で返る。
- 受入の画面で人が LLM の項目を押す・メモを直すと、画面のサーバーが `by` と `llm` を落として保存する。以後その項目は人の判定として扱い、judge は書き換えない。
- モデルは `--model` (既定 sonnet)。呼び出しは 1 回 5〜10 秒、換算 0.014〜0.023 USD (2026-10-01 の実測。ADR の 10〜14 秒・0.015〜0.033 USD より速く安い)。

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
