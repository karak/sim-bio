---
id: M20-01
title: 個人情報・秘密情報の監査と削除
status: in_progress
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: []
evidence: []
---

# 個人情報・秘密情報の監査と削除

## What to build

公開前に、追跡ファイルと全ブランチの履歴から個人を特定できる情報と秘密情報を洗い出し、削除する。2026-09-20 の下見: 全 108 コミットの author が個人メール(156341+karak@users.noreply.github.com)、企画書 HTML に「起案 karak97」、.env は未追跡で履歴にも無し、`.claude/launch.json` が追跡されている、Gemini 生成の概念画 PNG(約 1MB × 9)が履歴に残っている。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 追跡ファイルの全文検索(メールアドレス、氏名・ハンドル、絶対パス /Users/…、API キー形式、社内ドメイン)で該当 0 件。検索コマンドと結果を作業ログに残す
- [ ] 企画書 HTML の起案者表記を匿名化または削除(ユーザーが表記を決める)
- [ ] `.claude/launch.json` を追跡から外すか、公開しても差し支えない内容だと確認して残す(判断を作業ログに)
- [ ] 全ブランチ(main、feat/m1〜m8、wip/*、worktree-concept-art-variants)の履歴に対して同じ検索を行い、author メールと生成画像の扱いを M20-02 の判断材料として一覧化する
- [ ] `.env.example` を追加し、必要な環境変数(GEMINI_API_KEY)の説明だけを書く
- [ ] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

