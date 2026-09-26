"""地面の植生 (flora) の観察画面用アセット → assets/models/observe/flora.glb

ノード: grass_tuft (草の房、≤40 三角形、GPU インスタンス用) / moongrass_tuft (月草、細く淡い銀緑、≤40) /
moss_clump (胞子苔の塊、≤120、胞子の粒が淡く光る) / rock (苔の乗った石、≤200)。
形は assets/textures/board/sheets/flora.png、画風は creatures/ に寄せる (太めの葉・柔らかい量感)。
草の葉は両面の材質 (doubleSided)。頂点色で根元を暗く、先を明るく暖かくする (風の揺れは Three.js の頂点シェーダで高さに比例させる)。
M22-03 で足したノード: forest_tree (森の広葉樹、鐘樹と見分ける: 濃い緑の丸い樹冠・茶色の幹・鐘なし、≤2,000) /
forest_tree_lod1 (群れ用、≤600) / moongrass_tuft_seed (淡く光る穂のある月草、≤60) / fern (羊歯、≤80) /
flower_patch (淡い小花の群れ、≤80)。

実行: blender -b --factory-startup --python tools/blender/observe_flora.py
"""
import math
import os
import random
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402
from observe_kit import Z  # noqa: E402

K.reset()

M = {
    "grass": K.material("flora_grass", "#86A84C", rough=0.9, double=True),
    "moongrass": K.material("flora_moongrass", "#BCD0B4", rough=0.8, double=True),
    "moss": K.material("flora_moss", "#88A83F", rough=0.95),
    "spore": K.material("flora_spore", "#E9F5A6", rough=0.6, emit="#DDF28A", strength=1.5),
    "rock": K.material("flora_rock", "#9C9A8D", rough=0.95),
    "moonseed": K.material("flora_moonseed", "#DCEBDD", rough=0.6, emit="#C9F6EA", strength=0.8),
    "fern": K.material("flora_fern", "#5F8D3A", rough=0.9, double=True),
    "petal": K.material("flora_petal", "#F1EDE2", rough=0.8, double=True),
    "stem": K.material("flora_stem", "#6F9642", rough=0.9, double=True),
    "forest_leaf": K.material("flora_forest_leaf", "#5A873C", rough=0.9),
    "forest_bark": K.material("flora_forest_bark", "#6E5039", rough=0.9),
    # (木の磨き上げで追加) 森の木の幹と根 (基本色は白、樹皮と苔の色は頂点色が持つ) と、葉のカード (鐘樹と同じ絵)
    "forest_trunk": K.material("flora_forest_trunk", "#FFFFFF", rough=0.9),
    "forest_foliage": K.foliage_material("flora_forest_foliage", K.leaf_card_image()),
}

# (木の磨き上げで追加) 森の木の樹皮・苔・葉のカードの色 (リニア)。鐘樹 (observe_belltree.py) と同じ作りで、葉は濃く青い緑、幹は茶色
FOREST_BARK_LIN = K.hex_rgb("#6E5039")
FOREST_MOSS_LIN = K.hex_rgb("#5E7E34")
FOREST_CARD_LIN = K.hex_rgb("#6F9C45")
FOREST_LUMP_K = 0.86
FOREST_INNER = (0.5, 0.56, 0.7)
# lod ごとの葉のカード: (1 m² あたりの枚数, 一辺 m)
FOREST_CARDS = {0: (2.6, 1.45), 1: (1.4, 2.0)}


def blade_shade(height, lo=0.5, warm=0.12):
    def f(co, n):
        t = min(1.0, max(0.0, co.z / height))
        v = lo + (1 - lo) * t ** 0.8
        return (v, v, max(0.0, v - warm * t))
    return f


def tuft(name, mat, blades, height, width, spread, bend, seed, lo=0.5, warm=0.12):
    n = K.Node(name)
    rnd = random.Random(seed)
    for i in range(blades):
        a = 2 * math.pi * (i + rnd.uniform(-0.25, 0.25)) / blades
        d = Vector((math.cos(a), math.sin(a), 0))
        base = d * rnd.uniform(0.2, 1.0) * spread
        h = height * rnd.uniform(0.7, 1.0)
        n.add(K.blade(base, d, h, width * rnd.uniform(0.85, 1.15), bend * rnd.uniform(0.6, 1.3), segs=2,
                      twist=rnd.uniform(-0.6, 0.6)),
              M[mat], smooth=True, recalc=False, shade=blade_shade(height, lo, warm), soft=((0, 0, -height), 0.5))
    return n


# (草の磨き上げ: 観察画面は src/observe/render/grass.ts の carpetTuft を草の房に使う。この grass_tuft は星形に開き、
#  引きで判を押したように見えたため。flora.glb には残す)
def grass_tuft():
    return tuft("grass_tuft", "grass", blades=8, height=0.45, width=0.1, spread=0.1, bend=0.55, seed=1)


def moongrass_tuft():
    return tuft("moongrass_tuft", "moongrass", blades=8, height=0.72, width=0.05, spread=0.06, bend=0.3, seed=2,
                lo=0.62, warm=0.04)


def moss_clump():
    n = K.Node("moss_clump")
    n.add(K.ico((0.34, 0.3, 0.15), subdiv=1, jitter=0.28, seed=3, flat_bottom=0.9), M["moss"], smooth=True,
          shade=K.shade_height(0.0, 0.12, 0.65, 1.0), soft=((0, 0, -0.3), 0.5))
    rnd = random.Random(4)
    for i in range(4):
        a = 2 * math.pi * i / 4 + rnd.uniform(-0.4, 0.4)
        d = Vector((math.cos(a), math.sin(a), 0))
        base = d * rnd.uniform(0.05, 0.2) + Z * 0.08
        h = rnd.uniform(0.1, 0.16)
        n.add(K.blade(base, d, h, 0.012, 0.3, segs=0), M["moss"], recalc=False, shade=K.shade_const(0.8))
        tip = base + Z * (h * (1 - 0.35 * 0.3)) + d * (0.3 * h)
        n.add(K.lathe([(0.0, 0.022), (0.02, 0.0), (0.0, -0.018)], n=4), M["spore"], matrix=K.trs(tip), smooth=True)
    return n


