# 石板 (シナリオ) と判定

石板の島 (`/?scenario=<id>`) を回し、滅びの進行に介入して、年の境目で判定 (生き延びた・滅びた) を受ける。判定の板から港へ出す・もう一度・自由モードへ。

## Sub-features

- 石板の板: `#tablet` (`#tablet-title`・`#tablet-year`・`#tablet-power`・`#tablet-timeline`・`#tablet-avoidance`・`#tablet-warnings`)。層 A
- 介入: 勅令 `#edict-stop`・`#edict-resume`、気象塔 `#tower-chip`、迎撃 `#intercept-btn`、空の舟 `#ship-btn` (理由は `#*-reason`・`#*-hint`)。層 A
- 判定の板: `#verdict` (`#verdict-title`・`#verdict-reason`・`#verdict-stats`・`#verdict-avoidance`、`#verdict-harbor`・`#verdict-retry`・`#verdict-free`・`#verdict-download`)。層 A
- 板の手触り (取っ手 `#verdict-grip` のドラッグ・矢印キー、画面の外に出ない): 層 A (`verdict.spec.ts`) + 層 C (受入の画面 TUR-001、人の 1 周 1 分)
- 結末の決定論 (1x〜1000x で同じ): 層 A (`tests/unit/scenario.determinism.test.ts`)
- 石板の中の枠の保存・読込・「石板を初めから」: save-load.md

## How to get to it (user POV)

タイトルで石板を選ぶ、または `/?scenario=test-ship` (`test-quick` は集落の無い短い石板)。`?dev=1` で 1000x と開発の板。`?shortcut=alive` は次の年の境目で alive にする近道 (港へは出ない)。

## Driving it with Playwright

```ts
import { playToVerdict } from '../driver/verdict';
await playToVerdict(page, '/?scenario=test-ship&dev=1', { speed: 1000, timeoutMs: 120_000 });
await expect(page.locator('#verdict-title')).toHaveText(/生き延びた|滅びた/);
```

介入は札を押し、`#tablet-power` の減りと `#tablet-timeline` の行で確かめる。年代記への記録は console の `cmd.received` と、`chronicle.spec.ts` のように IndexedDB の `chronicles` を読む。

## 証拠の終わりの状態

- `#verdict` が見え、`#verdict-title` に結末。`#verdict-stats` に数
- 同じ seed・同じ介入の列で、速さを変えても `digest` が同じ (`src/chronicle/digest.ts`)
- 近道で出した判定は港の板 (`#verdict-harbor`) に出ない

## Gotchas

- 本物の判定は test-ship で 1000x でも 1〜2 分。近道は手触りの確認用で、結末の証拠にはならない
- 受入の画面に出す画 (`pnpm run shots`) は `?paused=1` と `advanceTo` で同じ tick に止めて撮る
- 層 C の TUR-001 は人が押すまで未確定。agent は `pnpm run acceptance:page` で items.json を作り、案内するだけ
