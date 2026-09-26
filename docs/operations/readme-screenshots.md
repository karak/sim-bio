# README のスクリーンショットを撮り直す

README の「スクリーンショット」節の画像は `docs/design/screenshots/` の PNG(Git LFS)で、撮る台は `tools/readme-shots.ts`(Playwright)。

## 手順

```bash
npm run dev                                           # Vite を立てる(例 http://localhost:5173)
node tools/readme-shots.ts --url http://localhost:5173
node tools/readme-shots.ts --url http://localhost:5173 --only 05-night,08-rabbit   # 一部だけ
```

- `--headed` でブラウザを表示して撮る。
- 画面は 1600×900。GPU で描くため、headless shell ではなく Chromium 本体の新しい headless を使う。
- 撮り終えたら画像を目で確かめ、README の説明文と合っているかを見てから commit する。

## 撮る画

| ファイル | ページ | 内容 |
|---|---|---|
| `01-overview.png` | `/`(本体) | 空の舟 25 年目の保存(`assets/data/observe/sky-ship-y25.json`)を「読込」に渡し、ホイールで島いっぱいに寄せる |
| `02-settlement.png` | `observe.html?shot=集落&time=0.12` | 集落の朝 |
| `03-slipway.png` | `observe.html?shot=船台&time=0.2&ship=100` | 組み上がった舟 |
| `04-departure.png` | `observe.html?depart=1&time=0.62` | 飛び立ち(自動カメラが去る舟を追う) |
| `05-night.png` | `observe.html?shot=集落&time=0.8` | 夜の集落 |
| `06-deer.png` | `observe.html?shot=群れ&time=0.14` | 鹿の群れ |
| `07-wolf.png` | `observe.html?shot=狼&time=0.25` | 狼 |
| `08-rabbit.png` | `observe.html?time=0.18&auto=0` + `__observeLook('rabbit', 3, 0.8, 0.6)` | 兎 |
| `09-grove.png` | `observe.html?shot=林&time=0.3` | 鐘樹の林 |
| `10-coast.png` | `observe.html?shot=海岸&time=0.5` | 海岸 |

観察画面の画はどれも `freeze=1`(時刻と本体を止める)を付け、開発用の表示(`#stats`・`#shots`・`#status`)を隠して撮る。
URL の指定の意味は `src/observe/view.ts` の冒頭のコメントを参照。画を足す・変えるときは `tools/readme-shots.ts` の `SHOTS` を直す。
