---
id: M25-04
title: E2E のドメインの driver (Island・Harbor・Verdict・Camera) を置き、spec の写しの関数を消す
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-02]
evidence: []
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
