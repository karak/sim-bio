---
name: verify-biotope
description: biotope-island (生態系の箱庭。Vite の本体 index.html・観察画面 observe.html・Cloudflare Worker の港) を本物で動かして証拠を取る手順。変更が効いていることを証すとき、票の受入基準の証跡を作るとき、審査台や受入の画面に出す画を撮るときに使う。層 A (機械が決める)・層 B (LLM の採点)・層 C (人の審査) を分けて、どこまでが自動でどこから人かを先に言う。
---

# verify-biotope

対象は 3 つの面。本体 (`/`、島を回す・放流・石板の判定・保存・港)、観察画面 (`/observe.html`、3D の絵と性能)、港の Worker (`/api/v1/*`、D1)。
証拠は 3 つの層に分ける。**層が違えば「通った」の意味が違う**ので、報告では層を名指す。

| 層 | 誰が決めるか | 道具 | 「通った」の意味 |
|---|---|---|---|
| A 機械 | 決定論の試験 | `pnpm run check`、`pnpm run test:e2e`、lens・基準画 (`pnpm run shots`)、`bench:observe`、`check:free-tier` | 同じ入力で毎回同じ。CI でも回る (基準画の比べは Mac だけ) |
| B LLM の採点 | `claude -p` の 3 票の多数決 | `pnpm run judge` | 揺れと費用 (1 回 0.01〜0.03 USD) がある。fail・undecided は人が見直す。画素の基準を持つ画は 3 票 yes でも合格を書かない |
| C 人の審査 | ユーザー | 審査台 (`.claude/localreview`、5390)、受入の画面 (`.claude/acceptance`、5392) | 人が押すまで未確定。agent は材料 (前後の画・候補・票) を並べるだけ。**既存のコメント・既存の文書の文・`docs/acceptance/scenarios.jsonl` の書き換えもここ** (承認制) |

作業の順は A → B → C。A で落ちているものを B・C に出さない。C は agent が全部終わってから 1 回だけ案内する。

## Launch

Playwright の E2E は `playwright.config.ts` の `webServer` が Vite を自分で立てる (`pnpm run dev --port $E2E_PORT --strictPort`、既定 5181、`reuseExistingServer: true`)。
**worktree ごとに `E2E_PORT` をずらす**。ずらさないと別の worktree の dev サーバーを拾い、古いコードを試す。

```sh
# 層 A の E2E (サーバーは Playwright が立てて畳む)
E2E_PORT=5187 pnpm exec playwright test tests/e2e/smoke.spec.ts --reporter=line

# 手で触る・画を撮る (本体と観察画面。港は閉港)
pnpm run dev --port 5187 --strictPort        # ready: 標準出力に "Local:   http://localhost:5187/"

# 港つき (ローカルの D1 に migration を当ててから wrangler dev。受入の画面と組む)
pnpm run dev:acceptance                      # ready: "Ready on http://localhost:8787"。VITE_DEVTOOLS=1 で開発の板が入る
pnpm run dev:cloudflare                      # 本番と同じビルド (開発の板は入らない)

# 層 C の板
(cd .claude/localreview && nohup node server.mjs >> server.log 2>&1 &)   # 審査台 http://127.0.0.1:5390
(cd .claude/acceptance && node server.mjs &)                               # 受入の画面 http://localhost:5392
```

空のデータから使える状態になる条件: `pnpm install --frozen-lockfile` 済み (worktree は本体の `node_modules` の symlink が古いことがある)、`pnpm run d1:local` が通る (港つきのとき)。seed は要らない (島は `?seed=` と `assets/data/world.default.json` から決定論で作る)。
畳み方は **Cleanup**。

## Doctor

```sh
.claude/skills/verify-biotope/scripts/doctor.sh [E2E_PORT]
```

読むだけ。出すもの: worktree と HEAD、`node_modules` と Playwright の Chromium の有無、`E2E_PORT` を誰が持っているか (別の worktree の Vite なら赤)、審査台と受入の画面が応えるか、`claude -p` が呼べるか (層 B)、`uv` の有無 (scripts)。1 つでも赤なら、その層の証拠は作らない。

## Drive

手がかりは **id と aria-label** を使う (座標は `#scene` の中のクリックだけ)。`tests/driver/*.ts` が本物の入口で、台本の直書きは単体テストが落とす (`spawnClick` は UI と同じ `src/simulation/commands.ts`)。

