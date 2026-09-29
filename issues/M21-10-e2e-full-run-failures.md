---
id: M21-10
title: E2E の通しでだけ落ちる 2 件 (枠の読込の確かめ・石板の出港)
status: review
milestone: M21
plan: null
depends_on: []
evidence: ["485f11d src/render/SceneView.ts tests/e2e/sceneIdle.spec.ts tests/e2e/confirm.spec.ts tests/e2e/harbor.spec.ts", "6bd1374 tests/e2e/confirm.spec.ts tests/e2e/scenarioSave.spec.ts"]
---

# E2E の通しでだけ落ちる 2 件 (枠の読込の確かめ・石板の出港)

優先度: Must

## 症状

`CI=1 pnpm exec playwright test` の通し (83 件) で、次の 2 件が feat/m19 の 2da66c4 でも基点の 702a38b でも毎回落ちた。1 件ずつ回すと通る (36 秒)。

- `tests/e2e/confirm.spec.ts:111`「M21-04: 枠の読込とファイルの読込は…」: 60 s の時間切れ。落ちる所は回ごとに違う (130 行の `#slot-load` の押し、122 行の `#speed-100` の押し、140 行のダイアログの toBeVisible)
- `tests/e2e/scenarioSave.spec.ts:108`「M19-17: 石板で枠に保存し…港へ出すと…」: 145 行、出港の後の文が「港へ運んでいる…」のまま 5 s 切れ。harbor.spec の出港の文 (128・183・373 行) も同じ形で落ちることがある

## 原因

操作画面の 3D の島 (`src/render/SceneView.ts`) が、見た目の変わらないフレームも毎フレーム `renderer.render` で描き直していた。
E2E の Chromium には GPU が無く WebGL はソフトウェアで描くので、止めた島の 1 ページが CPU を 2 コア余り使い続け、フレームは 8 fps ほどに落ちる。
通しは 5 worker で回る (この系統の playwright.config.ts には CI で 1 worker にする行が無い。main の 95a4385 にはある) ので、10 コアの機械が埋まり、Playwright の 1 歩 (要素の解決・押し・読み) が 1〜3 秒かかる。
歩数の多い confirm.spec:111 (60 s に 30 歩ほど) と、出港の後の 5 s の待ち (Turnstile の読み込み・IndexedDB・港の写しへの往復) が先に切れる。

証拠 (scratchpad/m21-10/ の記録):

- 通しの trace (run1、修正前、5 worker): confirm.spec:111 は goto から `#speed-100` の押しまで 1 歩ごとに 1〜3 秒かかり (枠へ保存の押しだけで 13.8 s)、どこかで止まったのではなく全部が遅い。scenarioSave.spec:108 も同じ
- 止めた自由モードのページの CPU (Playwright の Chromium、10 秒、`idle_cpu.mjs`・`idle_cpu2.mjs`): 修正前 228〜277% で rAF 79〜93 回。WebGL の draw を何もしない関数に替えると 5〜6% で rAF 601 回。空のページは 1%。CPU はほぼ全部が描き直し
- 1 worker にしても、ほかの worktree の E2E が同じ機械で回っている間 (load 30〜40) は confirm.spec:111 が時間切れで落ちた (run2)。worker の数ではなく、1 ページの描き直しの重さが根

## 直し

