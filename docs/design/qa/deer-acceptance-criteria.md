# 光角鹿 (deer) 3D モデル QA 受入基準

対象: `assets/models/deer.glb` / `assets/models/deer.blend` (LFS 管理)、生成 `tools/blender/deer.py` (共通部品 `lowpoly_kit.py`)。
参照画像: `assets/textures/concept/deer-angular.png`。評価カメラ: 方位 135° (左側面が手前、頭が画面右)、仰角 10°、**平行投影** (`proj=ortho`)。
参照は 4 本の蹄を同じ地面線に描いているので wolf と同じく平行投影で評価し、生成側のデカール投影も同じにする (透視 0.49 → 平行投影 0.52、形状修正前)。
判定: PASS / PARTIAL (中間成果物として許容) / FAIL。証跡の SHA はブランチ `worktree-concept-art-variants`。残課題は `deer-remaining-issues.md`。

## A. 制作方針

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| A1 | 参照画像 (angular 路線) から断面ロフトで一から作る | PASS | `b56a65a` `deer.py` |
| A2 | 深緑パネル・蹄・角の根元は平らな塗り分け (盛り上げない) | PASS | `deer.py` `paint_faces` (参照座標の多角形に投影される面を塗る)、`make_leg` / `make_antler` |
| A4 | パネルの境界は直線 (参照座標の多角形の辺で面を切ってから塗る) | PASS | `lowpoly_kit.py` `Kit.cut_along`、`deer.py` `PANELS` |
| A5 | 角は参照クラス図の左右の角の対応点から復元した 3D 折れ線 (換算式をコメントに記録) | PASS | `deer.py` `make_antler` |
| A3 | rabbit と同じ検証 (compare_ref → tune_colors) を回す | PASS | `deer-compare.png`, `deer-metrics.json`, `deer-tune-history.json` |

## B. 形状

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| B1 | 三角形数 | 1800〜3000 | 2805 (初版 1837) | PASS | `deer-metrics.json` `tris` |
| B2 | シルエット IoU | ≥ 0.80 | 0.73 (初版 0.49) | PARTIAL | `silhouette.iou`、残課題 #2 |
| B3 | 縦横比 (参照 0.52) | ±0.05 | 0.53 | PASS | `silhouette.aspect` |
| B4 | fur マスク IoU | ≥ 0.60 | 0.72 (初版 0.42) | PASS | `parts.fur.mask_iou` |
| B5 | dark (深緑パネル・蹄・角根元) マスク IoU | ≥ 0.50 | 0.52 (初版 0.31) | PASS | `parts.dark.mask_iou` |
| B6 | glow (角・縁線・目) マスク IoU | ≥ 0.50 | 0.39 (初版 0.21) | PARTIAL | `parts.glow.mask_iou`、残課題 #1 |
| B7 | 面積比の差 ±0.03 | ±0.03 | fur +0.006 / dark +0.007 / glow −0.013 | PASS | `parts.<p>.fraction.diff` |
| B8 | 重心距離 ≤ 0.03 | ≤ 0.03 | fur 0.007 / dark 0.015 / glow 0.039 | PARTIAL (glow) | `parts.<p>.centroid.dist` |
| B9 | 閉じたメッシュ、法線外向き、原点足元、Z up、正面 −Y、孤立頂点なし | 検査 | 達成 (`inspect_scene.py` PROBLEMS なし) | PASS | `lowpoly_kit.finish` / `finalize` / `tube` |

## C. 色

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| C1 | fur ΔE76 | < 1.0 | 0.20 | PASS | `parts.fur.color.delta_e76` |
| C2 | dark ΔE76 | < 1.0 | 0.61 | PASS | `parts.dark.color.delta_e76` |
| C3 | glow ΔE76 | < 1.0 | 0.41 | PASS | `parts.glow.color.delta_e76` |
| C4 | 収束色が JSON 化され再ビルドで再現 | 有 | fur #CE994B / dark・teal #2F6661 / glow #97F7E0 (平行投影で 2 反復) | PASS | `tools/blender/deer-colors.json`, `deer-tune-history.json` |

## D. 成果物・運用

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| D1 | glb / blend が LFS でコミット | PASS | `b56a65a` (初版)、2 回目はこのコミット |
| D2 | 生成が決定論的 | PASS | `Kit.__init__` で `read_factory_settings(use_empty=True)` |
| D3 | 証跡が `docs/design/qa/` にある | PASS | deer-compare.png / -metrics.json / -ref-components.json / -tune-history.json |
| D4 | 残課題の文書化 | PASS | `deer-remaining-issues.md` |
| D5 | ユーザー手動受入 | 未実施 | — |

## 再現手順

```
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
    assets/models/deer.blend assets/textures/concept/deer-angular.png <out> 135 10 creature=deer proj=ortho
python3 tools/blender/tune_colors.py --creature deer --az 135 --proj ortho --target 1.0
DEER_DEBUG=1 ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models   # ランドマークの投影座標
~/.claude/skills/blender/scripts/run_blender.sh ~/.claude/skills/blender/scripts/inspect_scene.py -- assets/models/deer.blend
```
