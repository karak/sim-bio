# 観察画面 (3D の絵と性能)

空の舟の集落・群れ・海岸を絵画的写実で見る画面。本体からは「3D で見る」(`#observe-open`、時間の箱の端)、試作のページは `/observe.html` (寄せ先の札と統計)。

## Sub-features

- 入口と戻り: `#observe-open` → 観察画面 (`#observe-layer`)、100x は 10x に落ち、戻ると地図。層 A (`observe.spec.ts`・`observeEntry.spec.ts`)
- 絵として成り立つか (OBS-002): 層 B (`pnpm run judge`、承認済みの画 `docs/acceptance/observe-approved/`)。3 票 yes で pass を書く唯一の手順
- 造形の前後 (動物・草木・株・丸太): 層 C (審査台の回に前後の画を並べる。`tools/flora-shots.ts`、Blender は `tools/blender/*.py`)
- 性能 (三角形・draw call・fps): 層 A の数 (`npm run bench:observe`、6 画)。判断は人 (予算の内か)
- 特性化 (描かれるものの一覧): 層 A (`observeCharacterization.spec.ts`)
- 祈りの知らせの帯、個体を押して追う: 層 A

## How to get to it (user POV)

本体で「3D で見る」。試作は `/observe.html` (空の舟 25 年目・朝・時間を止める)。寄せ先の札 (集落・船台・群れ・林・狼・海岸)。

## Driving it with Playwright

```ts
import { enterObserve, lookFrom } from '../driver/observe';
await enterObserve(page);                 // 集落のある 10 年目の春に進めて入る
await lookFrom(page, '集落');             // 視点は src/observe/view/camera.ts の presets と同じ
const stats = await page.evaluate(() => window.__probe.observe.stats());
```

画は `installFrames` で時計を止めてから撮る。前後の比較は同じ台を変更の前後のコミットで走らせる:

```sh
node tools/flora-shots.ts --url http://127.0.0.1:5187 --out <dir> --prefix before-
npm run bench:observe -- --out before.json && npm run bench:observe:compare before.json after.json
```

## 証拠の終わりの状態

- 層 A: `#observe-layer` が見え、戻ると `#hud-year` が進んでいる。`stats()` の三角形・draw call が前と同じか予算の内
- 層 B: `judge.json` に 3 票と根拠。fail・undecided は note の文で人が見直す
- 層 C: 審査台の回の `verdicts.json` に pass。票にその回の名前と日付

## Gotchas

- 動物 3 種の世界観を正とし、他を寄せる (衝突したらそちら)。造形は参照画を画像で渡す
- agent の worktree が古い main から切られると旧アセットで描かれ、先祖返りに見える。起動直後に merge-base を見る
- fps は Vite を立てた直後に低く出る。三角形と draw call を主に見る
- GLB の書き出しは決定論 (`observe_render.py -- verify`)。2 回書き出して同じことを確かめる
- 審査台の案内は agent が全部終わってから 1 回だけ。途中で 1 件ずつ頼まない