def rock():
    n = K.Node("rock")
    rnd = random.Random(5)
    moss = lambda c, nrm: M["moss"] if nrm.z > 0.72 and c.z > 0.2 else None  # noqa: E731
    n.add(K.ico((0.55, 0.42, 0.34), subdiv=1, jitter=0.1, seed=6, flat_bottom=0.6), M["rock"],
          matrix=K.trs((0, 0, 0.16), (0, 0, 10)), smooth=False, shade=K.shade_height(0.0, 0.4, 0.7, 1.0),
          per_face_mat=moss)
    n.add(K.ico((0.26, 0.22, 0.17), subdiv=1, jitter=0.18, seed=7, flat_bottom=0.6), M["rock"],
          matrix=K.trs((0.5, -0.2, 0.07), (0, 0, rnd.uniform(0, 360))), smooth=False,
          shade=K.shade_height(0.0, 0.25, 0.7, 0.95))
    return n


# ---------------------------------------------------------------- M22-03 の追加

# (鐘樹の段の作り直しで変更: 前の穂の出た月草。書き出しには使わない (前と後を比べるために残す)。今の穂の出た月草は下の「下草の作り直し」の moongrass_tuft_seed())
def moongrass_tuft_seed_old():
    """穂の出た月草: 葉 5 枚と、先に淡く光る細い穂を付けた茎 3 本"""
    n = tuft("moongrass_tuft_seed", "moongrass", blades=5, height=0.68, width=0.05, spread=0.06, bend=0.3, seed=12,
             lo=0.62, warm=0.04)
    rnd = random.Random(13)
    for i in range(3):
        a = 2 * math.pi * i / 3 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        h = rnd.uniform(0.78, 0.92)
        n.add(K.blade(d * 0.03, d, h, 0.014, 0.12, segs=0), M["moongrass"], recalc=False, shade=K.shade_const(0.85))
        tip = d * 0.03 + Z * (h * (1 - 0.35 * 0.12)) + d * (0.12 * h)
        n.add(K.lathe([(0.0, 0.0), (0.018, 0.04), (0.0, 0.11)], n=4), M["moonseed"],
              matrix=K.trs(tip - Z * 0.02, (0, 12 * math.cos(a), 12 * math.sin(a))), smooth=True)
    return n


def frond(n, base, yaw, length, rise, width, k=8):
    """羊歯の葉 1 枚: 反って垂れる軸の両側に、先へ向いた細い小葉の三角を並べる (片面、材質は両面)。
    小葉は根元で細く、中ほどで広く、先へ細る"""
    import bmesh
    bm = bmesh.new()
    c = []
    for i in range(k + 1):
        u = i / k
        c.append(Vector((length * u, 0, rise * (1.9 * u - 1.6 * u * u))))
    cv = [bm.verts.new(p) for p in c]
    seg = length / k
    for i in range(k):
        u = (i + 0.5) / k
        w = width * min(1.0, u * 3.5) * (1 - u) ** 0.5
        mid = (c[i] + c[i + 1]) / 2 + Vector((seg * 0.9, 0, -0.2 * w))
        for side in (-1, 1):
            tip = bm.verts.new(mid + Vector((0, side * w, 0)))
            f = (cv[i], cv[i + 1], tip) if side > 0 else (cv[i + 1], cv[i], tip)
            bm.faces.new(f)
    m = K.trs(base, (0, 0, yaw))
    n.add(bm, M["fern"], matrix=m, smooth=True, recalc=False,
          shade=lambda co, nrm: (lambda v: (v, v, v * 0.95))(0.6 + 0.4 * min(1.0, co.z / max(0.01, rise * 0.6))),
          soft=((0, 0, -0.4), 0.5))


# (鐘樹の段の作り直しで変更: 前の羊歯。書き出しには使わない (前と後を比べるために残す)。今の羊歯は下の「下草の作り直し」の fern())
def fern_old():
    n = K.Node("fern")
    rnd = random.Random(21)
    for i in range(5):
        yaw = 72 * i + rnd.uniform(-15, 15)
        frond(n, (0, 0, 0.02), yaw, rnd.uniform(0.58, 0.72), rnd.uniform(0.62, 0.78), 0.13)
    return n


# (鐘樹の段の作り直しで変更: 前の小花。書き出しには使わない (前と後を比べるために残す)。今の小花は下の「下草の作り直し」の flower_patch())
def flower_patch_old():
    """淡い小花 5 輪 (白・淡い藤色、中心は黄色) と、地に伏せた葉 4 枚。花は 5 弁の星形で、外へ少し傾けて上を向く"""
    import bmesh
    n = K.Node("flower_patch")
    rnd = random.Random(31)
    for i in range(4):
        a = math.pi / 2 * i + rnd.uniform(-0.4, 0.4)
        d = Vector((math.cos(a), math.sin(a), 0))
        n.add(K.blade(d * 0.02, d, 0.16, 0.07, 1.2, segs=1), M["stem"], recalc=False, shade=K.shade_const(0.8))
    for i in range(5):
        a = 2 * math.pi * i / 5 + rnd.uniform(-0.4, 0.4)
        r = rnd.uniform(0.05, 0.2)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        h = rnd.uniform(0.14, 0.26)
        d = Vector((math.cos(a), math.sin(a), 0))
        n.add(K.blade(base, d, h, 0.012, 0.15, segs=0), M["stem"], recalc=False, shade=K.shade_const(0.85))
        head = base + Z * (h * (1 - 0.35 * 0.15)) + d * (0.15 * h)
        bm = bmesh.new()
        ctr = bm.verts.new((0, 0, 0.006))
        ph = rnd.uniform(0, 1)
        rim = [bm.verts.new(((0.065 if j % 2 == 0 else 0.02) * math.cos(ph + math.pi * j / 5),
                             (0.065 if j % 2 == 0 else 0.02) * math.sin(ph + math.pi * j / 5),
                             0.012 if j % 2 == 0 else 0.0)) for j in range(10)]
        for j in range(10):
            bm.faces.new((ctr, rim[j], rim[(j + 1) % 10]))
        tint = (0.93, 0.9, 1.0) if i % 2 else (1.0, 1.0, 0.97)

        def shade(co, nrm, c=head, t=tint):
            if (co - c).length < 0.012:
                return (1.0, 0.86, 0.42)  # 花の中心
            return t
        tilt = 35
        n.add(bm, M["petal"], matrix=K.trs(head, (0, 0, math.degrees(a))) @ K.trs((0, 0, 0), (0, tilt, 0)),
              smooth=True, recalc=False, shade=shade)
    return n


