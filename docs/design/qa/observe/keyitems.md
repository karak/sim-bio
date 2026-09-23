# 観察画面のキーアイテムと残りの植物(M22-06 舟・集落の追加、M22-03 植物)

空の舟の建造 5 段と飛び立ち、造船場の材木、集落の衝立と L 字の石垣、森の木・羊歯・小花・穂の出た月草を、`environment.md` と同じ作り方(丸めたローポリ・柔らかい量感・頂点色・UV なし・発光は `KHR_materials_emissive_strength`)で足しました。
形は `assets/textures/board/sheets/{ship,settlement,flora}.png` と `key-visuals/{shipyard,departure}.png`、画風は動物の基準画 `creatures/*.png` に寄せています。
鐘樹の鐘も、引いて見ても鐘と読めるように直しました。

2026-09-24 の試作 2 の判断「船は大きく、立派な感じがほしい」を受けて、舟の 6 段を作り直しました(全長 ≈ 26 m・幅 7 m・主帆柱 22 m、帆柱 3 本、船尾楼)。
船台(`settlement.glb` の `slipway`)も舟に合わせて 27 × 7.6 m に広げました。以下の数は作り直した後のものです(前の値は括弧内)。

## 作り方と確認

| 何を | どこで |
|---|---|
| 舟(6 段)と丸太の山 | `tools/blender/observe_ship.py` → `assets/models/observe/ship.glb`(新規) |
| 衝立・L 字の石垣・灯籠の格子 | `tools/blender/observe_settlement.py` → `settlement.glb`(既存ノードはそのまま) |
| 森の木・羊歯・小花・穂の出た月草 | `tools/blender/observe_flora.py` → `flora.glb`(既存ノードはそのまま) |
| 鐘の形と光り方 | `tools/blender/observe_belltree.py` → `belltree.glb` |
| 読み直し・並べ図・舟の段・造船場 | `tools/blender/observe_render.py`(`verify` / `lineup` / `ship-stages` / `ship` / `shipyard`) |

```sh
blender -b --factory-startup --python tools/blender/observe_ship.py
blender -b --factory-startup --python tools/blender/observe_settlement.py
blender -b --factory-startup --python tools/blender/observe_flora.py
blender -b --factory-startup --python tools/blender/observe_belltree.py
blender -b --factory-startup --python tools/blender/observe_render.py -- verify assets/models/observe/{ship,settlement,flora,belltree}.glb
blender -b --factory-startup --python tools/blender/observe_render.py -- ship-stages docs/design/qa/observe/ship-stages.png
blender -b --factory-startup --python tools/blender/observe_render.py -- ship docs/design/qa/observe/ship.png
blender -b --factory-startup --python tools/blender/observe_render.py -- shipyard docs/design/qa/observe/shipyard.png
blender -b --factory-startup --python tools/blender/observe_render.py -- lineup assets/models/observe/flora.glb docs/design/qa/observe/flora2.png --only forest_tree,forest_tree_lod1,moongrass_tuft,moongrass_tuft_seed,fern,flower_patch --gap 0.6 --ref assets/models/deer.glb
blender -b --factory-startup --python tools/blender/observe_render.py -- lineup assets/models/observe/flora.glb docs/design/qa/observe/flora2_small.png --only grass_tuft,moongrass_tuft,moongrass_tuft_seed,fern,flower_patch --gap 0.3
blender -b --factory-startup --python tools/blender/observe_render.py -- lineup assets/models/observe/settlement.glb docs/design/qa/observe/settlement_new.png --only lantern_post,woven_screen,stone_wall_corner --gap 0.6
blender -b --factory-startup --python tools/blender/observe_render.py -- lineup assets/models/observe/ship.glb docs/design/qa/observe/timber_pile.png --only timber_pile --ref assets/models/deer.glb
```

## 舟の GLB の約束(`ship.glb`)

- 段ごとに 1 ノードです。ゲーム側は進みに合わせて 1 つだけ表示します。
  配線はまだしていません。対応の案は 竜骨 0〜19 / 肋 20〜39 / 板 40〜59 / 帆柱 60〜89 / 帆 90〜119 / 完成 120(`ship_sails`)/ 飛び立ち(`launchedYear` 以降、`ship_flying`)です。
