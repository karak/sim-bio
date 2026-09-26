---
id: M19-13
title: パッケージ管理を npm から pnpm へ移す(worktree ごとの node_modules)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-04, M19-05]
evidence:
  - "671c386 build: パッケージ管理を npm から pnpm 10.28.1 へ移す(pnpm import の lockfile、pnpm-workspace.yaml で worker を束ね、CI 2 本と README を pnpm に)"
  - "files: pnpm-lock.yaml, pnpm-workspace.yaml, package.json, playwright.config.ts, .github/workflows/ci.yml, .github/workflows/deploy.yml, README.md"
  - "tests(新しいテストは無し。移行の前後で同じ組を回した): tests/unit (91 files), worker/test/logs.test.ts, tests/e2e/*.spec.ts, tests/e2e-cloudflare/harbor.spec.ts"
---

# パッケージ管理を npm から pnpm へ移す(worktree ごとの node_modules)

## What to build

今は npm(`package-lock.json`、CI は `npm ci`)で入れている。agent の worktree は親の node_modules(141 MB)へのシンボリックリンクを共有している。
2026-09-26 12:34 に、M19-05 の agent がリンク越しに `fake-indexeddb` を入れ、親の node_modules が `package-lock.json` とずれた。依存の入れ替えや削除は全部の worktree に波及する。M19 では wrangler や `@cloudflare/vitest-pool-workers` を足すので、危うさが増す。

ユーザーの指示(2026-09-26 12:42、原文):「移行を別チケットで進めて」

pnpm に移し、worktree ごとに `pnpm install --frozen-lockfile` で自分の node_modules を持たせる。pnpm は store からハードリンクで配るので、速く、容量もほとんど増えない。

- `pnpm import` で `package-lock.json` から `pnpm-lock.yaml` を作り、`package-lock.json` を消す。
- `package.json` に `packageManager`(pnpm 10.28.1)を書く。corepack を使うか決める。
- store をプロジェクトと同じ外付けのディスクに置く(ハードリンクは同じ filesystem の中でしか効かない)。`.npmrc` の `store-dir` か、pnpm の既定を調べて決める。
- vite・vitest・playwright・eslint・tsc が pnpm の厳格な node_modules(巻き上げ無し)で動くかを確かめる。足りない依存は明示する。`shamefully-hoist` は最後の手段にする。
- CI(`.github/workflows/ci.yml`)を `pnpm/action-setup` と `pnpm install --frozen-lockfile` にする。
- 手順書を直す: agent に張らせていた node_modules の symlink をやめ、worktree で `pnpm install --frozen-lockfile` を実行する。対象は README、メモリの運用、引き継ぎ。
- 親の `node_modules/node_modules`(移設前の `/Users/yasushi/projects/game-demo/node_modules` を指す壊れたリンク)を片づける。→ 2026-09-26 12:42 にユーザーの許可で消した(済み)

## Blocked by

M19-04, M19-05(動いている agent と node_modules が重ならないよう、両方の取り込みの後)

## Acceptance criteria

- [x] `pnpm install --frozen-lockfile` で入り、typecheck・lint・vitest の通し・`npx playwright test` の全 E2E が npm の時と同じ結果になる(件数を記す)
  - lockfile の中身: `pnpm import` の後、`package-lock.json` と `pnpm-lock.yaml` の「名前@版」の組を突き合わせた。どちらも 272 件で、片方だけにあるものは 0 件(版の解決は npm の時と同じ)
  - `pnpm run check`(671c386 の内容): `tsc --noEmit`・`tsc --noEmit -p worker`・`wrangler types --check`(✨ up to date)・`eslint .` が通過。単体 **830 件**(91 files、vitest 5.0.1)、worker **20 件**(`worker/test/logs.test.ts`、vitest 4.1.11 と `@cloudflare/vitest-plugin`、workerd の中)。本体と worker で別の vitest が効いていることを `RUN v5.0.1` / `RUN v4.1.11` の行で確かめた
  - `E2E_PORT=5413 pnpm exec playwright test`: **37 件**通過(2.2 分)。webServer の `pnpm run dev --port 5413 --strictPort` が 5413 で立ったので、引数も届いている
  - `E2E_PORT=8813 pnpm run test:e2e:cloudflare`: vite build と wrangler dev(`node_modules/.bin/wrangler`)が動き、**3 件**通過
  - feat/m19(ffd35e1、npm)の数は 単体 830・worker 20・E2E 37 で、同じ
  - 厳格な node_modules で足りない依存は無かった。`shamefully-hoist` も `.npmrc` も使っていない