FOREST_C = Vector((0, 0, 5.1))  # 森の木の樹冠の中心


def forest_tree(lod=0):
    """森の広葉樹: 茶色の幹が 3 本の太枝に分かれ、濃い緑の丸い葉の塊をまとめた樹冠。鐘は無い (鐘樹と見分ける)"""
    # (M22-07 光の筋のために変更: 太枝は房ごとに 6 本、樹冠は離れた房 6 つ。下の FOREST_CLUSTERS を参照)
    name = "forest_tree" if lod == 0 else "forest_tree_lod1"
    n = K.Node(name)
    rnd = random.Random(41)
    # (木の磨き上げで変更: 幹に縦の裂け目を入れるため、面を 7 → 12 (lod1 は 5 → 6) にする)
    sides = 12 if lod == 0 else 6
    spine = [(0, 0, 0), (0.05, 0.02, 1.1), (-0.02, 0.05, 2.2), (0.03, 0.0, 3.0)]
    radii = [0.34, 0.26, 0.21, 0.16]
    if lod:
        spine, radii = [spine[0], spine[2], spine[3]], [radii[0], radii[2], radii[3]]
    # (木の磨き上げで変更: 幹と根は、縦の裂け目・筋・根元の苔を頂点色で持つ forest_trunk の材質にする)
    bark = K.bark_shade(spine, radii, FOREST_BARK_LIN, FOREST_MOSS_LIN, lo=0.6, hi=1.0, z1=2.5, moss_z=(0.05, 0.8), seed=2.1)
    # (鐘樹の段の作り直しで追加) 鐘樹の株・丸太と同じく、樹皮に地衣の淡い斑を足す
    bark = forest_lichen(bark) if lod == 0 else bark
    n.add(K.tube(spine, radii, n=sides, cap_start=False, ridge=K.fissures(sides, depth=(0.07, 0.14), seed=9, rings=len(spine))),
          M["forest_trunk"], smooth=True, shade=bark)
    if lod == 0:
        for i in range(4):
            a = math.radians(30 + 90 * i)
            d = Vector((math.cos(a), math.sin(a), 0))
            # (木の磨き上げで変更: 根の断面を縦長の楕円 (鰭) にする)
            n.add(K.tube([d * 0.15 + Z * 0.6, d * 0.45 + Z * 0.14, d * 0.78 + Z * -0.03], [0.17, 0.1, 0.03], n=4,
                         tip=True, cap_start=False, aspect=(0.7, 1.3)), M["forest_trunk"], smooth=True, shade=bark)
        # (鐘樹の段の作り直しで追加) 根と根の間に苔の小山 3 つ (鐘樹の株と同じ、明るい苔と暗い苔の斑)
        for i in range(3):
            a = math.radians(75 + 90 * i)
            d = Vector((math.cos(a), math.sin(a), 0))
            forest_moss(n, d * 0.42 + Z * 0.0, 0.16 + 0.03 * i, 60 + i)
    # (M22-07 光の筋のために変更: 3 本の太枝の先に大きな塊 8 つを重ねた樹冠をやめ、房 6 つ (FOREST_CLUSTERS) に
    #  1 本ずつ枝を伸ばす。房と房の間 (0.4〜0.6 m) が抜け、日の影の地図で影がまだらになる。lod1 も隙間を残す)
    trunk_top = Vector(spine[-1])
    for k, (c, r, upper, z0) in enumerate(forest_clusters()):
        p0 = Vector((0, 0, min(z0, trunk_top.z)))
        d = Vector((c.x, c.y, 0)).normalized()
        end = c - Z * 0.2 * r
        p1 = p0.lerp(end, 0.4) + d * 0.25 - Z * 0.2
        rad = [0.12, 0.08, 0.04] if upper else [0.15, 0.1, 0.05]
        n.add(K.tube([p0, p1, end], rad, n=5 if lod == 0 else 4, tip=True, cap_start=False), M["forest_bark"],
              smooth=True, shade=K.shade_const(0.8))
    # (木の磨き上げで変更: 塊は FOREST_LUMP_K に縮めて暗い内側にし、表面に葉のカードを散らす。塊は lod0 の真ん中だけ細かさ 1、
    #  他は 0 (カードに三角形を回す)。柔らかい法線は 0.6 → 0.9 (粗い塊の面の角を陰りに出さない))
    card_lumps = []
    for k, (c, r, upper, _) in enumerate(forest_clusters()):
        lumps = forest_lumps(c, r, upper)
        if lod:
            g = sum((lc * lr ** 3 for lc, lr in lumps), Vector()) / sum(lr ** 3 for _, lr in lumps)
            lumps = [(g, r * 1.02)]  # (試作 3 の判断で変更: 1.08 → 1.02。房を大きくしたので、lod1 の隙間が lod0 より詰まりすぎないように)
        for j, (lc, lr) in enumerate(lumps):
            lr *= FOREST_LUMP_K
            base = K.shade_canopy(FOREST_C, 2.2, lo=0.5, hi=1.0, warm=0.12)
            n.add(K.ico((lr, lr, lr * 0.88), subdiv=1 if (j == 0 and not lod) else 0, jitter=0.09, seed=50 + 3 * k + j,
                        flat_bottom=0.25),
                  M["forest_leaf"], matrix=K.trs(lc, (0, 0, rnd.uniform(0, 360))), smooth=True,
                  shade=lambda co, nrm, b=base: tuple(v * q for v, q in zip(b(co, nrm), FOREST_INNER)),
                  soft=(c + Z * 0.15 * r, 0.9))
            card_lumps.append((lc, lr, k))
    clusters = forest_clusters()
    density, size = FOREST_CARDS[lod]
    cards = K.scatter_cards(n, M["forest_foliage"], card_lumps, density, size, seed=90 + lod, color=FOREST_CARD_LIN,
                            shade_of=lambda k: forest_card_shade(clusters[k][0], clusters[k][1]),
                            soft_of=lambda k: (clusters[k][0] + Z * 0.15 * clusters[k][1], 1.0), rz=0.88, flat_bottom=0.25,
                            gap_clear=0.25)
    print(f"  {name}: cards={cards}")
    return n


