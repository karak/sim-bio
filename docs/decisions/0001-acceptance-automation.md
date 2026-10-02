---
status: accepted
date: 2026-10-01
decision-makers: ユーザー (2026-10-01 00:31 に判断 1〜6 を推奨どおり承認)
consulted: 調べと試しの agent (fable)
informed: M21 以降の票を受ける agent
---

# 人が判じている受入の見た目・読みやすさ・手触りを、検査・基準画・LLM の採点で機械に移す

受入の人の 1 周 (13 分) のうち、機械の性質に言い換えられるものは読みやすさの検査と基準画に移す。
言い換えられないもの (観察画面の絵・文の意味・ドラッグの手触り) は、手元の `claude -p` で採点表に当てて判じる。
人がするのは、基準画の更新の承認と、手触りの 1 分と、LLM の票が割れた画を見ることだけにする。
段を踏んで進め、人の分を 13 分から 1〜4 分に減らす。

## 背景と問題

受入の正本 `docs/acceptance/scenarios.jsonl` の human の行は、TUR-001 (5 分)・TUR-002 (4 分)・HBR-006・CRG-005・CNF-002・SEL-003 (各 1 分) の 13 分である (scenarios.jsonl の 15・16・54〜57 行)。
順と数と保存は auto の行の試験がもう見ている (docs/design/2026-09-29-acceptance-redesign.md §4)。
人に残っているのは、どの行の judge も「見た目・読みやすさ・手触り」だけである。

画で見る 4 行は、`tests/e2e/shots.spec.ts` が撮る前に、写すものの文を toHaveText で確かめ、`toBeInViewport({ ratio: 1 })` と `expectUncovered` をかけている (shots.spec.ts:65-71)。
しかし `expectUncovered` は部品の真ん中の 1 点しか見ない (tests/e2e/uncovered.ts:9-14、M21-05 の「分かっている限り」)。
2026-09-30 に、文字の箱ごとに 5 点を当てる試しを回すと、今の shots が pass する画に、次の 2 つの欠陥が写っていた。

- 左の縁の港の札 (x 0〜36・y 336〜384) が、#cell-info の「生気 / 枯死」「輝石」「草」の札を覆う (CRG-005-2・SEL-003-1〜3)。
- HUD のグラフの canvas は 640×200 で (src/ui/Hud.ts:168)、CSS では 320×100 に描く (src/ui/hud.css:23)。軸の字 `10px` と目印の字 `bold 18px` (src/ui/graph.ts:6-7) は、画面の上で 5px と 9px になる。CRG-005 で人が読む「漂着 (狼・鹿)」がこの 9px の字である。

人が 13 分かけて見ても、この 2 つは残っていた。
人の目は毎回同じ所を同じ厳しさで見るわけではないので、機械で判じられる性質は機械に移したほうが確かである。

## 決める要因

- 人の分を減らす。待ちを含めて 15 分までという今の予算 (redesign §2.1) を、数分にする。
- 機械が判じた結果が、同じ状態で同じになる (揺れで赤にならない)。
- 本番のビルドに試験のための口を入れない (docs/operations/acceptance.md の「本番のビルドには入らない」)。
- 鍵と課金を増やさない。手元の Claude Code の認証で回せる。
- 今の正本・acceptance.py・審査台 (.claude/localreview) の流儀を壊さない。

## 検討した案

| | A. 検査の層だけ | B. 検査 + 製品の口 + 基準画 + driver + 手元の LLM | C. Gherkin の実行器で steps をそのまま回す |
|---|---|---|---|
| 中身 | shotsOf に読みやすさの検査を足す | A に、撮る状態の決定論 (製品の口)・基準画・ドメインの driver・`pnpm run judge` を足す | playwright-bdd などで steps の文を正規表現に結び、steps を実行する |
| 見つかった 2 つの欠陥 | 見つける | 見つける | 見つけない (文の実行だけで、見た目の性質を持たない) |
| 画の揺れ (下の付録 B) | 残る | 元の 3 つを消す | 残る |
| 3D の絵・手触り | 人に残る | 絵は LLM、手触りは人の 1 分 | 人に残る |
| 本番の口 | 残る (この ADR の外の票で閉じる) | 同じ。口の境界の型を決める | 残る |
| 人の分 | 13 → 12 分 | 13 → 1〜4 分 | 13 分のまま |
| 費用 | 小 | 中 (8 票) | 大 (日本語の文の結びと、正本と .feature の 2 か所持ち) |

