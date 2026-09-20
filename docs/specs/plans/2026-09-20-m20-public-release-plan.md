# M20 計画: GitHub public リポジトリとして公開する

**Goal:** このリポジトリを個人情報と秘密情報を含まない形で GitHub に public 公開し、README と LICENSE を整える。

## 下見(2026-09-20)

| 項目 | 現状 | 対応チケット |
|---|---|---|
| commit author | 全 108 コミットが個人メール(`156341+karak@users.noreply.github.com`) | M20-01 で一覧化、M20-02 で履歴を作り直す |
| 氏名の表記 | `docs/design/2026-09-19-proposal.html` に「起案 karak97」 | M20-01 |
| 秘密情報 | `.env` は未追跡・履歴にも無し。コード内は変数名の言及のみ | M20-01 で再確認、`.env.example` を追加 |
| 追跡されている設定 | `.claude/launch.json` | M20-01 で判断 |
| 大容量ファイル | Gemini 生成の概念画 PNG(約 1MB × 9)が履歴に残る。`.git` 23MB | M20-02 |
| ブランチ | main、feat/m1〜m8、wip/m8-06-tower-rebalance、worktree-concept-art-variants(別セッションの 3D モデル作業) | M20-02 で全部を main に取り込むか判断 |
| README | フォルダ構成のみ | M20-03 |
| LICENSE | 無し。package.json の license 欄も未設定 | M20-03 |
| remote | 無し | M20-04 |

## M20-01 監査結果(2026-09-20)

追跡ファイル(`git grep`、`package-lock.json` 除外)と全ブランチ履歴を対象に、メールアドレス・氏名/ハンドル・絶対パス・API キー形式・社内ドメインを検索した。検索コマンドと件数は `issues/M20-01-pii-audit.md` の作業ログに記録。

### author 一覧(全ブランチ)

```
$ git log --all --format='%an <%ae>' | sort -u
karak <156341+karak@users.noreply.github.com>
```

全 120 コミット(`git rev-list --all | wc -l`)、対象ブランチ `main` `feat/m1`〜`feat/m8` `wip/m8-06-tower-rebalance` `worktree-concept-art-variants` すべてが単一 author。M20-02 で作り直す場合、書き換え対象は上記 1 アドレスのみ。

### 秘密情報の検索(全ブランチ履歴)

| 検索 | コマンド | 結果 |
|---|---|---|
| `GEMINI_API_KEY=` の値(Markdown/`.mjs` を除く追加・変更) | `git log --all -p -S'GEMINI_API_KEY=' -- . ':!*.md' ':!*.mjs'` | 0 件(該当なし) |
| Google API キー形式 | `git log --all -p -G'AIza[0-9A-Za-z_-]{16,}' -- .` | 0 件 |
| OpenAI 形式キー | `git log --all -p -G'sk-[A-Za-z0-9]{16,}' -- .` (広めのパターンでの粗い一致1644行を目視/正規表現で絞り込み) | 実在するトークンなし |
| GitHub PAT | `git log --all -p -G'ghp_[A-Za-z0-9]+' -- .` | 0 件 |
| Slack トークン | `git log --all -p -G'xox[baprs]-' -- .` | 0 件 |

秘密情報の履歴混入は確認されなかった。

### 大容量オブジェクト(全履歴、>500KB)

`git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | sort -k3 -n -r`

| パス | サイズ | 備考 |
|---|---|---|
| assets/textures/concept/archive/rabbit-v1.png | 1,219,135 B | 現行トラック(archive) |
| assets/textures/concept/archive/rabbit-v3.png | 1,183,456 B | 現行トラック(archive) |
| assets/textures/concept/archive/wolf-v3.png | 1,100,652 B | 現行トラック(archive) |
| assets/textures/concept/archive/wolf-v1.png | 1,080,180 B | 現行トラック(archive) |
| assets/textures/concept/archive/wolf-v2.png | 1,068,101 B | 現行トラック(archive) |
| assets/textures/concept/archive/deer-v3.png | 1,035,267 B | 現行トラック(archive) |
| assets/textures/concept/archive/deer-angular-v3.png | 1,003,446 B | 現行トラック(archive) |
| assets/textures/concept/archive/deer-angular-v2.png | 985,079 B | 現行トラック(archive) |
| assets/textures/concept/rabbit-angular.png | 978,303 B | 現行トラック |
| assets/textures/concept/wolf-angular.png | 971,769 B | 現行トラック |
| assets/textures/concept/archive/deer-angular-v1.png | 971,461 B | 現行トラック(archive) |
| assets/textures/concept/archive/deer-v1.png | 966,550 B | 現行トラック(archive) |
| assets/textures/concept/archive/deer-v2.png | 961,252 B | 現行トラック(archive) |
| assets/textures/concept/archive/rabbit-v2.png | 961,047 B | 現行トラック(archive) |

500KB 超のオブジェクトは Gemini 生成のコンセプト画像 14 個(現行 `assets/textures/concept/` 3 枚 + `archive/` 11 枚)、合計 約 14.5MB。いずれも個人情報・秘密情報は含まない(生成画像そのもの)が、`.git` は現在 23MB(下見時点と同じ)で、大半をこれらの画像が占める。300〜440KB 台には `docs/design/qa/*-compare.png` `*-ref-classes.png` の複数リビジョンもある。png 以外の大きめオブジェクトは `assets/models/*.glb`/`*.blend`(数十〜120KB台)、`package-lock.json`、設計ドキュメント Markdown で、いずれも個人情報・秘密情報なし。画像を公開に含めるか、履歴から圧縮/除去するかは M20-02 の判断事項(下見表のとおり)。

### PII 検索結果(追跡ファイル、`git grep`)

| 検索対象 | コマンド | 件数 | 内訳 |
|---|---|---|---|
| メールアドレス | `git grep -nIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -- . ':!package-lock.json'` | 4 | `Co-Authored-By: ... <noreply@anthropic.com>` × 2(コミットテンプレート文言、実データではない)、本計画書と `issues/M20-01-pii-audit.md` 内の `156341+karak@users.noreply.github.com` への言及(監査結果の記述そのもの) |
| karak97/karak/加藤/kato(大小無視) | `git grep -niIE 'karak97\|karak\|加藤\|kato' -- . ':!package-lock.json'` | 6 | `docs/design/2026-09-19-proposal.html:87` の「起案 karak97」(→本チケットで匿名化、下記参照)、`docs/design/qa/handoff-T18-merge.md:15` と `issues/ART-01-merge-concept-art-variants.md:38` の絶対パス中の `karak97`(下記の絶対パス参照)、残りは本計画書・チケット内の監査結果の記述 |
| 絶対パス `/Users/` | `git grep -nI '/Users/' -- . ':!package-lock.json'` | 3(実質2) | `docs/design/qa/handoff-T18-merge.md:15`、`issues/ART-01-merge-concept-art-variants.md:38` に `<repo>/...` の記述。残り1件はチケット本文の検索対象の説明文(実際のパスではない) |
| API キー形式 | `git grep -nIE 'AIza[0-9A-Za-z_-]{20,}\|sk-[A-Za-z0-9]{16,}\|ghp_[A-Za-z0-9]+\|xox[baprs]-' -- . ':!package-lock.json'` | 0 | 該当なし |
| 社内ドメイン `eiken.or.jp` | `git grep -niI 'eiken\.or\.jp' -- . ':!package-lock.json'` | 0 | 該当なし |
| `tools/blender/*.py` の絶対パス | `git grep -nI '/Users\|/home/' -- tools/blender/` | 0 | 該当なし(スクリプトはすべて相対パス/引数で動作) |
| `docs/design/qa/*.md` の絶対パス | `git grep -nI '/Users\|/home/' -- docs/design/qa/` | 1 | `handoff-T18-merge.md:15`(上記と同じ) |

### 対応

- `docs/design/2026-09-19-proposal.html` の「起案 `karak97`」を「起案 `—`」に変更(本コミットで実施)。最終的な起案者表記(実名/ハンドル/削除のまま)はユーザーが決定する。
- `docs/design/qa/handoff-T18-merge.md:15` の絶対パスの記述(`<repo>/...`)を `<repo>/...` に置換(本コミットで実施、prose のみでコード的な意味は無いファイル)。
- `issues/ART-01-merge-concept-art-variants.md:38` にも同じ絶対パスの記述があるが、`tools/blender` / `docs/design/qa` の対象範囲外であり、かつ内容は完了済みタスクの引き継ぎ手順の記録であるため本チケットでは編集せず、この監査結果に記録するに留める(必要なら別途対応)。
- `.claude/launch.json` は `npm run dev -- --port 5180 --strictPort` を起動するだけの dev サーバ設定で、個人情報・秘密情報を含まない。**追跡のまま残す**と判断した(詳細は `issues/M20-01-pii-audit.md` 作業ログ)。
- `.env.example` を追加し、`GEMINI_API_KEY` の説明のみを記載(本コミットで実施)。`.env` は元々未追跡・履歴にも無いことを再確認済み。
- Gemini 生成の概念画像・大容量オブジェクトの扱い(履歴から除去するか、公開に含めるか)は M20-02 の判断事項として本結果を引き継ぐ。

## ユーザーの決定(2026-09-20)

| 項目 | 決定 |
|---|---|
| 起案者表記 | `karak97`(ハンドル) |
| 生成画像・3D モデル | 公開に含める。PNG も含め git LFS で管理する(`.gitattributes` に `assets/textures/**/*.png` を追加) |
| 履歴の作り直し | `git filter-repo` で author を GitHub の noreply アドレスに書き換える(履歴は残す)。全ブランチが feat/m8 → main に統合された後に実施 |
| ライセンス | MIT。権利者表記は `karak97` |
| リポジトリ名 | `sim-bio`(仮称) |
| 絶対パスの記述 | リポジトリルートからの相対に書き換える |

## ユーザーに決めてもらうこと(決定済み。上表を参照)

- 履歴の作り直し方: (a) 単一コミットに squash して初期化(履歴は消える。バックアップは bundle で残す) / (b) filter-repo で author 書き換え + PNG 除去(履歴は残る)
- ライセンス(推奨 MIT)と権利者表記
- 企画書の起案者表記をどうするか
- Gemini 生成の画像と 3D モデルを公開に含めるか
- リポジトリ名とオーナー

## 依存

```
M20-01 監査 → M20-02 履歴の作り直し ─┐
M20-01 監査 → M20-03 README/LICENSE ─┴→ M20-04 GitHub 公開
```
