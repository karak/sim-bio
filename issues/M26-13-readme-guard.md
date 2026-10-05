---
id: M26-13
title: README に運用の手順が戻らないよう、check で機械的に落とす柵 (scripts/check_readme.py)
status: review
milestone: M26
plan: null
depends_on: []
evidence:
  - 4ff7552 5a18eeb scripts/check_readme.py, scripts/test_check_readme.py (34 件), package.json (check:readme を check に), docs/operations/README.md, issues/README.md
---

# README に運用の手順を置かせない柵

優先度: Should

## 経緯

運用の手順が README に置かれ、docs/operations/ へ移すことが 2 回起きた。
- 2026-09-26 679e222: スクリーンショットの撮り直し → docs/operations/readme-screenshots.md
- 2026-10-06 85294e0: 「Cloudflare へ配る」(配備・手元で確かめる・課金にしない・運用) → docs/operations/cloudflare.md。M19-02・M19-08・M19-12 の票が「README に書く」を受入の基準にしていた (票が置き場を指定して、人も agent もそれに従った)

ユーザーの指示 (2026-10-06): 再発防止の機械的な柵を設計する。

## 設計 (案)

`scripts/check_readme.py` を `pnpm run check` に入れる (CI と配備の前で回る。check_free_tier.py と同じ型の検査)。

1. **見出しの許可表**: README の `##`・`###` は表 (`ALLOWED_HEADINGS`、今の見出し) にあるものだけ。新しい節を足すと落ち、「運用の手順なら docs/operations/、設計なら docs/design/ へ。README の節を足すなら表に足す (レビューで見える)」と出す
2. **運用の印の禁止**: README の本文 (表とコードの塊を含む) に、運用の手順の印があれば落とす。印の例: `wrangler (deploy|login|secret|d1 .*--remote|tail|rollback)`・`gh (secret|variable|workflow run|api -X)`・`scripts/mod.py`・`--remote`・`security (add|find)-generic-password`。docs/operations/ への案内の行 (リンクを含む行) は許す
3. **長さの上限**: README の行数の上限 (今の 170 行程度 + 余裕)。超えると「節を docs/ へ分ける」と出す
4. **票の型にも柵**: 新しい票の受入の基準が「README に〜を書く」と言うのを、issues/README.md の決まりで禁止し、`scripts/check_readme.py` は issues/ の **open・todo・in_progress** の票で `README` + (配備|運用|手順|課金) を含む受入の行を警告する (過去の票の記録は見ない)

試験 (`scripts/test_check_readme.py`、先に赤): 許可外の見出し・印の入ったコードの塊・案内の行は通る・長さの超過・票の警告。今の README が通ること。

## 決めること

- 4 (票の型) を入れるか。入れるなら issues/README.md に決まりの 1 行を足す (既存の文は変えない)
- 長さの上限の値

## Acceptance criteria

- [x] 上の試験が通る (先に赤)。今の README は通り、85294e0 の前の README は落ちる
- [x] `pnpm run check` に入り、CI で回る
- [x] docs/operations/ に、運用の文書の置き場の決まりを 1 段落 (README.md ではなくここに書く)

## 作業ログ

- 2026-10-06: 起票 (設計の案、ユーザーの承認待ち)。
- 2026-10-06: ユーザーの決定「柵はいったんそれでよい」。案の 1〜4 を入れ、長さの上限は 200 行。定期の再評価は M26-14。
- 2026-10-06: 実装 (4ff7552・5a18eeb)。試験を先に書いて赤 (import 失敗) → 緑。許可表は今の見出し 11 個、印は wrangler (deploy|login|secret|tail|rollback)・pnpm run deploy・scripts/deploy.py・gh (secret|variable|workflow run|api -X)・scripts/mod.py・--remote・security (add|find)-generic-password、上限 200 行 (今は 169)。別 agent (opus) の読むだけのレビューで、コードの塊の中のリンク免除・見出しの形 (字下げ・setext)・fence の閉じ方・配備の印・票の誤警告を直した。今 open の票で警告に出るものは無い。表の行にリンクと印が同居すると通る (案の通り、リンクを含む行は許す)。
