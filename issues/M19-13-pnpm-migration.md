---
id: M19-13
title: パッケージ管理を npm から pnpm へ移す(worktree ごとの node_modules)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-04, M19-05]
evidence: []
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
- 親の `node_modules/node_modules`(移設前の `/Users/yasushi/projects/game-demo/node_modules` を指す壊れたリンク)を片づける。

## Blocked by

M19-04, M19-05(動いている agent と node_modules が重ならないよう、両方の取り込みの後)

## Acceptance criteria

- [ ] `pnpm install --frozen-lockfile` で入り、typecheck・lint・vitest の通し・`npx playwright test` の全 E2E が npm の時と同じ結果になる(件数を記す)
- [ ] 新しい worktree で `pnpm install --frozen-lockfile` にかかる時間と、増えた容量を測って記す(ハードリンクが効いていること)
- [ ] CI が pnpm で通る(ワークフローの変更。push はユーザーの許可を得てから)
- [ ] `package-lock.json` が消え、`pnpm-lock.yaml` だけになる。`packageManager` が書いてある
- [ ] 手順書(README・運用の手順)が pnpm になり、symlink の手順が消えている
- [ ] evidence に commit SHA とテストファイルを記す

## 作業ログ
