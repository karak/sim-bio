# 保存・読込・タイトル

自動の枠 (90 tick ごと、1 季節) と手動の枠 3 つ (IndexedDB、見守り手ごとに `biotope-island@<名前>`)、JSON ファイルの書き出し・読込、新しい島、タイトルの「続きから」。

## Sub-features

- 枠: `#slot-select`・`#slot-save`・`#slot-load`。書いてある枠への保存と読込は確かめ (alertdialog、`confirm.spec.ts`)。層 A
- ファイル: `#save-btn` (download `biotope-<時刻>.json`)、`#load-input` (file input)。層 A
- 新しい島: `#new-island` (確かめてから Year 0)。層 A
- 自動保存と開き直し (閉じて開くと続き): 層 A (`persist.spec.ts`、`context` で新しい page)
- タイトル: 素の `/`、「続きから」が自動の枠を読む、`#to-title`。層 A (`title.spec.ts`)
- 石板の枠 ↔ 自由モードの枠の行き来: 層 A (`scenarioSave.spec.ts`)

## How to get to it (user POV)

島を少し進めて、右の列の枠の欄で保存。読込は枠を選んで押す。ファイルは保存の札と読込の欄。タイトルへは `#to-title`。

## Driving it with Playwright

```ts
await page.click('#speed-100'); await expect(page.locator('#hud-year')).not.toHaveText('Year 0');
await page.click('#speed-0');
await page.selectOption('#slot-select', 'manual-1'); await page.click('#slot-save');
// 進めてから読む
await page.click('#speed-100'); /* 待つ */ await page.click('#speed-0');
await page.click('#slot-load'); // 確かめ → 受ける (confirm.spec.ts の流儀)
```

開き直しは `context.newPage()` で同じ origin を開く。IndexedDB の中身は `tests/fixtures/devSnapshot.ts` の `restoreDb` と同じ store 名 (saves・slots・chronicles・outbox・keys・scenarios・marks・finished)。

## 証拠の終わりの状態

- 読込の後、`#hud-year`・`#hud-season` が保存の時点に戻る。枠の一覧 (`#slot-select` の option の文) に年
- 開き直しで同じ年から続く
- ファイル保存は `download` イベントで `biotope-*.json` が落ち、中身が `SaveData` (`World.serialize`、数は `toPrecision(6)` 丸め)

## Gotchas

- 見守り手 (`?player=`) ごとに DB が分かれる。別の人として試すなら URL に付ける
- 訪問中 (`?visit=`) は枠への保存・読込・ファイル・新しい島を押せない (製品の決め、`scenarioSave.spec.ts`)
- 古い形 (包みの無い SaveData) も読める。壊すときは `SaveData.version` を上げる (ADR 0002 の決定 5)
