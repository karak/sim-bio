# 観察画面の灰狼(M22-05)

基準画 `assets/textures/board/creatures/wolf.png`(承認済み)を、月鹿(`deer.md`)と同じ作り方・同じ密度(丸めた形・なめらかな陰影)で起こした灰狼。
造形の元は `assets/textures/concept/wolf-angular.png`。画風が食い違ったら動物側の基準画を正とする(`assets/textures/board/README.md`)。

## 出力と作り直し方

| もの | 場所 |
|---|---|
| モデル | `assets/models/observe/wolf.glb`(+ `wolf.blend`) |
| 組み立て | `tools/blender/observe_wolf.py`(`observe_deer.py` の部品・リグ・IK・焼き・書き出しを引き継ぐ) |
| 撮影 | `tools/blender/observe_wolf_render.py`(鹿と同じ光・紙色の背景・グレア) |
| 比較画 | `tools/blender/observe_wolf_sheet.py`(python3 + Pillow) |
| 書き出しの検証 | `tools/blender/observe_wolf_check.py`(GLB を Blender に読み戻して数える) |

```sh
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf.py -- assets/models/observe
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf_render.py -- assets/models/observe/wolf.blend <raw_dir> 720
python3 tools/blender/observe_wolf_sheet.py <raw_dir> docs/design/qa/observe
~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf_check.py -- assets/models/observe/wolf.glb
```

鹿のスクリプトは変えていない(汎用化せず、狼用に写して直した)。

## 実測(`observe_wolf_check.py`、GLB を読み戻した値)

| メッシュ(ノード名) | 三角形 | 頂点 | 内訳(材質別の三角形) |
|---|---|---|---|
| `wolf`(近 LOD) | **2,541** | 1,609 | body 1,358 / dark 696 / glow 400 / nose 60 / pale 27 |
| `wolf_lod1`(群れ LOD) | **650** | 455 | body 388 / dark 172 / glow 78 / nose 12 |

- 予算(近 ≈2,500 / 群れ ≈800)に対し 近 +2%、群れ -19%。群れ LOD は VAT に焼くので頂点を 455 に抑えた。
- 寸法: 単位 m。背の線(肩)0.85 m(組み立ての断面の値)、全高 0.94 m(肩の棘の先・耳の先、bbox)、鼻先から尾の先 1.58 m(y -0.86..0.72)、幅 0.40 m。足の底が z = 0、前後の足の中点が原点。
- 向き: Blender で正面 -Y → glTF で **+Z が正面、Y が上**。
- 2 つのメッシュは同じスキン(`wolf_rig`、骨 29 本)を共有し、どちらもシーンのルートに置く(鹿と同じ)。
- 1 頂点あたりの影響は最大 3 本、重みの合計はすべて 1。頂点色 `COLOR_0` は全プリミティブに付く(毛以外は白)。
- glTF-Validator(npm `gltf-validator`): **errors 0 / warnings 0 / infos 0**、アニメ 6、材質 5、スキンあり。

## 骨(29 本)

`root`(動かさない)・`pelvis`・`spine1`・`chest`・`neck1`・`neck2`・`head`・`jaw`・`ear_L/R`・`tail1/2/3`、
脚 4 本 × 4(前: `fl_upper/fore/meta/paw_{L,R}`、後: `hl_thigh/shin/meta/paw_{L,R}`)。目・棘・飾り毛は頭か胴・首に固定。
どの骨もローカル X がワールド X を向く(鹿と同じ)。前向きの骨は X 回りの正で先が下がり、後ろ向きの尾は正で先が上がる。

## アニメーション(30 fps、その場。root は全フレームで 0)

| 名前 | 長さ | ループ | 中身 |
|---|---|---|---|
| `idle` | 4.0 s(120 f) | する | 呼吸(2 回)、首をゆっくり左右、1.0 s に左耳・2.7 s に右耳をはじく、尾のゆるい揺れと 2.0 s の一振り |
| `walk` | 1.1 s(33 f) | する | 4 拍の常歩(左後 → 左前 → 右後 → 右前、立脚 62%、歩幅 0.40 m) |
| `stalk` | 1.6 s(48 f) | する | 体を 0.10 m 沈め、胸を下げ、首を前へ伸ばして頭を水平に保つ忍び足(立脚 76%、歩幅 0.30 m)。耳は前 |
| `run` | 0.5 s(15 f) | する | 回転ギャロップ(右後 → 左後 → 右前 → 左前、立脚 34%、歩幅 0.72 m)。背を曲げ伸ばし、耳を伏せ、尾を後ろへ伸ばす |
| `pounce` | 1.2 s(36 f) | しない | 0〜0.35 s 後ろへ沈んで溜める、0.35〜0.6 s 前下へ 0.30 m 飛び込み前足を 0.45 m 先へ(顎を開く)、0.75〜1.2 s 前足・後足を一歩ずつ戻して rest に戻る |
| `fall` | 2.0 s(60 f) | しない | 0〜0.6 s 前脚が折れる、0.45〜1.4 s 横倒し、1.2〜2 s 首と頭が地に落ちて止まる |

- 脚は 2D の解析 IK(肩・股関節から足の付け根)で、立脚中は足が地面に固定される。ループはどれも最初と最後のフレームが同じ。
- `pounce` は骨盤が一時的に前へ 0.37 m 動く(その場の原点は動かさない)。最後のフレームは rest と同じなので、終わったら idle / walk へそのまま戻せる。捕まえた後の移動は Three.js 側で個体を動かす。
- `pounce`・`fall` は Three.js で `LoopOnce` + `clampWhenFinished`。

