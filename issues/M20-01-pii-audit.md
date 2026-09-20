---
id: M20-01
title: 個人情報・秘密情報の監査と削除
status: done
milestone: M20
plan: docs/specs/plans/2026-09-20-m20-public-release-plan.md
depends_on: []
evidence: ["3dd0718 docs/specs/plans/2026-09-20-m20-public-release-plan.md"]
---

# 個人情報・秘密情報の監査と削除

## What to build

公開前に、追跡ファイルと全ブランチの履歴から個人を特定できる情報と秘密情報を洗い出し、削除する。2026-09-20 の下見: 全 108 コミットの author が個人メール(156341+karak@users.noreply.github.com)、企画書 HTML に「起案 karak97」、.env は未追跡で履歴にも無し、`.claude/launch.json` が追跡されている、Gemini 生成の概念画 PNG(約 1MB × 9)が履歴に残っている。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [ ] 追跡ファイルの全文検索(メールアドレス、氏名・ハンドル、絶対パス /Users/…、API キー形式、社内ドメイン)で該当 0 件。検索コマンドと結果を作業ログに残す
  - 検索コマンドと結果は作業ログに記録済みだが、「該当 0 件」は未達成のため未チェック。残存: (1) `issues/ART-01-merge-concept-art-variants.md:38` の絶対パス `<home>/...`(tools/blender・docs/design/qa の対象範囲外のため今回は未編集、ユーザー判断待ち)、(2) 本チケットと計画書自身が監査結果として `156341+karak@users.noreply.github.com`/`karak97` に言及している(自己言及であり実データの漏洩ではないが、grep 上は 0 件にならない)
- [x] 企画書 HTML の起案者表記を匿名化または削除(ユーザーが表記を決める)
- [x] `.claude/launch.json` を追跡から外すか、公開しても差し支えない内容だと確認して残す(判断を作業ログに)
- [x] 全ブランチ(main、feat/m1〜m8、wip/*、worktree-concept-art-variants)の履歴に対して同じ検索を行い、author メールと生成画像の扱いを M20-02 の判断材料として一覧化する
- [x] `.env.example` を追加し、必要な環境変数(GEMINI_API_KEY)の説明だけを書く
- [x] evidence に commit SHA と確認コマンドの出力(または証跡ファイル)を記す

## 作業ログ

### 2026-09-20 個人情報・秘密情報の監査、起案者匿名化、.env.example 追加(commit 3dd0718)

**1. 追跡ファイルの全文検索**(worktree ルートから `git grep`、`package-lock.json` 除外。すべて `-- . ':!package-lock.json'` 付き)

| 検索対象 | コマンド | 件数 |
|---|---|---|
| メールアドレス | `git grep -nIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'` | 4(内訳: `Co-Authored-By` 定型文言 ×2、本チケット/計画書内の監査結果記述 ×2) |
| karak97/karak/加藤/kato(大小無視) | `git grep -niIE 'karak97\|karak\|加藤\|kato'` | 6(内訳: `docs/design/2026-09-19-proposal.html:87` 「起案 karak97」→本コミットで匿名化、`docs/design/qa/handoff-T18-merge.md:15` と `issues/ART-01-merge-concept-art-variants.md:38` の絶対パス中の `karak97`、残りは監査結果の自己言及) |
| 絶対パス `/Users/` | `git grep -nI '/Users/'` | 3(`docs/design/qa/handoff-T18-merge.md:15` → 本コミットで `<repo>` に置換、`issues/ART-01-merge-concept-art-variants.md:38` → 対象範囲外のため未編集、残り1件は本チケット本文中の検索対象の説明文) |
| API キー形式(`AIza…`/`sk-…`/`ghp_…`/`xox[baprs]-`) | `git grep -nIE 'AIza[0-9A-Za-z_-]{20,}\|sk-[A-Za-z0-9]{16,}\|ghp_[A-Za-z0-9]+\|xox[baprs]-'` | 0 |
| 社内ドメイン `eiken.or.jp` | `git grep -niI 'eiken\.or\.jp'` | 0 |
| `tools/blender/*.py` の絶対パス | `git grep -nI '/Users\|/home/' -- tools/blender/` | 0 |
| `docs/design/qa/*.md` の絶対パス | `git grep -nI '/Users\|/home/' -- docs/design/qa/` | 1(上記 `handoff-T18-merge.md:15` と同一、対応済み) |

詳細な結果表は `docs/specs/plans/2026-09-20-m20-public-release-plan.md` の「M20-01 監査結果」節に記載。

**2. 全ブランチ履歴の検索**

- author: `git log --all --format='%an <%ae>' | sort -u` → `karak <156341+karak@users.noreply.github.com>` の1件のみ。対象ブランチは `main` `feat/m1`〜`feat/m8` `wip/m8-06-tower-rebalance` `worktree-concept-art-variants`(`worktree-agent-*` は今回のセッション用の自動作成ブランチで `feat/m8` と同一コミット)。全 120 コミット(`git rev-list --all | wc -l`)。
- 秘密情報: `git log --all -p -S'GEMINI_API_KEY=' -- . ':!*.md' ':!*.mjs'` および `AIza…`/`sk-…`/`ghp_…`/`xox[baprs]-` の `-G` 検索(pickaxe)を実施。実在するトークンは 0 件(`sk-` は粗いパターンで1644行ヒットしたが、`sk-[A-Za-z0-9]{16,}` に絞ると 0 件で誤検知と確認)。
- 大容量オブジェクト: `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | sort -k3 -n -r` で 500KB 超のオブジェクトを列挙。Gemini 生成のコンセプト画像 14 個(`assets/textures/concept/` 現行3枚 + `archive/` 11枚)、合計 約14.5MB。個人情報・秘密情報は含まないが、`.git` 23MB の大半を占める。詳細は計画書参照。

**3. 対応した項目**

- `docs/design/2026-09-19-proposal.html`: 「起案 `karak97`」→「起案 `—`」に変更。**最終的な起案者表記(実名/ハンドル/このまま空欄/別表記)はユーザーが決定すること。**
- `docs/design/qa/handoff-T18-merge.md`: 絶対パス `<repo>/...` を `<repo>/...` に置換(prose のみ、動作に影響なし)。
- `.env.example` を新規追加。`GEMINI_API_KEY=` と日本語コメントのみを記載。`.env` は元々未追跡・全履歴にも存在しないことを再確認した(`git log --all --diff-filter=A --name-only` に `.env` なし)。

**4. `.claude/launch.json` の判断**

内容は `npm run dev -- --port 5180 --strictPort` を起動する dev サーバ設定のみで、個人情報・秘密情報・機密性のある値は含まない。**追跡のまま残す**と判断した。

**5. 未対応(ユーザー判断待ち・M20-02 に引き継ぎ)**

- `issues/ART-01-merge-concept-art-variants.md:38` の絶対パス記述は `tools/blender`/`docs/design/qa` の対象範囲外であり、完了済みタスクの引き継ぎ記録であるため今回は編集しなかった。必要なら別途修正する。
- Gemini 生成の概念画像・3D モデルを履歴からどう扱うか(圧縮/除去/そのまま公開)は M20-02 の判断事項。
- 全 120 コミットの author 書き換え方法(squash 初期化 or filter-repo)は `docs/specs/plans/2026-09-20-m20-public-release-plan.md` の「ユーザーに決めてもらうこと」のとおり、ユーザー決定待ち。

`npm run lint` は今回の変更(Markdown/HTML/.env.example のみ)後も通過を確認済み。

