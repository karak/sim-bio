---
id: M22-10
title: 選んだセルを操作画面の 3D の島で示す(境界線の強調と浮かぶ印)
status: review
milestone: M22
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: ["5d7348f src/render/cellHighlight.ts src/render/SceneView.ts tests/unit/render.cellHighlight.test.ts tests/e2e/cellHighlight.spec.ts"]
---

# 選んだセルを操作画面の 3D の島で示す(境界線の強調と浮かぶ印)

優先度: Could

## What to build

受入試験(2026-09-27、a-free-resume)のユーザーのメモ原文(スコープ外、登録の依頼):「マウスでセルを選択したときに、3D画面上でどこを選択したかわかるようにしてほしい。例えば、対象セルの境界線をハイライトし、その上部に矢印・ピンなど浮かせておく。」

ユーザーの判断(2026-09-28): 示すのは観察画面ではなく、**クリックする操作画面**(`src/render/SceneView.ts` の透視の島。`pickCell` でセルを選び、`selected` は `src/main.ts` にある)。

(もとの案: 2D の地図で選んだセル(selected)を、3D の観察画面でも示す。観察画面の予算(draw call ≤200 など)と世界観(動物側の意匠)に合わせる。→ 上の判断で置き換え)

操作画面で選んだセル(selected)の境界を、地形の高さに沿った線で強調する(地形に埋もれず、z-fighting しない)。その上に矢印かピンを浮かせる(ゆっくり上下してよい。動かすなら prefers-reduced-motion を守る)。

- 選びを解く(新しい島・読み込みで `selected = null`)と消え、別のセルを選ぶと移る
- 地形の変化(地図は毎フレーム更新)と、種・重ね図の切り替えに付いていく
- SceneView の色(HUD の色)に合わせる。安く作る(draw call は数個。毎フレームの geometry の作り直しをせず、位置をその場で書き換える)
- セルの番号 → 輪郭の頂点・印の位置は、snapshot の格子と標高から求める純粋な関数にし、単体テストを書く

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 操作画面でクリックして選んだセルが、3D の島の上で境界の強調と浮かぶ印で分かる。別のセルを選ぶと移り、選びを解くと消える(比較画を審査台に載せる)
  - src/render/SceneView.ts の `setSelected`、src/main.ts は毎フレーム `view.setSelected(selected)` を渡す 1 行(5d7348f)
  - 帯: セルの境界をまたぐ幅の帯(明るい琥珀 #FFE08A、照らさない)。各頂点の真下の地形の面(海のセルは海面)+ 0.06、polygonOffset で z-fighting させない
  - 印: 下向きの円錐と玉のピン(HUD の注意の色 #e0b055)。カメラの距離で大きさを変え、約 1.6 秒で 1 往復ゆっくり上下する。prefers-reduced-motion なら止める
  - 比較画(自由モード `/`、1 セル選択): 既定のカメラ m22-10-before.png / m22-10-after.png、寄ったカメラ m22-10-before-close.png / m22-10-after-close.png(scratchpad。審査台への載せはユーザーの確かめ待ち)
- [x] 輪郭の頂点と印の位置を求める純粋な関数と単体テスト
  - src/render/cellHighlight.ts: `surfaceHeightAt`・`writeCellOutline`・`outlineIndices`・`cellMarkerAnchor`・`markerScale`・`outlineWidth`・`markerBob`
  - tests/unit/render.cellHighlight.test.ts 15 件(地形の面の高さが three の地形を真上から射た高さと一致・海面で止まる・帯がセルの境界をまたぐ・どの頂点も真下の面 + lift・配列の使い回し・三角形の輪が閉じる・印の足もと・大きさ・上下と動きを減らす設定)
- [x] E2E: 操作画面でセルを押すと強調がそのセルに出て、別のセルで移り、解くと消える
  - tests/e2e/cellHighlight.spec.ts「M22-10: 操作画面で島を押すと、そのセルに境界の帯と浮かぶ印が出て、別のセルで移り、層を替えても残り、新しい島で消える」。#cell-info の「セル (x, y)」と、読むだけの `__sceneSelection()` の帯の範囲・印の位置を突き合わせる。気温の重ね図・森の種の層に替えても残る
  - 消す側の確かめ: main.ts で null を渡さないようにすると、このテストは「新しい島で消える」で落ちる(手元で確かめて戻した)
- [x] 予算: 操作画面の draw call の増え(renderer.info の前後)が数個の内。毎フレーム geometry を作り直さない
  - 自由モード `/`、止めた島、既定のカメラで renderer.info.render.calls: 選ぶ前 4 → 選んだ後 6(+2、帯と印)。E2E で `before + 2` を確かめる
  - 帯の頂点(8 標本 × 4 辺 × 2 = 64 頂点)は作った Float32Array をその場で書き換える。書き直すのは tick・セル・帯の幅(カメラの距離)が変わった時だけ。印は位置と大きさだけ
- [x] pnpm run check・E2E が通り、evidence に commit SHA とテストファイルを記す
  - pnpm run check: vitest 110 files・1056 tests、worker 66 tests、scripts 42 tests(5d7348f)
  - E2E を 1 worker で: cellHighlight・smoke 25 件、chronicle・persist・scenarioSave・observe 22 件、計 47 件すべて通る

## 既知の制限

- 既定のカメラ(128 セルの島を全部見る遠さ)ではセルが画面で数 px なので、帯は小さな四角に見える。見つけやすさは主にピンが担う
- 帯は深さを比べて描くので、手前の山に隠れたセルの帯は見えない(ピンは上に浮くので多くは見える)
- `__sceneSelection()` は観察画面の `__observeStats` などと同じく本番のビルドでも入る(読むだけ)。M19-16 の開発用の手段の gate には入れていない
- 印の上下は島を止めていても続く(描画は毎フレームなので)

## 作業ログ

- 2026-09-28: ユーザーの判断で、示す先を観察画面から操作画面(SceneView)に改めた(e55a0d2)。帯は 1 px の線 (Line) では遠いと見えないので、幅のある帯の Mesh にし、幅をカメラの距離で変える。地形の面の高さは PlaneGeometry の三角形の割り方どおりに補間し、three の Raycaster と一致することを単体テストで確かめた。
- 古くなって消していないコメント: なし。
