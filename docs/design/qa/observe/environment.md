# 観察画面の環境アセット(M22-02 デフォルメ試作)

鐘樹・集落・地面の植生を、Switch 世代の 3D ポケモン程度の密度でモデルにしたものです。
形は `assets/textures/board/sheets/{belltree,settlement,flora}.png` から取り、画風は動物の基準画 `assets/textures/board/creatures/*.png` に寄せました。
予算は `docs/design/2026-09-23-observation-view-design.md` §8 に従います。

## 作り方と確認

| 何を | どこで |
|---|---|
| 共通の部品(材質・形の部品・頂点色・柔らかい法線・書き出し) | `tools/blender/observe_kit.py` |
| 鐘樹 | `tools/blender/observe_belltree.py` → `assets/models/observe/belltree.glb` |
| 集落の部品 | `tools/blender/observe_settlement.py` → `assets/models/observe/settlement.glb` |
| 植生 | `tools/blender/observe_flora.py` → `assets/models/observe/flora.glb` |
| 読み直し・並べ図・集落の一角 | `tools/blender/observe_render.py`(`verify` / `lineup` / `corner`) |

```sh
blender -b --factory-startup --python tools/blender/observe_belltree.py
blender -b --factory-startup --python tools/blender/observe_settlement.py
blender -b --factory-startup --python tools/blender/observe_flora.py
blender -b --factory-startup --python tools/blender/observe_render.py -- verify assets/models/observe/{belltree,settlement,flora}.glb
blender -b --factory-startup --python tools/blender/observe_render.py -- lineup assets/models/observe/belltree.glb docs/design/qa/observe/belltree.png --ref assets/models/deer.glb
blender -b --factory-startup --python tools/blender/observe_render.py -- corner docs/design/qa/observe/corner.png
```

GLB の約束:

- 単位はメートル、Y 上です。各ノードは平行移動・回転を持たず、原点が地面の中心です。根や土の盛りは地面より最大 9 cm 沈めてあります。
- 1 ノードに 1 メッシュで、材質ごとに primitive が分かれます。属性は `POSITION`・`NORMAL`・`COLOR_0` だけです(UV はありません)。
- 材質は平らな基本色(`baseColorFactor`)です。`COLOR_0` は陰りと石ごとのばらつきを表す 0〜1 の乗数で、Three.js では `vertexColors: true` にすると glTF の規約どおり `baseColorFactor × COLOR_0` になります。
- 発光は `emissiveFactor` と `KHR_materials_emissive_strength` で持ちます。
- 草の葉(`flora_grass`・`flora_moongrass`)だけ `doubleSided` です。
- 葉の塊・草・苔には「柔らかい法線」を入れました。塊の法線と樹冠の中心から外への向きを混ぜたカスタム法線で、トゥーンのランプで一つの量感として陰ります。

## 三角形数(書き出した .glb を Blender で読み直した実測)

| ノード | 三角形 | 予算 | 大きさ(幅 × 奥 × 高さ m) | 材質 |
|---|---:|---:|---|---|
| `belltree_seedling` | 150 | — | 0.40 × 0.37 × 0.38 | soil, moss, bark, leaf, glow |
| `belltree_sapling` | 468 | — | 1.47 × 1.45 × 2.95 | soil, moss, bark, leaf |
| `belltree_mature` | 3,952 | ≤ 4,000 | 9.12 × 8.93 × 9.38 | bark, leaf, bell, bell_rim(鐘 30 個、M22-06 で裾を開いた) |
| `belltree_mature_lod1` | 1,112 | ≤ 1,200 | 9.16 × 8.92 × 9.30 | bark, leaf, bell, bell_rim(鐘 30 個、位置は成木と同じ) |
| `belltree_stump` | 300 | — | 2.06 × 2.21 × 0.87 | soil, moss, bark, cut, cut_ring |
| `belltree_logs` | 432 | — | 2.14 × 1.28 × 1.08 | cut, cut_ring, bark |
| `hut` | 1,934 | 1,200〜2,000 | 4.73 × 4.12 × 3.85 | straw, stone, moss, wood, bark, vine |
| `lantern_post` | 512 | ≤ 600 | 1.36 × 0.86 × 2.35 | stone, moss, rope, frame, lantern(M22-06 で灯籠に X の格子) |
| `slipway` | 1,982(1,114 から) | ≤ 2,500(≤ 1,500 から) | 8.24 × 27.78 × 2.74(5.11 × 16.54 × 1.81 から) | stone, moss, wood(M22-06 試作 2 の判断で大きな舟に合わせて 27 × 7.6 m に広げた。`keyitems.md`) |
| `stone_wall` | 440 | ≤ 600 | 4.04 × 0.67 × 0.96 | stone, moss |
| `megalith` | 596 | ≤ 800 | 1.98 × 1.79 × 3.78 | glyph, stone, moss |
| `grass_tuft` | 40 | ≤ 40 | 0.51 × 0.57 × 0.35 | grass |
| `moongrass_tuft` | 40 | ≤ 40 | 0.43 × 0.55 × 0.63 | moongrass |
| `moss_clump` | 116 | ≤ 120 | 0.78 × 0.65 × 0.25 | moss, spore |
| `rock` | 160 | ≤ 200 | 1.26 × 0.85 × 0.52 | rock, moss |

