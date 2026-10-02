---
id: M25-08
title: TUR-002 を retired にし、TUR-001 を手触りの 1 分にする
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-03, M25-07]
evidence:
  - "scripts/test_acceptance.py RepoSotTest の 3 件 (round の human は TUR-001 だけ・1 分、TUR-001 の札の付いた手順は judge human の 1 つ、TUR-002 は retired)"
  - "uv run scripts/acceptance.py check: ok 44 scenarios"
  - "ACCEPTANCE_DIR=<scratchpad> acceptance.py page: groups は TUR-001 だけ、delegated に auto の行"
---

# TUR-002 を retired にし、TUR-001 を手触りの 1 分にする

優先度: Must

## What to build

ADR 0001 の段 6。2026-10-01 のユーザーの判断 6 (手触りの 1 分は人に残す)。

作るもの:
- TUR-002 を `status: retired` にし、`retired.replaced_by` に SEL-003・CRG-005・CNF-002・DEV-001 を書く (行は消さない)
- TUR-001 を書き直す: 残すのは「判定の板を取っ手でドラッグすると付いてきて気持ちよい」の 1 手順 (`judge: "human"`、1 分)。3D の絵は M25-07 の行へ、読みやすさは HBR-006 へ移したことを judge に書く
- 受入の画面の「人の 1 周」の background を直す (docs/acceptance/scenarios.jsonl の TUR の行)
- docs/operations/acceptance.md の「人が判じるのは」の段を直す

TUR-002 の retire は M25-03 の後にできる。TUR-001 の書き直しは M25-07 の後 (ADR の「段 5 と段 6 は順を逆にしても値が出る」)。

## Blocked by

- M25-03 (TUR-002)
- M25-07 (TUR-001)

## Acceptance criteria

