# 土兎 (rabbit) 3D モデル QA 受入基準 (フルセット)

対象: `assets/models/rabbit.glb` / `assets/models/rabbit.blend` (git 管理外)、生成スクリプト `tools/blender/rabbit.py`。
参照画像: `assets/textures/concept/rabbit-angular.png` (Gemini `gemini-2.5-flash-image`、`--style=angular`)。
評価カメラ: 方位 45° (+X 側から正面寄り)、仰角 10°、50 mm、全高がフレームの 62%。
残課題は `rabbit-remaining-issues.md` を参照。

判定欄: PASS = 基準達成、PARTIAL = 目標未達だが中間成果物として許容、FAIL = 未達。
証跡列の SHA はこの worktree ブランチ `worktree-concept-art-variants` のコミット。

## A. 制作方針 (ユーザー指示由来)

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| A1 | 参照画像 (deer-v3 路線 = 角ばったジオメトリック、3〜5 頭身) に基づいて制作する | PASS | `56bff61` (`tools/gen-concept-art.mjs --style=angular`)、`assets/textures/concept/rabbit-angular.png` |
| A2 | 既存 Blender モデルを一切参照せず、2D 参照画像から一から作る (プリミティブ積み上げは不可) | PASS | `f9994ef` 断面ロフト方式に全面書き換え (`tools/blender/rabbit.py` `ring`/`loft`/`densify`) |
| A3 | 目・鼻・耳の模様・六角ジュエルは盛り上げず、参照どおりの平らな塗り分けにする | PASS | `4b90631` (`decal_at` / `almond` / `hexagon` / `jewel` / `ribbon`) |
| A4 | 評価はシルエットだけでなく、パーツ・模様ごとに RGB で色を比較する | PASS | `4b90631` `tools/blender/compare_ref.py` v2 (`parts.<p>.color`) |
| A5 | 各パーツの色差 ΔE76 が 1 未満になるまで補正ループを回す | PASS | `a8b0601` `tools/blender/tune_colors.py`、`rabbit-tune-history.json` |