- [x] 新しい worktree で `pnpm install --frozen-lockfile` にかかる時間と、増えた容量を測って記す(ハードリンクが効いていること)
  - 一時の worktree(`.claude/worktrees/m19-13-measure`、671c386 を detach)で測り、測ったあと `git worktree remove` で消した。store は温まった状態(この worktree で先に 1 回入れた後)
  - 時間: **4.6 秒**(`Done in 4.5s`。esbuild・workerd の postinstall を含む)
  - 容量: `du` で node_modules の見かけは 356 MB(364,840 KB)。store と一緒に `du` に渡すと(同じ inode は 1 度しか数えない)、新しい node_modules だけの分は **7.2 MB**(7,380 KB)。`df` の使用量の差も 7.4 MB(7,544 KB)
  - ハードリンク: `node_modules/.pnpm` のファイル 8,516 件のうち 8,441 件はリンク数 2 以上(store と共有)。例: `three/build/three.module.js` はリンク数 3(store・この worktree・一時の worktree)
  - store: `pnpm store path` は `/Volumes/Mac external HDD/.pnpm-store/v10`。repo と同じボリュームで、repo の外
- [ ] CI が pnpm で通る(ワークフローの変更。push はユーザーの許可を得てから)
  - ワークフローは直した(671c386)。`ci.yml`・`deploy.yml` とも `pnpm/action-setup@v6`(版は `packageManager` から読む)→ `actions/setup-node@v4`(`cache: pnpm`)→ `pnpm install --frozen-lockfile`。続く手順は `pnpm run check`・`pnpm exec playwright install --with-deps chromium`・`pnpm exec playwright test`・`pnpm run test:e2e:cloudflare`、deploy は `pnpm run build:cloudflare`・`pnpm exec wrangler deploy`
  - YAML として読めることは確かめた(`ruby -ryaml`)。**CI の実行は、push がユーザーの許可待ち**
- [x] `package-lock.json` が消え、`pnpm-lock.yaml` だけになる。`packageManager` が書いてある
  - 671c386: `package-lock.json` を削除、`pnpm-lock.yaml`(lockfileVersion 9.0)を追加、`package.json` に `"packageManager": "pnpm@10.28.1"`。npm の `workspaces` は `pnpm-workspace.yaml` の `packages: [worker]` に置き換えた
- [x] 手順書(README・運用の手順)が pnpm になり、symlink の手順が消えている
  - README「動かし方」「Cloudflare へ配る」とフォルダ構成の表を pnpm に。worktree ごとに `pnpm install --frozen-lockfile` を実行し、ほかの checkout の node_modules へ symlink を張らない、と書いた。`pnpm run` に `--` を挟まないことも書いた
  - repo の中に symlink の手順は無かった。残っているのはメモリ(`feedback-remove-merged-worktrees.md` の How to apply)と引き継ぎ(`.claude/handoff-2026-09-25.md`、未追跡)で、どちらも repo の外なので親が直す
  - `docs/operations/` は feat/m19 には無い(feat/m21 の 679e222 で入った)。feat/m21 の `docs/operations/readme-screenshots.md` 8 行目の `npm run dev` は、両方を合わせるときに `pnpm run dev` にする
  - `issues/README.md` に npm の手順は無かった
- [x] evidence に commit SHA とテストファイルを記す(frontmatter の evidence)

## 作業ログ

### 移行(2026-09-26、M19-13 の担当)

- 基点: worktree を `git merge --ff-only feat/m19` で ffd35e1 に上げてから始めた(`git merge-base HEAD feat/m19` = ffd35e1)。
- docs(context7、pnpm.io と pnpm/action-setup の README)で確かめたこと:
  - store の既定: 「install するディスクに home があればその中、無ければそのディスクの根の `.pnpm-store`」。別のディスクの store を指すとハードリンクでなく写しになる。
  - `pnpm/action-setup` の今の版は v6。`version` を省くと `packageManager` を読む。`actions/setup-node` の `cache: pnpm` は pnpm が PATH にある必要があるので、action-setup を先に置く。
  - pnpm 10 は依存の install スクリプトを既定で止める。許すものは `pnpm-workspace.yaml` の `onlyBuiltDependencies` に書く(pnpm 11 では `allowBuilds` に替わる。上げるときに書き換える)。
  - 今の docs は pnpm 11・12 のもので、`pnpm/setup@v2` も勧めている。この repo は 10.28.1 に固定するので、10 で動く action-setup を使った。
