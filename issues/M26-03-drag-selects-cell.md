---
id: M26-03
title: カメラのドラッグでポインタの下のセルが選ばれる
status: open
milestone: M26
plan: null
depends_on: []
evidence: []
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

- [ ] 単体試験で押し・ドラッグ・キャンセルの 3 つが分かれる
- [ ] E2E でドラッグの後に #cell-info が開かない
- [ ] `pnpm run check` と E2E (cellHighlight・shots) が通る

## 作業ログ

- 2026-10-04: 起票 (2026-10-02 の一覧の 5)。