- 原点は竜骨の底の中心で、船首は +Z(glTF)を向きます(変更なし)。
  外板の船体は 24.6 m、船首の巻きと船尾の柱まで入れて 26.7 m、幅は 7.0 m(舷縁まで、舷縁の冠木を入れて 7.4 m)です(前は 14.1 m / 15.3 m / 3.9 m)。
  高さ(竜骨の底から): 中央の舷縁 5.6 m、主甲板 4.5 m、船尾楼の床 7.4 m・欄干の上 ≈ 9.7 m、船首の巻きの頂 ≈ 11.2 m、帆柱の頂は前 18.8 m・主 22.0 m・後ろ 15.8 m。
- 盤木は原点より下(−0.5 m まで、前は −0.35 m)に伸びます。船台に載せるときは船台の盤木の上面(`slipway` の中央で 1.36 m、前は 0.99 m)に 0.5 m を足し、船台の傾き(atan(1.5/27) ≈ 3.2°、前は atan(0.9/16)、船首側が下は同じ)だけ傾けます。
  盤木は `slipway` の盤木と同じ前後位置(±1.45 m・±4.35 m・±7.25 m、前は ±1.3 m・±3.85 m)に置いたので、重ねると盤木の上に盤木が載ります。船台の盤木は外側に ±10.15 m の 2 つが余分にあります(船首・船尾の柱の下)。
- 支柱の足は船台に合わせて下ろしてあります: 竜骨の段の柱と竜骨の支柱は敷石の上面(原点から −0.88 m)、舷側の支柱(板・帆柱・帆の段)は両脇の縁石の上面(−0.58 m、横 ±3.35 m)。
  平らな地面に置くと支柱の足が地面より下に入るので、描き比べでも船台に載せています(`ship.png`・`ship-stages.png`)。
- `ship_flying` は盤木と支柱がなく、竜骨の下に光の輪とレンズが原点の 2.6 m 下まで(前は 1.6 m)下がります。浮かせて使う前提です。
- 各段の同じ部品(竜骨・外板・船尾楼・帆柱・帆桁・手すり・鐘)は同じ形で、段を切り替えても位置が飛びません(同じ乱数の種で作り、`ship.glb` を 2 回書き出してバイト単位で同じことも確かめました)。
- ゲーム側(`src/observe/render/ship.ts`)の数: `SLIP_TOP = 1.36`、`BLOCK_DROP = 0.5`、`SLIP_TILT = atan(1.5/27)`、`HOVER = 11`(前は 0.99 / 0.35 / atan(0.9/16) / 7)。
- 船体(`ship_hull`)と帆(`ship_sail`)は両面です。浮かぶ力のレンズ(`ship_lift`)だけ `alphaMode: BLEND`(不透明度 0.2)です。

## 三角形数(書き出した .glb を Blender で読み直した実測)

