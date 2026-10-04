---
id: M26-11
title: judge の SEL-003/3 は、選んだセルの辺りを切り抜いた画に当てる (全体の画では帯が 25 px で読めない)
status: review
milestone: M26
plan: null
depends_on: []
evidence:
  - tests/unit/shotCrop.test.ts (cropRectAround: 端のセルも画の内に収める。red は tests/driver/crop.ts が無い状態で確認)
  - scripts/test_judge.py CropPlanTest・RepoCropTest (crops.json の手順は切り抜きに当てる。画素の基準は全体の画のまま。red は judge.py を HEAD に戻して 2 失敗・4 エラーを確認)
  - pnpm run shots 6 passed (E2E_PORT=5458)。基準画 tests/e2e/baselines に差分なし
  - pnpm run judge -- --step SEL-003/3 --dry-run -> `SEL-003/3 SEL-003-2-セルの辺り.png: 問い 5 つ x 3 回`
---

# judge の SEL-003/3 は選んだセルの辺りの画に当てる

優先度: Should

## What to build

2026-10-04 の judge の再実行で SEL-003/3 (画 2、寄ったカメラ) だけ 3 票とも no (問い 2〜4: 帯が輪に見えない・地面に沿うか確かめられない)。画 `SEL-003-2.png` は 1280×720 の全体で、選んだセルの帯は約 25 px。問い 2・3 に「ピンが重なって隠すのは欠けに数えない」を足しても票は割れた。同じ画のセルの辺り 320×240 を切り抜いて `--image` で当てると 5 問とも 3 票 yes (0.058 USD)。

やること:
1. judge が SEL-003/3 (と、帯・ピンを見る SEL-003 の手順) に渡す画を、選んだセルの画面の位置を中心に切り抜いた画にする。位置は撮る時に dev の probe (選んだセルの画面座標) から取り、shots が `SEL-003-2-セルの辺り.png` のような画を別に書く案。全体の画と基準画は変えない
2. rubrics.json の手順と画の対応 (どの画に当てるか) を、切り抜いた画に向ける。既存の行の書き換えは承認制なので、案を報告に挙げて親に聞く (新しい鍵を足すのは可)
3. `pnpm run shots` が通り、`pnpm run judge -- --step SEL-003/3 --dry-run` が切り抜いた画を指す。本物の judge は親が回す

## Acceptance criteria

- [x] 切り抜きの位置を決める関数の単体試験 (画面の端に近いセルでも画の内に収める)
- [x] shots が切り抜いた画を書き、全体の画と基準画は変わらない
- [x] `pnpm run check`・shots が通る

## 作業ログ

- 2026-10-04: 起票 (judge の再実行の結果から。切り抜きの試しは scratchpad の sel3-crop320.png)。
- 2026-10-04: 実装 (review)。tests/driver/crop.ts の cropRectAround (320x240・画の内に寄せる) を shots が使い、SEL-003 の 3 枚に `SEL-003-<n>-セルの辺り.png` を足す (位置は probe の selection().view.screen)。名前は画の形に合わないので shots_of には数えない。judge は新しい docs/acceptance/crops.json (手順 -> 切り抜きの名前) で SEL-003/3 だけを切り抜きへ向け、画素の基準・承認済みの画は全体の画のものを見る。rubrics.json は変えていない。切り抜きが無いと呼ぶ前に止まる (全体の画へ黙って戻さない)。SEL-003/2・4 は問いが画面の縁の板・画全体を見るので全体のまま。