| したいこと | 手段 (この repo の実物) |
|---|---|
| 島を回す | `page.click('#speed-100')` → `#hud-year` が `Year 0` でなくなる。tick で止めるなら `advanceTo(page, tick)` (`tests/driver/island.ts`、`__probe` 経由) |
| 放流 | `#spawn-<種>` を押して `.armed`、`#scene` の中を `page.mouse.click`。ログ `cmd.received` の `spawn_species` で確かめ、`cmd.rejected` が 0 |
| 層を切り替える | `#layer-temperature`・`#layer-crystal` → `.on` |
| 石板を判定まで | `playToVerdict(page, '/?scenario=test-ship&dev=1', { speed: 1000, timeoutMs })` (`tests/driver/verdict.ts`)。近道は `?shortcut=alive` |
| 港 | E2E は `routeHarbor(page)` (`tests/driver/harbor.ts`、`tests/fixtures/fakeHarbor.ts`) で `/api/v1/*` を決定論に答える。本物の港は `dev:acceptance` の D1 (別の人は `?player=a`) |
| 観察画面 | `enterObserve(page)`・`lookFrom(page, '集落' \| '群れ' \| '海岸')` (`tests/driver/observe.ts`)。性能は `__probe.observe.stats()` |
| 画面の時計を止める | `installFrames(page)` を goto の前、`stepFrames(page, n)` (`tests/driver/frames.ts`)。撮る画は `reducedMotion: 'reduce'` と `?paused=1` |
| 人が見た状態の再現 | 受入の画面の状態 id → `readSnapshot(id)`・`openSnapshot(page, snap)` (`tests/fixtures/devSnapshot.ts`、`ACCEPTANCE_DIR` に本体の `.claude/acceptance`) |
| 草木の寄り | `node tools/flora-shots.ts --url http://127.0.0.1:<port> --out <dir> --prefix before-` を変更の前後のコミットで |
| 性能 | `npm run bench:observe -- --out <before.json>` → `npm run bench:observe:compare <前> <後>` (Apple M4、1280×720。fps は Vite を立てた直後は低く出る。三角形と draw call を主に見る) |

選択子の正本は `tests/e2e/*.spec.ts`。知らない要素は spec を grep してから使う。

## Evidence

置き場は `.claude/verify/<YYYYMMDD-HHMM>-<題>/` (git の外。Cleanup は消さない)。helper `scripts/run-e2e.sh` がここに Playwright の JSON の報告・失敗の画と trace・使ったポートと HEAD を書く。

証拠の決まり:
- **人の道を通す**。`__probe`・`?dev=1`・近道は「止める・進める・状態を読む」だけに使い、結果を作るのに使わない (近道の判定は港へ出ない、と製品が決めている)。
- **操作と結果の両方**。押した後の DOM の文 (`toHaveText`) と、副作用 (構造化ログ `event` の行、IndexedDB の store、港なら D1 の行、ファイル保存なら `download`) を一緒に取る。
- **偽物は境界だけ**。港は `page.route()` の写し (本番の境界)、Turnstile は `fakeTurnstile`。本体の中の関数を差し替えない。
- **画は内容を確かめてから撮る** (`shots.spec.ts` の流儀: 文は `toHaveText`、3D の印は `selection().view`)。
- **数は限界を言う**。bench の数は 1 回で 5% ほど揺れる。前後は同じ条件で取り、差が揺れの内なら「同じ」と書く。
- **層 B** の結果は `judge.json` (受入の画面の置き場) と標準出力。`--image` の試しは記録に書かないので、標準出力を証拠の置き場に写す。
- **層 C** の結果は `.claude/localreview/verdicts.json` と `tickets/answers.json`。票には回の名前 (`m22-11-flora-20261017-1436` の形) と日付を書く。

## Cleanup

```sh
.claude/skills/verify-biotope/scripts/cleanup.sh <証拠の置き場>
```

`run-e2e.sh` が `pids` に書いた pid だけを止める (名前で kill しない。審査台・受入の画面・ユーザーの Vite は触らない)。証拠の置き場は残す。Playwright が自分で立てたサーバーは Playwright が畳む。
agent の worktree は取り込んだ後に `git worktree remove` と `git branch -d` (merge-base と未コミット無しを確かめてから。自分が作ったものだけ)。

## Helpers

| helper | 使い方 |
|---|---|
| `scripts/doctor.sh [E2E_PORT]` | 読むだけの点検。終了コード 1 なら赤がある |
| `scripts/run-e2e.sh <題> [spec...]` | 空いたポートで Playwright を回し、`.claude/verify/<日時>-<題>/` に報告 (`report.json`)・失敗の trace・`meta.txt` (HEAD・ポート)・`pids` を書く。spec を省くと全部 |
| `scripts/cleanup.sh <置き場>` | `pids` の pid を止める。置き場は残す |

## 層 C に出すときの決まり (このプロジェクトの約束)

- 比較画は審査台の回 (`.claude/localreview/<接頭辞>-<日時>/`) に出し、`items.json` は共有の `groups` に足す。artifact は許可があるまで使わない。
- 既存のコメント・文書の文・`scenarios.jsonl` の書き換えは、file:line・原文・新文・理由を 1 件ずつ板に出す。承認はその回・その対象に限る。承認で変えたらコミットメッセージに「ユーザーの承認」と日付。
- push・PR・merge・配備は、許可があるときだけ。
- 終わったとき・聞くときに `afplay /System/Library/Sounds/Ping.aiff`。

## 機能の地図

`features/README.md`。面ごとの入口・手がかり・証拠の終わりの状態。地図に無い入口を 1 つ通しただけの証拠は不完全。
