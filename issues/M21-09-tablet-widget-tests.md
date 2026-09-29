---
id: M21-09
title: 石板 (Tablet) と確かめのダイアログを、部品の試験の型 (M21-05) へ移す
status: review
milestone: M21
depends_on: [M21-05, M21-07]
evidence: ["beabe81 src/ui/Tablet.ts src/ui/confirm.ts tests/unit/ui.tablet.view.test.ts tests/unit/ui.tablet.dom.test.ts tests/unit/ui.confirm.test.ts tests/unit/ui.confirm.dom.test.ts tests/e2e/uncovered.spec.ts"]
---

# 石板 (Tablet) と確かめのダイアログを、部品の試験の型 (M21-05) へ移す

優先度: Should

## What to build

M21-05 の「ほかの部品を移す順」の 1 番。範囲はその表の 1 行目のとおり:

| 部品 | 外への依存 (いま直に読むもの) | 範囲 |
|---|---|---|
| Tablet (石板の残り) と confirm.ts | setTimeout (flash)・URL.createObjectURL (持ち出しの保存) | update の文 (祈り・節目・警告のチップ・年表・力)、警告のチップの委譲 (onShowSpecies)、選びを選んだ直後に今の舞台へ戻す (M21-04)、判定の札 (もう一度・自由モードへ)・持ち出しの保存の出し分け。確かめのダイアログの focus・Esc・Tab の回り |

M21-05 と同じ 3 段で移す: (1) 部品の中の状態の移りを純粋な関数に分け、node の単体試験で確かめる。(2) 部品の外を引数の env で渡し、`// @vitest-environment happy-dom` のファイルで組んで user-event で押し、中身を内容で確かめる。(3) 置き場所は tests/e2e/uncovered.spec.ts の表に部品を足す。

振る舞いは変えない (リファクタリング)。M21-07 で出した src/app/place.ts (操作の確かめと行き先) は作り直さず、組み合わせの試験で使う。

## Blocked by

- M21-05 (部品の試験の型・happy-dom と user-event・uncovered.ts)
- M21-07 (舞台を移る操作の確かめは planOp が決める)

## Acceptance criteria

- [x] 石板の文と判定の板の文を、DOM に触れない純粋な関数に分け、node の単体試験で確かめる
  - beabe81 src/ui/Tablet.ts: `tabletViewOf(def, speciesNames, input): TabletView` (年・残り・祈り・節目・警告とチップ・年表・力) と `verdictViewOf(verdict, cargo, def, speciesNames): VerdictView` (題・理由・内訳・持ち出し)。update と showVerdict はこれを呼んで DOM に写すだけ。HTML の組み方 (innerHTML が同じなら書き換えない守り、警告の文をそのまま HTML に入れること) は前のまま
  - tests/unit/ui.tablet.view.test.ts (node、9 件)
    - tabletViewOf: 「年は石板の年数で止め、走っている間は「あと」を付け、判定が出たら理由だけを出す」「祈りは種類の文と残りの年数。祈りが無ければ null (行ごと隠す)」「節目は未到達のものだけを並べ、到達した年 (その年を含む) で消える」「警告は先頭の 3 つだけ。種の id を持つ警告にだけ「〜を見る」のチップを付け、名前の無い種は id で出す」「年表は件数を題に、直近の 6 件だけを「年: 文」で並べる」「力は budget のある石板だけ。力は切り捨て、直前の年の収入と維持費は 0 なら出さない」
    - verdictViewOf: 「題は生き延びた・次の島へ・滅びたの 3 つ。理由はそのまま出す」「内訳は介入の回数・陸地率・種ごとの数の 3 行。使った力は budget のある石板だけ。内訳が無ければ行も無い」「持ち出しの保存は escaped で持ち出しがあるときだけ、その持ち出しを出す」
- [x] 確かめのダイアログのキー (Esc・Tab の回り・ほかのキー) を純粋な関数に分け、node の単体試験で確かめる
  - beabe81 src/ui/confirm.ts: `confirmKeyOf(key, focus): ConfirmKey` (`{ kind: 'cancel' }`・`{ kind: 'focus', to }`・null)。onKey は受けたキーだけ preventDefault と stopPropagation をする (前と同じ)
  - tests/unit/ui.confirm.test.ts (node、3 件): 「Esc は取り消し (どの札に focus があっても)」「Tab は 2 つの札を回る。やめるからは確かめの札へ、それ以外 (確かめの札・板の外) からはやめるへ」「ほかのキー (Enter・矢印・文字) は受けない (札の既定の動きに任せる)」