def forest_lichen(shade, seed=4):
    """(鐘樹の段の作り直しで追加) 森の木の樹皮の陰りに、地衣 (淡い灰緑) の斑を足す (高さ 0.6 m より上)"""
    lichen = K.hex_rgb("#A7AE8A")

    def f(co, nrm):
        v = shade(co, nrm)
        if co.z < 0.6:
            return v
        t = K.vnoise(co.x * 7, co.y * 7, co.z * 3.5, seed)
        t = min(1.0, max(0.0, (t - 0.7) / 0.1))
        return K.mix3(v, K.mul3(lichen, 0.55 + 0.45 * sum(v) / 3 / max(1e-3, sum(FOREST_BARK_LIN) / 3)), t * 0.7)
    return f


def forest_moss(n, at, size, seed):
    """(鐘樹の段の作り直しで追加) 根元の苔の小山 (粗い 20 三角形、斑は頂点色)"""
    deep, light = K.hex_rgb("#4E6E2A"), K.hex_rgb("#8FAE45")
    bm = K.ico((size, size * 0.8, size * 0.45), subdiv=0, jitter=0.25, seed=seed, flat_bottom=0.9)
    K.paint(bm, lambda v: K.mix3(deep, light, K.vnoise(v.co.x * 14, v.co.y * 14, v.co.z * 14, seed)))
    n.add(bm, M["forest_trunk"], matrix=K.trs(at), smooth=True, soft=(Vector(at) - Z * size, 0.5))


def forest_card_shade(c, r):
    """(木の磨き上げで追加) 森の木の葉のカードの陰り: 樹冠全体の上下に、房の上ほど明るく暖かく・下ほど暗く (鐘樹の shade_card と同じ)"""
    base = K.shade_canopy(FOREST_C, 2.2, lo=0.6, hi=1.0, warm=0.08)

    def f(co, nrm):
        v = base(co, nrm)
        t = min(1.0, max(0.0, 0.5 + (co.z - c.z) / (r * 1.3)))
        k = 0.6 + 0.55 * t
        return (v[0] * k, v[1] * k, v[2] * k * (1.08 - 0.25 * t))
    return f


# (M22-07 光の筋のために追加) 森の木の房: (方位 度, 幹からの距離, 高さ, 半径, 枝の付け根の高さ)。
# 下の輪 4 房と、下の輪の房の間の上に載せた上の房 2 つ。鐘樹より房が詰まり、隙間は狭い (0.4〜0.6 m)
# (試作 3 の判断で変更: 引くと房が刈り込んだ木 (ぽんぽん) に見えたので、房を大きくして隙間を詰め、光の筋が出る程度の
#  狭い隙間だけ残す。前の値は (20, 1.8, 4.45, 1.0, 2.6), (110, 1.75, 4.7, 0.98, 2.8), (200, 1.85, 4.5, 1.0, 2.7),
#  (290, 1.75, 4.75, 0.96, 2.9), (70, 0.7, 6.35, 1.0, 3.0), (245, 0.75, 6.55, 0.98, 3.0))
FOREST_CLUSTERS = [
    (20, 1.8, 4.5, 1.2, 2.6), (110, 1.75, 4.75, 1.18, 2.8), (200, 1.85, 4.55, 1.2, 2.7), (290, 1.75, 4.8, 1.16, 2.9),
    (70, 0.7, 6.5, 1.2, 3.0), (245, 0.75, 6.7, 1.18, 3.0),
]


def forest_clusters():
    """(中心, 半径, 上の房か, 枝の付け根の高さ)"""
    out = []
    for i, (a, d, z, r, z0) in enumerate(FOREST_CLUSTERS):
        a = math.radians(a)
        out.append((Vector((d * math.cos(a), d * math.sin(a), z)), r, i >= 4, z0))
    return out


def forest_lumps(c, r, upper):
    """房 1 つを塊 3 つで: 真ん中、外の上へ盛った塊、上の房は上へ・下の輪は内の上へ盛った塊 (横へは張り出さず、房の間を空ける)"""
    out = Vector((c.x, c.y, 0)).normalized()
    side = Z.cross(out)
    lumps = [(c, r), (c + out * 0.4 * r + Z * 0.3 * r, 0.68 * r)]
    if upper:
        lumps.append((c + Z * 0.45 * r - out * 0.2 * r + side * 0.2 * r, 0.64 * r))
    else:
        lumps.append((c - out * 0.3 * r + Z * 0.35 * r + side * 0.15 * r, 0.64 * r))
    return lumps


# ---------------------------------------------------------------- 下草の作り直し
# (鐘樹の段の作り直しで追加) 審査台への判断 (t03-flora 保留「鐘樹の段 (芽・若木・成木・株・丸太) におなじ」) を受けて、
# 羊歯・小花・穂の出た月草を作り直す。色は頂点色で持ち (材質の基本色は白、両面)、葉ごとの明暗・付け根の陰・中肋・先の明るさを描く。
# 形は assets/textures/board/sheets/flora.png (月草の細い穂) と key-visuals/herd.png (林床の羊歯) に寄せる

M["under"] = K.material("flora_under", "#FFFFFF", rough=0.9, double=True)
FERN_BASE = K.hex_rgb("#2F5A24")
FERN_MID = K.hex_rgb("#5A9538")
FERN_TIP = K.hex_rgb("#A2CC60")
FERN_RIB = K.hex_rgb("#9CB86A")
STEM_LIN = K.hex_rgb("#5E8638")
ROSETTE = (K.hex_rgb("#3E6A2C"), K.hex_rgb("#6E9A44"), K.hex_rgb("#9FC06E"))
PETALS = [(K.hex_rgb("#F6F2E6"), K.hex_rgb("#FFFDF6")), (K.hex_rgb("#D9CFEA"), K.hex_rgb("#F1ECF8")), (K.hex_rgb("#F3E9C9"), K.hex_rgb("#FFF8E2"))]
FLOWER_EYE = K.hex_rgb("#E8B83C")
MOON_BASE = K.hex_rgb("#6F8A66")
MOON_TIP = K.hex_rgb("#D6E4CE")


