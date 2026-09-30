---
id: M25-07
title: 観察画面の 3 枚 (集落・群れ・海岸) を撮り、採点表 O1〜O8 で LLM に判じさせる
status: todo
milestone: M25
plan: docs/decisions/0001-acceptance-automation.md
depends_on: [M25-02, M25-06]
evidence: []
---

# 観察画面の 3 枚 (集落・群れ・海岸) を撮り、採点表 O1〜O8 で LLM に判じさせる

優先度: Should

## What to build

ADR 0001 の段 5。TUR-001 の「観察画面の島が絵として成り立って見える」を、画素の基準ではなく採点表 (ADR の付録 A、O1〜O8) に落とす。

作るもの:
- shots に観察画面の 3 枚を足す: `freeze=1&dynres=0&auto=0&shot=` の 集落・群れ・海岸 (src/observe/view.ts:709-723 の preset)。M25-02 の時計で止める
- 採点表 O1〜O8 を `docs/acceptance/rubrics/observe.md` に置き、承認済みの基準画 (動物 3 種は assets/textures/board/creatures/ を正とする) を並べて渡す
- 正本に観察画面の行を足し (`next OBS`)、手順に `judge: "llm"` を持たせる
- 観察画面は画素の基準を持たないので、3 票そろった yes で合格。人は並べて渡す基準画を替えるときにだけ承認する

## Blocked by

- M25-02 (観察画面の時計)
- M25-06 (judge の器)

## Acceptance criteria

- [ ] 3 枚を 2 回撮り、木と動物の位置が同じ (freeze と時計で止まっている)
- [ ] 仕込んだ欠陥 (木を消す・地面に穴を開ける・光を消す) を、それぞれ O2・O4・O3 が 3 票とも no で見つける
- [ ] 今の観察画面の 3 枚は O1〜O8 が 3 票とも yes (no があれば票に起こす)
- [ ] `uv run scripts/acceptance.py check` が通る

## 作業ログ

- 2026-10-01: 起票 (ADR 0001 の段 5)
