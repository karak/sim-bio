---
id: M26-14
title: README の柵 (M26-13) の定期の再評価 (2026-11-06 ごろ)
status: done
milestone: M26
plan: null
depends_on: [M26-13]
evidence:
  - "package.json (check:readme を外す)、scripts/check_readme.py・scripts/test_check_readme.py を削除。pnpm run check:docs・test:scripts・lint:py 通過"
---

# README の柵の定期の再評価 (次回 2026-11-06 ごろ)

優先度: Should

## What to build

ユーザーの依頼 (2026-10-06): M26-13 の柵は「いったん」入れ、定期的に再評価する。この票はその次の回。

見ること:
1. 柵が落としたもの・警告したもの (git log と CI の失敗から、`check_readme` で落ちた回)。正しく落としたか、誤って落としたか
2. 柵をすり抜けたもの: README と docs/ に運用の手順・設計が置き違えられていないか (README の差分、docs/operations/ と docs/design/ の新しい文書)
3. 見出しの許可表・運用の印・長さの上限 (200 行) が今の README に合っているか。足す・外す・緩める・締める案
4. 票の型の警告 (open の票の「README に書く」) が役に立ったか
5. 柵を広げるか (docs/design と docs/operations の取り違え、CLAUDE.md への運用の手順など)

結論を作業ログに書き、ユーザーに案を出して決めてもらう。

## Acceptance criteria

- [x] 1〜5 の結果と案が作業ログにある。ユーザーの決定も
- [x] 次の回の票 (M26-14 と同じ型、約 1 か月後) を起票した。続けないとユーザーが決めたら起票しない

## 作業ログ

- 2026-10-06: 起票 (M26-13 の柵の次の再評価)。
- 2026-11-20: 再評価の材料。
  1. 落としたもの: 10/6 以降、柵が落としたものは見つかっていない (誤って落とした回も無い)。
  2. すり抜け: 見つかっていない。10/6 以降の README の差分は 3 commit (6634acf・675a1b5・a933356) で、運用の手順を足したものは無い。
  3. 今の README は 171 行、見出しは 11 個。`uv run scripts/check_readme.py` は「違反なし (警告 0 件)」。
  4. 票の型の警告: 0 件。役に立った回は無い。
  5. 柵を広げる: 外すので広げない。
- 2026-11-20 12:45: ユーザーの決定「柵は除外しましょう」。M26-13 の柵 (scripts/check_readme.py と試験、pnpm run check からの呼び出し、票の型の警告) を外す。次の回の票は起票しない (続けない決定)。