| ノード | 三角形 | 予算 | 大きさ(幅 × 奥 × 高さ m) | 材質 |
|---|---:|---:|---|---|
| `ship_keel` | 508(412 から) | ≤ 12,000 | 5.44 × 26.72 × 12.11 | timber, block |
| `ship_ribs` | 3,480(1,792 から) | ≤ 12,000 | 7.18 × 26.72 × 11.65 | timber, block |
| `ship_planks` | 3,980(1,968 から) | ≤ 12,000 | 7.42 × 26.72 × 11.73 | timber, block, hull |
| `ship_mast` | 5,416(2,496 から) | ≤ 12,000 | 7.42 × 26.72 × 22.59 | timber, block, hull, deck |
| `ship_sails` | 10,348(3,928 から) | ≤ 12,000 | 10.40 × 28.08 × 22.59 | timber, block, hull, deck, rope, bell, bell_rim, sail |
| `ship_flying` | 10,781(3,906 から) | ≤ 12,000 | 11.85 × 28.08 × 24.60 | timber, hull, deck, block, rope, bell, bell_rim, sail, mu, mu_ring, lift |
| `slipway`(船台を広げた) | 1,982(1,114 から) | ≤ 2,500(≤ 1,500 から) | 8.24 × 27.78 × 2.74 | stone, moss, wood |
| `timber_pile` | 516 | ≤ 600 | 3.19 × 2.75 × 0.83 | log_ring, log_cut, log_bark, block, timber |
| `woven_screen` | 360 | ≤ 400 | 2.14 × 0.30 × 2.07 | wood, weave, rope, vine, bell, bell_rim |
| `stone_wall_corner` | 680 | ≤ 800 | 3.40 × 3.10 × 1.02 | stone, moss |
| `lantern_post`(格子を足した) | 512(368 から) | ≤ 600 | 1.36 × 0.86 × 2.35 | stone, moss, rope, frame, lantern |
| `forest_tree`(M22-07 で房 6 つに分けた) | 1,625(1,740 から) | ≤ 2,000 | 5.51 × 5.32 × 7.53 | forest_bark, forest_leaf |
| `forest_tree_lod1`(M22-07 で房 6 つ) | 575(579 から) | ≤ 600 | 5.47 × 5.44 × 7.58 | forest_bark, forest_leaf |
| `moongrass_tuft_seed` | 52 | ≤ 60 | 0.38 × 0.49 × 0.95 | moongrass, moonseed |
| `fern` | 80 | ≤ 80 | 1.33 × 1.21 × 0.42 | fern |
| `flower_patch` | 67 | ≤ 80 | 0.41 × 0.42 × 0.29 | stem, petal |
| `belltree_mature`(鐘を直した、M22-07 で房 8 つ) | 3,917(3,952 から) | ≤ 4,000 | 8.74 × 8.86 × 9.52 | bark, leaf, bell, bell_rim |
| `belltree_mature_lod1`(鐘を直した、M22-07 で房 8 つ) | 1,112 | ≤ 1,200 | 8.96 × 8.89 × 9.56 | bark, leaf, bell, bell_rim |

予算は試作 2 の判断で各段 ≤ 6,000 から ≤ 12,000 に上げました。`ship_sails`・`ship_flying` の奥行き 28.08 m は船首の鐘の腕のぶん、`ship_flying` の高さは竜骨の下の光の輪のぶんを含みます。`ship_flying` の `ship_block` は船尾楼の戸口の板戸です。
`ship_keel` の奥行き 16.67 m は、船首と船尾の柱を支える斜めの支柱のぶんです(作り直した後は 26.72 m で、船首の巻きと船尾の柱の長さと同じです)。`stone_wall_corner` の原点は L の外側の角で、腕は +X に 3 m、−Z(glTF)に 2.4 m 伸びます。
既存のノード(`hut`・`slipway`・`stone_wall`・`megalith`・草・苔・石・鐘樹の他の段)の三角形数は変わっていません。
(試作 2 の作り直しでは `slipway` だけを変えました。`settlement.glb` の他のノードは頂点・索引の中身まで前と同じです。)

## 材質(新しいもの)

| 材質 | 基本色 | 発光 | 使う所 |
|---|---|---|---|
| `ship_hull` / `ship_timber` / `ship_deck` | #E4D6BC / #D8C6A4 / #CDB58E | — | 鐘樹の淡い材の外板(両面)、竜骨・肋・帆柱・帆桁・手すり、甲板 |
| `ship_block` / `ship_rope` / `ship_sail` | #A07A52 / #B79E6E / #EAE0C8 | — | 盤木と支柱(集落の木と同じ色)、編んだ縄、編み繊維の帆(両面) |
| `ship_bell` / `ship_bell_rim` | #7A4E2A / #FFD58F | #FFC46B × 0.2 / × 3.0 | 舷側の小さな鐘の胴(暗い青銅)と、開いた裾の帯と口 |
| `ship_mu` / `ship_mu_ring` / `ship_lift` | #8FF5E6 | #8FF5E6 × 2.0 / × 2.0 / × 1.0 | 竜骨の底の継ぎ目、細長い六角の光の輪 3 つ(両面)、淡いレンズ(半透明 0.2) |
| `ship_log_bark` / `ship_log_cut` / `ship_log_ring` | #E6DFD1 / #EFD6A8 / #D2AC7B | — | 丸太の山(鐘樹の丸太と同じ色) |
| `settlement_weave` | #A8977A | — | 衝立の編み繊維(両面) |
| `settlement_bell` / `settlement_bell_rim` | #7A4E2A / #FFD58F | #FFC46B × 0.2 / × 3.0 | 衝立に吊った小さな鐘 |
| `belltree_bell`(変更) / `belltree_bell_rim`(新規) | #7E5230(#A8703F から) / #FFD58F | #FFC46B × 0.2(× 0.9 から) / × 3.0 | 鐘樹の鐘の胴と、裾の帯と口 |
| `flora_forest_leaf` / `flora_forest_bark` | #5A873C / #6E5039 | — | 森の木の葉の塊(鐘樹 #86A044 より濃く青い)と茶色の幹 |
| `flora_fern` / `flora_stem` / `flora_petal` | #5F8D3A / #6F9642 / #F1EDE2 | — | 羊歯・花の茎と葉・花びら(いずれも両面) |
| `flora_moonseed` | #DCEBDD | #C9F6EA × 0.8 | 月草の穂(淡く光る) |

