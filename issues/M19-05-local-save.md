---
id: M19-05
title: 手元の保存(IndexedDB、自動保存と手動の枠)
status: review
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: []
evidence: ["db25aaf cdc5a4b b994d1f 5c4366e src/persist/islandStore.ts src/persist/localSave.ts src/persist/slots.ts tests/unit/persist.islandStore.test.ts tests/unit/persist.localSave.test.ts tests/e2e/persist.spec.ts"]
---

# 手元の保存(IndexedDB、自動保存と手動の枠)

優先度: Must(設計書のドライバの優先度)

## What to build

B2。SaveData と年代記を IndexedDB に置く(`src/persist/islandStore.ts`)。localStorage は 5 MB 前後で SaveData を複数持てない。サーバーは関わらない。今の `onSave: () => world.serialize()` の延長。

## Blocked by

None (can start immediately)

## Acceptance criteria

- [x] 自動保存(N tick ごと)と手動の枠の保存・読込・一覧(fake-indexeddb で単体テスト)
  - 証跡: db25aaf・cdc5a4b・b994d1f・5c4366e。`src/persist/islandStore.ts`(置き場)、`src/persist/localSave.ts`(方針)、`src/persist/slots.ts`(枠のモデル)
  - `tests/unit/persist.islandStore.test.ts`: 「手動の枠に保存した島を読み込むと、続きが同じに進む」「空の枠は null を返す」「一覧は保存した枠だけを、自動・枠 1・枠 2・枠 3 の順に、保存した時刻と年で返す」「同じ枠へ保存し直すと上書きされ、枠は増えない」「脇へ退けた枠は一覧と読込から消え、退けた先の key を返す」「開き直しても (同じ IndexedDB の別の接続でも) 保存が残る」
  - `tests/unit/persist.localSave.test.ts`: 「前に書いてから N tick 進んだフレームで 1 回だけ書く (40 tick のフレームなら 120・240・360・480)」「前の書き込みが終わるまで次を書かない (serialize を重ねない)」「タブが隠れたら、周期を待たずに今の島を書く (一時停止中の島も残る)」「読み込んだ・新しくした島は、その場で自動の枠に書き、そこから数え直す」「枠へ保存すると一覧の行を返し、枠から読み込める。自動の枠は変わらない」「枠の島が読めない (restore が投げる) ときは null を返し、warn の記録に原因を残す」「書き込みの失敗は warn の記録に原因を残し、例外にしない」「IndexedDB が使えない (store が null) ときは何も書かず、枠は空として振る舞う」
  - E2E `tests/e2e/persist.spec.ts`: 「手動の枠に保存し、先へ進めてから読み込むと保存した島に戻り、開き直してもその島から続く」
- [x] 閉じて開き直すと続きから遊べる(E2E)
  - 証跡: db25aaf・cdc5a4b・b994d1f。E2E `tests/e2e/persist.spec.ts`: 「閉じて開き直すと、止めた所の続きから遊べる (自動保存と、隠れたときの書き込み)」(止めた tick を IndexedDB から読み、開き直したページの `persist.resumed` の tick と比べる)、「「新しい島」は確かめてから Year 0 に作り直し (取り消せば今の島のまま)、開き直しても新しい島から続く」
  - 単体: `tests/unit/persist.localSave.test.ts`「自由モードは自動の枠の島から再開し、そこから N tick 数えて書く」「自動の枠が空なら null (新しい島で始める)」「読めない自動の枠 (版違いなど) からは再開せず、脇へ退けて残し、新しい島を普段どおり自動保存する」
- [x] シナリオ中の読込は予言と矛盾するので無効、の既存の規則を保つ
  - 証跡: db25aaf・b994d1f。`src/main.ts` の `load` の `if (runner) return; // シナリオ中の読込は予言と矛盾するので無効` はそのまま残し、枠の読込(`onSlotLoad`)と「新しい島」(`onNewIsland`)も同じ guard を通す。HUD はシナリオ中、ファイルの読込・枠から読込・新しい島を押せなくし、title に理由を出す(`setReplaceable(!scenario)`)
  - E2E `tests/e2e/persist.spec.ts`「シナリオ中は島を差し替えられず (予言と矛盾する)、自動保存からも戻さず、自動の枠にも書かない」。単体 `tests/unit/persist.localSave.test.ts`「シナリオは自動の枠から戻さない (シナリオ中の読込は予言と矛盾する)」「シナリオでは自動の枠に書かない」
- [x] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す
  - 証跡: b994d1f で `npm run check` 735 件すべて通過(85 ファイル)、Playwright 32 件すべて通過(このうち persist.spec.ts は 4 件)。5c4366e の後に、persist の単体テスト 19 件を「5 回の繰り返しを 10 回」回してすべて通過、persist.spec.ts 4 件も通過

## 作業ログ

