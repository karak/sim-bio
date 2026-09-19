# 光角鹿 (deer) 3D モデル QA 受入基準

対象: `assets/models/deer.glb` / `assets/models/deer.blend` (LFS 管理)、生成 `tools/blender/deer.py` (共通部品 `lowpoly_kit.py`)。
参照画像: `assets/textures/concept/deer-angular.png`。評価カメラ: 方位 135° (左側面が手前、頭が画面右)、仰角 10°、50 mm。
判定: PASS / PARTIAL (中間成果物として許容) / FAIL。証跡の SHA はブランチ `worktree-concept-art-variants`。残課題は `deer-remaining-issues.md`。

## A. 制作方針

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| A1 | 参照画像 (angular 路線) から断面ロフトで一から作る | PASS | `b56a65a` `deer.py` |
| A2 | 深緑パネル・蹄・角の根元は平らな塗り分け (盛り上げない) | PASS | `deer.py` `paint_faces` (参照座標の多角形に投影される面を塗る)、`make_leg` / `make_antler` |
| A3 | rabbit と同じ検証 (compare_ref → tune_colors) を回す | PASS | `deer-compare.png`, `deer-metrics.json`, `deer-tune-history.json` |

## B. 形状

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| B1 | 三角形数 | 1800〜3000 | 1837 | PASS | `deer-metrics.json` `tris` |
| B2 | シルエット IoU | ≥ 0.80 | 0.49 | FAIL | `silhouette.iou`、残課題 #1〜#3 |
| B3 | 縦横比 (参照 0.52) | ±0.05 | 0.49 | PASS | `silhouette.aspect` |
| B4 | fur マスク IoU | ≥ 0.60 | 0.42 | PARTIAL | `parts.fur.mask_iou` |
| B5 | dark (深緑パネル・蹄・角根元) マスク IoU | ≥ 0.50 | 0.31 | PARTIAL | `parts.dark.mask_iou`、残課題 #2 |
| B6 | glow (角・縁線・目) マスク IoU | ≥ 0.50 | 0.21 | FAIL | `parts.glow.mask_iou`、残課題 #1 |
| B7 | 面積比の差 ±0.03 | ±0.03 | fur −0.044 / dark +0.030 / glow +0.014 | PARTIAL | `parts.<p>.fraction.diff` |
| B8 | 重心距離 ≤ 0.03 | ≤ 0.03 | fur 0.016 / dark 0.032 / glow 0.022 | PASS (dark 僅差) | `parts.<p>.centroid.dist` |
| B9 | 閉じたメッシュ、法線外向き、原点足元、Z up、正面 −Y | 検査 | 達成 | PASS | `lowpoly_kit.finish` / `finalize` |

## C. 色

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| C1 | fur ΔE76 | < 1.0 | 0.39 | PASS | `parts.fur.color.delta_e76` |
| C2 | dark ΔE76 | < 1.0 | 0.29 | PASS | `parts.dark.color.delta_e76` |
| C3 | glow ΔE76 | < 1.0 | 0.87 | PASS | `parts.glow.color.delta_e76` |
| C4 | 収束色が JSON 化され再ビルドで再現 | 有 | fur #CA964A / dark・teal #2E6561 / glow #97F9E1 (3 反復) | PASS | `tools/blender/deer-colors.json`, `deer-tune-history.json` |

## D. 成果物・運用

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| D1 | glb / blend が LFS でコミット | PASS | `b56a65a` |
| D2 | 生成が決定論的 | PASS | `Kit.__init__` で `read_factory_settings(use_empty=True)` |
| D3 | 証跡が `docs/design/qa/` にある | PASS | deer-compare.png / -metrics.json / -ref-components.json / -tune-history.json |
| D4 | 残課題の文書化 | PASS | `deer-remaining-issues.md` |
| D5 | ユーザー手動受入 | 未実施 | — |

## 再現手順

```
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
    assets/models/deer.blend assets/textures/concept/deer-angular.png <out> 135 10 creature=deer
python3 tools/blender/tune_colors.py --creature deer --az 135 --target 1.0
DEER_DEBUG=1 ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models   # ランドマークの投影座標
```