- store の場所: repo の `.npmrc` に `store-dir` は書かない。既定のままで `/Volumes/Mac external HDD/.pnpm-store`(repo と同じボリューム、repo の外)になる。repo は公開で CI(Linux)でも使うので、絶対パスを repo の設定に書くと CI やほかの機械で壊れる。この機械で固定したくなったら、repo ではなく利用者の設定(`pnpm config set store-dir <path> --location global`)に書く。
- corepack は使わない。手元は nvm で入れた pnpm 10.28.1、CI は action-setup が `packageManager` を読んで同じ版を入れる。pnpm は 12.6.0 への更新を勧めてくるが、このチケットでは上げない。
- install スクリプト: 最初の install で esbuild@0.28.1 と workerd@1.20260925.1 の postinstall が止められた。npm の時は走っていたので、この 2 つだけを `onlyBuiltDependencies` に書いた。
- scripts: `npm run test -w worker` は npm の workspaces が無いと動かないので `pnpm --filter ./worker test` に。ほかの `npm run` も `pnpm run` に揃えた(パッケージ管理を 1 つにする)。
- playwright の webServer: `npm run dev -- --port` をそのまま `pnpm run dev -- --port` にすると壊れる。pnpm は `--` もそのまま script へ渡す(scratchpad の小さな package.json で `pnpm run a -- --port 1` を回すと、script の行が `node -e … -- --port 1 --strictPort` になった)。vite は `--` の後ろを option として読まない(`node_modules/.bin/vite -- --port 5419 --strictPort` は 5419 でなく 5173 で立った)。そこで `--` を外して `pnpm run dev --port ${port} --strictPort` にした。E2E が E2E_PORT で立ったことで確かめた。
- `tools/*.ts` のコメントにある `npm run bench:observe -- --out …` は、pnpm で `--` 付きのまま回しても動く(引数は `indexOf('--out')` と `startsWith('-')` で読むので、`--` は無視される)。
- 既存コメントは消していない。`ci.yml` の「通し実行 (npm run test:slow、…)」と `playwright.cloudflare.config.ts` の「npm run test:e2e:cloudflare から回す」は npm の書き方のまま残した(直すならユーザーの指示で)。`npm run` はパッケージ管理によらず scripts を回せるので、書いてあるとおりに打っても動く。
- 過去の記録(docs/specs、docs/design/qa、閉じたチケット)の `npm run` は、その時の記録なので直していない。

### レビュー(thermo-nuclear、自分で)

- 見たこと: 抽象の足し過ぎ・分岐・層の置き場所。変更は設定と手順書だけで、コードの分岐は増えていない。
- 指摘 1(直した): README に store の絶対パス(この機械の外付けのディスク)を書いていた。公開の README に機械ごとの値を置くと、ほかの人には誤りになる。「home の無いディスクでは、そのディスクの根に `.pnpm-store`」という規則だけを書き、この機械の値はこのチケットに置いた。
- 指摘 2(見送り): `ci.yml` と `deploy.yml` で setup の 4 手順が重なっている。composite action にまとめると呼び手 2 つのために層が 1 つ増える。npm の時から同じ重なりで、このチケットは道具の置き換えに留める。
- 指摘 3(見送り): playwright の webServer から pnpm を外し `vite --port …` を直に呼べば `--` の罠そのものが消える。ただ `dev` の script を 1 か所の正とする今の形を崩すので、`--` を外すだけにした。
- 指摘 4(残る): コメントの中の `npm run`(上記)。コメントはユーザーの指示が無いと直せない。

### 親が取り込んだあとにすること

- 親の checkout で `rm -rf node_modules worker/node_modules` → `pnpm install --frozen-lockfile`(npm の node_modules は pnpm の構成と違うので、入れ直す)。
- 動いている agent の worktree で親の node_modules へ symlink を張っているものは、その agent が終わってから外す。新しい worktree では `pnpm install --frozen-lockfile`。
- メモリ `feedback-remove-merged-worktrees.md` の「node_modules の symlink は先に rm で外し」と、引き継ぎの手順を pnpm の形に直す。
- CI を回すには push が要る(ユーザーの許可待ち)。