C は捨てる。
steps の文は人が読む日本語で、正規表現に結ぶと文を直すたびに試験が壊れる。
正本を jsonl に置いたまま .feature を持つと、M21-06 が退けた「同じことを 2 か所に持つ」になる (redesign §6)。

A は B の段 1 と同じもので、B の最初の段として含める。
A だけで止めると、揺れのために基準画が使えず、画の 3 行 (CRG-005・CNF-002・SEL-003 の見た目) と TUR の 9 分が人に残る。

## 決定

案 B を選ぶ。
見つかった欠陥と揺れの元 3 つのどれにも手が届き、人の分をいちばん減らすからである。

### 人の判断を機械の性質に言い換える

| 人の判断 | 機械の性質 | 置き場 |
|---|---|---|
| 文が読める | 文字の箱ごとに 5 点で覆われていない (elementFromPoint)。画面の内にある。切れていない (scrollWidth。訪問のリンクの欄のように横に送る欄は許す欄の表に書く)。コントラスト比 4.5 以上 (背景は文字を透明にして撮った画から取る。押せない札は除く)。画面の上の字が 11px 以上 (canvas は `font × clientWidth / width`) | 段 1 の lens |
| 文が決まった語を含む | 今の toHaveText | そのまま |
| 帯とピンで場所が分かる | 今の `hiddenFrom`・`markerOnScreen` に、ピンだけを色で描いた画での見える画素の面積と、周りとの ΔE76 を足す (M6 の tools/blender/compare_ref.py の ΔE と IoU の考え方) | 段 2 の口と段 3 |
| 板と札の見た目 | 要素ごとの画と基準画の差 | 段 3 |
| 観察画面の絵・文の意味の適切さ | 採点表の問いに yes / no で答える LLM の 3 票 (付録 A) | 段 5 |
| ドラッグの手触り | 付いてくること・画面の外へ出ないことは verdict.spec.ts と ui.movable.dom.test.ts が見ている。気持ちよさだけが人に残る | 人の 1 分 |

### テストドライバ

`tests/driver/` に、Page を受け取るドメインの型 (Island・Harbor・Verdict・Camera) を置く。
いま `routeHarbor` は 5 つの spec に (confirm.spec.ts:20・devtools.spec.ts:45・harbor.spec.ts:34・scenarioSave.spec.ts:17・shots.spec.ts:22)、`shownTick` は 4 つの spec に写しで書かれている (confirm・devtools・persist・scenarioSave)。
driver はこれを 1 つにし、shots.spec.ts から移す。

Gherkin の文と driver の呼び出しを 1 対 1 に結ぶことはしない (案 C を捨てた理由と同じ)。
代わりに、正本の【見た目】【読みやすさ】【手触り】の札の付いた手順ごとに、`checks: [{lens, target}]` か `judge: "llm" | "human"` を持たせる。
acceptance.py check は、札の付いた手順に checks も judge も無ければ落とす。
今の covered_by の題名の一致 (scripts/acceptance.py:345-384) と同じ流儀で、試験の実在を検査が見る。

### 製品側に足す口と、その境界

- **読むだけの口**: SceneView と観察画面は、window に書かず、`inspect()` という読むだけのメソッドを返す。window に載せるのは、`DEVTOOLS_BUILT` (src/main.ts:39) の下で動的に import する `src/dev/probe.ts` だけにする。本番に入らないことは、tests/unit/build.devtools.test.ts の MARKERS に `__scene`・`__observe`・`__probe` を足して縛る。
- **時計**: ピンの上下 (src/render/SceneView.ts:237 の `performance.now()`) と観察画面の `t` (src/observe/view.ts:941-951) に、時計を渡せるようにする。撮るときは `reducedMotion: 'reduce'` と観察画面の `freeze=1&dynres=0&auto=0&shot=<場面>` で止める。
- **tick で止める**: 開発の板に「tick N まで進める」を足す。今の CNF-002 は 100x で「Year 0 でなくなるまで」回して止めるので (shots.spec.ts:190-192)、止まる tick が回ごとに違う。
- **グラフ**: HUD はフレームごとに年の変わり目を拾って点を積む (src/ui/Hud.ts:497-499)。1000x ではフレームの間に年が飛ぶので、グラフの形がフレームの間隔で変わる。本体の年ごとに点を積むようにする。目印は canvas の外にも文で出す (aria の説明)。今の fillText を差し替える手口 (shots.spec.ts:129-139) が要らなくなる。
- **ピンの ID 描き**: ピンだけを 1 色で描き、地形の深さで隠れる所は描かない描き方を、probe から呼べるようにする。

