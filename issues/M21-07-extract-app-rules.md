---
id: M21-07
title: main.ts と港の画面の判断を純粋な関数に出し、手動と E2E の組み合わせを表の単体試験に移す
status: todo
milestone: M21
plan: docs/design/2026-09-29-acceptance-redesign.md
depends_on: [M21-06]
evidence: []
---

# main.ts と港の画面の判断を純粋な関数に出し、手動と E2E の組み合わせを表の単体試験に移す

優先度: Must

## What to build

2026-09-29 のユーザーの依頼(原文):「今後、手動のE2Eではなく、ビジネスロジックを抽出して自動化することをタスクとして起票」

いまの作り (feat/m19 eb8bdc5): 次の判断は main.ts の閉包と Harbor.ts の DOM の組み立ての中にあり、E2E か人の手でしか確かめられない。
手動の受入の手順の「バリエーション」(操作 × 自由モード/走っている石板/判定の出た石板/訪問、URL の組)は、ここに集まっている。

| 判断 | いまの場所 | 手動の手順 |
|---|---|---|
| 操作の確かめと行き先(新しい島・枠とファイルの読込・枠へ保存・石板を選ぶ・もう一度・自由モードへ・訪れる) | main.ts `load`・`onNewIsland`・`onSlotSave`・`leaving`・`selectScenario` | r2-confirm 1〜5、r2-scenario-slot 3、r2-cross-stage 2〜3、r2-restart 2、r2-url 2 |
| 起動の舞台と、最初の島をどこから戻すか | main.ts boot 58-68・106-122 行 | r2-url 1、r2-cross-stage 4、a-scenario-resume |
| 枠の札を押せるか | Hud.ts 339-343 行 | a-scenario-resume 3(retired)、訪問 |
| 判定の後に港へ出すもの(出港・回避率・積荷。近道と訪問は出さない) | main.ts `onVerdict` 372-388 行 | r2-avoidance 1〜2、a-cargo 1 |
| 漂着を受け取れるか・着く浜・目印 | main.ts `landCargo` 273-291 行 | a-cargo 5、r2-cargo 3〜4 |
| 港の口に並べる判定の出た島・石碑の札 | Harbor.ts `finishedScope`・`cardItem` | r2-late-publish 2、r2-browse 2 |

作るもの(型は docs/design/2026-09-29-acceptance-redesign.md の「ロジックの抽出」):
- `src/app/place.ts`: `planOp(op, at, titleOf): Plan`・`searchFor(search, scenarioId)`・`bootPlanOf(search, scenarioIds, pending): BootPlan`・`slotControlsOf(at)`
- `src/harbor/dock.ts`: `afterVerdictOf(status, at): AfterVerdict`・`finishedScopeOf(scenarios, at)`・`cardActionsOf(card, at)`
- `src/harbor/cargo.ts` に `planLanding(d, island, gate, names): Landing`
- main.ts・Hud.ts・Harbor.ts はこれらを呼び、Effect を順に行うだけにする(判断を残さない)

確かめの文 (askOf) と枠の行き先 (planSlotLoad) は作り直さず、planOp の中で使う。

## Blocked by

- M21-06(正本の covered_by に、この票の試験の題名を planned で先に書いてある。題名はそのまま使う)

## Acceptance criteria