- [x] 石板の外 (揺れを止める時計・持ち出しの Blob URL) を env で渡し、happy-dom で組んで user-event で押し、中身を内容で確かめる
  - beabe81: `createTablet(root, defs, def, onSelect, speciesNames, onShowSpecies, env?)`。`TabletEnv = { later(fn, ms), createObjectURL(blob), revokeObjectURL(url) }`。省略すると setTimeout と URL (main.ts は変えていない)
  - tests/unit/ui.tablet.dom.test.ts (happy-dom、14 件)
    - 石板の選び: 「自由モードと隠れていない石板を並べ、今の石板を選んだ状態で出す」「選んだ石板を知らせ、選びは今の舞台の表示へ戻す (移るときは開き直す。M21-04)」「自由モードでも、選んだ後は自由モードの表示へ戻す」
    - update: 「年・残り・祈り・節目・警告・年表・力を文で出す」「祈りが消えれば行を隠し、節目を過ぎれば消え、渡した節目 (迎撃で外したもの) があればそれを出す」「自由モードの石板は選びだけで、update は何もしない」
    - 警告のチップの委譲: 「「〜を見る」を押すとその種を開く。update でチップが差し替わっても押せる。警告の文を押しても何もしない」
    - 判定の札: 「判定を出すと題・理由・内訳を出し、「もう一度」は同じ石板を、「自由モードへ」は自由モードを選ぶ。閉じれば隠れる」「生き延びた・次の島へに出し直すと、色の組 (alive / escaped) を入れ替える」
    - 持ち出しの保存: 「次の島へ逃れて持ち出しがあれば、持ち出しの JSON を Blob URL で保存させる」(Blob の中身を JSON で読む)「出し直すたびに前の Blob URL を捨てる。持ち出しが無い・逃れていないなら札を隠す」
    - 揺れ: 「flash で石板を揺らし、300 ms 後に止める。揺れている間の flash も揺らし直す」
    - 石板と確かめのダイアログと planOp (M21-07) を main.ts の run と同じに組む: 「判定の出た石板の島で「もう一度」を押すと「判定の出た島を離れる」を確かめ、やめれば移らず、受ければ書き切って同じ石板へ移る」「判定の前の石板の島で石板を選び直すのは確かめずに移る (走っている島は書き切ってから移る)」
- [x] 確かめのダイアログを happy-dom で組み、focus・Esc・Tab・背景の押下・同時に 1 つだけを user-event で確かめる
  - tests/unit/ui.confirm.dom.test.ts (happy-dom、6 件): 「開くと題を名前・文を説明に持つ alertdialog (aria-modal) が出て、「やめる」に focus がある」「Tab と Shift+Tab は 2 つの札の間を回り、板の外へ出ない」「Esc は取り消しで、板を消し、開く前の札へ focus を返す。Esc も Tab も後ろの画面へは渡さない」「「やめる」に focus があるまま Enter は取り消し。確かめの札へ移って Enter で受ける」「札を押すと答え、背景を押すと取り消す。板の中の文を押しても閉じない」「開いている間の次の問いはその場で取り消しとして答え、開いている板はそのまま残って答えられる」
  - E2E (confirm.spec.ts) が縛っていなかった Shift+Tab・背景の押下・同時に 1 つだけ・Esc を後ろへ渡さないことは、ここで縛った
- [x] 置き場所を tests/e2e/uncovered.spec.ts の表に足す
  - beabe81 tests/e2e/uncovered.spec.ts: 「M21-09: 石板 (?scenario=test-quick) の選び・年・年表・力は、どれも覆われない」「M21-09: 判定の板が出ているときに開いた確かめのダイアログの札は、判定の板に覆われない」(「石板を初めから」で開く。M21-04 の判断待ちの確かめを通らない)
  - 型が覆いを見つけることの確かめ: hud.css の `.confirm` の z-index を 70 → 5 にすると 2 件目が `"やめる": "p#.harbor-line harbor-dim"` の差分で落ち、`.tablet` に `z-index: -1` を足すと 1 件目が `"石板の選び": "canvas#scene.scene"` ほか 4 つの差分で落ちた (戻して通ることも確かめた)
- [x] 試験を先に書き、配線に誤りを戻して落ちることを見る (変異)
  - 先に書いた試験を元の実装に当てた: 部品の試験 11 件 (石板の選び・update・チップ・判定の札・組み合わせ・確かめのダイアログ 6 件) はそのまま通り (振る舞いの縛り)、15 件は落ちた (`tabletViewOf is not a function`・`confirmKeyOf is not a function`、env を受けないので「expected [] to deeply equal [ 300 ]」「expected 'blob:nodedata:…' to be 'blob:cargo-1'」)
  - 変異 48 通り (Tablet.ts 34・confirm.ts 14) を 1 つずつ入れ、どれも新しい試験が落ちた (生き残り 0)。新しい 32 件のどれも、少なくとも 1 つの変異で落ちる。初めの回で「収支の片方だけでは出さない」「escaped の色を dead にも付ける」が生き残り、試験を足した