M21-05 の順の 2 番 (Hud) と 3 番 (Harbor・HarborVisit) の部品化は、段 3 の後に回す。
部品化は振る舞いを変えないリファクタリングで、段 3 の基準画がその安全網になるからである。

### 基準画の閾値

基準画は要素ごとの画 (clip) で撮り、画面全体では撮らない。
3D の canvas の範囲と DOM の板を別の画にすると、片方の揺れがもう片方の判定に入らない。

閾値は、画素ごとの色の差を Playwright の既定 `threshold: 0.2` (YIQ の距離) で数え、要素の画の `maxDiffPixelRatio: 0.02` とする。
差 0 にしない理由は付録 B の 2 の測りによる。
確かめの板の画 (69,560 画素) で、字の描き方を変えた場合 (`text-rendering: geometricPrecision`、フォントの描きの更新の代わり) は閾値を越える画素が 696 (1.0%) だった。
字の太さを 400 から 500 にした場合は 562 (0.8%) で、字の描き方の更新と見分けがつかない。
一方、板が 2px ずれると 4,305 (6.2%)、文の 1 字が変わると 3,039 (4.4%) で、2% の閾値で落ちる。
字の太さと色は画の差ではなく段 1 の lens (字の大きさ・コントラスト) で見るので、基準画の役目はずれと文の変わりに絞る。

差 0 にすると、macOS か Playwright の Chromium を上げるたびに 13 枚が全部赤になる。
撮り直しは `pnpm run shots` の 1.2 分と、13 組の前後の画を見て承認する 2〜3 分である。
費用そのものは小さいが、全部が赤の回が続くと、人が中身を見ずに一括で承認するようになる。
基準画の承認を人の判断の中心に置くので、承認の 1 回ごとに見る差が本物の変わりであることを優先する。

基準画には、撮った Chromium の版 (今は `chromium-1243`) と macOS の版を添える。
版が変わった回は、閾値の内なら版だけを書き換え、閾値を越えた画だけを審査台に並べる。

### LLM の判定

`pnpm run judge` は、scripts から手元の `claude -p` を呼ぶ。
鍵は持たず、Claude Code の認証をそのまま使う (`--bare` は ANTHROPIC_API_KEY しか読まないので使わない)。
1 枚の画に対して 3 回呼び、問いごとの多数決を取る。
3 票がそろわない問いと、no の問いだけを人に見せる。
画素の基準を持つ画は、LLM の yes だけでは合格にしない。基準画と閾値の内で一致した画だけが、人を通らずに合格する。
観察画面は画素の基準を持たないので (付録 A)、3 票そろった yes で合格とし、人は並べて渡す基準画を替えるときにだけ承認する。

2026-09-30 に 2 枚の画で試した結果は付録 B の 4 にある。
1 回の呼び出しは 10〜14 秒、CLI が示す換算額は 0.015〜0.033 USD、5 問 × 2 枚 × 3 回で答えはどれもそろった。

CI では回さない。
CI は ubuntu で (.github/workflows/ci.yml:10)、Claude Code の認証も基準画も無い。
CI で回すのは、段 1 の lens (環境に依らない性質) と今の E2E である。

## 結果

### 良い面

- 人の分が 13 分から 1〜4 分になる (段ごとの減り方は下の表)。
- 人が 13 分かけて見落としていた覆いと小さすぎる字を、次から検査が落とす。
- 撮る状態が決定論になり、基準画の差が本物の変わりだけを指す。
- 本番のビルドから試験の口が消え、build.devtools.test.ts がそれを縛る。
- spec の写しの関数が driver の 1 か所になる。

