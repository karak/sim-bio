---
id: M20-04
title: GitHub に public リポジトリを作成して公開
status: done
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: [M20-02, M20-03]
evidence: ["01b21fe .github/workflows/ci.yml README.md", "https://github.com/karak/sim-bio/actions/runs/35551680607 (CI success)"]
---

# GitHub に public リポジトリを作成して公開

## What to build

作り直した履歴を GitHub の public リポジトリとして公開し、URL を README と企画書に載せる。

## Blocked by

M20-02, M20-03

## Acceptance criteria

- [x] GitHub 上にリポジトリを作成(karak/sim-bio、public)、remote origin を設定して main を push。URL は README と企画書に記載
- [x] push 前に `git grep` の秘密情報検索を再実行。実データ 0 件(監査文書内の検索パターン `/Users/` の 3 行のみ)
- [x] CI(`.github/workflows/ci.yml`: LFS checkout、npm ci、npm run check、Playwright chromium + E2E)が通る。test:slow は CI では走らせない(README に明記)
- [x] 説明文・トピック(threejs, typescript, simulation, ecosystem, game, vite)・既定ブランチ main を設定。Issues の扱いを README に記載
- [x] 公開後に別のクローン(`git clone https://github.com/karak/sim-bio`)で npm install → npm run check(213 件)が通り、PNG が LFS から実体で落ちる(971KB)ことを確認
- [x] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

- 2026-09-20 決定: リポジトリ名 sim-bio(仮称)。LFS を有効にして push(Uploading LFS objects を確認)。

### 2026-09-21 実施

- `gh repo create sim-bio --public --source=. --remote=origin`(書き換え後のクローンから)→ https://github.com/karak/sim-bio 。`git push -u origin main` で `Uploading LFS objects: 100% (35/35), 19 MB` を確認。公開したブランチは main のみ(feat/*、wip/* は手元に残す)。
- GitHub 上の commit author: `gh api repos/karak/sim-bio/commits --jq '.[].commit.author.email'` → `156341+karak@users.noreply.github.com` のみ。既定ブランチ main。
- CI: 初回(01b21fe)は 2 コアのランナーで `data.test.ts` の 20 年(82 秒 > 60 秒)と `world.trophic` の乾燥気候(6.7 秒 > 5 秒)がタイムアウト。長い単体テストの上限を 180〜300 秒に引き上げて再 push → success(https://github.com/karak/sim-bio/actions/runs/35551680607)。
- 別クローンでの確認: `git clone` → `git lfs ls-files` 26 件、`assets/textures/concept/deer-angular.png` 971,461 bytes(実体)、`npm install && npm run check` 213 件通過。
- 企画書に公開リポジトリの一節を追加。

