---
id: M19-17
title: シナリオ中の保存・読込・初期化と URL・ゲームの状態の一貫性(仕様の見直し)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-14]
evidence: ["b708e83・92a13d1・490ef43 tests/unit/persist.slotSave.test.ts tests/unit/ui.hud.test.ts tests/e2e/scenarioSave.spec.ts tests/e2e/persist.spec.ts"]
---

# シナリオ中の保存・読込・初期化と URL・ゲームの状態の一貫性(仕様の見直し)

優先度: Should

## What to build

受入試験(2026-09-27、a-scenario-resume 保留)のユーザーのメモ原文:「左の仕様としては正しい。正しいが、枠に保存だけできて読み込みができない。初期化もできないというのは制限事項に思える。仕様から見直し、保存できるようにしたうえで、URLと内部ゲーム状態管理を一貫性のあるものにするタスクを積むこと」

今の仕様: シナリオ中は枠へ保存だけでき、枠から読込・新しい島(初期化)ができない(「シナリオ中の読込は予言と矛盾するので無効」)。URL(`?scenario=`・`?visit=`)と、手元の自動保存・続きからの関係も場当たりになっている。
仕様から見直す: シナリオ中にも保存と読込(同じ石板の保存に限る、など)・初期化ができるようにし、URL が示すもの(自由モード・どの石板・訪問)と、手元の状態(自動の枠・手動の枠・続きから・判定の出た島)の対応を 1 つの表にして一貫させる。先に設計(状態の表と遷移)を書いてユーザーの承認を得る。

## Blocked by

M19-14

## Acceptance criteria

- [x] URL と手元の状態の対応表・遷移を設計に書き、ユーザーの承認を得る
  - docs/design/2026-09-27-scenario-save-url.md(ce9da4a)。2026-09-27 にユーザーが §6 の 1〜3(巻き戻しを許す・違う舞台の枠はその舞台へ移って読む・石板の中は「石板を初めから」)を案のとおり承認
- [x] シナリオ中の保存・読込・初期化が設計どおりに動き、予言と矛盾しない(同じ石板の保存だけを読むなど)ことを E2E で確かめる
  - 実装 b708e83・490ef43。src/persist/slotSave.ts(包み SlotSave・checkSlot・planSlotLoad・sessionStorage の受け渡し)、src/persist/scenarioSave.ts(checkScenarioSave を続きからの復帰と枠の読込で共有)、src/persist/islandStore.ts・localSave.ts・slots.ts(枠の包みと一覧の舞台)、src/main.ts、src/ui/Hud.ts・Tablet.ts
  - §7 の E2E は tests/e2e/scenarioSave.spec.ts(92a13d1)
    - 「石板で枠に保存し、介入して進めてから読むと、石板の年・力・年表・年代記が保存の時点に戻る。戻した島を判定まで回して港へ出すと、訪れた側の回し直しで同じ結末になる」
    - 「自由モードの枠を石板の中で読むと、確かめてから自由モード (/) へ移ってその島になり、石板の続きは書き換わらない」
    - 「石板の枠を自由モードで読むと、確かめてからその石板へ移り、開いた直後に枠の時点 (力・年表・年代記) から続く」
    - 「移った先で渡された枠が読めなければ、その舞台の自動の続きで開き、記録に残す」
    - 「「石板を初めから」は確かめてから Year 0・力の初期値・年表なしに戻し、判定の出た島は港の板に残る」
    - 「知らない石板の URL (?scenario=nope) は自由モードで開き、URL から scenario を消して記録に残す」
    - 「訪問 (他人の島) では枠への保存・読込・ファイルの読込・新しい島を押せない」
    - 「包みの無い古い枠とファイル (M19-17 より前の SaveData) は自由モードの島として読める」
  - 単体は tests/unit/persist.slotSave.test.ts(包み・舞台の確かめ・行き先・受け渡し・置き場)、tests/unit/ui.hud.test.ts の slotLabel
- [x] pnpm run check・E2E が通り、evidence に commit SHA とテストファイルを記す
  - pnpm run check: vitest 103 files・1007 tests、worker 64 tests、scripts 42 tests が通る(490ef43)
  - E2E: 下の作業ログ

## 既知の制限(2026-09-27、ユーザーが受け入れた)

- 訪問中もファイルの保存(ダウンロード)は押せ、自由モードの包み(`{stage:'free'}`)で書く。設計の表(§4)の外。
- 判定の後の枠への保存は、判定の板が画面を覆うので押せない → M21-04 へ移した。

## 作業ログ

- 2026-09-27: 設計(承認済み)のとおり実装した。
  - 枠とファイルは舞台を名乗る包み `SlotSave`。自動の枠も `{stage:'free', save}` で書く(置き場の形を 1 つにした)。包みの無い古い値と、舞台の無い一覧の行は自由モードとして読む。
  - 同じ舞台の枠は `window.confirm` のあと差し替える。石板では runner と年代記も戻し、記録器は命令の列だけを枠の年代記に差し替える。判定の前の枠なら判定の表示を閉じ、判定の後の枠なら出し直す。
  - 違う舞台の枠は、確かめたあと今の続きを書き切ってから移る。読む枠の名前は sessionStorage(`biotope-pending-slot`)に 1 回だけ置く。ファイルは saves の `import`(一覧に出ない)に置いてから移る。読めなければ、その舞台の自動の続きで開き、`persist.slot.load.failed` を残す。
  - 石板を選ぶ・自由モードへ移るときは、`localSave.flush` と石板の続きの書き込み(どちらも Promise を返すようにした)を待ってから URL を変える。
  - 設計と違うところ: 知らない石板の URL では `scenario` と一緒に `visit` も消す(石板の無い訪問は成り立たないので)。訪問ではファイルへの保存(ダウンロード)は止めていない(設計の表に無い。自由モードの包みとして書く)。
  - 残り: 判定の板(#verdict)は画面全体を覆うので、判定の後に HUD の「枠へ保存」を押す道が画面に無い。コードは判定の後の保存・読込を受ける。板を閉じる手段は M21-04 か別チケットで。
  - E2E: tests/e2e/scenarioSave.spec.ts 8 件、persist.spec.ts・harbor.spec.ts は 1 worker で全件通る。全体を 5 workers で流すと、重い機械の上で港の出港の待ち(5 秒)と 60 秒の上限に掛かるものが 5 件出た(harbor.spec.ts:144 は M19-17 の前から時間ぎりぎり)。同じ 5 件は 1 worker で通る。全体を 1 worker で流すと 57 件すべて通る(12.4 分、490ef43)。
- 2026-09-27: feat/m19(M19-15・M19-16)を merge した(915f931)。createHud の options を 1 つにし(speeds と石板の名前)、開発用の石板の差し替え(dev.scenarioDef)を枠の読込で作り直す runner にも通す。知らない石板の URL で消すのは scenario と visit だけで、player・dev・shortcut は残す。tests/unit/dev.snapshot.test.ts を枠の包みに合わせた。merge の後に pnpm run check(vitest 109 files・1034 tests、worker 66 tests、scripts 42 tests)と、E2E 全体を 1 worker で 66 件すべて通した(12.6 分)。