### 悪い面

- 8 票の作業がかかる。
- 基準画は手元の Mac でしか持たない。CI は基準画の差を見ない。
- 字の太さや 16 段ほどの色の変わりは基準画では落ちない (付録 B の 2)。lens が見る範囲 (字の大きさ・コントラスト) の外の見た目の変わりは、LLM の採点か人に頼る。
- LLM の判定は採点表の問いの外を見ない。問いの書き方が判定の質を決める。
- 製品に `inspect()` と時計の引数が増える。

### 確かめ方

段ごとの完了の条件 (下の表) を票の Acceptance criteria にする。
この ADR に従っているかは、acceptance.py check (札の付いた手順に checks か judge がある) と build.devtools.test.ts (本番に口が無い) が縛る。

## 段と票

票は issues/M25-01〜M25-08 に起こした (2026-10-01)。
人の分は、今の 13 分 (TUR-001 5・TUR-002 4・画の 4 行 各 1) から数える。

| 段 | 票 | 中身 | 依存 | 完了の条件 | 人の分 |
|---|---|---|---|---|---|
| 1 | M25-01 | 読みやすさの lens (覆い 5 点・画面の内・切れ・コントラスト・画面の上の字の大きさ) を shotsOf に入れる。コントラストと字の大きさの計算は純粋な関数にして vitest で試す。読みやすさだけを判じる HBR-006 を auto に移す | なし | 今の feat/m19 で `pnpm run shots` が赤になり、差分に「港の札 (button.harbor-dock) が #cell-info の 生気 / 枯死・輝石・草 を覆う」と「#graph の字が 5px・9px」が出る。仕込んだ変異 (hud.css の `.confirm` の z-index を下げる、確かめの文を板の幅より長くする) でも赤になる。M25-10・M25-11 を直すと緑になる | 12 分 (HBR-006 が機械へ) |
| 2 | M25-02 | 撮る状態の決定論: `reducedMotion`、tick で止める口、グラフを本体の年ごとに積む、ピンと観察画面の時計、ピンの ID 描き | M25-09 | `pnpm run shots` を 2 回撮り、13 組の画がどれも閾値の内に収まる。今は CNF-002-1/2 が 0.8%、HBR-006-1/2 のグラフが 0.14% ずれる (付録 B の 3) | 12 分 |
| 3 | M25-03 | 要素ごとの基準画、閾値、版の記録、審査台で前後を並べる更新の手順。CRG-005・CNF-002・SEL-003 を auto に移し、covered_by を基準画の試験にする | 段 2 | `.confirm-box` を 2px ずらすと落ち、`text-rendering: geometricPrecision` では落ちない。審査台に前後の画が出て、承認すると基準画が書き換わる | TUR 9 分 + 承認 0〜2 分 |
| 4 | M25-04 | `tests/driver/` (Island・Harbor・Verdict・Camera)。shots.spec.ts から移し、写しの関数を消す | 段 2 | `routeHarbor` が 5 → 1、`shownTick` が 4 → 1。E2E の数は変わらず全部通る | 変わらない |
| 4 | M25-05 | 正本の手順ごとの `checks` と `judge`。acceptance.py check と test_acceptance.py | 段 1 | 札の付いた手順から checks と judge を消すと check が落ちる (test_acceptance.py) | 変わらない |
| 5 | M25-06 | `pnpm run judge` (`claude -p` を 3 回、多数決、results.json に `judge: "llm"` と根拠を書く) | 段 3・M25-05 | 仕込んだ欠陥 (ピンを海の色にする・確かめの文を切る・観察画面の木を消す) を 3 票とも no で見つけ、承認済みの画は 3 票とも yes | 変わらない (判定の器だけ) |
| 5 | M25-07 | 観察画面の撮影 (`freeze=1&dynres=0&auto=0&shot=` の 集落・群れ・海岸) と採点表 (付録 A) | 段 2・M25-06 | 上と同じ条件を観察画面の 3 枚で満たす | TUR-001 の 3D が LLM へ |
| 6 | M25-08 | TUR の書き直し。TUR-002 は retired にして画の行へ移す。TUR-001 は手触りの 1 分にする | TUR-002 は段 3、TUR-001 は段 5 | acceptance.py check が通り、round の human の行が TUR-001 (手触り、1 分) だけになる | 1〜4 分 (手触り 1 + 承認 0〜2 + 票の割れた画 0〜1) |

