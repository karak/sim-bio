---
id: M20-04
title: GitHub に public リポジトリを作成して公開
status: todo
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: [M20-02, M20-03]
evidence: []
---

# GitHub に public リポジトリを作成して公開

## What to build

作り直した履歴を GitHub の public リポジトリとして公開し、URL を README と企画書に載せる。

## Blocked by

M20-02, M20-03

## Acceptance criteria

- [ ] GitHub 上にリポジトリを作成(名前とオーナーはユーザーが決める)、remote origin を設定して main を push。public URL を作業ログと README に記す
- [ ] push 前に GitHub の secret scanning を意識して `git grep` の秘密情報検索を再実行し 0 件
- [ ] Playwright ブラウザ等のセットアップを含む CI(GitHub Actions)で npm run check が通る。test:slow は CI では走らせない(README に明記)
- [ ] リポジトリの説明文・トピック・既定ブランチを設定し、Issues の扱い(issues/ フォルダで管理している旨)を README に書く
- [ ] 公開後に別のクローンで npm install → npm run check が通ることを確認
- [ ] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

