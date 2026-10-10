---
id: M26-15
title: 照合の後の引き直しが失敗すると、確かめた人の数が「まだ誰もたどっていない」のまま残る
status: review
milestone: M26
plan: null
depends_on: []
evidence:
  - "87c5140 fix(harbor): 港のクライアントに recount (src/harbor/client.ts の RECOUNT_BACKOFF_MS 1 s・3 s、wait、harbor.recount.dropped)、src/ui/HarborVisit.ts の reader は visit の代わりに recount"
  - "ac63ee9 fix(harbor): 読み直したとき、後から届いた前の読みの引き直しで数を書き戻さない (レビューの指摘)"
  - "tests/unit/harbor.client.test.ts '照合の後の引き直し recount (M26-15)' の 3 本 (修正前に赤を確認: recount is not a function)"
  - "17e4fce tests/e2e/harbor.spec.ts 'M26-15: 照合の後の引き直しが 1 回落ちても…' (修正前に赤を確認: 30 秒待っても「まだ誰もたどっていない」)"
  - "pnpm run check 通過 (unit 1289・worker 66)。E2E harbor・confirm を --repeat-each 3 で 78 本通過、flaky 無し"

---

# 照合の後の引き直しを数回だけ送り直す

優先度: Should

## What to build

訪問の板で「年表を読む」を読み終えると、`src/ui/HarborVisit.ts` の reader は港へ `confirm` を送り、年代記を引き直して (`visit`)「N 人がたどって確かめた」の行を書き換える。2 往復あり、港のクライアントは 1 往復 10 秒で諦める。引き直しが時間切れや網の失敗で落ちると、港には「1 人」が残っているのに、板は「まだ誰もたどっていない」のまま変わらない。

ユーザーの決定 (2026-10-10): **案 a、引き直しを送り直す**。照合の失敗は今どおり黙って握りつぶす (板に誤りを出さない)。

やること:
1. 落ちる試験: 単体 (港のクライアントで、引き直しの 1 回目が閉港なら間を置いて問い直し、数が届く) と E2E (confirm の後の 1 回目の引き直しを page.route で落としても、板が「1 人がたどって確かめた」になる)
2. 直す: 港のクライアントに引き直し (`recount`) を足す。閉港のときだけ、決まった回数と間で問い直す。港に無い (取り下げ済み) は問い直さない。最後まで閉港なら null を返し、`harbor.recount.dropped` を 1 行残す
3. reader は `visit` の代わりに `recount` を使う

## Acceptance criteria

- [x] 引き直しの 1 回目が閉港でも数が届く試験 (単体・E2E) が通る。直す前に赤
- [x] 港に無いときは問い直さず、最後まで閉港なら null と `harbor.recount.dropped` の 1 行 (単体)
- [x] `pnpm run check` と港・照合の E2E が通る

## 作業ログ

- 2026-10-10: 起票 (ユーザーの決定「案 a、引き直しを送り直す」)。
- 2026-10-10: 実装 (87c5140・17e4fce)。単体と E2E を先に書いて赤を確かめてから直した。E2E は confirm の後の最初の引き直し (GET) だけを page.route で網の失敗にする。
- 2026-10-10: 別 agent (sonnet) の読むだけのレビュー。読み直したときに前の読みの引き直しが後から届いて数を書き戻す競りを直した (ac63ee9)。この守りは単体の試験が無い (reader は Worker の再生を通すので DOM の単体の台が無い)。E2E は待ちの長さを見ない (単体が [1000] を見る)。