## 材質

| 名前 | 色(sRGB) | 使い方 |
|---|---|---|
| `wolf_body` | 頂点色(地 #D8754C、背 #E48A56、喉・胸・腹・鼻づらの下・頬 #B08C78、耳の内側 #8E4E36)、baseColorFactor 1 | 毛。淡い色と、焦げ茶の手前の暗み(脚)は頂点色 |
| `wolf_dark` | #6B412F | 脚の下(前脚は肘の少し上、後脚は膝の少し上から)と足 |
| `wolf_pale` | #B08C78 | 頬と胸の飾り毛(尖った楔、近 LOD のみ)。淡い面そのものは `wolf_body` の頂点色 |
| `wolf_nose` | #3A2826 | 鼻、目の縁 |
| `wolf_glow` | #8FF5E6、emissive #8FF5E6(係数 1) | 背の稜線(頭の後ろ → 尾の先)、肩と首の上の棘の前の面、肩の後ろ・肩の前・腰の前の継ぎ目、目 |

- 全材質 roughness 0.8、metallic 0、specular 0。陰影は Three.js 側のトゥーンのランプで付ける前提(鹿と同じ)。

## 比較画

上から 基準画の上段(側面・正面・斜め前)、モデル(rest、同じ向き)、基準画の下段(忍び寄り・疾走)、モデル(`stalk` 12 f・`run` 12 f、側面)。

![比較](wolf-compare.png)

| 画像 | 中身 |
|---|---|
| `wolf-compare.png` | 上のとおり 5 体ずつ |
| `wolf-view-{side,front,q34,rear34}.png` | モデル単体 512² |
| `wolf-lod.png` | 近 LOD / 群れ LOD(側面・斜め前) |
| `wolf-anim.png` | idle(1.1 s)・walk(8 f)・stalk(12 f)・run(12 f)・pounce(17 f、飛び込み)・fall(最後) |
| `wolf-seq-{walk,stalk,run,pounce,fall}.png` | 側面の連続 |

![LOD](wolf-lod.png)
![アニメ](wolf-anim.png)

## 作り直しの記録

1. **1 回目**: 基準画の側面を 0.0029 m/px で測って胴・首・頭・脚・尾を組んだ。頭が長く尖り(狐)、耳が小さく、継ぎ目が胴を一周する縞に見え、淡い胸がほとんど見えず、焦げ茶が脚の下だけ(長靴)。run で尾が腹の下へ回った(後ろ向きの骨の回転の符号の取り違え)。
2. **2 回目**: 頭を短く太く、耳を大きく、焦げ茶を肘・膝の少し上から、淡い色を喉・胸・頬へ広げた。継ぎ目を短く、足を大きく。尾・耳の回転の符号を直した。
3. **3 回目**: 頭を 5 cm 持ち上げた(基準画の側面は頭が低く、正面・斜め前は高い。rest はその間にして、stalk で首を下げる)。肩幅を広げ(正面で頭より胴が狭かった)、棘を首の後ろから肩へ寄せた(正面で頭の上に突き出た)。
4. **4 回目**: 鼻づらの先を丸く太く(尖りを減らす)、肩の継ぎ目を短く。fall の首の横曲げの向きを直した(頭が地面から持ち上がっていた)。疾走の比較は脚を体の下に集めた 12 f にした。

## 基準画との差(残り)

- **面の立ち方**: 基準画は面の立った角ばり(肩の面・脇の面・頬の面がはっきり分かれる)。モデルはなめらかな断面のロフトで、胴は丸い樽に近い。鹿と同じ課題。
- **鼻づら**: 基準画より細く尖って見え、狐寄り。正面から鼻が大きな黒い玉に見える。
- **塗り**: 基準画の筆の塗り(明るい面の黄み、陰の赤み、毛の筆致)は無い。モデルの橙は撮影の光で基準画より明るく桃色寄りに見える。淡い胸は基準画(陰の灰茶)より明るい。
- **発光**: 基準画は輪郭全体を包む滲んだ光。モデルは背の稜線・棘・3 本の継ぎ目・目だけで、胸や肩の前の輪郭の光は無い。正面では稜線が頭の上に細い線として見える。
- **姿勢**: 基準画の側面・忍び寄りは前脚を前へ突き出す。モデルの rest は脚をほぼ垂直に立てている(IK の基準のため)。忍び寄りの前脚は基準画ほど前へ伸びない。
- **尾**: 基準画より長く細い。下側のぎざぎざの毛は無い。
- **群れ LOD**: 足の塊と飾り毛を省き、脚のロフトの先を平らにしただけ。遠目の輪郭は近 LOD と同じ。
- Three.js での読み込み・再生の確認はまだ(`creatures.ts` は鹿の GLB だけを読む。狼の GLB を読み込む配線は M22-05 の残り)。

## 判定(所見)

珊瑚色の体・焦げ茶の脚・淡い喉と胸・シアンに光る背の稜線と棘・光る目・尖った耳・ふさふさの尾・肩が高く頭の低い構えは、5 方向とも基準画と同じ生き物として読める。
面の立ち方と鼻づらの形は基準画に届いていない(狐寄り)。鹿と揃えて、Three.js の塗りを当てた後に詰めるかをユーザーの美観チェックで決める。