def face_up(bm):
    """(鐘樹の段の作り直しで追加) 片面の板 (小葉・花弁) の面の向きを上 (+Z) に揃える。観察画面の両面の材質は裏の面の法線を裏返すので、
    裏向きの板は下向きの法線になって縁の光が一面に掛かり、小葉が白茶けて見えた"""
    import bmesh
    down = [f for f in bm.faces if (f.normal_update() or f.normal.z) < 0]
    if down:
        bmesh.ops.reverse_faces(bm, faces=down)
    return bm


# (下草の見直しで追加) 審査台 t2-flora のメモ (2026-09-24「しだ、花の葉部分はもう少し高くても良いのでは」) を受けて高くする
FERN_RISE = (1.05, 1.35)      # 羊歯の葉の立ち上がり (葉の先の高さは約 0.56 倍、0.6〜0.75 m)
FLOWER_LEAF_UP = 1.3          # 小花の葉の向きの縦の成分 (横 1 に対して)
FLOWER_LEAF_L = (0.3, 0.38)   # 小花の葉の長さ (m)
FLOWER_STEM = (0.3, 0.46)     # 小花の茎の高さ (m)
# (下草の 4 回目で追加) 審査台 t3-flora (2026-09-25「小花の根元の茎と草の位置がずれているのはなぜ？」) を受けて、茎を葉のロゼットの中心から出す
FLOWER_STEM_FOOT = (0.01, 0.016, 0.022)  # 茎の付け根の中心からの距離 (m、茎ごとに順に)。葉の付け根 (中心) の間に収まる
FLOWER_STEM_BOW = 0.15        # 茎の中ほどを付け根と花を結ぶ線から内へ寄せる割合 (水平の開きに対して)