鐘の胴の発光を 0.2 に下げたのは、Three.js 側の `toToon` が発光の強さを 0.45 で頭打ちにするためです(`src/observe/render/assets.ts`)。
胴が 0.9 のままだと、胴も裾もどちらも 0.45 になって差が消えます。胴 0.2 と裾 0.45 なら、暗い胴に明るい口という読みが本体でも残ります。

## 画像

| 画像 | 中身 |
|---|---|
| `ship-stages.png` | 建造の 6 段(手前の列: 竜骨・肋・板、奥の列: 帆柱・帆(完成)・飛び立ち)を左舷の斜め上から(正射影)。試作 2 で各段を船台に載せ(飛び立ちは船台の 5 m 上)、左手前に小屋と月鹿を物差しに置いた |
| `ship.png` | 完成(帆を畳む、盤木と支柱つき)と飛び立ち(帆を広げる、竜骨の下にシアンの光)の寄り。丸太の山と月鹿は物差し。試作 2 で完成を船台に載せ、小屋も物差しに置いた |
| `shipyard.png` | 造船場: 船台に肋の段の舟、丸太の山、灯り柱 2、編んだ衝立、小屋、L 字の石垣、鐘樹 2、奥に森の木 9、羊歯・小花・穂の出た月草・草、月鹿。試作 2 で 27 m の船台に板張りの段の舟(キービジュアルと同じく肋の頭が覗く)、丸太の山は船台の横、月鹿を船台の脇にもう 1 頭 |
| `flora2.png` / `flora2_small.png` | 森の木(lod0・lod1)と小さな植物、小さな植物の寄り |
| `settlement_new.png` | 格子を足した灯り柱・編んだ衝立・L 字の石垣の寄り |
| `timber_pile.png` | 丸太の山と月鹿 |
| `belltree.png` / `settlement.png` / `corner.png` | 既存の図を、直した鐘と足したノードで描き直したもの |

## 基準画との照合(自己評価)

舟の作り直し(試作 2、「船は大きく、立派な感じがほしい」):

- 大きさ: 全長 ≈ 26 m・幅 7 m・中央の舷縁 5.6 m・主帆柱 22 m で、小屋(高さ 3.9 m)の 6 倍近い高さ、月鹿(き甲 1.41 m)の 4 倍の舷の高さです。
  `ship.png`・`shipyard.png` で、小屋と月鹿の横に並べると集落の大仕事として読めます。前の舟(全長 15 m・舷縁 2.6 m)の細い漕ぎ舟の印象は無くなりました。
- 形: 長く平らな竜骨から両端で反り上がる深い丸い船体、高く巻いた船首の柱、欄干と鐘を並べた高い船尾楼(前の壁に戸口、主甲板から上がる階段)。
  基準画(`sheets/ship.png`)の「短く深い」「船尾に欄干の台」に近づきました。長さと高さの比は基準画(≈ 3)よりまだ長め(舷縁まで ≈ 4.4、船尾楼まで ≈ 2.7)です。
  船体の中ほどに太い腰板 2 本を通し、横から見たときの水平の帯で大きさを読ませています。