大きさは根・床石・割れ石を含みます。石垣と巨石の差し渡しは根元の石のぶん大きくなっています。

## 材質

| 材質 | 基本色 | 発光 | 使う所 |
|---|---|---|---|
| `belltree_bark` | #E6DFD1 | — | 白い幹・枝・根・鐘の吊り紐 |
| `belltree_leaf` | #86A044 | — | 葉の塊・若木と芽の葉 |
| `belltree_bell` / `belltree_bell_rim` | #7E5230 / #FFD58F | #FFC46B × 0.2 / × 3.0 | 青銅の鐘の胴と、裾の帯と口(M22-06 で変更、`keyitems.md`) |
| `belltree_glow` | #FFE7A8 | #FFD98A × 3.0 | 芽の先の光 |
| `belltree_soil` / `belltree_moss` | #7B6043 / #8AA743 | — | 根元の土の盛り(上を向いた面が苔) |
| `belltree_cut` / `belltree_cut_ring` | #EFD6A8 / #D2AC7B | — | 株と丸太の断面(年輪の帯) |
| `settlement_stone` / `settlement_moss` | #A3A194 / #8FA548 | — | 石(石ごとに明るさをばらす)と上面の苔 |
| `settlement_bark` / `settlement_wood` / `settlement_vine` / `settlement_straw` | #8E6240 / #A07A52 / #6E8235 / #C19C5E | — | 屋根の樹皮、梁・竿・盤木、蔓、敷き藁 |
| `settlement_lantern` / `settlement_frame` / `settlement_rope` | #FFC77A / #6A4A2F / #B79E6E | #FFC46B × 2.5(灯籠) | 灯籠の胴、枠、吊り紐 |
| `settlement_glyph` | #8FF5E6 | #8FF5E6 × 1.5 | 巨石の割れ目と六角の紋(ムーのシアン) |
| `flora_grass` / `flora_moongrass` | #86A84C / #BCD0B4 | — | 草・月草(両面) |
| `flora_moss` / `flora_spore` | #88A83F / #E9F5A6 | #DDF28A × 1.5(胞子) | 胞子苔と、苔の乗った石 |
| `flora_rock` | #9C9A8D | — | 石 |

## 画像

EEVEE で、Three.js 側の陰影の予定(設計 §8)を近似しました。
地の色は `baseColorFactor × COLOR_0` で、白い拡散の明るさを 3 段のランプ(寒色の影・中間・暖色の光、境界はなめらか)に通し、縁の光と発光を足しています。
bloom はかけていません。並べ図の右端の月鹿(`assets/models/deer.glb`、高さ 1.6 m)は大きさの物差しです。

| 画像 | 中身 |
|---|---|
| `belltree.png` | 芽・若木・成木・成木 lod1・株・丸太・月鹿 |
| `belltree_small.png` | 芽・若木・株・丸太・月鹿の寄り |
| `settlement.png` | 小屋・灯り柱・船台・石垣・巨石・月鹿(船台は 16 m の旧版。広げた船台は `ship.png`・`shipyard.png`) |
| `settlement_small.png` | 船台を除いた寄り |
| `flora.png` | 草・月草・胞子苔・石 |
| `corner.png` | 集落の一角(小屋、灯り柱 2、船台、石垣、巨石、成木 3、株、丸太、若木、芽、散らした草・月草・苔・石、月鹿)を低い斜めから(船台は 16 m の旧版のまま描き直していない) |

## 基準画との照合(自己評価)

形(sheets):

