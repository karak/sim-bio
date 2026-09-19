# 3D モデル検証ワークフロー (rabbit / deer / wolf 共通)

参照画像 `assets/textures/concept/<creature>-angular.png` に対して、同アングルで撮影した 3D モデルを
パーツ別に定量比較する手順。rabbit で確立した手順を deer / wolf にも使えるよう個体別設定に分離した。

## スクリプト

| ファイル | 役割 |
|---|---|
| `tools/blender/creature_parts.py` | 個体別のパーツ定義。評価パーツ、ID 色、マテリアル名 → パーツの対応、材質の初期色、参照画像の HSV 分類ルール |
| `tools/blender/compare_ref.py` | 撮影と比較。`creature=<name>` を渡すか、ファイル名 (`deer.blend` / `deer-angular.png`) から個体を推定する |
| `tools/blender/tune_colors.py` | 材質色の補正ループ。`--creature deer` のように個体を指定する |
| `tools/blender/<creature>.py` | モデル生成スクリプト (rabbit / deer / wolf)。deer と wolf は共通部品 `lowpoly_kit.py` (材質・ロフト・参照座標系デカール・仕上げ) を使う |
| `tools/blender/<creature>-colors.json` | 補正で収束した材質色 (生成スクリプトが読み込む) |

## 個体別のパーツ定義

| 個体 | パーツ | 参照側の分類ルール (HSV) | 3D 側のマテリアル名 |
|---|---|---|---|
| rabbit | fur / ear_inner / dark / glow | シアン (H 140〜215, S>0.2, V>0.35) → glow。V<0.5 の暗色のうち上半分 → ear_inner、下半分 → dark。残り → fur | `rabbit_fur`, `rabbit_ear_inner`, `rabbit_dark`, `rabbit_glow`, `rabbit_teal` (glow に含める) |
| deer | fur / dark / glow | シアンで V>0.6 → glow (角・縁の線・目)。シアンで V≤0.6 または V<0.45 → dark (深緑のパネル・蹄・角の根元・鼻)。残り → fur | `deer_fur`, `deer_dark`, `deer_teal` (dark に含める), `deer_glow` |
| wolf | fur / dark / glow | シアン (V>0.5) → glow (縁の線)。V<0.66 → dark (鼻・耳内側・脚の陰の赤茶)。残り → fur (面の中間色 #BC5C3C を含む) | `wolf_fur`, `wolf_dark`, `wolf_glow`, `wolf_teal` (glow に含める) |

分類の検証結果 (参照 | 参照クラス図): `deer-ref-classes.png`, `wolf-ref-classes.png`。
参照画像の模様の塊 (デカール配置の実測値): `deer-ref-components.json`, `wolf-ref-components.json`。

## カメラと正規化枠

- 方位: rabbit は 45° (右側面が手前、頭が画面左)。deer / wolf は参照の頭が画面右なので 135° (左側面が手前)。仰角は共通で 10°。
- カメラ距離: 全高がフレームの 62% になる距離。横長の個体は画面上の概算幅 0.7·(dx+dy) が全高を超えるのでそれを基準にする (compare_ref.py と lowpoly_kit.py で同じ規則)。
- 正規化枠: シルエット bbox の高さを 1 とし中央揃え・上寄せ。`fx = (x − 中心)/高さ`, `fy = 上端からの距離/高さ`。
  横長の個体 (参照の縦横比 > 1) はクラス図とヒートマップを 2 倍幅で出力する (中央 S×S に切り出さない)。実行ログに `frame: unit = height, wide layout` と出る。

## 手順

```
# 1. 生成 (deer / wolf は tools/blender/<creature>.py を rabbit.py と同じ規約で作る)
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models

# 2. 比較 (deer / wolf は方位 135°、rabbit は 45°。仰角 10°)
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
    assets/models/deer.blend assets/textures/concept/deer-angular.png <out_dir> 135 10 creature=deer

# 3. 材質色の補正 (全パーツ ΔE76 < 1 まで)
python3 tools/blender/tune_colors.py --creature deer --az 135 --target 1.0

# 4. 証跡を docs/design/qa/<creature>-compare.png, -metrics.json, -ref-components.json, -tune-history.json にコピー
```

## 受入基準のテンプレート (deer / wolf)

rabbit の `rabbit-acceptance-criteria.md` と同じ構成で作る。数値目標の初期値:

| 指標 | 目標 |
|---|---|
| 三角形数 | 旧モデルの 3〜5 倍 (旧モデルがない場合は rabbit と同等の 1800〜3000) |
| シルエット IoU | ≥ 0.80 |
| fur マスク IoU | ≥ 0.60 |
| dark マスク IoU | deer ≥ 0.50 (パネルは幾何で作れる) / wolf は参考値 (陰由来) |
| glow マスク IoU | deer ≥ 0.50 (角は幾何) / wolf ≥ 0.30 (細い縁線) |
| 各パーツ ΔE76 | < 1.0 |
| 面積比の差 | ±0.03 |
| 重心距離 | ≤ 0.03 |

## 個体ごとの注意

- **deer**: 角 (glow) がシルエットの約 20% を占め、上半分の一致が支配的になる。参照は頭が画面右なので az=135 で撮る。パネル (dark) は面ごとに割り当てられる形なので、`deer.py` の `paint_faces` (参照座標の多角形に投影される面を塗る) で再現している。結果と残課題は `deer-acceptance-criteria.md` / `deer-remaining-issues.md`。
- **wolf**: 横長で前傾姿勢。glow は幅 1〜2 px の縁線なので、モデル側は細いリボン (`Kit.ribbon`) で再現し、比較解像度 (S=384) で消えないよう幅 0.01 以上にする。dark は大半が陰 (脚の後ろ側・顔の下面) で、`wolf.py` の `shade_faces` が法線の向きで塗り分けるが位置は合わない。結果と残課題は `wolf-acceptance-criteria.md` / `wolf-remaining-issues.md`。