- 帆: 完成は 5 本の帆桁に畳んだ帆。飛び立ちは前と主に 2 段ずつ・後ろに 1 枚の四角い帆を重ね、前の帆柱から船首の柱へ三角の帆を張りました(`departure.png` の「帆を何枚も重ねた大きな船」)。
  帆柱の中ほどに丸い檣楼を置き、`departure.png` の帆柱の見張り台に寄せています。
- 鐘: 腰の手すりの柱の間ごとに 14 個ずつ(両舷 28)、船尾楼の欄干に 3 つおき、船首の巻いた柱の先に大きな鐘を 1 つ。胴と裾の光り方は前と同じ(`ship_bell` / `ship_bell_rim`)です。
- ムーのシアン(飛び立ちだけ): 竜骨の底の継ぎ目、外板の継ぎ目 2 本に沿った細い象嵌の線(月鹿の甲の継ぎ目と同じ光り方)、船首の両舷の六角の紋、竜骨の下の輪 3 つとレンズ。建造中の段には入れていません。
- 違うところ: 基準画の船首は大きく渦を巻きますが、こちらは四角い材の小さな鉤です。
  基準画の帆は帆桁の下に大きく張った一枚ですが、完成の段は畳んでいます(依頼どおり)。飛び立ちの帆は横から見ると薄い膨らみになり、キービジュアルのような斜め前からの角度で映えます。
  船体の両端は外板の段が細くなるので、寄ると縦の筋(平らな面の継ぎ目)が見えます。

舟(`sheets/ship.png`・`key-visuals/shipyard.png`・`departure.png`):

- 合っているところ: 淡い材の丸い船体、高く反った船首と船尾の柱、船首の先の巻き、舷側に並んだ小さな青銅の鐘、帆柱と縄梯子、四角い編み繊維の帆。
  肋の段は、造船場のキービジュアルと同じく肋の頭が舷縁の上に並ぶ骨組みで、船台の上で舟を組んでいる場面として読めます。
  基準画に無かった「板張りの途中」の段は、下 4 段と 5 段目の中ほどだけを張って上に肋を覗かせて補いました。
- 違うところ: 基準画の船体はもっと短く深い(全長に対して高い)丸さで、船尾に低い欄干の台があります。こちらは細長いボートに近く、船尾の台は小さな箱です。
  基準画の帆は帆桁の下に大きく張った一枚ですが、完成の段では畳んで帆桁に括っています(依頼どおり)。横から見ると帆桁の端が見え、畳んだ帆は小さな塊になります。
  飛び立ちのキービジュアルは帆を何枚も重ねた大きな船ですが、こちらは帆 1 枚のままです。
- 外板の鎧張りは、段の下の縁の影(頂点色 0.8)と段ごとの明るさで読ませています。寄れば板に見え、引くと滑らかな船体に見えます。

浮かぶ力(ムーのシアン):

- 竜骨の底の細い継ぎ目と、竜骨の下に重ねた細長い六角の輪 3 つ(土兎の六角の紋と同じ意匠)と、ごく淡いレンズです。
  EEVEE(bloom なし)では輪がくっきりした線に見え、「柔らかい光」には届いていません。本体の bloom でぼけて光の層に見えるかを確かめる必要があります。
  輪が機械的すぎるなら、輪を外してレンズと継ぎ目だけにする(三角形は 36 減る)のが次の候補です。
- シアンは飛び立ちの段だけに使い、建造中の段には入れていません(控えめに、の指示どおり)。

集落(`sheets/settlement.png`):

- 衝立: 束ねた枝の柱 2 本、上下の横木、横 5・縦 6 の帯を上下交互に編んだ面、四隅の括り縄、蔓、小さな鐘 2 つ。基準画の要素は揃っています。基準画の編み目はもっと細かく、蔓が多いです。
- L 字の石垣: 角と端に太い立石、2 段の丸めた石、崩れかけた天端の石、足元の落ちた石。基準画の「端の石の彫り物」は、浅い六角の溝(光らない)にしました。基準画の彫り物は文字のような形ですが、文字や人の形は避ける方針(`environment.md` の巨石)に合わせています。
- 灯り柱: 灯籠の六つの面に X の格子を入れ、基準画の木の格子の灯籠に近づきました。

植物(`sheets/flora.png`):