段 5 と段 6 は、順を逆にしても値が出る。
TUR-002 の見るもの (帯とピン・受け取りの文と目印・確かめの板) は、SEL-003・CRG-005・CNF-002 の画がもう撮っているので、段 3 の後に TUR-002 を retired にできる。
TUR-001 の読みやすさの部分 (回避率の行・積荷の知らせ) も HBR-006 の画が撮っている。
段 6 を先にすると、段 5 の前に人の分は 13 分から 3〜5 分 (TUR-001 の 3D の絵とドラッグ 2〜3 分 + 承認 0〜2 分) になる。
残る TUR-001 の 3D の絵が LLM に移るのは段 5 の後である。

段 6 は 2026-10-02 に済んだ (M25-08)。TUR-002 は retired、TUR-001 は手触りの 1 分になり、round の human の行は TUR-001 だけである。

## この ADR の外で起こす票

次の 3 つは設計に依らない製品の欠陥で、この ADR の決定がどうなっても直す。
票は issues/M25-09〜M25-11 に起こした (2026-10-01)。

| 票 | 欠陥 | 根拠 | この ADR との関係 |
|---|---|---|---|
| M25-09 (外-1) | 本番の bundle に `__sceneSelection`・`__sceneCell` と `__observe*` の 10 個が入っている (当時の名。今は `__probe.scene.*`・`__probe.observe.*` で、開発のビルドだけ) | `pnpm run build:cloudflare` と同じ環境で vite build し、出た JS に文字列があった。書く所は src/render/SceneView.ts:246・286 と src/observe/view.ts:657-1008。tests/unit/build.devtools.test.ts:8 の MARKERS はこれを見ていない | 段 2 の前提 (口を probe に移す) |
| M25-10 (外-2) | 港の札が #cell-info の「生気 / 枯死」「輝石」「草」の札を覆う | 文字の箱ごとの 5 点の試し (付録 B の 1)。CRG-005-2・SEL-003-3 の画にも写る | 段 1 の lens が緑になる前提 |
| M25-11 (外-3) | HUD のグラフの canvas の字が画面の上で 5px (軸) と 9px (目印) | src/ui/Hud.ts:168・src/ui/hud.css:23・src/ui/graph.ts:6-7 | 同上 |

## ユーザーの判断を待った点 (2026-10-01 に承認)

どれも推奨どおりに決まった。

1. **決定: 基準画は手元の Mac だけに置く。** 基準画を手元の Mac だけに置くか、Linux の docker で CI でも持つか。推奨は手元だけ。shots はもう ACCEPTANCE_DIR のあるときだけ回り (shots.spec.ts:14-15)、CI には日本語の字形と GL の差の分の手間が増える。
2. **決定: 手元の `claude -p` で回す。** LLM の判定を手元の `claude -p` で回すか、API の鍵で回すか。推奨は `claude -p`。鍵を持たずに `pnpm run judge` から呼べることを試した (付録 B の 4)。
3. **決定: M25-09 を段 2 の前に、M25-10・M25-11 を段 1 と並べて直す。** 外の票 3 つをいつ直すか。推奨は、M25-09 を段 2 の前に、M25-10・M25-11 を段 1 と並べて直す。段 1 の完了は検査が赤になることを示すことで、直すと緑になる。
4. **決定: `threshold: 0.2`・`maxDiffPixelRatio: 0.02`。** 基準画の閾値を `threshold: 0.2`・`maxDiffPixelRatio: 0.02` にするか、差 0 にするか。推奨は 0.02 (上の「基準画の閾値」)。
5. **決定: 段 3 の後にする。** Hud・Harbor の部品化 (M21-05 の順の 2・3) を段 3 の後にするか。推奨は段 3 の後。
6. **決定: 人に残す。** 手触りの 1 分を人に残すか。推奨は残す。付いてくることと画面の外へ出ないことは試験が見ていて、残るのは気持ちよさだけである。

## 確かめていない仮定