def fern_frond(n, yaw, length, rise, width, k, seed, droop=1.6, rachis=True, every=1, coarse=False):
    """羊歯の葉 1 枚: 付け根から反って垂れる軸 (細い管) の両側に、先へ向いた小葉 (菱形、2 三角形) を k 対。
    小葉は中ほどが長く、付け根と先で短い。付け根は暗く先ほど明るく、小葉ごとに明暗を揺らし、軸と小葉の付け根が明るい"""
    rnd = random.Random(seed)
    m = K.trs((0, 0, 0.02), (0, 0, yaw))
    pts = [Vector((length * u, 0, rise * (1.9 * u - droop * u * u))) for u in [i / k for i in range(k + 1)]]
    rach = pts[::2] if k % 2 == 0 else pts[::2] + [pts[-1]]
    # (遠距離版の追加で追加) coarse なら軸を付け根・中ほど・先の 3 点で描く (遠距離版)
    if coarse:
        rach = [pts[0], pts[k // 2], pts[-1]]
    if rachis:
            n.add(K.tube(rach, [0.006 * (1 - j / (len(rach) - 1)) + 0.0015 for j in range(len(rach) - 1)] + [0.0],
                     n=3, tip=True, cap_start=False), M["under"], matrix=m, smooth=True, soft=((0, 0, -3.0), 0.9),
              shade=lambda co, nrm: K.mix3(FERN_BASE, FERN_RIB, 0.5 + 0.5 * min(1.0, co.z / max(0.01, rise))))
    import bmesh
    for i in range(1, k):
        # (遠距離版の追加で追加) every > 1 なら小葉を every 対に 1 対だけ描く (遠距離版の小葉を近い形と同じ位置に置く)
        if i % every:
            continue
        u = i / k
        a, b = pts[i], pts[min(k, i + 1)]
        ax = (b - a).normalized()
        L = width * min(1.0, u * 3.2) * (1 - u) ** 0.45 * rnd.uniform(0.9, 1.08)
        if L < 0.015:
            continue
        for side in (-1, 1):
            out = Vector((0, side, 0))  # 軸の横 (葉の座標の y)
            dirp = (out * 0.85 + ax * 0.5).normalized()
            dirp.z -= 0.2
            base = a + ax * 0.004
            tipp = base + dirp * L
            w = L * 0.42
            mid = base.lerp(tipp, 0.45)
            p1 = mid + (ax * w)
            p2 = mid - (ax * w)
            bm = bmesh.new()
            lay = bm.verts.layers.float_color.new("Col")
            vb, v1, vt, v2 = (bm.verts.new(p) for p in (base, p1, tipp, p2))
            jit = rnd.uniform(0.85, 1.12)
            c_base = K.mul3(K.mix3(FERN_BASE, FERN_MID, u), jit)
            c_tip = K.mul3(K.mix3(FERN_MID, FERN_TIP, u), jit)
            vb[lay] = (*K.mix3(c_base, FERN_RIB, 0.35), 1)
            vt[lay] = (*c_tip, 1)
            v1[lay] = (*K.mul3(K.mix3(c_base, c_tip, 0.5), 1.05), 1)
            v2[lay] = (*K.mul3(K.mix3(c_base, c_tip, 0.5), 0.85), 1)
            bm.faces.new((vb, v1, vt))
            bm.faces.new((vb, vt, v2))
            # 法線はほぼ上向きに寄せる (草と同じ。房の外向きのままだと、見下ろす画で小葉の縁が縁の光で白く浮いた)
            n.add(face_up(bm), M["under"], matrix=m, smooth=True, recalc=False, soft=((0, 0, -3.0), 0.85))


def fern():
    """(鐘樹の段の作り直しで変更: 葉 5 枚の三角の羊歯を、軸と菱形の小葉の葉 6 枚 (付け根が暗く先が明るい) と、
    真ん中で巻いた若い芽 (ぜんまい) 1 本に作り直す。前の形は fern_old)"""
    n = K.Node("fern")
    rnd = random.Random(21)
    for i in range(6):
        yaw = 60 * i + rnd.uniform(-14, 14)
        # (下草の見直しで変更: 葉の立ち上がり 0.45〜0.66 → FERN_RISE。草の房 (丈の平均 0.47 m) の上へ葉が出る)
        fern_frond(n, yaw, rnd.uniform(0.55, 0.74), rnd.uniform(*FERN_RISE), 0.21, 10, seed=22 + i, droop=rnd.uniform(1.5, 1.8))
    # 巻いた若い芽: 立ち上がる茎の先を渦に巻く
    pts = [Vector((0.02, 0.01, 0.0)), Vector((0.03, 0.0, 0.18)), Vector((0.05, 0.0, 0.3))]
    cx, cz = 0.08, 0.3
    # (下草の見直しで変更: 葉を高くしたので、巻いた芽も 0.5 m まで伸ばす)
    pts = [Vector((0.02, 0.01, 0.0)), Vector((0.03, 0.0, 0.3)), Vector((0.05, 0.0, 0.5))]
    cx, cz = 0.08, 0.5
    for j in range(1, 6):
        t = j / 5 * 1.6 * math.pi
        rr = 0.04 * (1 - j / 7)
        pts.append(Vector((cx - math.cos(t) * rr, 0.0, cz + math.sin(t) * rr)))
    n.add(K.tube(pts, [0.012] * 3 + [0.011, 0.01, 0.009, 0.008, 0.0], n=3, tip=True, cap_start=False), M["under"], smooth=True,
          soft=((0, 0, -3.0), 0.9),
          shade=lambda co, nrm: K.mix3(FERN_MID, K.hex_rgb("#A6C66E"), min(1.0, co.z / 0.5)))
    return n


def fern_lod1():
    """(鐘樹の段の作り直しで追加) 羊歯の遠距離版 fern_lod1 (観察画面は 22 m より先で使う): 同じ向きと大きさの葉 6 枚を、
    軸と若い芽なしの小葉 5 対で描く (羊歯は林床に数百株あり、近い形 417 三角形のままだと林の画で 23 万三角形になった)"""
    n = K.Node("fern_lod1")
    rnd = random.Random(21)
    for i in range(6):
        yaw = 60 * i + rnd.uniform(-14, 14)
        # (遠距離版の追加で変更: 小葉 5 対 (k=6) では近い形と小葉の位置がずれ、切り替わりで跳ぶ。近い形と同じ k=10 の小葉を 1 対おきに描き、
        #  軸も 3 点の粗い管で描く (軸が無いと、切り替わりで株の真ん中の立ち上がる軸の束が消えて見えた))
        fern_frond(n, yaw, rnd.uniform(0.55, 0.74), rnd.uniform(*FERN_RISE), 0.26, 10, seed=22 + i, droop=rnd.uniform(1.5, 1.8),
                   rachis=True, every=2, coarse=True)
    return n


def flower_patch():
    """(鐘樹の段の作り直しで変更: 伏せた葉 4 枚と星形の花 5 輪を、中肋で折った葉のロゼット 5 枚と、細い茎の先の 5 弁の花 5 輪
    (弁ごとに付け根が淡く陰り先が明るい、黄色い花芯) とつぼみ 2 つに作り直す。前の形は flower_patch_old)"""
    import bmesh
    n = K.Node("flower_patch")
    rnd = random.Random(31)
    for i in range(5):
        a = 2 * math.pi * i / 5 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0.18))
        # (下草の見直しで変更: 地に伏せた葉を、斜めに立ち上がって先が外へ撓む長い葉にする (先の高さ 0.25〜0.33 m)。草の房の間から葉が見える)
        d = Vector((math.cos(a), math.sin(a), FLOWER_LEAF_UP))
        m = K.aim(d)
        m.translation = Vector((0, 0, 0.01))
        L = rnd.uniform(0.14, 0.19)
        L = rnd.uniform(*FLOWER_LEAF_L)
        cols = tuple(K.mul3(c, rnd.uniform(0.9, 1.08)) for c in ROSETTE)
        n.add(K.leaf_folded(L, L * 0.34, k=3, fold=0.25, bend=0.42, thick=0.004, base_col=cols[0], tip_col=cols[1], rib_col=cols[2]),
              M["under"], matrix=m, smooth=True, soft=((0, 0, -3.0), 0.85))
    heads = []
    for i in range(7):
        a = 2 * math.pi * i / 7 + rnd.uniform(-0.35, 0.35)
        r = rnd.uniform(0.04, 0.2)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        # (下草の 4 回目で変更: 茎を葉のロゼットの中心 (葉の付け根の間、中心から 1〜2 cm) から出す。前は中心から r (4〜20 cm) 離れた輪に植えたので、
        #  葉を立ち上げた後は茎が葉の外の地面から生えて見えた (審査台 t3-flora「小花の根元の茎と草の位置がずれているのはなぜ？」))
        base = Vector((math.cos(a), math.sin(a), 0)) * FLOWER_STEM_FOOT[i % 3] + Z * 0.006
        h = rnd.uniform(0.11, 0.21)
        h = rnd.uniform(*FLOWER_STEM)  # (下草の見直しで変更: 花が高くした葉の上に出る)
        lean = Vector((math.cos(a), math.sin(a), 0)) * h * rnd.uniform(0.1, 0.25)
        top = base + Z * h + lean
        # (下草の 4 回目で変更: 花は前と同じ所 (中心から r + 傾き) に咲かせ、上から見た花の輪の大きさを保つ。茎は中心から外へ傾いて花を広げる)
        top = Vector((math.cos(a) * r, math.sin(a) * r, 0)) + Z * h + lean
        mid = base.lerp(top, 0.5) + lean * 0.3
        # (下草の 4 回目で変更: 茎の中ほどを付け根の真上寄りに置き、根元は葉の間を立ち上がってから外へ撓む (前のように外へ膨らませると、付け根を中心へ寄せた茎は根元の区間が仰角 40° ほどまで寝て、立ち上がる葉 (仰角 52°) より低く這う))
        mid = base.lerp(top, 0.5) - (top - base).to_2d().to_3d() * FLOWER_STEM_BOW
        n.add(K.tube([base, mid, top], [0.0035, 0.003, 0.0025], n=3, cap_start=False), M["under"], smooth=True, soft=((0, 0, -3.0), 0.9),
              shade=lambda co, nrm: K.mul3(STEM_LIN, 0.7 + 0.3 * min(1.0, co.z / 0.4)))
        heads.append((top, a, i))
    for top, a, i in heads:
        if i >= 5:  # つぼみ
            n.add(K.lathe([(0.0, 0.0), (0.012, 0.012), (0.0, 0.03)], n=4), M["under"], matrix=K.trs(top), smooth=True,
                  shade=lambda co, nrm: K.hex_rgb("#C9D6A0"))
            continue
        pc = PETALS[i % len(PETALS)]
        ph = rnd.uniform(0, 2 * math.pi)
        tilt = K.trs(top, (0, 0, math.degrees(a))) @ K.trs((0, 0, 0), (0, rnd.uniform(20, 40), 0))
        for j in range(5):
            t = ph + 2 * math.pi * j / 5
            dv = Vector((math.cos(t), math.sin(t), 0))
            sv = Vector((-math.sin(t), math.cos(t), 0))
            L = rnd.uniform(0.068, 0.084)
            bm = bmesh.new()
            lay = bm.verts.layers.float_color.new("Col")
            v0 = bm.verts.new(dv * 0.006 + Z * 0.004)
            v1 = bm.verts.new(dv * L * 0.6 + sv * L * 0.36 + Z * 0.012)
            v2 = bm.verts.new(dv * L + Z * 0.008)
            v3 = bm.verts.new(dv * L * 0.6 - sv * L * 0.36 + Z * 0.012)
            v0[lay] = (*K.mul3(pc[0], 0.8), 1)
            for v in (v1, v3):
                v[lay] = (*pc[0], 1)
            v2[lay] = (*pc[1], 1)
            bm.faces.new((v0, v1, v2))
            bm.faces.new((v0, v2, v3))
            n.add(face_up(bm), M["under"], matrix=tilt, smooth=True, recalc=False)
        n.add(K.lathe([(0.0, 0.004), (0.016, 0.012), (0.0, 0.024)], n=5), M["under"], matrix=tilt, smooth=True,
              shade=lambda co, nrm: FLOWER_EYE)
    return n


