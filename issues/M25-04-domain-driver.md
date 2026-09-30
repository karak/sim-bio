---
id: M25-04
title: E2E のドメインの driver (Island・Harbor・Verdict・Camera) を置き、spec の写しの関数を消す
status: review
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-02]
evidence:
  - "AC1 (一部): routeHarbor は confirm・devtools・harbor・scenarioSave の 4 本を tests/driver/harbor.ts の 1 本にした。shownTick は confirm・devtools・persist・scenarioSave の 4 本を tests/driver/island.ts の 1 本にした (grep 'function routeHarbor|function shownTick' tests → driver に 1 つずつ、spec に残るのは shots.spec.ts の routeHarbor と playToVerdict だけ)。shots.spec.ts は M25-03 が触っているので置き換えを後に回した。M25-03 の後に driver へ替えれば routeHarbor は 5 → 1 になる"
  - "AC2: playwright test --list は前も後も 96 tests in 16 files。CI=1 E2E_PORT=5458 の通しは 92 passed・4 skipped (shots の 4 本は ACCEPTANCE_DIR なしで skip。前と同じ)。pnpm run check は vitest 123 files 1221 passed (driver の単体 9 を含む)、worker 66、scripts 91 OK"
  - "AC3: 差分のレビューを読むだけの別のモデル (opus) に頼んだ (codex は認証が切れて動かなかった)。Turnstile の待ち (100・50・300 ms と widget の有無)・abort の種類・判定の待ち (速さ・題・timeout) は前と同じ、待ちや retry の足しは無し。指摘の未使用 import 2 つは直した"
  - "driver の縛り: tests/unit/driver.test.ts (tickFromHud・shownTick・fakeTurnstile・wireOf・routeHarbor の route の当たり方と閉港・分け合い)"
---

# E2E のドメインの driver (Island・Harbor・Verdict・Camera) を置き、spec の写しの関数を消す

優先度: Should

## What to build

ADR 0001 の段 4。`routeHarbor` は 5 つの spec に (confirm.spec.ts:20・devtools.spec.ts:45・harbor.spec.ts:34・scenarioSave.spec.ts:17・shots.spec.ts:22)、`shownTick` は 4 つの spec に写しで書かれている。

作るもの:
- `tests/driver/` に Page を受け取る型: Island (開く・tick まで進める・セルを押す・層を替える)、Harbor (港の写しを答えさせる・閉港・開く・受け取る)、Verdict (判定まで進める・出港する・訪問のリンク)、Camera (寄る・倒す・止まるまで待つ)
- shots.spec.ts から先に移し、次に harbor・confirm・scenarioSave・devtools・persist
- Gherkin の文と 1 対 1 には結ばない (ADR の「テストドライバ」)

## Blocked by

- M25-02 (tick で止める口を driver が使う)

## Acceptance criteria

- [ ] `routeHarbor` が 5 → 1、`shownTick` が 4 → 1 (grep の結果を作業ログに)
- [ ] E2E の数が変わらず、`CI=1` の通しが全部通る
- [ ] driver の関数に、写した spec の試験以外の振る舞いを足していない (差分のレビュー)

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 4)
- 2026-10-01: tests/driver/{island,harbor,verdict,camera}.ts を置いた。Page を受け取る関数で、待ちは出来事 (toHaveText・toBeVisible・expect.poll) のまま。spec の差は options で渡す (Turnstile の待ちと widget、fake と sent の分け合い、判定の速さ・題・timeout)。clicks.ts の 1 クリック (Command を作るもの) は driver が打つ DOM の押下には無く、src 側のボタンの handler が使うので、driver は使っていない。
- 2026-10-01: 移したコメント 6 つ (港の写しの分け合い・Turnstile の代わり・港の API を写しで答える・abortWith・石板を 100 倍速で回す・persist の TICKS_PER_YEAR と shownTick) は文を変えずに driver へ。消したコメントは無い。
- 2026-10-01: shots.spec.ts の openPaused・advanceTo・settle・tilt・selection・型 (View・Selection) は driver (island.ts・camera.ts) に同じ文で置いた。shots.spec.ts は未変更なので、M25-03 の後にそこの写しを消して driver を呼ぶ (routeHarbor と playToVerdict も)。shotState.spec.ts は openPaused と advanceTo を driver に替えた。