- [ ] `uv run scripts/acceptance.py check` が通り、round の human の行が TUR-001 (1 分) だけになる
- [ ] `pnpm run acceptance:page` の items.json に TUR-001 だけが項目として出て、delegated に移した行が並ぶ
- [ ] results.json の旧い判定 (r2-cargo など) が TUR-002 の retired の行の下で読める

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 6)
- 2026-10-02: 実装 (feat/m25-08、feat/m19 の 700dfe6 から)。
  - 先に scripts/test_acceptance.py に 3 件を足して赤 (3 件落ちる) を見てから正本を変えた。
  - 変える前の原文 (ユーザーの承認済みの範囲。ユーザーが見比べるため、行の全文を JSON のまま写す)。

    TUR-001 (変える前の行の全文):

    ```json
    {"kind": "scenario", "id": "TUR-001", "status": "active", "mode": "human", "title": "帆の試し読みを判定まで通し、3D・判定の板・出港・訪問を見る", "tickets": ["M19-09", "M19-10", "M19-11", "M19-15", "M19-18", "M21-05", "M22-08"], "from": ["a-publish-visit", "r2-publish-visit", "r2-board-regress"], "when": "round", "minutes": 5, "links": [{"label": "帆の試し読み (開発の板つき)", "path": "/?scenario=test-ship&dev=1"}], "judge": "見た目・読みやすさ・手触りだけ。順と数は HBR-001・BRD-001・AVD-001・CRG-001 の自動試験が見る", "steps": [["前提", "`/?scenario=test-ship&dev=1` を開いている"], ["もし", "判定の前に、左上の時間の箱の速さの列の右端の「3D で見る」を押す"], ["ならば", "【見た目】観察画面の島が絵として成り立って見える (地形・木・水・光)。Esc で操作画面に戻る", {"judge": "human"}], ["もし", "1000x で進める"], ["ならば", "判定「次の島へ」の板が 20 秒以内に出て、時計が止まる"], ["かつ", "【手触り】判定の板を上の取っ手でドラッグすると板が付いてきて、画面の外へは出ない", {"judge": "human"}], ["かつ", "【読みやすさ】石板と判定の板に「この予言を越えた見守り手は N%」の行が読める。右下の知らせに「積荷を港へ流した」の意味の文が出る", {"checks": [{"lens": "legible", "target": "判定の板の回避率"}, {"lens": "legible", "target": "石板の回避率"}, {"lens": "legible", "target": "積荷の知らせ"}]}], ["もし", "「港へ出す」で碑文を 1 つ選び「出港する」"], ["ならば", "「この島を訪れる」のリンクが出る"], ["もし", "リンクを別のタブで開く"], ["ならば", "【見た目】島の名前と碑文の板が読め、3D の島が動き、下の帯が「N 年 · 季節」で進む", {"judge": "human"}], ["もし", "「年表を読む」"], ["ならば", "【読みやすさ】進みの棒のあとに「港の記録と同じ結末になった」が読める", {"judge": "human"}]], "covered_by": [{"file": "tests/e2e/harbor.spec.ts", "title": "M19-09: 出港 → リンク → 訪問 (3D 観察画面) → 照合 (年表を読む) の一連"}, {"file": "tests/e2e/smoke.spec.ts", "title": "sky ship: ?scenario=test-ship shows the ship progress in the HUD and escapes to a 次の島へ verdict with a downloadable cargo (M10-03)"}]}
    ```

    TUR-002 (変える前の行の全文):

    ```json
    {"kind": "scenario", "id": "TUR-002", "status": "active", "mode": "human", "title": "自由モードで漂着を受け取り、セルの印と確かめの板を見て、状態を送る", "tickets": ["M19-10", "M19-15", "M19-16", "M21-04", "M22-10"], "from": ["r2-cargo", "r2-cell-highlight", "r2-confirm", "r2-snapshot"], "when": "round", "minutes": 4, "links": [{"label": "自由モード (開発の板つき)", "path": "/?dev=1"}], "judge": "見た目・読みやすさだけ。受け取りの帳簿 (二度は受け取れない・力不足) は CRG-002・CRG-003、確かめの取り消しの効き目は CNF-001 の自動試験が見る", "steps": [["前提", "TUR-001 を終えている (帆の試し読みの積荷が港に流れている)"], ["前提", "`/?dev=1` を開いている"], ["もし", "島の陸を押す"], ["ならば", "【見た目】押したセルの縁に淡い琥珀の帯、その上に琥珀のピンが浮かんで上下し、遠い既定のカメラでもどこを押したか分かる", {"judge": "human"}], ["もし", "左の縁の「港」→「浜を見る」→「受け取る」"], ["ならば", "【読みやすさ】港の口の文で受け取ったことが読め、着いた浜のセルが選ばれ、HUD のグラフに太字の「漂着 (…)」の目印が線の内側に読める", {"checks": [{"lens": "legible", "target": "受け取りの文"}, {"lens": "legible", "target": "HUD のグラフ"}, {"lens": "legible", "target": "セルの詳細"}]}], ["もし", "HUD の「新しい島」"], ["ならば", "【読みやすさ】ページの中の確かめの板が出て、初めは「やめる」に光が当たり、文が何を失うかを言っている", {"checks": [{"lens": "legible", "target": "確かめの板"}], "judge": "human"}], ["もし", "Esc"], ["ならば", "何も起きない (年・日はそのまま)"], ["もし", "右下の「開発」の板の「状態を受入の画面へ送る」"], ["ならば", "id (`s-…`) が出る。この項目の「状態 id」に貼ると「写しを見る」で JSON が開く"]], "covered_by": [{"file": "tests/e2e/harbor.spec.ts", "title": "M19-15 (4): 漂着を受け取ると、積荷の着いた浜のセルを選んで見せ、放たれた種の密度がそのセルで読める"}, {"file": "tests/e2e/cellHighlight.spec.ts", "title": "M22-10: 操作画面で島を押すと、そのセルに境界の帯と浮かぶ印が出て、別のセルで移り、層を替えても残り、新しい島で消える"}, {"file": "tests/e2e/confirm.spec.ts", "title": "M21-04: 確かめのダイアログは alertdialog で、開くと「やめる」に focus があり、Esc で取り消し、確かめの札に移って Enter で受ける"}, {"file": "tests/e2e/devtools.spec.ts", "title": "M19-16: 状態を受入の画面へ送って id を得、その id の写しを別のブラウザに流し込むと、同じ島・同じ枠から続く"}]}
    ```
  - TUR-002: status を retired にし、retired {on 2026-10-02, reason, replaced_by SEL-003・CRG-005・CNF-002・CNF-001・CRG-002・DEV-001} を足した。ほかの鍵 (mode・when・minutes・steps・from・covered_by) はそのまま。行は消さない。
  - TUR-001: title と judge を書き換え、minutes を 5 から 1 にし、steps を 前提・もし 1000x・ならば 板が出る・かつ【手触り】ドラッグ (judge human) の 4 つにした。tickets・from・when・links・covered_by は変えていない。
  - 吸収先 (消えた手順ごと):

    | 元の手順 | 吸収先 |
    |---|---|
    | TUR-001 「3D で見る」→【見た目】島が絵として成り立つ | OBS-002 (judge: llm、撮影と採点表 O1〜O8) |
    | TUR-001 【読みやすさ】回避率の行・積荷の知らせ | HBR-006 の lens (legible) と基準画 |
    | TUR-001 出港 → リンク → 訪問 → 年表を読む | HBR-001・OBS-001 と harbor.spec の M19-09 (順と数) |
    | TUR-001 訪問の【見た目】【読みやすさ】(島の名前・碑文の板・帯・「港の記録と同じ結末」) | 画の lens は無い。HBR-001 が出る・出ないを見る。下の「ユーザーの判断」 |
    | TUR-002 【見た目】セルの帯とピン | SEL-003 (基準画)・cellHighlight.spec |
    | TUR-002 【読みやすさ】受け取りの文・グラフの目印・セルの詳細 | CRG-005 (lens と基準画)、帳簿は CRG-002 |
    | TUR-002 【読みやすさ】確かめの板 | CNF-002 (lens と基準画) |
    | TUR-002 Esc で何も起きない | CNF-001 |
    | TUR-002 状態を受入の画面へ送る | DEV-001 |
  - results.json の旧い判定は TUR-002 の `from` (r2-cargo・r2-cell-highlight・r2-confirm・r2-snapshot) に残る。check_results は通る。今の results.json にはこの 4 つの鍵は無い (あるのは r2-browse・r2-closed・r2-late-publish・r2-publish-visit ほか)。
  - docs/operations/acceptance.md に節「人の 1 周は 1 分」を足し、ADR 0001 の段 6 に 1 行足した。既存の文は変えていない。
  - 検査: acceptance.py check ok (44 行)。ACCEPTANCE_DIR を scratchpad にして page を回すと groups は TUR-001 だけ。
  - **ユーザーの判断**: (a) 訪問の画面の【見た目】【読みやすさ】(島の名前・碑文・年表の結末の文) は、ADR の決定どおり人からも外したが、lens も LLM の問いも無い。足すか。(b) docs/acceptance/scenarios.jsonl の code 行 TUR の background 「見るのは【見た目】【読みやすさ】【手触り】の札の付いた行だけ…」は今は【手触り】だけで古い。既存の文なので書き換えていない。(c) docs/operations/acceptance.md の「合格は書かない」(M25-07 のログが挙げた古い文)。