def moongrass_tuft_seed():
    """(鐘樹の段の作り直しで変更: 葉 5 枚と光る紡錘 3 つを、根元が暗く先が淡い銀緑の葉 7 枚 (葉ごとに明暗を揺らす) と、
    細い茎に互い違いの小穂 (淡く光る菱形 5 つ) を付けた穂 3 本に作り直す。基準画 sheets/flora.png の月草の穂。前の形は moongrass_tuft_seed_old)"""
    import bmesh
    n = K.Node("moongrass_tuft_seed")
    rnd = random.Random(12)
    height = 0.66
    for i in range(7):
        a = 2 * math.pi * (i + rnd.uniform(-0.25, 0.25)) / 7
        d = Vector((math.cos(a), math.sin(a), 0))
        h = height * rnd.uniform(0.7, 1.0)
        jit = rnd.uniform(0.85, 1.1)
        n.add(K.blade(d * rnd.uniform(0.01, 0.05), d, h, 0.045 * rnd.uniform(0.85, 1.15), 0.3 * rnd.uniform(0.6, 1.3), segs=2,
                      twist=rnd.uniform(-0.6, 0.6)),
              M["under"], smooth=True, recalc=False, soft=((0, 0, -height), 0.5),
              shade=lambda co, nrm, jit=jit, h=h: K.mul3(K.mix3(MOON_BASE, MOON_TIP, min(1.0, max(0.0, co.z / h)) ** 0.8), jit))
    for i in range(3):
        a = 2 * math.pi * i / 3 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        h = rnd.uniform(0.74, 0.9)
        base = d * 0.02
        top = base + Z * h + d * h * 0.12
        mid = base.lerp(top, 0.55) + d * 0.02
        n.add(K.tube([base, mid, top], [0.005, 0.004, 0.003], n=3, cap_start=False), M["under"], smooth=True, soft=((0, 0, -3.0), 0.9),
              shade=lambda co, nrm: K.mix3(MOON_BASE, MOON_TIP, min(1.0, co.z / 0.8)))
        ax = (top - mid).normalized()
        side = ax.cross(Z).normalized() if abs(ax.z) < 0.99 else Vector((1, 0, 0))
        for j in range(5):
            t = 0.62 + 0.38 * j / 4
            p = mid.lerp(top, (t - 0.55) / 0.45) if t > 0.55 else mid
            s = side * (1 if j % 2 else -1)
            L = 0.06 * (1 - 0.35 * j / 4)
            dv = (ax * 0.75 + s * 0.4).normalized()
            q = Z.rotation_difference(dv).to_matrix().to_4x4()
            q.translation = p
            # 小穂は閉じた 3 角の紡錘 (材質は片面なので、裏の見えない板にしない)
            n.add(K.lathe([(0.0, 0.0), (0.011, L * 0.45), (0.0, L)], n=3, phase=j * 0.7), M["moonseed"], matrix=q, smooth=True)
    return n


# ---------------------------------------------------------------- 遠距離版 (小花・穂の出た月草)
# (遠距離版の追加で追加) 小花 (307 三角形) と穂の出た月草 (164 三角形) は林床と草地に 600 株ずつまで置くので、25 m より先は遠距離版で描く。
# 近い形の 1〜2 割の三角形で、同じ色 (頂点色)・同じ高さ・同じ花の数を残す