- [x] 振る舞いが変わらないことを、前の石板と並べて確かめる。E2E は全部そのまま通る (CI=1・1 worker)
  - 前の Tablet.ts (HEAD) と新しいものを happy-dom に並べ、乱数の入り (石板 2 つと自由モード × 200 回 × 30 手の update・showVerdict・hideVerdict) で root の innerHTML と Blob URL の出し入れの順が一致した (捨てた道具。下の作業ログ)
  - `pnpm run check` と E2E の数は下の作業ログ

## 作業ログ

- 2026-09-29: 基点は feat/m19 2da66c4 (worktree m21-09、ブランチ feat/m21-09)。実装は beabe81
- 移したコードのコメントは文を変えずに一緒に移した (節目は未到達のものだけ・種レイヤーへの案内チップの 2 行・直前の年の収入と維持費)。消した・書き換えたコメントは無い
- 振る舞いの差は無い。仕事の量の差が 1 つ: 年表の行 (describeEvent を多くて 6 件) を、前は件数が変わったときだけ作っていたが、今は update のたびに作る (描き直すのは前と同じく件数が変わったときだけ)。毎フレームの 6 回の文の組み立てで、見て分かる差は無い
- 同じ並べの道具 (前と新の石板の innerHTML の比べ) と変異の道具 (mutate.py) は scratchpad に置いた (セッションとともに消える)
- codex はトークンを更新できずに止まった (「Your access token could not be refreshed. Please log out and sign in again.」)。代わりに別のモデル (fable) の読むだけのレビューを実装後と直した後に 2 回回した。1 回目は high・medium 無し、low 5 件 (年表の行を毎回作る・試験の keydown リスナーを外していない・判定の待ち 60 s を confirm.spec と同じ 90 s に・getByRole の exact・色の class の並び順まで縛る)。1 件目は上のとおり残し、ほかの 4 件は直した。2 回目は、直しがどれも正しく、新しく入った問題は無い
- `pnpm run check` (直した後): vitest 118 files・1157 tests (todo 1)、worker 5 files・66 tests、scripts 73 tests で通った
- E2E (CI=1・1 worker・E2E_PORT=5432): 85 件のうち 75 件が通り、4 件は shots.spec (ACCEPTANCE_DIR が無いので skip)、6 件が落ちた。落ちた 6 件のうち confirm.spec.ts:111 は基点でも落ちる既知のもの (m21-10 が直している)。ほかの 5 件 (harbor.spec.ts:128・183・373、confirm.spec.ts:237 の「港へ運んでいる…」のまま 5 s・scenarioSave.spec.ts:326 の記録の poll 5 s) は待ちの切れで、並べて動く agent の負荷で load average が 34〜40 あった。この 5 件だけを回し直すと、どれも通った (1.3 分)
  - 既知の 2 件 (confirm.spec.ts:111・scenarioSave.spec.ts:108) は単独で回して、どちらも通った (48 s・43 s)。scenarioSave.spec.ts:108 は通しでも通った
- M21-04 の慎重な確かめ 2 つ (書いてある枠への上書き・判定の出た島での「もう一度」) は、いまの振る舞い (確かめる) のまま試験に書いた。答えで変わる試験は次の 1 件
  - tests/unit/ui.tablet.dom.test.ts「判定の出た石板の島で「もう一度」を押すと「判定の出た島を離れる」を確かめ、やめれば移らず、受ければ書き切って同じ石板へ移る」(「もう一度」の確かめを外すなら、確かめずに flush・go になる)
  - 書いてある枠への上書きは Hud の札 (M21-05 の順の 2 番) なので、この票の試験には入っていない。uncovered.spec.ts の 2 件目は、答えで変わらない「石板を初めから」で確かめのダイアログを開く

## 分かっている限り

- 判定の板のドラッグは TabletEnv に入れていない (makeMovable の既定の env のまま。M21-05 の「分かっている限り」のとおり、判定の板の寄せは verdict.spec.ts で見る)
- happy-dom は `{Tab}` の既定の focus の移りを持つので、確かめのダイアログの「板の外へ出ない」は preventDefault を外す変異で落ちることを見た。実のブラウザの Tab の回りは confirm.spec.ts が見る
- 警告と節目の文は、前と同じくそのまま HTML として入る (エスケープしない)。文は石板の定義と警告の組み立てから来るので、港など外からの値は入らない
