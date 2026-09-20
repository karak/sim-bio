---
id: M20-03
title: README と LICENSE
status: done
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: [M20-01]
evidence: ["2991c44 README.md LICENSE"]
---

# README と LICENSE

## What to build

初めて来た人が、何のプロジェクトか、どう動かすか、どこに設計があるかを README だけで分かる状態にし、ライセンスを付ける。現状の README はフォルダ構成だけ。

## Blocked by

M20-01

## Acceptance criteria

- [x] README: 概要(1 段落)、スクリーンショット 1 枚、動かし方(npm install / dev / build / test / test:slow / E2E)、シナリオの遊び方(?scenario=、石板、星の力)、設計書・企画書・世界観・チケットへの導線、開発の流れ(issues/ とマイルストーン)、ライセンスと第三者素材の節
- [x] LICENSE ファイル(ユーザーが選ぶ。推奨 MIT。年と権利者表記の書き方はユーザーに確認)。package.json の license 欄を合わせる
- [x] 第三者ライセンスの整理: Three.js(MIT)、simplex-noise、Vite/Vitest/Playwright は依存として明記。Gemini で生成した概念画・参照画像とそれを元にした 3D モデルの扱い(公開する/しない、生成物である旨)を README に書く
- [x] docs/README や references/README との重複を整理し、リンク切れが無い(スクリプトか手動で確認)
- [x] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

- 2026-09-20 決定: MIT、権利者 karak97、リポジトリ名 sim-bio(仮称)。生成画像・モデルは公開に含める旨を README に書く。
- 2026-09-20 実施: README.md を全面書き直し(概要・スクリーンショット枠・動かし方・遊び方・設計/資料への導線・開発の流れ・3D モデル/コンセプト画・ライセンス・フォルダ構成、127 行)。LICENSE(MIT、Copyright (c) 2026 karak97)を追加。package.json の `license` を `ISC` → `MIT` に変更(`name` は `biotope-island` のままとした。`game-demo` のような明白なプレースホルダーではなく、コード・テストからの参照も無いため変更不要と判断)。
  - 第三者ライセンスは `node_modules/*/package.json` を実地確認して記載: three(MIT)、simplex-noise(MIT)、vite(MIT)、vitest(MIT)、eslint / typescript-eslint(MIT)、`@playwright/test`(Apache-2.0)、typescript(Apache-2.0)。Playwright と TypeScript は MIT ではなく Apache-2.0 だったため、それぞれ正しいライセンス名で記載した。
  - docs/README.md は存在しないため重複整理は不要と確認(`ls docs/` = `decisions design specs`)。references/README.md とは役割が重複しないよう、ルート README からは導線リンクのみとした。
  - リンク切れ確認: `node -e '...'` で README.md 内の Markdown リンク(`](...)`)を抽出し実在確認 → `./LICENSE` の 1 件のみ、`ALL LINKS OK`。加えてバッククォート内のパス参照(`docs/`, `src/`, `tests/`, `tools/`, `assets/`, `references/`, `issues/` 配下)も同様に存在確認 → 意図的なプレースホルダー `docs/design/screenshots/`(スクリーンショット未追加のため)以外はすべて実在を確認。
  - `npm run lint`・`npm run typecheck` とも commit 2991c44 の内容で通過(エラー無し)を確認。`SLOW=1 npx vitest run tests/slow` も参考として実行し 20/20 件通過(869.08s ≒ 約 14.5 分。README に書いた「約 15 分」の裏付け)。
  - commit: `2991c44`(README.md, LICENSE, package.json)。
