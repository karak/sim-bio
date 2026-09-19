# 岩狼 (wolf) 3D モデル QA 受入基準

対象: `assets/models/wolf.glb` / `assets/models/wolf.blend` (LFS 管理)、生成 `tools/blender/wolf.py` (共通部品 `lowpoly_kit.py`)。
参照画像: `assets/textures/concept/wolf-angular.png`。評価カメラ: 方位 135° (左側面が手前、頭が画面右)、仰角 10°、50 mm。
横長 (縦横比 1.75) なので、カメラ距離は画面上の概算幅を基準にし、クラス図・ヒートマップは 2 倍幅で出る。
判定: PASS / PARTIAL / FAIL。残課題は `wolf-remaining-issues.md`。

## A. 制作方針

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| A1 | 参照画像から断面ロフトで一から作る (前傾の忍び足ポーズ) | PASS | `wolf.py` |
| A2 | 濃色 (赤茶) は参照の陰側 (顎下・腹・脚の後ろ・耳内側) を面の法線で塗り分け、盛り上げない | PASS | `wolf.py` `shade_faces` |
| A3 | rabbit と同じ検証 (compare_ref → tune_colors) を回す | PASS | `wolf-compare.png`, `wolf-metrics.json`, `wolf-tune-history.json` |

## B. 形状

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| B1 | 三角形数 | 1500〜3000 | 1582 | PASS | `wolf-metrics.json` `tris` |
| B2 | シルエット IoU | ≥ 0.80 | 0.58 | FAIL | `silhouette.iou`、残課題 #1, #2 |
| B3 | 縦横比 (参照 1.75) | ±0.1 | 1.53 | PARTIAL | `silhouette.aspect` |
| B4 | fur マスク IoU | ≥ 0.60 | 0.43 | PARTIAL | `parts.fur.mask_iou` |
| B5 | dark マスク IoU | 参考値 (陰由来) | 0.05 | 参考 | `parts.dark.mask_iou`、残課題 #3 |
| B6 | glow (縁線) マスク IoU | ≥ 0.30 | 0.08 | FAIL | `parts.glow.mask_iou`、残課題 #4 |
| B7 | 面積比の差 ±0.03 | ±0.03 | fur +0.019 / dark −0.006 / glow −0.013 | PASS | `parts.<p>.fraction.diff` |
| B8 | 重心距離 ≤ 0.03 | ≤ 0.03 | fur 0.047 / dark 0.228 / glow 0.044 | FAIL | `parts.<p>.centroid.dist` |
| B9 | 閉じたメッシュ、法線外向き、原点足元、Z up、正面 −Y | 検査 | 達成 | PASS | `lowpoly_kit.finish` / `finalize` |

## C. 色

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| C1 | fur ΔE76 | < 1.0 | 0.47 | PASS | `parts.fur.color.delta_e76` |
| C2 | dark ΔE76 | < 1.0 | 0.21 | PASS | `parts.dark.color.delta_e76` |
| C3 | glow ΔE76 | < 1.0 | 0.78 | PASS | `parts.glow.color.delta_e76` |
| C4 | 収束色が JSON 化され再ビルドで再現 | 有 | fur #F28A5D / dark #9F4439 / glow・teal #90EBCA (4 反復) | PASS | `tools/blender/wolf-colors.json`, `wolf-tune-history.json` |

## D. 成果物・運用

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| D1 | glb / blend が LFS でコミット | PASS | このコミット |
| D2 | 生成が決定論的 | PASS | `Kit.__init__` |
| D3 | 証跡が `docs/design/qa/` にある | PASS | wolf-compare.png / -metrics.json / -ref-components.json / -tune-history.json |
| D4 | 残課題の文書化 | PASS | `wolf-remaining-issues.md` |
| D5 | ユーザー手動受入 | 未実施 | — |

## 再現手順

```
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/wolf.py -- assets/models
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
    assets/models/wolf.blend assets/textures/concept/wolf-angular.png <out> 135 10 creature=wolf
python3 tools/blender/tune_colors.py --creature wolf --az 135 --target 1.0
WOLF_DEBUG=1 ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/wolf.py -- assets/models
```
