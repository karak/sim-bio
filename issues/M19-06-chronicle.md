---
id: M19-06
title: 年代記の記録と再生(Web Worker)
status: todo
milestone: M19
plan: docs/design/2026-09-26-cloudflare-architecture.md
depends_on: [M19-04]
evidence: []
---

# 年代記の記録と再生(Web Worker)

優先度: Must(設計書のドライバの優先度)

## What to build

設計書 §5。UI の `dispatch` を外から包んで tick 付きの命令を積む `recordChronicle`(World は変えない。予言の fromStar:false は載せない)、Web Worker で年代記を回し直す `replay`(tick の上限と中断を持つ)、結末の要約 `digestOf`(toPrecision(6)、正規化 JSON の SHA-256)。年ごとの種の総数の短い系列を添える(折れ線用)。

## Blocked by

M19-04

## Acceptance criteria

- [ ] seed + 年代記 → 同じ Digest を 1 本のテストで示す(設計書 §9 の最初の一手)
- [ ] 拒否された命令は年代記に載らない。自動保存からの復帰で年代記を引き継ぐ
- [ ] 壊れた年代記(tick の逆行・長すぎ)で replay が止まり、タブを落とさない
- [ ] 300 年の再生の所要時間を計測して作業ログに記す(照合を自動で走らせるか決める材料)
- [ ] npm run check と E2E が通り、evidence に commit SHA とテストファイルを記す

## 作業ログ

### M19-04 からの引き継ぎ(2026-09-26)

- 再生の駆動は `tests/unit/scenario.determinism.test.ts` の `replay()` を元にする。形は「最初に `runner.update(snapshot)`(tick 0 の評価)→ 介入ごとに `stepByYear` でその tick まで進めて `runner.intervene` → `stepByYear` で判定まで」。
- 順序の契約: 境目ちょうど(tick = 360·Y)の介入は、その境目の `update` の後に打つ。ライブのクリックも、境目を越えたフレームの `update` の後に来るので同じになる。tests/slow の台本(`play`・`playTower`)は境目で「介入 → update」の逆順。台本の年代記をそのまま再生の golden にしないこと(同じ tick でも、力の収入の前後・年表の年・その年の判定が介入を数えるかが変わる)。
- `recordChronicle` が記録する tick は、クリックを受けたときの `world.snapshot().tick`(次の `stepOnce` で適用される tick)。
- M19-04 のレビュー(thermo-nuclear)で見送った作り替えをここでやる:
  - `ScenarioRunner` に `advance(n)` を持たせる(`RunnerWorld` に `step` を足す)。
  - `update` を境目専用の評価にし、tick 0 の評価は生成時に行う。onFrame は読むだけにする。`currentPrayer` と迎撃の pending は snapshot から求める。
  - `ticksToNextYear` を非公開に戻す。
  - テストの `replay()` を `src` の `replayChronicle` に移す。
  - tests/slow の 47 件の判定が変わらないように、台本の駆動は段階的に移す。
- 別の版の照合で気をつけること: 本体は毎 tick `Math.sin`・`Math.cos` を使う(`src/simulation/climate.ts:36-37`)。V8 どうしなら一致するが、エンジンが違うブラウザ(Safari・Firefox)で最後の桁まで一致するとは限らない。照合の Digest は `toPrecision(6)` に丸めるものの、差が年を追って育つかは実測していない。
