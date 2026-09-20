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

## ユーザーに決めてもらうこと

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
