---
id: M20-03
title: README と LICENSE
status: todo
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: [M20-01]
evidence: []
---

# README と LICENSE

## What to build

初めて来た人が、何のプロジェクトか、どう動かすか、どこに設計があるかを README だけで分かる状態にし、ライセンスを付ける。現状の README はフォルダ構成だけ。

## Blocked by

M20-01

## Acceptance criteria

- [ ] README: 概要(1 段落)、スクリーンショット 1 枚、動かし方(npm install / dev / build / test / test:slow / E2E)、シナリオの遊び方(?scenario=、石板、星の力)、設計書・企画書・世界観・チケットへの導線、開発の流れ(issues/ とマイルストーン)、ライセンスと第三者素材の節
- [ ] LICENSE ファイル(ユーザーが選ぶ。推奨 MIT。年と権利者表記の書き方はユーザーに確認)。package.json の license 欄を合わせる
- [ ] 第三者ライセンスの整理: Three.js(MIT)、simplex-noise、Vite/Vitest/Playwright は依存として明記。Gemini で生成した概念画・参照画像とそれを元にした 3D モデルの扱い(公開する/しない、生成物である旨)を README に書く
- [ ] docs/README や references/README との重複を整理し、リンク切れが無い(スクリプトか手動で確認)
- [ ] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

