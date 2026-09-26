---
id: M19-14
title: シナリオの続きから(runner の状態を持ち出す)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-05, M19-06]
evidence: []
---

# シナリオの続きから(runner の状態を持ち出す)

優先度: Must(設計書 B2「予言は 200〜500 年あり、1 回では終わらない」)

## What to build

M19-05 では、シナリオの途中で閉じると石板の初めからになる(runner の状態が SaveData に無い)。M19-06 で、年代記から回し直す案は開き直しに時間がかかりすぎると分かった(Chromium の Web Worker で size 64 の 300 年が 73.6 秒、size 128 は 4 倍)。そこで runner の状態そのものを持ち出す(M19-06 の作業ログの案)。

- `ScenarioRunner` に `save(): RunnerState` と `createScenarioRunner(def, world, opts, restored?)` を足す。状態は JSON にできるものだけ(力・年表・警告・履歴・fired と cancelled・前年の値)。
- シナリオの自動保存は、SaveData・RunnerState・年代記の 3 つを 1 つの transaction で書く(同じ tick のものしか並ばない)。開き直したら 3 つを戻し、`recorder.resume` で年代記を引き継ぐ。
- 先に確かめる: `World.restore` の続きが、閉じずに回した島と最後の桁まで一致するか(`civYearKeys` など、年の中の状態が SaveData に無い)。一致しなければ、年の境目でだけ書く案を試す。

## Blocked by

M19-05, M19-06

## Acceptance criteria

- [ ] 途中で保存して戻した島を最後まで回した Digest が、閉じずに回した Digest と一致する(単体テスト、年代記で証明)
- [ ] シナリオの途中で閉じて開き直すと、同じ年・同じ石板の状態から続く(E2E)
- [ ] 「シナリオ中の読込は予言と矛盾するので無効」の規則との関係を整理して記す(自動の枠からの復帰は矛盾しない)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ
