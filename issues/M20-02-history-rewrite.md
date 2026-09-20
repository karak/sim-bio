---
id: M20-02
title: 履歴の作り直し(ブランチの全マージと再作成)
status: todo
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

- [ ] 作業前に `git bundle create` でバックアップを作り、復元手順を作業ログに書く
- [ ] wip/m8-06-tower-rebalance と worktree-concept-art-variants を含め、残す成果はすべて main に取り込む(取り込まないものはユーザーに確認してから捨てる)
- [ ] 作り直した履歴で `git log --all --format='%ae' | sort -u` に個人メールが無い
- [ ] 作り直した履歴に概念画 PNG が無く、.git のサイズを作業ログに記す(現状 23MB)
- [ ] 作り直し後に npm run check、E2E、npm run test:slow が通る
- [ ] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

- 2026-09-20 決定: filter-repo で author を noreply に書き換え(squash しない)。生成画像も含めて公開し、PNG を LFS 化する(既存履歴の PNG を LFS に移すには filter-repo の --path-based LFS 変換または `git lfs migrate import --include='assets/textures/**/*.png' --everything` を使う)。実施は M8 の全ブランチ統合後。
