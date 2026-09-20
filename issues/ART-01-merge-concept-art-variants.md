---
id: ART-01
title: worktree-concept-art-variants(コンセプト画 → Blender ローポリモデル)を feat/m8 にマージ
status: done
milestone: ART
plan: docs/design/qa/handoff-T18-merge.md (git show worktree-concept-art-variants:docs/design/qa/handoff-T18-merge.md)
depends_on: []
evidence: ["2aa9877", "git lfs ls-files = 6, git lfs fsck OK, lint 0, vitest 189/189 (マージ前後とも)"]
---

# worktree-concept-art-variants を feat/m8 にマージ

## What to build

別セッションが作った rabbit / deer / wolf のローポリモデル(Blender)、検証ツール、QA 文書を含むブランチ
`worktree-concept-art-variants` を、このチェックアウトのブランチ(feat/m8。別を指示された場合はそれに従う)に `--no-ff` でマージし、
LFS の実体化・lint・test を確認して報告する。詳細な手順書は `git show worktree-concept-art-variants:docs/design/qa/handoff-T18-merge.md`。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 手順 1〜8 を指示書どおりに実施し、マージ SHA を evidence に記す
- [x] .gitignore の衝突は両ブロック残しで解決。他の衝突があれば解決前に報告した記録がある
- [x] `git lfs ls-files` が 6 件、`git lfs fsck` エラーなし、`assets/models/` の 6 ファイルが実体化している
- [x] `npm run lint` と `npm test` がマージ前と同じ結果(件数を作業ログに)
- [x] リモートがあれば push して `Uploading LFS objects: 6` を確認、なければ push せず報告
- [x] `docs/design/qa/remaining-tasks.md` の T18 行を完了に更新してコミット
- [x] マージ元の worktree と未コミットの Finder 移動(`assets/textures/concept/*-v*.png → archive/`)には触らず、扱いをユーザーに確認

## 指示書(ユーザー提供、2026-09-20)

ブランチ worktree-concept-art-variants を、このチェックアウトのブランチ(feat/m8。別を指示された場合はそれに従う)にマージしてください。コンセプト画 → Blender ローポリモデル(rabbit / deer / wolf)と、その検証ツール・QA 文書を含むブランチです。詳細な手順書は `git show worktree-concept-art-variants:docs/design/qa/handoff-T18-merge.md` で読めます。

前提(検証済み)
- マージ元の HEAD は `git log -1 worktree-concept-art-variants` で確認。worktree は `.claude/worktrees/concept-art-variants`(リポジトリルートからの相対)(別セッションが使用中。中は触らない)。
- 分岐点 b09d573(feat/m4 の途中)。独自コミット 21、変更ファイル 58。tools/blender/、tools/gen-concept-art.mjs、assets/models/、assets/textures/concept/、docs/design/qa/、.gitattributes、.gitignore のみ。src/ と tests/ は無変更。
- feat/m8・main への試しマージで、衝突は .gitignore 末尾ブロックのみ。こちらの `# Python / __pycache__/` と相手の `# 他エージェントの worktree / .claude/worktrees/` を両方残す。
- assets/models/{rabbit,deer,wolf}.{blend,glb} の 6 ファイルは git LFS 管理(.gitattributes)。`git lfs install` は同リポジトリで実行済み。
- リモートは未設定だった。あれば push、なければ push せず報告。
- マージ元の作業ツリーにある Finder 移動(assets/textures/concept/*-v*.png → archive/)は未コミットでマージ対象外。扱いはユーザーに確認。

手順
1. `git status` が clean であること。汚れていれば止めて報告。`git stash` は使わない。
2. `git merge --no-ff worktree-concept-art-variants`。
3. .gitignore を両ブロック残しで解決して `git add`。他の衝突が出たら報告してから解決。
4. マージコミット(`--no-verify` 禁止)。末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
5. 検証: `git lfs ls-files` が 6 件、`git lfs fsck` エラーなし、`ls -la assets/models/` で実体化(ポインタなら `git lfs checkout`)、`npm run lint` と `npm test` がマージ前と同じ結果。任意で wolf の比較を 1 回回し、silhouette.iou ≈ 0.77、tris 2182 を確認:
   ```bash
   ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- assets/models/wolf.blend assets/textures/concept/wolf-angular.png /tmp/wolf-check 135 10 creature=wolf proj=ortho
   ```
6. リモートがあれば `git push` して `Uploading LFS objects: 6` を確認。
7. `docs/design/qa/remaining-tasks.md` の T18 行を完了(マージ SHA、push の有無)に更新してコミット。
8. マージ元の worktree は削除しない。

制約: 既存コードのコメントを削除しない、.env をコミットしない、他エージェントの worktree を触らない、判断が要る衝突やテスト差分は解決前に報告。

報告: マージ SHA、衝突と解決、LFS 状態、lint / test 結果、push の有無。

## 作業ログ

- 2026-09-20: 本体ツリーに未追跡の assets/models/*.glb 3 件があり、ブランチの LFS 内容と sha256 が一致したので scratchpad に退避してマージ。衝突は .gitignore のみ、両ブロック残し。LFS 6 件実体化、fsck OK。lint 0 / vitest 189 はマージ前後で同一。リモート未設定のため push なし(M20-04 で公開時に push)。wolf の比較(任意)は未実施。マージ元の worktree と未コミットの Finder 移動には触っていない。
