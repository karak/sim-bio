# 引き継ぎプロンプト: T18 — 3D モデル制作ブランチのマージ

以下をマージ先の worktree で開くセッションに貼り付けて使う。

---

## 依頼

ブランチ `worktree-concept-art-variants` を **このチェックアウトのブランチ (`feat/m8`。別を指示された場合はそれに従う)** にマージしてください。
コンセプト画 → Blender ローポリモデル (rabbit / deer / wolf) と、その検証ツール・QA 文書を含むブランチです。
push はリモートが設定されている場合のみ行い、LFS の転送を確認してください。

## 前提の事実 (2026-09-20 11:30 時点で検証済み)

- マージ元: `worktree-concept-art-variants`、HEAD はこの文書を含む最新コミット (`git log -1 worktree-concept-art-variants` で確認)。worktree の場所は `<repo>/.claude/worktrees/concept-art-variants` (別セッションが使用中。中のファイルは触らない)。
- 分岐点: `b09d573` (feat/m4 の途中)。マージ元の独自コミット 23、変更ファイル 70 (archive への移動 12 枚を含む)。触っているのは `tools/blender/`、`tools/gen-concept-art.mjs`、`assets/models/`、`assets/textures/concept/`、`docs/design/qa/`、`.gitattributes`、`.gitignore` のみで、`src/` と `tests/` には変更なし。
- `feat/m8` は分岐点から 47 コミット、`main` は 27 コミット進んでいる。**両側で変更したファイルは `.gitignore` の 1 つだけ**。
- `feat/m8` と `main` のそれぞれに対して `git merge --no-commit --no-ff` で試しにマージしたところ、衝突は `.gitignore` 末尾のブロックだけで他は自動マージされた (検証後に `--abort` 済み)。
  - こちら側の追記: `# Python` / `__pycache__/`
  - 相手側の追記: `# 他エージェントの worktree` / `.claude/worktrees/`
  - **両方のブロックを残す**のが正解。
- マージ元は git LFS を使う。`.gitattributes` で `assets/**/*.blend` と `assets/**/*.glb` を LFS 管理にしており、対象は `assets/models/{rabbit,deer,wolf}.{blend,glb}` の 6 ファイル。`git lfs install` は同じリポジトリで実行済み (hooks は `.git/hooks` で worktree 間共通)。
- リモートは未設定だった (`git remote -v` が空)。設定されていれば push まで、なければ push は行わずその旨を報告する。
- 参照画像の旧バリエーション 12 枚は `assets/textures/concept/archive/` へ移動してコミット済み (`484b632`、リネーム)。マージ元の作業ツリーは clean。

## 手順

1. 作業ツリーが clean であることを確認する (`git status`)。汚れていれば止めて報告する。`git stash` は使わない (他セッションと共有されるため)。
2. `git merge --no-ff worktree-concept-art-variants` を実行する。
3. `.gitignore` の衝突を、両方の追記ブロックを残す形で解決し `git add .gitignore` する。他に衝突が出た場合は内容を報告してから解決する。
4. マージコミットを作る。メッセージ例:
   ```
   merge: worktree-concept-art-variants (3D ローポリモデル rabbit / deer / wolf と検証ツール・QA 文書)

   - tools/blender: 断面ロフト生成 (rabbit.py / deer.py / wolf.py, lowpoly_kit.py)、参照画像との定量比較 (compare_ref.py)、
     色補正ループ (tune_colors.py)、個体別分類 (creature_parts.py)
   - assets/models: 3 個体の .blend / .glb (git LFS)
   - docs/design/qa: 受入基準・残課題・証跡・検証手順・残タスク一覧
   - .gitignore: __pycache__/ を追加し .blend の除外を解除、.gitattributes で LFS

   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   ```
   `--no-verify` は使わない (git-secrets フックを通す)。
5. 検証:
   - `git lfs ls-files` に 6 ファイルが出ること。`git lfs fsck` がエラーなし。
   - `ls -la assets/models/` で .blend / .glb が実体 (数十 KB〜数 MB) であり、LFS ポインタ (130 バイト前後のテキスト) になっていないこと。ポインタなら `git lfs checkout`。
   - `npm run lint` と `npm test` (unit) を実行し、マージ前と同じ結果であること (このブランチは src / tests を触っていないので差は出ないはず)。
   - 任意: ツールが動くことの確認
     ```
     ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
         assets/models/wolf.blend assets/textures/concept/wolf-angular.png /tmp/wolf-check 135 10 creature=wolf proj=ortho
     ```
     `metrics.json` の `silhouette.iou` が 0.77 前後、`tris` が 2182 なら OK (`docs/design/qa/wolf-metrics.json` と一致)。
6. リモートがあれば `git push` し、LFS オブジェクトの転送 (`Uploading LFS objects: 6`) を確認する。なければ「リモート未設定のため push 未実施」と報告する。
7. `docs/design/qa/remaining-tasks.md` の T18 行を「完了 (マージ SHA、push の有無)」に更新してコミットする。
8. マージ元の worktree の削除はしない (別セッションが使用中。ユーザーの指示があるまで残す)。

## 制約

- 既存コードのコメントは削除しない (CLAUDE.md)。
- `.env` は絶対にコミットしない。
- 他エージェントの worktree (`.claude/worktrees/*`) の中身は触らない。
- 判断が必要な衝突や、テスト結果の差が出たら、解決を試みる前に報告する。

## 報告に含めること

- マージコミットの SHA、衝突の内容と解決、LFS の状態 (`git lfs ls-files` の件数、実体化の確認)、lint / test の結果、push の有無。