- 2026-09-26: 実装(db25aaf)→ レビュー 3 回(cdc5a4b・b994d1f・5c4366e)。codex CLI は認証切れ(`Your access token could not be refreshed`)で動かず、代わりに `pstack:thermo-nuclear-code-quality-review` の手順で別の agent にレビューを頼んだ。
  - 形: IndexedDB `biotope-island` の v1 に、object store を 2 つ作る。`saves` は key が枠の id で、値が SaveData。`slots` は一覧の行 `{slot, savedAt, year}` を持つ。`chronicle`・`outbox`・`keys` は、使うチケット(M19-06・M19-09)が `UPGRADES` の末尾に版を足して作る。使わない store は先に作らない。
    - 一覧の行を分けた理由: Chromium で size 128 の SaveData 4 件を `getAll` すると 124〜160 ms かかり、1 件の `get` でも 61〜123 ms かかる。設計書 §3.1 にも反映した。
  - 枠: 自動の枠 1 つと、手動の枠 3 つ。自動の枠へは自動保存だけが書く。
  - 自動保存の周期: 90 tick(1 季節)ごとに書く。1 倍速で 90 秒、100 倍速で 1 秒ほどになる。
    - 実測(node、size 128): serialize は 3.2 ms、fake-indexeddb への書き込みは 6.1 ms、90 tick の計算は 541 ms。保存の手間は計算の 2% に満たない。SaveData は JSON にすると 1.62 MB。
    - 周期のほかに、次のときも書く: タブが隠れたとき(`visibilitychange`)、読込の直後、新しい島の直後。
    - 書き込み中は次を書かない。
  - 方針は `src/persist/localSave.ts` にまとめ、自由モードかシナリオかを 1 回だけ決める。
    - 自由モード: 開くと自動の枠から再開する。
    - 「新しい島」のチップを足した。確かめのダイアログを通してから作り直す。自動保存から再開するので、開き直しても新しい島にはならず、このチップが要る。
    - 読めない自動の枠(版違いなど)は `unreadable:auto` へ退け、新しい島を普段どおり自動保存する。
  - シナリオの差(残した差): シナリオの島は自動の枠から戻さず、書きもしない。
    - 理由 1: runner の状態(力・年表・警告・startTick)は SaveData に無い。
    - 理由 2: ScenarioRunner にはこのチケットで触れない約束がある。
    - 理由 3: シナリオ中の読込は予言と矛盾する。
    - このため、シナリオの途中で閉じると、開き直したときは石板の初めからになる。設計書 B2 の「予言は 200〜500 年あり、1 回では終わらない」を満たすには、続きのチケットが要る。案: 年代記(M19-06)の seed と命令から、シナリオの島と runner を回し直して戻す。SaveData に runner の状態を足す案より、予言との矛盾が起きない。
  - devDependency に `fake-indexeddb` ^6.2.5 を足した。理由: 単体テストは node の環境で動き、IndexedDB が無い。依存は 0 件。
    - node_modules は親の共有の木へのリンクを外し、この worktree に `npm ci` で入れた。package.json と package-lock.json をコミットした。
    - lock の `license` が ISC から MIT に変わった。package.json に合わせて npm が直したもの。
  - 注意: db25aaf を一度開いたブラウザは、同じ v1 でも store の形が違う(`saves` の keyPath が `slot`、`slots` が無い)。そのため保存が NotFoundError で失敗する。まだ出荷していないので、移行は作らない。開発で開いたブラウザは、localhost のサイトのデータを消す。
  - E2E: 全体を回したとき、`smoke.spec.ts` の「warnings: 種 id 付きの警告 (狼の波)…」が 1 回だけ落ちた。石板を描き直している間にチップが DOM から外れていた。単独で 3 回回すとすべて通り、全体をもう一度回すと 32 件すべて通った。このチケットの変更とは関係が無い。
  - レビューで直したこと:
    - 新しい島の入口
    - 方針を localSave へまとめた
    - 読込の直後と、隠れたときの書き込み
    - 読めない枠の退避
    - transaction の abort の原因を記録する
    - 一覧の store を分けた
    - 枠の読込の失敗を記録する
    - 種が変わったら描き直す
    - E2E の競合をなくすため、IndexedDB を直に読む
    - 単体テストの待ち方(7 回中 2 回落ちていた)
  - 見送った指摘:
    - `setReplaceable` は、既存の `setShipEnabled` にならって setter のままにした。
    - `onblocked` と、`versionchange` で閉じた後の扱い。まれなので見送った。
    - `resume` で自動の枠の読込そのもの(IDB)が失敗した場合、「空」と同じに扱う。まれなので見送った。

- 2026-09-27 受入試験(.claude/acceptance、http://localhost:5392): a-free-resume 合格「スコープ外だが、修正タスク二つ登録 / マウスでセルを選択したときに、3D画面上でどこを選択したかわかるようにしてほしい。例えば、対象セルの境界線をハイライトし、その上部に矢印・ピンなど浮かせておく。 / 「新しい島」「枠から読み込み」その他、やり直しの効かない破壊的変更は確認ダイアログを経由すること」 → 直しは M19-15・M19-16・M19-17、登録は M21-04・M22-10