- 段 1 の lens が ubuntu の CI の Chromium でも同じ値を出す (日本語の字形とフォントの代わり)。
- 止めた自由モードの 3D が差 0 になるのは、この Mac (Apple Silicon、`chromium-1243`) で確かめた。他の Mac と、GPU を持つ Chromium では確かめていない。
- 字の描き方の更新の代わりに `text-rendering: geometricPrecision` を使った。実際の macOS の更新で変わる画素の数は測っていない。
- 「tick N まで進める」を足しても、石板の判定は今と同じ (stepByYear が年の境目で刻むので保たれる見込み。tests/unit/scenario.determinism.test.ts)。
- ピンの ID 描きを足しても、M21-10 の「止めた島は描き直さない」を壊さない (probe から呼ぶときだけ 1 回描く)。
- LLM の採点表で、仕込んだ欠陥を見つけられるか。試したのは今の画 2 枚だけで、欠陥を仕込んだ画ではまだ試していない。
- 1 回の受入 (画 16 枚 × 3 票 = 48 回) の時間と換算額は、試しの 1 回あたりの数からの見積もり (直列で約 10 分、4 並列で約 2.5 分、約 1 USD) である。
- 判定の時刻を越えて CLI と既定のモデルが変わると、同じ採点表でも答えが変わる可能性がある。results.json に CLI の版とモデルを書き残す。

## 付録 A: 観察画面の採点表の草案

観察画面は、dt が壁時計で、動的な解像度と個体の動きがあるので、画素の基準は持たない (src/observe/view.ts:941-951)。
TUR-001 の「観察画面の島が絵として成り立って見える (地形・木・水・光)」を、次の問いに落とす。
撮るのは `freeze=1&dynres=0&auto=0&shot=` の 集落・群れ・海岸 の 3 枚で (src/observe/view.ts:709-723)、承認済みの基準画を 1 枚ずつ並べて渡す。
動物の画風は、動物 3 種の承認済みの基準画 (assets/textures/board/creatures/) を正とする (docs/design/2026-09-23-observation-view.md の 41〜42 行)。

| id | 問い (yes / no) |
|---|---|
| O1 | 画の真ん中の 3 分の 1 に島の陸が写り、陸が画の面積の 4 分の 1 以上を占める |
| O2 | 地面・木・水の 3 つがどれも見分けられ、水は陸と違う色の面として見える |
| O3 | 光の向きが 1 つに読め (陰が一方に落ちる)、真っ黒か真っ白に飛んだ広い面が無い |
| O4 | 描かれていない面 (背景の単色・黒い穴・欠けた地面) が画の 1 割を超えない |
| O5 | 宙に浮いた木、地面を突き抜けた物、裏返った面のような描きの誤りが見当たらない |
| O6 | 鹿・狼・兎・民のどれかが 1 つ以上、形として見分けられる (群れの画だけ) |
| O7 | 並べた基準画と、色の調子・輪郭の線の有無・面の粗さが同じ画風に見える |
| O8 | 画面の文字 (年と季節の帯・島の名前) が、3D の絵に溶けずに読める |

O8 は段 1 の lens でも見るが、観察画面の文字は 3D の上に直に載るので、LLM にも聞く。
答えには、画の中の位置と見えたものを 1 文で添えさせる。

## 付録 B: 試した結果の数字と置き場

どれも 2026-09-30、feat/m19 の 8723e67 を scratchpad に写し、`/Volumes/Mac external HDD/Projects/game-demo/.claude/worktrees/m19/node_modules` を借りて回した。
道具はセッションの scratchpad (`.../scratchpad/adr-0001/`) にあり、セッションとともに消える。
M25-01 で `tools/acceptance-probe/` に写し、段 1〜5 の票で試験として作り直す。

### 1. 読みやすさの試し

- 覆い (`src/tests/probe/occlusion.spec.ts`): 自由モードで島を押した後、文字の箱ごとに 5 点を当てると、3 件が覆われていた。どれも港の札 (`BUTTON.harbor-dock`・`SPAN.harbor-dock-glyph`) が #cell-info の「生気 / 枯死」「輝石」「草」を覆う。港の札の箱は x 0〜36・y 336〜384、#cell-info は x 22〜262・y 270〜524。
- コントラスト (`src/tests/probe/jitter.spec.ts` と `contrast.py`): 文字を透明にして撮った画を背景にし、要素の箱の中の 10 パーセンタイルの比を出した。自由モードと確かめの板の 73 要素のうち 4.5 未満は 1 つ (押せない「枠から読込」、opacity 0.4 で 2.35)。最小の字は 11px。canvas の中の字は数に入らない (M25-11 の字はここに出ない)。

