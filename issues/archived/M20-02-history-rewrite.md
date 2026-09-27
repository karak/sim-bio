---
id: M20-02
title: 履歴の作り直し(ブランチの全マージと再作成)
status: done
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: [M20-01]
evidence: []
---

# 履歴の作り直し(ブランチの全マージと再作成)

## What to build

author の個人メールと不要な大容量ファイルを履歴から消すため、公開用の履歴を作り直す。方針はユーザーが選ぶ: (a) 全ブランチを main に取り込んだ上で単一コミットに squash して新規リポジトリとして初期化、(b) git filter-repo で author を GitHub の noreply アドレスに書き換え、PNG を履歴から除去。M20-01 の一覧を材料にする。作業前に現状のリポジトリを丸ごとバックアップする。

## Blocked by

M20-01

## Acceptance criteria

- [x] 作業前に `git bundle create` でバックアップを作り、復元手順を作業ログに書く
- [x] wip/m8-06-tower-rebalance と worktree-concept-art-variants を含め、残す成果はすべて main に取り込む(worktree-concept-art-variants は ART-01 で main に統合済み、差分なし。wip/m8-06-tower-rebalance の有用部分は M8-08 で取り込み済みで、ブランチは書き換え後の履歴にも残す。公開するのは main のみ)
- [x] 作り直した履歴で `git log --all --format='%ae' | sort -u` に個人メールが無い(`156341+karak@users.noreply.github.com` の 1 件のみ)
- [x] 作り直した履歴では PNG がすべて LFS ポインタ(35 ファイル)。pack は 17.9MiB → 0.86MiB、.git は 19MB(うち LFS オブジェクト置き場が大半)
- [x] 作り直し後に npm run check(213 件)、E2E(15 件)、npm run test:slow(20 件、3 分割)が通る
- [x] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す(下記)

## 作業ログ

- 2026-09-20 決定: filter-repo で author を noreply に書き換え(squash しない)。生成画像も含めて公開し、PNG を LFS 化する(既存履歴の PNG を LFS に移すには filter-repo の --path-based LFS 変換または `git lfs migrate import --include='assets/textures/**/*.png' --everything` を使う)。実施は M8 の全ブランチ統合後。

### 2026-09-21 実施

- **バックアップ**: `git bundle create ~/projects/backups/game-demo-before-m20-02-20260921-1006.bundle --all`(18.5MB、`git bundle verify` で完全な履歴を確認)。復元手順: `git clone ~/projects/backups/game-demo-before-m20-02-20260921-1006.bundle restored && cd restored && git lfs fetch --all`(LFS オブジェクトは元リポジトリの `.git/lfs` から `git lfs push`/コピーが必要)。元のリポジトリ `~/projects/game-demo` はそのまま残している(書き換えは別クローンで実施)。
- **手順**(fresh clone `git clone --no-local` 上で。`git filter-repo` は worktree のある in-place リポジトリを拒むため):
  1. `git filter-repo --mailmap <karak <156341+karak@users.noreply.github.com> <karak97@gmail.com>> --replace-text <個人メール → noreply、/Users/<home>/projects/game-demo → <repo>、/Users/<home> → <home>、ログイン名 → karak97> --replace-message <個人メール → noreply> --path .claude/worktrees --invert-paths`(誤って gitlink として記録されていた `.claude/worktrees/concept-art-variants` を履歴から除去)。142 コミット、11 ブランチ。
  2. `git lfs migrate import --include='*.png' --everything`(全ブランチ・全履歴の PNG 35 ファイルを LFS 化。`.gitattributes` に `*.png filter=lfs diff=lfs merge=lfs -text` が各コミットに入る)。
  3. `git reflog expire --expire=now --all && git gc --prune=now`。
- **確認**: `git log --all --format='%an <%ae> / %cn <%ce>' | sort -u` → 1 行(noreply)。全コミットの blob を `git grep` して個人メール・ホームパス・ログイン名は 0 件、コミットメッセージも 0 件。`git rev-list --objects --all | git cat-file --batch-check` で 200KB 超の blob は 0 個。`git grep` の秘密情報パターン(`AIza…`/`sk-…`/`ghp_…`/`xox…`/個人メール/`/Users/`)は監査文書内の検索パターンそのもの 3 行のみ(実データなし)。
- **検証**: `npm ci && npm run check`(213 件)、`npm run build && npx playwright test`(15 件)、`SLOW=1 caffeinate -dimsu npx vitest run tests/slow -t …` 3 分割(5 + 11 + 7 = 20 件)すべて通過。
- **残作業**: 手元の `~/projects/game-demo` を書き換え後の履歴に差し替える(M20-04 の push 後に `git fetch origin && git reset --hard origin/main` を各ブランチで行うか、新規クローンに乗り換える)。別セッションの worktree `.claude/worktrees/concept-art-variants` は差し替え前に閉じること。