- 鐘樹: 幅の広い丸い樹冠、白く太い幹と根張り、樹冠の下に分かれる枝、垂れた鐘という骨格は合っています。
  基準画の樹冠は細かい葉の房が縁で毛羽立っていますが、こちらは滑らかな塊の集まりです。鐘は寄ると鐘に見え、引くと橙の円錐に見えます。
- 若木: 細い白い幹に大きな卵形の葉が螺旋に付き、縦長の輪郭で基準画に近いです。株(裂けた樹皮の縁と年輪)と丸太 3 本も合っています。丸太の樹皮には筋がありません。
- 小屋: 四隅の巨石の柱、低い空積みの壁、樹皮の板の屋根、屋根にかかる蔓、棟で交差する竿という基準画の要素は揃っています。
  基準画の板は不揃いで毛羽立っていますが、こちらは揃った板です。
- 灯り柱: 苔の乗った石の柱、石の腕木、吊り灯籠です。基準画の灯籠は木の格子(X の組み)ですが、こちらは六角の胴に縦の枠だけです。
- 船台: 斜路、両脇の縁石、上端の柱石は基準画どおりです。竜骨を受ける木の盤木と滑り材は、舟を組む場所として足しました(基準画にはありません)。
- 石垣: 2 段の丸めた石と、端の太い石です。基準画は L 字に曲がり、端の石に紋が刻まれていますが、こちらはまっすぐな 4 m の一片です(曲がりは置き方で作る想定)。
- 巨石: 基準画にはありません。一本の立石を 3 つに割って積み直し、割れ目を淡いシアンに光らせ(月鹿の装甲の継ぎ目と同じ意匠)、上の石に六角の紋(土兎の紋)を置きました。
  最初に入れた線の紋は文字や人の形に見えたので、継ぎ目と六角だけに減らしました。
- 植生: 草・月草・苔・苔の乗った石は基準画の区別(太い草、細く淡い月草、胞子の粒の光る苔)が付きます。月草の穂はありません。

画風(creatures):

- 合っているところ: 丸めた角ばり(面取りした石、滑らかな葉の塊)、柔らかい量感(柔らかい法線と頂点色の陰り)、控えめなシアンの発光(巨石だけ)、色味(黄褐・青緑・苔緑・白い幹・暖かい灯り)。
  月鹿と並べても浮かない色と密度です(`corner.png`)。
- 届いていないところ: 基準画の絵画らしさ(面の中の色の揺らぎ、筆の跡、縁の毛羽立ち)は、平らな基本色と頂点色だけでは出ません。
  Three.js 側の色調補正と紙の粒、葉の塊の輪郭の揺らし(頂点シェーダ)、必要なら小さなテクスチャで補う前提です。

## 既知の課題

- UV を書き出していません(`export_texcoords=False`)。テクスチャ(石と木のアトラス、葉のカード)を足すときは、UV を作るように部品を直す必要があります。
- 材質はスペキュラ 0 のため `KHR_materials_specular` が付き、GLTFLoader は `MeshPhysicalMaterial` を作ります。動物の .glb(`tools/blender/lowpoly_kit.py`)と同じ扱いです。
  観察画面では読み込み後にトゥーンの材質へ差し替える想定です(設計 §8)。
- 苔は面ごとの材質の切り替えなので、面取りした石の上面が丸ごと緑になり、境界がくっきりします。
- 鐘は引きの距離で円錐に見えます。灯りの読みは bloom(Three.js 側)に頼っています。
- 風の揺れの重みは頂点属性で持っていません。草・葉は高さ(`position.y`)に比例させる想定です。
- LOD は成木だけです。小屋・船台などの遠景用 LOD はありません(予算の範囲内なので未作成)。
- 描画は EEVEE の近似です。Three.js のトゥーン・縁の光・色調補正での比較画は、M22-02 の本体の組み立てで撮り直します。
- 集落の衝立(`sheets/settlement.png` の編んだ衝立)は、今回の対象外として作っていません。

## 追記(M22-06 / M22-03)

舟の 6 段・丸太の山・衝立・L 字の石垣・森の木・羊歯・小花・穂の出た月草を足し、鐘樹の鐘と灯籠を直しました。三角形数・画像・自己評価は `keyitems.md` にあります。
上の表の鐘樹の成木・lod1・灯り柱の数は直した後の実測に更新しました。上の「既知の課題」のうち、鐘が引きで円錐に見える点と、衝立を作っていない点は `keyitems.md` で対応済みです。