- `SceneView.update` は、見た目が変わったときだけ描く。描き直すのは: tick か層が変わって地形とインスタンスを置き直したとき、カメラが動いたとき (OrbitControls の change。ホイールとドラッグは controls が自分の update でカメラを動かすので、毎フレームの update の返り値には出ない)、選んだセルの強調が出た・消えた・動いた (浮き沈み) とき、大きさが変わったとき、火山の誘導を出し入れしたとき、WebGL の文脈が戻ったとき
- 修正後の止めたページは CPU 4%・rAF 601 回、1x で 33%・rAF 578 回 (修正前は 1x で 248%・rAF 109 回)
- 描き直しが速くなったら、遅さに隠れていた試験の競りが 4 つ出た。どれも試験の待ち方を直す (待つものを足す。時間は延ばさない)
  - confirm.spec の枠の読込 (111 行、直した後は 125 行) の最後: ファイルの読込を受けた直後に HUD の日を読んでいた。HUD は次のフレームで読んだ島を写すので、年が写るのを待ってから日を比べる (その前の枠の読込と同じ形)。直した直後に 1 件ずつ回すと毎回ここで落ちた (trace で、島を戻した記録と HUD を読んだのが同じ 10 ms の内)
  - 同じ試験の自動の枠の一覧: 止めた後にも、前の自動保存から 90 tick 進んでいれば 1 回書く。書き終わる前に一覧を覚えると、取り消しの後に一覧の年が変わって落ちた (通しの run5 で「自動 · Year 3」を覚え、後で「Year 4」)。persist.saved の記録で、止めた tick と最後に書いた tick の差が 90 未満になる (もう書かない) のを待ってから覚える
  - harbor.spec:183: 閉港のまま自由モードへ移ると、開いた直後に預けを送り直す (閉港で断られる)。その送り直しが断られる前に港を開くと、送り直しが港に届いて先に出港し、開き直しの送り直しと POST が 2 回になる (1 worker の通しの trace で、自由モードのページの POST が 201、開き直したページの POST が 200)。送り直しが断られた (POST が 2 件目) のを待ってから港を開く
  - scenarioSave.spec:326 (渡された枠が読めない): 起動は load の後に置き場を開いてから渡された枠を読む。load の直後に置いた枠は、その自由モードのページが 8 回中 8 回読んだ (`sessionStorage` が空になり、そのページが persist.slot.load.failed を出す)。試験の記録はそのページから出ていて、移った先の石板のページは何も渡されていなかった。そのページが先に閉じられると記録が無く落ちる (run5)。起動を終えて HUD が出てから置く

## Acceptance criteria

- [x] 止めた島を描き直さず、層を替える・火山の誘導を出す・カメラを動かす・島が進むと描き直す (`tests/e2e/sceneIdle.spec.ts`、修正前は止めた後の 30 フレームで draw 124 回で落ちた。setVolcanoHint の描き直しを外すと火山の段で落ちるのも見た)
- [x] 選んだセルの印は浮き沈みする間だけ描き直し、動きを減らす設定では描かない (同じ spec)
- [x] `CI=1 E2E_PORT=5431 pnpm exec playwright test` の通しを 2 回、confirm.spec:111 (今は 125 行) と scenarioSave.spec:108 を含めて全部通る (6bd1374 で run6・run7 とも 81 passed・4 skipped、5.1 分、5 worker、load 10〜20)
- [x] `pnpm run check` が通る (vitest 1125・worker 66・scripts 73)

## 作業ログ

- 2026-09-29: 基点は feat/m19 2da66c4 (worktree m21-10、ブランチ feat/m21-10)
- 親の記録 (e2e.log・e2e-2.log・e2e-base.log) の先頭はどれも「Running 83 tests using 5 workers」。`CI=1` で 1 worker になるのは main の 95a4385 からで、feat/m19 には入っていない
- 修正前の通し (run1、5 worker、trace 付き): 21 件落ち、load 67〜70。ほかの worktree (m21-09) の E2E と重なっていた
- 修正前の通し (run2、1 worker): 4 件落ち (confirm.spec:111 の時間切れ、harbor.spec:183 の POST 2 回など)。途中で直しを入れたので、後半の結果は数えない
- 時間を延ばす・retry を足す・試験を弱めるはしていない。遅さの元 (毎フレームの描き直し) を消し、遅さに隠れていた 2 つの競りは待つものを足して直した
- 修正後の通し (485f11d の前の作業木): run3・run4 とも 81 passed。その後 run5 で、速くなって見えた競り 2 つ (自動保存の書き終わり・起動を終えてから渡す枠) で 2 件落ち、6bd1374 で直した
- 修正後の通し (6bd1374): run6・run7 とも 81 passed・4 skipped (shots の 4 件)、各 5.1 分
- codex は 2 回ともトークンの更新に失敗した (`codex login` のやり直しが要る)。代わりに別のモデル (opus) の読むだけのレビュアーに 485f11d と 6bd1374 を見せた。指摘 (層の段の数え方が弱い・減衰の説明が違う・火山と大きさの段が無い) を直し、再レビューで残りなし

## 分かっている限り

- この系統 (feat/m19) の playwright.config.ts には、main の 95a4385 の「CI では 1 worker」の行が無い。通しは 5 worker で回る。この票では足していない (描き直しを消した後は 5 worker で通る)。main を取り込めば入る
- 前からある: 島を差し替えても新しい島の tick が前と同じ (Year 0 Day 0 の島で「新しい島」、今の tick の枠を読む) だと、地形とインスタンスを置き直さない (SceneView の tick と層の比べ)。この票の前も同じ絵を描き直していただけで、見た目は変わらない
- confirm.spec の AUTOSAVE_TICKS (90) は src/main.ts の値を写している。main.ts を変えたら合わせる