### 2. 基準画の閾値の測り (`src/tests/probe/fontdrift.spec.ts`)

確かめの板の要素の画 (69,560 画素) を、base と比べた。

| 変え方 | 差のある画素 | threshold 0.1 を越える | threshold 0.2 を越える |
|---|---|---|---|
| `text-rendering: geometricPrecision` | 3,845 | 2,518 | 696 (1.0%) |
| `-webkit-font-smoothing: antialiased` | 3,845 | 2,518 | 696 (1.0%) |
| 文の字を太さ 500 に | 972 | 645 | 562 (0.8%) |
| 板を 2px ずらす | 6,677 | 5,188 | 4,305 (6.2%) |
| 文の色を 16 段変える | 2,472 | 0 | 0 |
| 文の 1 字を変える | 4,605 | 3,539 | 3,039 (4.4%) |

### 3. 画の揺れ (shots.spec.ts を 2 回、`cmp2.py`)

| 画 | 差のある画素 | 最大の差 | 場所と元 |
|---|---|---|---|
| CNF-002-3・HBR-006-3・HBR-006-5 | 0 | 0 | なし |
| HBR-006-4 | 0.001% | 2 | 時間の箱の札 |
| CNF-002-1・2 | 0.78〜0.92% | 97 | 島全体。100x で止める tick が回ごとに違う |
| HBR-006-1・2 | 0.136% | 79 | グラフ。フレームごとに年を拾う |
| CRG-005-1・2、SEL-003-1〜3 | 0.003〜0.039% | 17〜126 | ピン。`performance.now()` の上下 |

止めた自由モードで同じページを 1 秒おいて撮った画は、ピンを除いて最大の差 7 (札の 24 画素) だった。
ピンのある画は、`reducedMotion: 'reduce'` の文脈で撮ると、同じページでも別の回でも差 0 だった。

### 4. `claude -p` の判定 (`judge/judge.sh`・`rubric.md`・`schema.json`)

呼び方は次のとおり。
`--system-prompt` と `--setting-sources ""` と `--strict-mcp-config` と `--disable-slash-commands` で、手元の CLAUDE.md・MCP・スキルを読み込ませない。
これをしない初めの 1 回は、233,747 トークンを読み込んで 17 秒、換算額 1.92 USD だった。

```sh
claude -p "$(cat rubric.md)

画像ファイル: $IMAGE" --output-format json --json-schema "$(cat schema.json)" --model opus \
  --system-prompt "受入の画を採点表で採点する。道具は Read だけ使う。" \
  --tools Read --allowedTools Read --add-dir "$DIR" --max-turns 4 --no-session-persistence \
  --disable-slash-commands --strict-mcp-config --setting-sources "" < /dev/null
```

- 出力: JSON の `structured_output` に `{image, answers: [{id, answer: "yes" | "no", evidence}]}`。ほかに `total_cost_usd`・`duration_ms`・`num_turns` (3)・`modelUsage` (`claude-opus-5-5`)。標準入力を閉じないと 3 秒待つ。evidence は日本語の問いに英語で返ったので、言語を問いに書く。
- 時間: 1 回 10〜14 秒 (CLI が返す `duration_ms` は 9〜12 秒)。
- 換算額: 1 回 0.015〜0.033 USD。
- 揺れ: 問い 5 つ (ピンが見える・ピンが見分けられる・グラフに「漂着」の太字が読める・グラフの軸の数が読める・セルの板の字が覆われていない) を、SEL-003-3 と CRG-005-2 に 3 回ずつ。6 回とも同じ答え (SEL-003-3 は yes・yes・no・no・no、CRG-005-2 は yes・yes・yes・no・no)。「漂着」の目印があるかは 2 枚で正しく分かれ、港の札の覆いとグラフの軸の小ささは 6 回とも no と答えた。