## B. 形状・ポリゴン

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| B1 | 三角形数が旧モデル (592) の 3〜5 倍 | 1776〜2960 | 1863 | PASS | `rabbit-metrics.json` `tris` (`0aae098`) |
| B2 | シルエット IoU (参照 vs 撮影、bbox 正規化) | ≥ 0.80 | 0.81 | PASS | `rabbit-metrics.json` `silhouette.iou` |
| B3 | fur マスク IoU | ≥ 0.60 | 0.60 | PASS | `parts.fur.mask_iou` |
| B4 | 耳内側マスク IoU | ≥ 0.60 | 0.68 | PASS | `parts.ear_inner.mask_iou` |
| B5 | 発光 (glow) マスク IoU | ≥ 0.40 | 0.33 | PARTIAL | `parts.glow.mask_iou`、残課題 #5 |
| B6 | 濃色 (dark) マスク IoU | ≥ 0.30 | 0.06 | PARTIAL | `parts.dark.mask_iou`、残課題 #3 (参照の濃色は影) |
| B7 | 各パーツの面積比 (シルエット内割合) の差が ±0.03 以内 | ±0.03 | fur −0.026 / 耳 +0.049 / 濃色 −0.013 / 発光 −0.010 | PARTIAL | `parts.<p>.fraction.diff` (耳内側が超過) |
| B8 | 各パーツの重心距離 (正規化枠) | ≤ 0.03 | fur 0.006 / 耳 0.019 / 濃色 0.090 / 発光 0.011 | PARTIAL | `parts.<p>.centroid.dist` (濃色が超過、残課題 #3) |
| B9 | 頭が楔形で顔面がほぼ垂直、口先が絞られている | 目視 | 達成 | PASS | `rabbit-compare.png` 撮影パネル、`0aae098` |
| B10 | 耳がパドル形で、参照の見え方 (手前: 全長が内側色、奥: 上部のみ) を再現 | 目視 | 達成 (塗り分けで再現) | PASS | 同上、残課題 #1 (幾何の折れは未実装) |
| B11 | 奥側の目が口先の脇から見えない | 目視 | 達成 | PASS | `0aae098` `conform` + 扇状三角形化、`HEAD_ANGLES` |
| B12 | 全パーツが閉じたメッシュで法線が外向き、原点は足元、Z up、正面 −Y | 検査 | 達成 | PASS | `rabbit.py` `finish` (recalc_face_normals)、仕上げで z-min→0 |

## C. 色

| # | 基準 | 目標 | 実測 | 判定 | 証跡 |
|---|---|---|---|---|---|
| C1 | fur の撮影平均色 vs 参照平均色 ΔE76 | < 1.0 | 0.22 | PASS | `parts.fur.color.delta_e76` |
| C2 | 耳内側 ΔE76 | < 1.0 | 0.33 | PASS | `parts.ear_inner.color.delta_e76` |
| C3 | 濃色 ΔE76 | < 1.0 | 0.31 | PASS | `parts.dark.color.delta_e76` |
| C4 | 発光 (glow + teal) ΔE76 | < 1.0 | 0.41 | PASS | `parts.glow.color.delta_e76` |
| C5 | 収束した材質色が JSON で記録され、再ビルドで再現できる | 有 | 有 | PASS | `tools/blender/rabbit-colors.json` (fur #F8C464 / 耳内側 #54362C / 濃色 #705849 / 発光 #7FFFE8 / 縁 #538879) |
| C6 | 材質はマット (スペキュラ 0)、Base Color は sRGB→リニア変換済み | 検査 | 達成 | PASS | `rabbit.py` `solid` |
| C7 | 画素ごとの ΔE76 (重なり領域) の中央値 | 参考値 | `pixel_color.median_delta_e` | 参考 | `rabbit-metrics.json` |

## D. 成果物・運用

| # | 基準 | 判定 | 証跡 |
|---|---|---|---|
| D1 | `rabbit.glb` がコミットされている (`.blend` は gitignore) | PASS | `0aae098` `assets/models/rabbit.glb` |
| D2 | 生成が決定論的 (スクリプト再実行で同じ出力) | PASS | `rabbit.py` 先頭で `read_factory_settings(use_empty=True)` |
| D3 | 比較の証跡 (compare.png / metrics.json / ref_components.json / tune-history.json) が `docs/design/qa/` にある | PASS | `0aae098` |
| D4 | 秘密情報スキャン (git-secrets) を `--no-verify` なしで通過 | PASS | `compare_ref.py` `rounded()` で小数 4 桁に丸め |
| D5 | 残課題が文書化されている | PASS | `d560a8b` `rabbit-remaining-issues.md` |
| D6 | ユーザーによる手動受入 (Finder で比較画像・glb を確認) | 未実施 | — |

## E. 手動受入チェック (ユーザー実施)

- [ ] `rabbit-compare.png` の撮影パネルが参照と同じ印象 (頭身、耳、胸の張り出し、六角模様の位置)
- [ ] `rabbit.glb` を three.js / Blender で開き、他アングルで破綻がない (耳の非対称ポーズを許容するか判断)
- [ ] ゲーム内照明での色味 (残課題 #7)

## 利用ツール

| ツール | 用途 | 場所 / 起動 |
|---|---|---|
| Blender 5.2 (headless) | モデル生成、ID パス・陰影撮影、参照画像の解析 (numpy 同梱) | `~/.claude/skills/blender/scripts/run_blender.sh <script.py> -- <args>` |
| `tools/blender/rabbit.py` | 断面ロフトによるモデル生成、デカール貼付、glb 書き出し。`RABBIT_DEBUG=1` でランドマークの投影座標を表示 | `run_blender.sh tools/blender/rabbit.py -- assets/models` |
| `tools/blender/compare_ref.py` | 参照と同アングル撮影、パーツ別 (面積比・重心・マスク IoU・ΔE76)、画素 ΔE ヒートマップ、参照模様の連結成分抽出 | `run_blender.sh tools/blender/compare_ref.py -- assets/models/rabbit.blend assets/textures/concept/rabbit-angular.png <out> 45 10` |
| `tools/blender/tune_colors.py` | 再ビルド→比較→リニア空間で参照/撮影の比を材質色に掛ける反復。`history.json` を出力 | `python3 tools/blender/tune_colors.py --target 1.0 [--max-iter N] [--out dir]` |
| `tools/blender/rabbit-colors.json` | 収束した材質色。`rabbit.py` が存在すれば読み込む | — |
| `tools/gen-concept-art.mjs` | Gemini API による参照画像生成 (`--style=angular`、`--variants=N`)。`.env` の API キーを使う (コミット禁止) | `node tools/gen-concept-art.mjs --style=angular deer rabbit wolf --force` |
| git-secrets (pre-commit hook) | 長い数字列の誤検知対策として JSON を 4 桁丸め | 自動 |
| 行別シルエット幅の比較 (セッション内の補助スクリプト `rows.py`、リポジトリ未収録) | compare.png のクラス図から fy ごとの左右端を表にして形状差を特定 | 必要なら `compare_ref.py` へ取り込む |
