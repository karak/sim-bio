---
id: M21-05
title: UI 部品 (ウィジェット) を単体で試せる作りにする (ドラッグを含む)
status: todo
milestone: M21
depends_on: [M19-18]
evidence: []
---

# UI 部品 (ウィジェット) を単体で試せる作りにする (ドラッグを含む)

優先度: Should

## What to build

2026-09-27 のユーザーの問い:「いわゆるウィジェットやコンポーネントと呼ばれる独立したUI部品について、しかもドラッグという比較的複雑度の高いDOM操作のテストができるような設計になっているか」。答えは「なっていない」。

今の作り (feat/m19 250e90a):
- vitest は `environment: 'node'` で、jsdom・happy-dom・Testing Library が無い。`tests/unit/ui.*.test.ts` は文字列を作る関数 (formatCiv など) だけを試し、部品を組み立てて試すものは無い。
- src/ui の部品 (Tablet・Hud・Harbor・HarborVisit) は、innerHTML の文字列で組み、id で引き当てる工場関数。部品の外 (innerWidth・sessionStorage・getBoundingClientRect) を直に読み、差し替えの口が無い。
- src/ui/movable.ts は clampOffset だけが純粋関数で単体試験 3 件。ドラッグの状態 (pointerdown → move → up/cancel・pointerId の照合・矢印キー・位置の覚え) は閉包とリスナーの中にあり、tests/e2e/verdict.spec.ts の実ブラウザでしか試せない。
- 置き場所 (重なり) の契約を持つ部品が無い。M19-18 (「3D で見る」が石板に覆われた) は、別々の CSS (entry.ts と hud.css) の絶対位置の衝突だった。

## Acceptance criteria

- [ ] ドラッグを純粋な状態遷移 (状態 + 出来事 → 次の状態) に分け、画面の大きさ・位置の置き場は引数で渡す。pointerId の照合・キャンセル・矢印キー (Shift で大きく)・画面の内への寄せ・覚えの読み書きを単体試験で確かめる
- [ ] 部品の試験用に DOM の環境 (happy-dom か jsdom) と Testing Library (user-event) を入れ、部品の試験のファイルだけで使う (既存の node の試験は変えない)
- [ ] makeMovable と判定の板を部品として組み、user-event の pointer でドラッグ・キーで動かし、translate と覚えの中身を内容で確かめる
- [ ] 実の配置 (重なり・覆い) は Playwright に残し、部品ごとの「覆われない」試験の型を 1 つにまとめる (M19-18 の observeEntry.spec.ts を土台に)
- [ ] ほかの部品 (Tablet・Hud・Harbor) を同じ型へ移す範囲と順を決める (この票では移さない)