- 森の木: 茶色の幹が 3 本の太枝に分かれ、濃い緑の丸い葉の塊の樹冠。鐘樹(白い幹・幅の広い樹冠・黄緑・鐘)とは、色・幹・大きさ(高さ 7.6 m、鐘樹は 9.4 m)ではっきり見分けられます(`shipyard.png` の奥)。
  基準画の樹冠は細かい葉の房で縁が毛羽立っていますが、こちらは滑らかな塊の集まりです(鐘樹と同じ課題)。
- 月草の穂: 細い茎の先に淡く光る穂 3 本。穂は細長い菱形で、寄ると結晶のようにも見えます。
- 羊歯: 反って垂れる葉 5 枚、小葉は先へ向いた三角。寄ると紙を切ったような角ばりが目立ちますが、草の中に撒くと羊歯として読めます(`shipyard.png`)。
- 小花: 5 弁の星形の淡い花(白と淡い藤色、中心は黄色)5 輪と、地に伏せた葉。小さいので引くと白い点になります。

鐘樹の鐘:

- 胴を暗い青銅(#7E5230、発光 0.2)に、裾を開いて(半径 0.27 → 0.30)、裾の帯と口を明るい材質にしました。
  引いた距離でも「暗い釣鐘に明るい口」の形で読め、前の「橙の円錐」から改善しました(`belltree.png`・`shipyard.png`)。
  群れ用(lod1)の鐘は四角の鐘にして、裾の帯を足しました(三角形は 932 → 1,112、予算 1,200 の内)。

画風(creatures):

- 合っているところ: 色味(淡い材・暖かい青銅の灯り・苔緑)と、丸めたローポリの密度は既存の環境アセットと揃っていて、月鹿と並べても浮きません(`ship.png`・`shipyard.png`)。
- 届いていないところ: 船体・帆・丸太は大きな平らな面が多く、基準画の絵画らしさ(面の中の色の揺らぎ・筆の跡)はまだありません。`environment.md` と同じく、Three.js 側の色調補正と紙の粒で補う前提です。

## 既知の課題

試作 2 の作り直しで増えたもの:

- 船台は 27 m になり、船台の点(外海に接する陸セルの中心、`src/observe/area.ts`)から舳先側へ 13.5 m、船尾側へ 13.5 m 伸びます。セルは 10 m なので、舳先の端は水の上、船尾の端は陸の斜面に掛かることがあります。
  必要なら船台の中心を船尾側へずらす(`prototype.ts` の置き方)か、地形の高さで船台の端を確かめます。M22-06 の要件の「平らな 16×5 m」は 27×8 m になります。
- 船台のカメラ(`prototype.ts` の `lookFrom(…, 22, 6, 0.9)`)は 16 m の舟に合わせた距離なので、26 m の舟では近すぎるかもしれません(帆柱の頂 22 m が画から出る)。本体で見て直します。
- 丸太の山(船台の横 6 m)は、船台の縁石(横 3.8 m まで)とは離れていますが、舷側の支柱の足(横 3.35 m)とは 1 m ほどです。
- 飛び立ちの浮かせる高さは 11 m にしました(光の輪が原点の 2.6 m 下、船台の柱石 2.6 m の上に離れて見える)。本体の飛び立ちの画で高さを確かめる必要があります。
- `corner.png`・`settlement.png` は 16 m の旧版の船台のままで、描き直していません。

- ゲーム側の配線(進み 0〜120 で段を切り替える、`launchedYear` で浮上して水平線へ去る、帆を失うと灯りが消える)は未着手です。M22-06 の受け入れ条件のうち、比較画の素材だけを用意しました。
- 帆を失ったときの見た目(鐘の灯りを消す)は、`ship_bell_rim` の発光を 0 にすれば出せます。専用のノードは作っていません。
- 飛び立ちの光の輪は bloom なしの EEVEE では硬い線です。本体での見え方の確認が要ります。
- 帆の風の揺れ・索具の揺れはありません(頂点シェーダで帆の `position` を揺らす想定)。
- 丸太の山の立てかけた板が杭と少し重なっています。丸太は 6 角なので、寄ると角が見えます。
- 羊歯は寄ると角ばりが目立ちます。寄りで使うなら葉のカード(UV とテクスチャ)が要ります。
- UV は引き続き書き出していません(`environment.md` の既知の課題と同じ)。

## 追記(M22-07 光の筋のための樹冠の隙間)

光の筋(`src/observe/render/atmosphere.ts` が日の影の地図を視線に沿ってたどり、日の当たる空気を明るくする)は、樹冠の影に穴がないと生まれません。
鐘樹の成木と森の木の樹冠を、一つにまとまった塊から、枝先に載った離れた房に組み直しました(`key-visuals/herd.png` の、房の間から射す日を目標に)。

- 鐘樹の成木(`observe_belltree.py` の `CLUSTERS`): 下の輪 5 房(幹から 3.05〜3.25 m、高さ 5.95〜6.5 m、半径 1.16〜1.26 m)と、その内側の上に載せた上の輪 3 房(1.45〜1.55 m、8.25〜8.45 m、半径 0.96〜1.0 m)。
  房は大きな塊・外の上へ盛った塊・横(上の輪は上)へ張り出した塊の 3 つで作り、白い枝を 1 本ずつ房の真ん中へ伸ばしました(下の輪は幹の 3.3〜4.2 m から、上の輪は 5.2〜6.4 m から)。
  下の輪の房の間は 0.8〜1.1 m 空き、真上から見ると 5 本の隙間が幹の近くまで抜けます。鐘 30 個は房の下側に吊ったままです(位置は lod0・lod1 で同じ)。
  lod1 は房ごとに塊 1 つ(房の輪郭の重心に 1.14 倍)で、枝も 8 本(4 角)残し、隙間は lod0 とほぼ同じです。
- 森の木(`observe_flora.py` の `FOREST_CLUSTERS`): 下の輪 4 房と、房の間の上に載せた上の房 2 つ。房の間は 0.4〜0.6 m で鐘樹より詰まり、茶色の幹・濃い緑で鐘樹と見分けます。lod1 は房ごとに塊 1 つ(1.08 倍)。
- 材質・ノード名・原点は変えていません。柔らかい法線の基準は樹冠の中心から房の中心に替え、房ごとの丸い量感にしました。

日が抜ける割合(`observe_render.py -- canopy-gaps` の実測。葉の頂点の凸包の影のうち、日の当たる地面の割合。方位 8 つの最小〜最大):

| ノード | 仰角 90°(真下から見上げたのと同じ) | 60° | 45° | 30° |
|---|---:|---:|---:|---:|
| `belltree_mature` | 0.32 | 0.23〜0.31 | 0.22〜0.29 | 0.22〜0.28 |
| `belltree_mature_lod1` | 0.34 | 0.22〜0.30 | 0.20〜0.29 | 0.21〜0.25 |
| `forest_tree` | 0.22 | 0.18〜0.23 | 0.18〜0.21 | 0.16〜0.21 |
| `forest_tree_lod1` | 0.19 | 0.14〜0.19 | 0.14〜0.18 | 0.13〜0.17 |
| (前の `forest_tree`、比較) | 0.07 | 0.04〜0.07 | 0.03〜0.06 | 0.04〜0.07 |

```sh
blender -b --factory-startup --python tools/blender/observe_render.py -- canopy-gaps docs/design/qa/observe/canopy-gaps.png
```

| 画像 | 中身 |
|---|---|
| `canopy-gaps.png` | 成木・成木 lod1・森の木・森の木 lod1 の日の影だけを真上から(正射影、木そのものは描かない)。行は日の仰角 90°・60°・45°・30°(方位 200°) |
| `belltree.png` / `flora2.png` / `corner.png` / `shipyard.png` | 房に分けた樹冠で描き直したもの |

残る課題:

- 引いた場面(`shipyard.png`)では、房に分けた樹冠が傘や刈り込んだ木のように見え、基準画(`sheets/belltree.png`)の詰まった丸い樹冠より疎です。隙間を狭めるなら `CLUSTERS` の半径を上げます(隙間と引き換え)。
- 光の筋が本体で実際に出るか(影の地図の解像度・範囲で房の間の 0.4〜1 m の隙間が潰れないか)は、Three.js の画面で確かめる必要があります。