- [ ] 試験を先に書き、落ちることを見てから実装する。題名は正本の planned と同じ文
  - tests/unit/app.place.test.ts
    - 「planOp (M21-07): 新しい島は、自由モードでは確かめて島を作り直し、石板では確かめて石板を初めからにする。訪問では何もしない」
    - 「planOp (M21-07): 同じ舞台の枠は確かめて差し替え、石板の枠なら石板を枠の時点から始め直して、その場で続きに書く」
    - 「planOp (M21-07): 違う舞台の枠は確かめてから、読む枠の名前を置いてその舞台へ移る。ファイルなら置き場 (import) に置いてから移る」
    - 「planOp (M21-07): 操作 × 舞台 (自由・走っている石板・判定の出た石板・訪問) の表で、確かめの有無と行き先が決まる」(it.each の表。5 操作 × 4 舞台の 20 行を全部書く)
    - 「bootPlanOf (M21-07): 知らない石板の URL は自由モードで開き、scenario と visit だけを消して player・dev は残す」
    - 「bootPlanOf (M21-07): 移ってきた枠があればそれから、無ければ石板は石板の続き・自由モードは自動の枠から戻す。訪問ではどれも戻さない」
    - 「slotControlsOf (M21-07): 訪問では枠への保存・読込・ファイルの読込・新しい島を押せず、自動の枠へは保存できない」
    - searchFor: 訪問中に石板を選ぶと visit を落とす(いまの selectScenario は残す。直すかどうかはこの票で決め、作業ログに書く)
  - tests/unit/harbor.dock.test.ts
    - 「afterVerdictOf (M21-07): 近道・訪問・年代記の無い島の判定は港へ出さない (出港・回避率・積荷のどれも)」
    - 「afterVerdictOf (M21-07): escaped のときだけ持ち出しと積荷を出す」
    - 「finishedScopeOf (M21-07): 石板ではその石板の島だけ、自由モードではどの石板の判定の出た島も並べ、訪問では並べない」
    - 「cardActionsOf (M21-07): 取り下げは自分が出港した島だけ、訪れるは同じ版の島だけ、通報はどの島にも出す」
  - tests/unit/harbor.cargo.test.ts
    - 「planLanding (M21-07): 判定の後は refused、力が積荷の種の数だけの放流に足りなければ budget で、どちらも命令を 1 つも出さない」
    - 「planLanding (M21-07): 受け取れるなら、着く浜のセル・種ごとの放流の命令・「漂着 (種の名)」の目印を返す」
- [ ] どの新しい試験も、配線に戻した誤りで落ちることを見る(変異)。少なくとも: 近道でも港へ出す(`!dev?.shortcut` を外す)・判定の出た島を離れるのに確かめない・訪問で枠を読める・力の足りない漂着を放つ・自由モードの港の口に他の石板の島を並べない
- [ ] main.ts・Hud.ts・Harbor.ts から上の判断が消え、関数を呼ぶだけになる。E2E は全部そのまま通る(CI=1・1 worker)
- [ ] 正本の planned を外す(`pnpm run check` の check:acceptance が、試験があるのに planned だと落とす)
- [ ] `tests/e2e-cloudflare/harbor.spec.ts` に「積荷を流し、別の見守り手が引いて受け取る (本物の D1)」を 1 件足す(本番の人の確かめ OPS-001 から外した積荷の、本物の港の道。見守り手を分けるのは試験の中で、人は分けない)
- [ ] (Could) 表の行に移った E2E の組み合わせを間引く候補を作業ログに挙げる。間引くのはユーザーの承認の後。候補: confirm.spec の「判定の前の石板から石板を選び直すのは確かめない」、harbor.spec の「星の力が足りなければ積荷を受け取らず…」。配線の E2E(操作 1 つ × 受ける/やめる 1 組)は残す

## この票で移さないもの

| もの | いまの場所 | 移さない理由 |
|---|---|---|
| 港の板の状態の移り(一覧の頁・知らせ・送り直しの数) | Harbor.ts | 状態を持つ部品で、移すと reducer への書き直しになる。M21-05 の「ほかの部品を移す順」の 3 番で、部品の試験 (happy-dom) と一緒に移す |
| 観察画面と時計の揃え | main.ts の観察画面の開閉 | 受入の手順のバリエーションに出てこない。見た目は人の 1 周 (TUR-001) が見る |
| 石碑の碑文の読み込み | Harbor.ts (fetch) | 網の読み込みで、判断が無い |

## 作業ログ

## 分かっている限り

- 判断を出しても、DOM の置き場所(覆われない)と絵は E2E と人の目のまま(M21-05 の uncovered.spec、M21-08 の画)
