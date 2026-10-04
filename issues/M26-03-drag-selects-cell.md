---
id: M26-03
title: カメラのドラッグでポインタの下のセルが選ばれる
status: review
milestone: M26
plan: null
depends_on: []
evidence:
  - tests/unit/press.test.ts (10 件: 押し・しきい値・キャンセル・別の指・つまみ・取りこぼし)
  - tests/e2e/cellHighlight.spec.ts の M26-03 (ドラッグ後は #cell-info が空、押すと開く。fix を外すと落ちることを確認)
  - src/ui/press.ts、src/main.ts の canvas の pointer 配線
  - pnpm run check 通過 (単体 1235 件・build 66 件)、E2E cellHighlight・sceneIdle・smoke・shots 34 件通過
---

# カメラのドラッグでポインタの下のセルが選ばれる

優先度: Should

## What to build

ADR 0001 の付録 B で見つけた製品の欠陥。島の画面でカメラをドラッグ (pointerdown → move → up) すると、終わりにポインタの下のセルが選ばれ #cell-info が開く。押しただけ (動かさずに up) のときだけ選ぶべき。

やること:
1. 入力の処理を見つける (`src/render/SceneView.ts`・`src/ui/movable.ts`・`src/main.ts` の pointer の配線)。選びとドラッグの判別 (しきい値 px、pointerId) を純粋な状態遷移に分ける
2. 単体試験: 動かさない up は選ぶ、しきい値を超えて動かした up は選ばない、キャンセルは選ばない
3. E2E (`tests/e2e/cellHighlight.spec.ts` か新しい spec): ドラッグの後に #cell-info が開かない、押すと開く
4. driver (`tests/driver/camera.ts`) があれば使う

## Blocked by

- なし

## Acceptance criteria

- [x] 単体試験で押し・ドラッグ・キャンセルの 3 つが分かれる
- [x] E2E でドラッグの後に #cell-info が開かない
- [x] `pnpm run check` と E2E (cellHighlight・shots) が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 5)。
- 2026-10-04: 実装 (review)。src/ui/press.ts の純粋な状態遷移 (しきい値 6 px、pointerId 照合、2 本目の指はつまみ扱い、キャンセルは選ばない、同じ指の down 重なりは押し直し) を main.ts の canvas の pointer から呼び、ドラッグだった次の click を選びにしない。別モデルの読むだけのレビューで取りこぼしの指摘を受け修正。