def flower_patch_lod1():
    """小花の遠距離版 flower_patch_lod1: 立ち上がる葉 3 枚 (粗い葉)、茎 5 本 (細い三角 1 枚)、花 5 輪 (5 角の平たい花、芯は色だけ)"""
    import bmesh
    n = K.Node("flower_patch_lod1")
    rnd = random.Random(31)
    for i in range(3):
        a = 2 * math.pi * i / 3 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), FLOWER_LEAF_UP))
        m = K.aim(d)
        m.translation = Vector((0, 0, 0.01))
        L = rnd.uniform(*FLOWER_LEAF_L)
        n.add(K.leaf_folded(L, L * 0.4, k=1, fold=0.25, bend=0.42, thick=0.004, base_col=ROSETTE[0], tip_col=ROSETTE[1], rib_col=ROSETTE[2]),
              M["under"], matrix=m, smooth=True, soft=((0, 0, -3.0), 0.85))
    for i in range(5):
        a = 2 * math.pi * i / 5 + rnd.uniform(-0.35, 0.35)
        r = rnd.uniform(0.04, 0.2)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        # (下草の 4 回目で変更: 近い形と同じく、茎を葉の付け根の間から出し、花は前と同じ所に咲かせる)
        base = Vector((math.cos(a), math.sin(a), 0)) * FLOWER_STEM_FOOT[i % 3] + Z * 0.006
        h = rnd.uniform(*FLOWER_STEM)
        top = base + Z * h + Vector((math.cos(a), math.sin(a), 0)) * h * 0.15
        top = Vector((math.cos(a) * r, math.sin(a) * r, 0)) + Z * h + Vector((math.cos(a), math.sin(a), 0)) * h * 0.15
        side = Vector((-math.sin(a), math.cos(a), 0)) * 0.006
        bm = bmesh.new()
        bm.faces.new([bm.verts.new(v) for v in (base - side, base + side, top)])
        n.add(bm, M["under"], smooth=True, recalc=False, soft=((0, 0, -3.0), 0.9),
              shade=lambda co, nrm: K.mul3(STEM_LIN, 0.7 + 0.3 * min(1.0, co.z / 0.4)))
        pc = PETALS[i % len(PETALS)]
        bm = bmesh.new()
        lay = bm.verts.layers.float_color.new("Col")
        ctr = bm.verts.new((0, 0, 0.006))
        # 花の芯の黄は近い形でも小さく、遠目には花弁の色が勝つ。芯を黄にすると花が黄色い点に見えて切り替わりで色が跳ぶので、芯は花弁の色を少し暖かく
        ctr[lay] = (*K.mix3(pc[0], FLOWER_EYE, 0.2), 1)
        ph = rnd.uniform(0, 2 * math.pi)
        rim = []
        for j in range(5):
            t = ph + 2 * math.pi * j / 5
            v = bm.verts.new((0.055 * math.cos(t), 0.055 * math.sin(t), 0.01))
            v[lay] = (*pc[1], 1)
            rim.append(v)
        for j in range(5):
            bm.faces.new((ctr, rim[j], rim[(j + 1) % 5]))
        tilt = K.trs(top, (0, 0, math.degrees(a))) @ K.trs((0, 0, 0), (0, 30, 0))
        n.add(face_up(bm), M["under"], matrix=tilt, smooth=True, recalc=False)
    return n


def fern_lod2():
    """(遠距離版の追加で追加) 羊歯のさらに遠い版 fern_lod2 (観察画面は 45 m より先で使う): 同じ向き・長さ・高さの葉 6 枚を、
    付け根から葉の先へ伸びる細い菱形 1 つ (2 三角形) ずつで描く。林の画で遠距離版 fern_lod1 (120 三角形) が 555 株見え、6.7 万三角形あった"""
    import bmesh
    n = K.Node("fern_lod2")
    rnd = random.Random(21)
    for i in range(6):
        yaw = 60 * i + rnd.uniform(-14, 14)
        length, rise, droop = rnd.uniform(0.55, 0.74), rnd.uniform(*FERN_RISE), rnd.uniform(1.5, 1.8)
        # fern_frond の軸の曲線: 付け根、いちばん高い所 (u = 0.95 / droop)、先
        um = min(0.9, 0.95 / droop)
        peak = Vector((length * um, 0, rise * (1.9 * um - droop * um * um)))
        tipp = Vector((length, 0, rise * (1.9 - droop)))
        # 葉の幅は近い形の小葉の広がりほど (付け根から先へ弓なりの帯にする)
        w = 0.21 * 0.5
        bm = bmesh.new()
        lay = bm.verts.layers.float_color.new("Col")
        vs = [bm.verts.new(v) for v in (Vector((0, 0, 0.02)), peak + Vector((0, -w, -0.03)), tipp, peak + Vector((0, w, -0.03)))]
        for v, c in zip(vs, (FERN_BASE, FERN_MID, FERN_TIP, FERN_MID)):
            v[lay] = (*c, 1)
        # 付け根 → 高い所の幅 → 先の弓なりの帯 (付け根と先を結ぶ弦を面に含めない。含めると遠目に葉の下が塗られた三角のテントに見えた)
        bm.faces.new((vs[0], vs[1], vs[3]))
        bm.faces.new((vs[1], vs[2], vs[3]))
        n.add(face_up(bm), M["under"], matrix=K.trs((0, 0, 0.02), (0, 0, yaw)), smooth=True, recalc=False, soft=((0, 0, -3.0), 0.85))
    return n


def moongrass_tuft_seed_lod1():
    """穂の出た月草の遠距離版 moongrass_tuft_seed_lod1: 葉 5 枚 (葉の段 1 つ)、穂 3 本 (茎は描かず、光る紡錘 1 つずつ)"""
    n = K.Node("moongrass_tuft_seed_lod1")
    rnd = random.Random(12)
    height = 0.66
    for i in range(5):
        a = 2 * math.pi * (i + rnd.uniform(-0.25, 0.25)) / 5
        d = Vector((math.cos(a), math.sin(a), 0))
        h = height * rnd.uniform(0.75, 1.0)
        n.add(K.blade(d * 0.03, d, h, 0.05, 0.3, segs=1, twist=rnd.uniform(-0.6, 0.6)),
              M["under"], smooth=True, recalc=False, soft=((0, 0, -height), 0.5),
              shade=lambda co, nrm, h=h: K.mix3(MOON_BASE, MOON_TIP, min(1.0, max(0.0, co.z / h)) ** 0.8))
    for i in range(3):
        a = 2 * math.pi * i / 3 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        h = rnd.uniform(0.74, 0.9)
        top = d * 0.02 + Z * h + d * h * 0.12
        # 近い形の小穂 5 つが並ぶ穂の長さ (約 0.3 m) の細い紡錘 1 つ
        n.add(K.lathe([(0.0, -0.3), (0.007, -0.14), (0.0, 0.03)], n=3), M["moonseed"], matrix=K.trs(top), smooth=True)
    return n


if __name__ == "__main__":
    nodes = [grass_tuft(), moongrass_tuft(), moss_clump(), rock(),
             forest_tree(0), forest_tree(1), moongrass_tuft_seed(), fern(), flower_patch(),
             fern_lod1()]  # (鐘樹の段の作り直しで追加: 羊歯の遠距離版)
    nodes += [flower_patch_lod1(), moongrass_tuft_seed_lod1()]  # (遠距離版の追加で追加: 小花と穂の出た月草の遠距離版)
    nodes += [fern_lod2()]  # (遠距離版の追加で追加: 羊歯のさらに遠い版)
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "flora.glb"), texcoords=True)
