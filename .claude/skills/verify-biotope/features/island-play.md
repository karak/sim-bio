# 島を回す・放流・層の切り替え (本体)

自由モードの島。神視点で時間を進め、種を放ち、気候をいじり、層 (温度・輝石・種) を切り替えて見る。

## Sub-features

- 時間: `#speed-0`・`#speed-1`・`#speed-10`・`#speed-100` (`?dev=1` で `#speed-1000`)。`#hud-year`・`#hud-season` が進む。層 A
- 放流: `#spawn-row` のチップ (`#spawn-grass`・`#spawn-forest` など、持っている間 `.armed`) → `#scene` をクリック。層 A
- 気候: `#temp-offset`・`#rain-scale` (値は `#temp-offset-v`・`#rain-scale-v`)。層 A
- 層: `#layer-row` のチップ (`#layer-temperature`・`#layer-crystal`・`#layer-species`、`.on`)、`#layer-mode-density`・`#layer-mode-suit`。層 A
- セル: クリックで `#cell-panel`・`#cell-info`、`#local-graph`。層 A (`cellHighlight.spec.ts`)
- グラフ: `#graph` (aria-label に年の境目の点の文)、`#legend-<種>` に総量。層 A
- 絵として成り立つか (3D): 層 B・C (observe-view.md)

## How to get to it (user POV)

`/` を開く (素の `/` はタイトル。E2E は localStorage の `biotope-dev-skip-title` で飛ばす。手で見るなら「新規ゲーム」)。Year 0 で止まっている。速さの札を押すと進む。

## Driving it with Playwright

```ts
await page.goto('/');
await expect(page.locator('#hud-year')).toHaveText('Year 0');
await page.click('#speed-100');
await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 20_000 });
await page.click('#spawn-forest'); await expect(page.locator('#spawn-forest')).toHaveClass(/armed/);
const box = await page.locator('#scene').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
```

tick で止めるなら `advanceTo(page, tick)` (`tests/driver/island.ts`)。選んだセルの 3D の印は `selection(page)` (`tests/driver/camera.ts`) の `view`。

## 証拠の終わりの状態

- `#hud-year` の文が進んだ。`#stat-veg` が `--%` でない。`#legend-grass` が数字
- console の構造化ログに `{"event":"sim.tick.summary","year":1}`、放流は `cmd.received` の `spawn_species` が 1 以上で `cmd.rejected` が 0
- 層の切り替えは押した札だけ `.on`

## Gotchas

- 放流は UI と台本が同じ `spawnClick` (`src/simulation/commands.ts`) を通る。直書きの dispatch は単体テストが落とす
- `reduce motion` でないとピンが上下する。画を撮るときは `reducedMotion: 'reduce'` と `?paused=1`
- 1000x は 1 フレーム 200 tick で止まる。結末の決定論は石板 (年の境目で刻む) にしかない
