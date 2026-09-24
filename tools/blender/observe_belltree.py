"""鐘樹 (belltree) の観察画面用アセット → assets/models/observe/belltree.glb

ノード: belltree_seedling (芽、~0.4 m、芽の先が淡く光る) / belltree_sapling (若木、~3 m) /
belltree_mature (成木、~9 m、葉の塊の丸い樹冠・白い幹・光る青銅の鐘 30 個) / belltree_mature_lod1 (群れ用) /
belltree_stump (伐った株) / belltree_logs (丸太 3 本)。
形は assets/textures/board/sheets/belltree.png、画風は creatures/ (丸めた角ばり・柔らかい量感) に寄せる。
予算 (docs/design/2026-09-23-observation-view-design.md §8): 成木 4,000 / 群れ 1,200 三角形。

実行: blender -b --factory-startup --python tools/blender/observe_belltree.py
"""
import math
import os
import random
import sys

import bmesh  # (鐘樹の段の作り直しで追加) 株と丸太の胴・木口の縁を組む
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402
from observe_kit import Z  # noqa: E402

K.reset()

M = {
    "bark": K.material("belltree_bark", "#E6DFD1", rough=0.9),
    "leaf": K.material("belltree_leaf", "#86A044", rough=0.9),
    "bell": K.material("belltree_bell", "#7E5230", rough=0.55, emit=K.BELL_AMBER, strength=0.2),
    "bell_rim": K.material("belltree_bell_rim", "#FFD58F", rough=0.5, emit=K.BELL_AMBER, strength=3.0),
    "glow": K.material("belltree_glow", "#FFE7A8", rough=0.6, emit="#FFD98A", strength=3.0),
    "soil": K.material("belltree_soil", "#7B6043", rough=0.95),
    "moss": K.material("belltree_moss", "#8AA743", rough=0.95),
    "cut": K.material("belltree_cut", "#EFD6A8", rough=0.9),
    "ring": K.material("belltree_cut_ring", "#D2AC7B", rough=0.9),
    # (木の磨き上げで追加) 成木の幹と板根 (基本色は白、樹皮と苔の色は頂点色が持つ) と、葉のカード (絵で葉の縁を出す)
    "trunk": K.material("belltree_trunk", "#FFFFFF", rough=0.9),
    "foliage": K.foliage_material("belltree_foliage", K.leaf_card_image()),
}

# (木の磨き上げで追加) 樹皮・苔・葉のカードの色 (リニア)。塊は内側の陰として暗く寒色に寄せ、カードの葉が明るい外側になる
BARK_LIN = K.hex_rgb("#E6DFD1")
MOSS_LIN = K.hex_rgb("#7F9B3F")
CARD_LIN = K.hex_rgb("#9DB54E")
GAP_CLEAR = 0.35        # 房と房の間の隙間を塞ぐカードを除く距離 (m、scatter_cards の gap_clear)
BELL_OUT = 1.28         # 鐘の付け根を塊の中心から外へ出す倍率 (葉のカードの層の外へ)
LUMP_K = 0.86           # 葉の塊を縮める割合 (カードが外へ出る分、輪郭の大きさを保つ)
INNER = (0.5, 0.56, 0.7)  # 塊 (内側) の陰りに掛ける乗数
# lod ごとの葉のカード: (1 m² あたりの枚数, 一辺 m)
CARDS = {0: (1.9, 1.8), 1: (0.8, 2.6)}

# (M23-04 で追加) 影の代わりの形の樹冠の大きさ (lod1 の塊の半径に掛ける) と葉のカード (1 m² あたりの枚数, 一辺 m)。
# lod1 の塊は房より 1.14 倍大きく、近い木 (lod0) の外側の葉まで自分の影に入れて暗くしたので、影は lod0 の葉の層の内に収める
SHADOW_K = 0.88
SHADOW_CARDS = (0.8, 2.2)

CANOPY_C = Vector((0, 0, 6.9))  # 成木の樹冠の中心 (柔らかい法線の向きの基準)

# (鐘樹の段の作り直しで追加) 鐘を吊る紐、芽・若木の葉、株と丸太の断面、地面の盛りの材質。基本色は白で、色は頂点色が持つ (紐を除く)
M["rope"] = K.material("belltree_rope", "#9A7E58", rough=0.9)
M["leafv"] = K.material("belltree_leafv", "#FFFFFF", rough=0.85)
M["wood"] = K.material("belltree_wood", "#FFFFFF", rough=0.9)
M["ground"] = K.material("belltree_ground", "#FFFFFF", rough=0.95)
# (鐘樹の段の作り直しで追加) 色 (リニア)。土・苔・落ち葉・小石・草、若木と芽の葉、伐った木口 (早材・晩材・髄・辺材)、内樹皮、地衣
SOIL_LIN = K.hex_rgb("#6E5436")
SOIL_DARK_LIN = K.hex_rgb("#4A3824")
MOSS_DEEP_LIN = K.hex_rgb("#56752C")
MOSS_LIGHT_LIN = K.hex_rgb("#9DB84A")
LITTER_LIN = [K.hex_rgb(h) for h in ("#A8844A", "#C2A35E", "#8C6A3A", "#9DAF55", "#B5925A")]
PEBBLE_LIN = K.hex_rgb("#9C9A8D")
GRASS_LIN = K.hex_rgb("#7FA447")
SAPLING_LEAF = (K.hex_rgb("#3C6A2A"), K.hex_rgb("#62923C"), K.hex_rgb("#A2C06C"))
SEEDLING_LEAF = (K.hex_rgb("#6E9E3A"), K.hex_rgb("#B2D060"), K.hex_rgb("#E0EDA6"))
WOOD = dict(light=K.hex_rgb("#EBD3A6"), dark=K.hex_rgb("#C49A66"), pith=K.hex_rgb("#9A7046"), sap=K.hex_rgb("#F5E6C8"))
FIBRE_LIN = K.hex_rgb("#E8D6B2")
INNER_BARK_LIN = K.hex_rgb("#A89478")
LICHEN_LIN = K.hex_rgb("#C9D0AC")


def moss_top(threshold=0.55):
    """上を向いた面は苔、それ以外は土"""
    return lambda c, n: M["moss"] if n.z > threshold else M["soil"]


def mound(node, radius, height, seed, subdiv=1):
    node.add(K.ico((radius, radius, height), subdiv=subdiv, jitter=0.12, seed=seed, flat_bottom=0.95), M["soil"],
             matrix=K.trs((0, 0, 0.0)), smooth=True, shade=K.shade_height(-0.02, height, 0.75, 1.0),
             per_face_mat=moss_top())


# ---------------------------------------------------------------- 芽

# (鐘樹の段の作り直しで変更: 前の芽。書き出しには使わない (前と後を比べるために残す)。今の芽は下の「鐘樹の段の作り直し」の seedling())
def seedling_old():
    n = K.Node("belltree_seedling")
    mound(n, 0.2, 0.06, seed=1)
    stem = [(0, 0, 0.03), (0.012, 0, 0.16), (0, 0.01, 0.33)]
    n.add(K.tube(stem, [0.014, 0.011, 0.008], n=4, cap_start=False), M["bark"], smooth=True)
    for a in (20, 200):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0.55)).normalized()
        m = K.aim(d)
        m.translation = Vector((0, 0, 0.325))  # 葉の付け根を茎の先へ
        n.add(K.leaf(0.13, 0.085, 0.012, bend=0.25), M["leaf"], matrix=m, smooth=True, shade=K.shade_const(0.95),
              soft=((0, 0, 0.3), 0.35))
    n.add(K.ico((0.028, 0.028, 0.034), subdiv=0, seed=2), M["glow"], matrix=K.trs((0, 0.01, 0.345)), smooth=True)
    return n


# ---------------------------------------------------------------- 若木

# (鐘樹の段の作り直しで変更: 前の若木。書き出しには使わない (前と後を比べるために残す)。今の若木は下の「鐘樹の段の作り直し」の sapling())
def sapling_old():
    """細い白い幹に大きな卵形の葉を螺旋に付けた、縦長の若木 (~3 m)"""
    n = K.Node("belltree_sapling")
    mound(n, 0.4, 0.08, seed=3)
    trunk = [(0, 0, 0.0), (0.03, 0, 0.9), (-0.02, 0.02, 1.8), (0.01, 0, 2.6)]
    n.add(K.tube(trunk, [0.085, 0.06, 0.042, 0.02], n=6, cap_start=False), M["bark"], smooth=True,
          shade=K.shade_height(0, 1.0, 0.8, 1.0))
    rnd = random.Random(4)
    crown = Vector((0, 0, 2.0))
    for z0, a, L in ((1.25, 40, 0.5), (1.6, 220, 0.45)):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        p0 = Vector((0, 0, z0))
        n.add(K.tube([p0, p0 + d * L * 0.5 + Z * L * 0.5, p0 + d * L + Z * L * 0.9], [0.028, 0.018, 0.01], n=4, tip=True),
              M["bark"], smooth=True)
    count = 20
    for j in range(count):
        t = j / (count - 1)
        z = 1.1 + 1.55 * t
        a = math.radians(j * 137.5 + rnd.uniform(-10, 10))
        r_at = 0.03 * (1 - t)
        up = 0.55 + 0.75 * t + rnd.uniform(-0.1, 0.1)
        d = Vector((math.cos(a), math.sin(a), up)).normalized()
        m = K.aim(d)
        m.translation = Vector((math.cos(a) * r_at, math.sin(a) * r_at, z))
        L = (0.5 + 0.28 * math.sin(math.pi * (0.25 + 0.75 * t))) * rnd.uniform(0.92, 1.05)
        n.add(K.leaf(L, L * 0.62, 0.04, bend=0.28), M["leaf"], matrix=m, smooth=True,
              shade=K.shade_canopy(crown, 0.9, lo=0.7, hi=1.0, warm=0.1), soft=(crown, 0.35))
    return n


# ---------------------------------------------------------------- 成木 (lod 0 / 1)

# (M22-07 光の筋のために追加) 樹冠を離れた房に分ける: (方位 度, 幹からの距離, 高さ, 半径, 枝の付け根の高さ)。
# 下の輪 5 房と上の輪 3 房。上の輪は下の輪の房の内側の上に載せ、下の輪の房と房の間の隙間 (0.8〜1.1 m) が幹の近くまで抜ける。
# 上の輪の真ん中にも隙間を残す (見上げると空が抜ける)。
# 日の影の地図で影がまだらになり、隙間を通った日が光の筋になる (src/observe/render/atmosphere.ts)
# (試作 3 の判断で変更: 引くと房が刈り込んだ木 (ぽんぽん) に見えたので、房を大きくして隙間を詰め、光の筋が出る程度の
#  狭い隙間だけ残す。前の値は下の輪 (10, 3.2, 6.05, 1.24, 3.3), (82, 3.05, 6.5, 1.16, 3.9), (150, 3.25, 5.95, 1.26, 3.5),
#  (222, 3.05, 6.4, 1.18, 4.2), (292, 3.2, 6.15, 1.22, 3.7)、上の輪 (14, 1.5, 8.3, 0.98, 5.2), (150, 1.45, 8.45, 1.0, 5.8),
#  (290, 1.55, 8.25, 0.96, 6.4))
CLUSTERS = [
    (10, 3.3, 6.25, 1.7, 3.3), (82, 3.15, 6.65, 1.6, 3.9), (150, 3.35, 6.15, 1.72, 3.5),
    (222, 3.15, 6.55, 1.62, 4.2), (292, 3.3, 6.35, 1.67, 3.7),
    (14, 1.4, 8.55, 1.42, 5.2), (150, 1.35, 8.7, 1.45, 5.8), (290, 1.45, 8.5, 1.4, 6.4),
]


def cluster_centers():
    """(中心, 半径, 上の輪か, 枝の付け根の高さ)"""
    out = []
    for i, (a, d, z, r, z0) in enumerate(CLUSTERS):
        a = math.radians(a)
        out.append((Vector((d * math.cos(a), d * math.sin(a), z)), r, i >= 5, z0))
    return out


def cluster_lumps(c, r, upper, k):
    """房 1 つを盛り上がった塊 3 つで作る: 真ん中の大きな塊、外の上へ盛った塊、横へ張り出した塊 (向きは房ごとに交互)。
    上の輪の房は横へ張り出す代わりに上へ盛る (上から見て房どうしの間を空ける)"""
    out = Vector((c.x, c.y, 0)).normalized()
    side = Z.cross(out) * (1 if k % 2 else -1)
    lumps = [(c, r)]
    if upper:
        lumps.append((c + out * 0.35 * r + Z * 0.3 * r, 0.68 * r))
        lumps.append((c + Z * 0.45 * r - out * 0.2 * r + side * 0.2 * r, 0.62 * r))
    else:
        lumps.append((c + out * 0.45 * r + Z * 0.3 * r, 0.68 * r))
        lumps.append((c + side * 0.55 * r + Z * 0.12 * r - out * 0.1 * r, 0.66 * r))
    return lumps


def canopy_clumps(lod):
    """(中心, 半径, 細かさ)。lod1 も同じ塊を粗く持つ (輪郭と鐘の位置を lod0 と揃える)"""
    # (M22-07 光の筋のために変更: 一つにまとまった樹冠の塊 11 個をやめ、離れた房 8 つ (CLUSTERS) の塊を返す。
    #  lod0 は房ごとに塊 3 つ (細かさ 1)、lod1 は房ごとに塊 1 つ (房の輪郭の重心に、少し大きく。下の輪は細かさ 1、上の輪は 0)。
    #  隙間は lod1 でも残す (45 m より先でも影を落とすため))
    # (木の磨き上げで変更: 塊は葉のカードの奥の暗い内側になり、輪郭はカードが作るので、塊を粗くして三角形をカードに回す。
    #  lod0 は房の真ん中の塊だけ細かさ 1、盛った塊 2 つは 0。lod1 は全部 0)
    cl = []
    for k, (c, r, upper, _) in enumerate(cluster_centers()):
        lumps = cluster_lumps(c, r, upper, k)
        if lod == 0:
            cl += [(lc, lr, 1 if j == 0 else 0) for j, (lc, lr) in enumerate(lumps)]
        else:
            g = sum((lc * lr ** 3 for lc, lr in lumps), Vector()) / sum(lr ** 3 for _, lr in lumps)
            cl.append((g, r * 1.14, 0))
    return cl


def trunk_at(spine, z):
    """(M22-07 で追加) 幹の芯の折れ線の高さ z での点 (枝の付け根)"""
    for a, b in zip(spine, spine[1:]):
        if a.z <= z <= b.z:
            return a.lerp(b, (z - a.z) / max(1e-6, b.z - a.z))
    return spine[-1].copy()


def shade_cluster(c, r):
    """(M22-07 で追加) 房の陰り: 樹冠全体の上下の陰り (shade_canopy) に、房の下側を 0.78 まで暗くする乗数を掛ける"""
    base = K.shade_canopy(CANOPY_C, 2.6, lo=0.55, hi=1.0, warm=0.2)

    def f(co, nrm):
        v = base(co, nrm)
        t = min(1.0, max(0.0, 0.5 + (co.z - c.z) / (r * 1.2)))
        k = 0.78 + 0.22 * t
        return (v[0] * k, v[1] * k, v[2] * k)
    return f


def shade_card(c, r):
    """(木の磨き上げで追加) 葉のカードの陰り: 房の上ほど明るく暖かく (1.18 倍、青を抜く)、下ほど暗く寒色に (0.6 倍)。
    基準画の樹冠は、日の当たる房の上の葉が明るい黄緑で、房の下と奥が暗い"""
    base = K.shade_canopy(CANOPY_C, 2.6, lo=0.62, hi=1.0, warm=0.1)

    def f(co, nrm):
        v = base(co, nrm)
        t = min(1.0, max(0.0, 0.5 + (co.z - c.z) / (r * 1.3)))
        k = 0.6 + 0.58 * t
        return (v[0] * k, v[1] * k, v[2] * k * (1.08 - 0.25 * t))
    return f


def shade_inner(c, r):
    """(木の磨き上げで追加) 葉の塊 (カードの奥の内側) の陰り: 房の陰りを INNER で暗く寒色に寄せる"""
    base = shade_cluster(c, r)
    return lambda co, nrm: tuple(v * k for v, k in zip(base(co, nrm), INNER))


def inside_other(p, clumps, skip):
    for i, (c, r, _) in enumerate(clumps):
        if i == skip:
            continue
        d = p - c
        if (d.x / r) ** 2 + (d.y / r) ** 2 + (d.z / (r * 0.82)) ** 2 < 0.9:
            return True
    return False


def bell_points(clumps, count, seed):
    rnd = random.Random(seed)
    pts = []
    tries = 0
    while len(pts) < count and tries < 5000:
        tries += 1
        i = rnd.randrange(len(clumps))
        c, r, _ = clumps[i]
        a = rnd.uniform(0, 2 * math.pi)
        dz = rnd.uniform(-0.85, 0.25)
        h = math.sqrt(1 - dz * dz)
        d = Vector((h * math.cos(a), h * math.sin(a), dz))
        p = c + Vector((d.x * r, d.y * r, d.z * r * 0.82)) * 0.93
        if p.z < 4.7 or inside_other(p, clumps, i):
            continue
        if any((p - q).length < 0.75 for q in pts):
            continue
        pts.append(p)
    return pts


def bell_out(p, clumps):
    """(木の磨き上げで追加) 鐘の付け根 p を、p に最も近い (半径で割った距離の) 塊の中心から BELL_OUT 倍に出す"""
    c, r, _ = min(clumps, key=lambda cl: (p - cl[0]).length / cl[1])
    return c + (p - c) * BELL_OUT


def bell(node, p, lod, seed):
    rnd = random.Random(seed)
    stem = 0.14 + rnd.uniform(0, 0.12)
    top = p - Z * stem
    if lod == 0:
        node.add(K.tube([p, top], [0.018, 0.015], n=3, cap_start=False, cap_end=False), M["bark"])
        prof = [(0.0, 0.0), (0.12, -0.04), (0.14, -0.24), (0.2, -0.4), (0.3, -0.5), (0.0, -0.38)]  # 丸い肩と開いた裾
        node.add(K.lathe(prof, n=6, phase=rnd.uniform(0, 1)), M["bell"], matrix=K.trs(top), smooth=True,
                 per_face_mat=bell_rim(top))
    else:
        prof = [(0.0, 0.0), (0.24, -0.42), (0.3, -0.5), (0.0, -0.38)]  # 群れ用: 四角の鐘、裾の帯と口が光る
        node.add(K.lathe(prof, n=4), M["bell"], matrix=K.trs(top), smooth=True, per_face_mat=bell_rim(top))


def bell_rim(top):
    """裾の開いた帯と内側 (z が肩から 0.4 より下) を明るい縁の材質に。引いても鐘の形が読める"""
    return lambda c, nrm: M["bell_rim"] if c.z - top.z < -0.4 else None


def mature(lod=0):
    name = "belltree_mature" if lod == 0 else "belltree_mature_lod1"
    n = K.Node(name)
    # (木の磨き上げで変更: 幹に縦の裂け目を入れるため、面を 8 → 14 (lod1 は 6 → 8) にする。偶数の頂点を凹ませる)
    sides = 14 if lod == 0 else 8
    spine = [(0, 0, 0), (0.06, 0.02, 0.6), (0.12, 0.06, 1.7), (0.05, 0.12, 3.0), (-0.02, 0.06, 4.3), (0.0, 0.0, 5.6), (0.05, -0.05, 6.8)]
    radii = [0.8, 0.6, 0.5, 0.46, 0.4, 0.3, 0.18]
    if lod:
        spine, radii = spine[::2], radii[::2]
    # (木の磨き上げで変更: 幹と根は樹皮の縦の筋・裂け目・根元の苔を頂点色で持つ trunk の材質にする。
    #  基準画の幹は淡い樹皮に縦の筋が走り、板根が広がって根元に苔が付く)
    bark_shade = K.bark_shade(spine, radii, BARK_LIN, MOSS_LIN, lo=0.66, hi=1.0, z1=2.4, moss_z=(0.2, 1.5), seed=1.3)
    n.add(K.tube(spine, radii, n=sides, cap_start=False, ridge=K.fissures(sides, seed=5, flare=(2, 1.12), rings=len(spine))),
          M["trunk"], smooth=True, shade=bark_shade)
    # (木の磨き上げで変更: 板根を 6 本 (lod1 は 4 本) にし、断面を縦長の楕円 (鰭) にして根元で幹に広く付ける)
    roots = 6 if lod == 0 else 4
    for i in range(roots):
        a = math.radians(20 + 360 * i / roots)
        d = Vector((math.cos(a), math.sin(a), 0))
        L = 1.0 + 0.18 * math.sin(i * 2.3)
        pts = [d * 0.22 + Z * 1.55, d * 0.62 + Z * 0.62, d * 1.15 * L + Z * 0.14, d * 1.7 * L + Z * (-0.05)]
        n.add(K.tube(pts, [0.34, 0.3, 0.15, 0.04], n=6 if lod == 0 else 4, tip=True, cap_start=False,
                     aspect=(0.62, 1.35)), M["trunk"], smooth=True, shade=bark_shade)
    clumps = canopy_clumps(lod)
    # (M22-07 光の筋のために変更: 太枝 5 本 (lod1 は 3 本) を下の輪の塊へ伸ばす形をやめ、房 8 つのそれぞれへ枝を 1 本ずつ伸ばす。
    #  下の輪の枝は幹の 3.3〜4.2 m から外へ垂れてから上がり、上の輪の枝は幹の上 (5.2〜6.4 m) から立ち上がる。
    #  枝の先は房の真ん中に入り、房の間と下から枝が見える。lod1 も同じ 8 本 (細い 4 角))
    spine_v = [Vector(p) for p in spine]
    for k, (c, r, upper, z0) in enumerate(cluster_centers()):
        p0 = trunk_at(spine_v, z0)
        d = Vector((c.x - p0.x, c.y - p0.y, 0)).normalized()
        end = c - Z * 0.2 * r
        sag = 0.25 if upper else 0.45
        p1 = p0.lerp(end, 0.33) + d * sag * 0.8 - Z * sag * 0.6
        p2 = p0.lerp(end, 0.68) + d * sag * 0.4 - Z * sag * 0.2
        rad = [0.2, 0.14, 0.09, 0.05] if upper else [0.26, 0.18, 0.11, 0.06]
        pts, rr = [p0, p1, p2, end], rad
        if lod:
            pts, rr = [p0, p1.lerp(p2, 0.5), end], [rad[0], rad[2], rad[3]]
        n.add(K.tube(pts, rr, n=5 if lod == 0 else 4, tip=True, cap_start=False), M["bark"],
              smooth=True, shade=K.shade_const(0.92))
    rnd = random.Random(7)
    per = 3 if lod == 0 else 1
    centers = cluster_centers()
    bell_clumps = [(c, r, s) for c, r, s in canopy_clumps(0)]
    pts = bell_points(bell_clumps, 30, seed=11)
    # (鐘樹の段の作り直しで変更: 鐘は樹冠の表に付けず、太枝から出した小枝に紐で吊る (hang_bells)。
    #  葉のカードは、鐘を吊る点の 0.5 m 上 (房の底の面) の近くにだけ置かない (紐の上が小枝まで見える))
    pts = [p + Z * 0.5 for p in hang_points()]
    for i, (c, r, s) in enumerate(clumps):
        # (木の磨き上げで変更: 塊は LUMP_K に縮めて、葉のカードの奥の暗い内側にする)
        src = K.ico((r * LUMP_K, r * LUMP_K, r * 0.82 * LUMP_K), subdiv=s, jitter=(0.03, 0.07, 0.1)[s], seed=10 + i,
                    flat_bottom=0.3)
        # (M22-07 光の筋のために変更: 柔らかい法線の基準を樹冠の中心から房の中心に替え、房ごとの丸い量感にする。
        #  陰りは樹冠全体の上下に、房の下側の陰りを掛ける)
        cc, cr = centers[i // per][0], centers[i // per][1]
        # (木の磨き上げで変更: 粗くした塊の面の角が陰りに出ないよう、柔らかい法線を 0.55 → 0.9 にする)
        n.add(src, M["leaf"], matrix=K.trs(c, (0, 0, rnd.uniform(0, 360))), smooth=True,
              shade=shade_inner(cc, cr), soft=(cc + Z * 0.15 * cr, 0.9))
    # (木の磨き上げで追加) 塊の表面に葉のカードを散らす。鐘の付け根の近くには置かない (鐘が葉に埋もれない)
    lumps = [(c, r * LUMP_K, i // per) for i, (c, r, _) in enumerate(clumps)]
    density, size = CARDS[lod]
    cards = K.scatter_cards(n, M["foliage"], lumps, density, size, seed=70 + lod, color=CARD_LIN,
                            shade_of=lambda k: shade_card(centers[k][0], centers[k][1]),
                            soft_of=lambda k: (centers[k][0] + Z * 0.15 * centers[k][1], 1.0), avoid=pts, avoid_r=0.5, gap_clear=GAP_CLEAR)
    # (木の磨き上げで追加) 鐘の付け根を、いちばん近い塊の中心から BELL_OUT 倍だけ外へ出す (カードの葉の層の外に吊るし、葉に埋もれない)
    # (鐘樹の段の作り直しで変更: 樹冠の表から外へ出した鐘は、枝と揃わず実や蜂の巣に見えた。下の輪の房の太枝から小枝を出し、紐で吊る)
    bells = hang_bells(n, lod)
    print(f"  {name}: bells={bells} cards={cards}")
    return n


def mature_shadow():
    """(M23-04 で追加) 成木の影だけに使う代わりの形 belltree_mature_shadow (観察画面は本の描画に出さず、日の影の描画だけで描く)。
    影の描画の三角形を減らす (成木 104 本を近い 3,646 / 遠い 1,080 三角形で描いていた)。樹冠の隙間の形は残す (光の筋・木漏れ日):
    - 葉の塊とカードは lod1 の房の位置に置き、SHADOW_K だけ小さくする (近い木の外側の葉を自分の影で暗くしない)。カードは絵のアルファで切り抜く
    - 幹は 4 角・3 段、板根は無し (根元の影は幹の影に紛れる)
    - 枝は房 8 つへ 1 本ずつ、付け根から房の中への 3 角の錐 (影の中の細い線)
    - 鐘は無し (樹冠の縁の小さな点)"""
    n = K.Node("belltree_mature_shadow")
    spine = [(0, 0, 0), (0.06, 0.02, 0.6), (0.12, 0.06, 1.7), (0.05, 0.12, 3.0), (-0.02, 0.06, 4.3), (0.0, 0.0, 5.6), (0.05, -0.05, 6.8)]
    radii = [0.8, 0.6, 0.5, 0.46, 0.4, 0.3, 0.18]
    spine, radii = spine[::2], radii[::2]
    n.add(K.tube(spine, radii, n=4, cap_start=False), M["trunk"])
    spine_v = [Vector(p) for p in spine]
    for c, r, upper, z0 in cluster_centers():
        p0 = trunk_at(spine_v, z0)
        n.add(K.tube([p0, c - Z * 0.2 * r], [0.2 if upper else 0.26, 0.05], n=3, tip=True, cap_start=False), M["bark"])
    clumps = [(c, r * SHADOW_K, s) for c, r, s in canopy_clumps(1)]
    rnd = random.Random(7)
    for i, (c, r, s) in enumerate(clumps):
        src = K.ico((r * LUMP_K, r * LUMP_K, r * 0.82 * LUMP_K), subdiv=s, jitter=(0.03, 0.07, 0.1)[s], seed=10 + i,
                    flat_bottom=0.3)
        n.add(src, M["leaf"], matrix=K.trs(c, (0, 0, rnd.uniform(0, 360))))
    centers = cluster_centers()
    # (鐘樹の段の作り直しで変更: 葉のカードの避ける点は成木 (lod0) と同じ、鐘を吊る点の 0.5 m 上)
    pts = [p + Z * 0.5 for p in hang_points()]
    lumps = [(c, r * LUMP_K, i) for i, (c, r, _) in enumerate(clumps)]
    density, size = SHADOW_CARDS
    cards = K.scatter_cards(n, M["foliage"], lumps, density, size, seed=71, color=CARD_LIN,
                            shade_of=lambda k: shade_card(centers[k][0], centers[k][1]),
                            soft_of=lambda k: (centers[k][0] + Z * 0.15 * centers[k][1], 1.0), avoid=pts, avoid_r=0.5, gap_clear=GAP_CLEAR)
    print(f"  belltree_mature_shadow: cards={cards}")
    return n


# ---------------------------------------------------------------- 株と丸太

def cut_face_mat(radius_of):
    """断面の年輪: 半径の帯で cut / ring を交互に"""
    def f(c, nrm):
        r = radius_of(c)
        if r is None:
            return None
        return M["ring"] if (0.62 < r < 0.78) or (0.3 < r < 0.45) else M["cut"]
    return f


# (鐘樹の段の作り直しで変更: 前の株。書き出しには使わない (前と後を比べるために残す)。今の株は下の「鐘樹の段の作り直し」の stump())
def stump_old():
    n = K.Node("belltree_stump")
    mound(n, 1.05, 0.1, seed=21)
    body = [(0.8, -0.02), (0.66, 0.14), (0.57, 0.4), (0.54, 0.6)]
    n.add(K.lathe(body, n=10, cap_top=False, cap_bottom=False, wobble=0.05, seed=22), M["bark"], smooth=True,
          shade=K.shade_height(0, 0.6, 0.72, 1.0))
    # 縁の裂けた樹皮: 外周 10 点を交互に高く
    import bmesh
    bm = bmesh.new()
    rnd = random.Random(23)
    N = 10
    outer = [bm.verts.new((0.54 * math.cos(2 * math.pi * i / N), 0.54 * math.sin(2 * math.pi * i / N), 0.6)) for i in range(N)]
    jag = []
    for i in range(N):
        a = 2 * math.pi * (i + 0.5) / N
        h = 0.62 + (0.08 + rnd.uniform(0, 0.14) if i % 3 != 1 else 0.02)
        jag.append(bm.verts.new((0.53 * math.cos(a), 0.53 * math.sin(a), h)))
    inner = [bm.verts.new((0.46 * math.cos(2 * math.pi * i / N), 0.46 * math.sin(2 * math.pi * i / N), 0.62)) for i in range(N)]
    for i in range(N):
        j = (i + 1) % N
        bm.faces.new((outer[i], outer[j], jag[i]))
        bm.faces.new((inner[j], inner[i], jag[i]))
        bm.faces.new((outer[j], inner[j], jag[i]))  # 裂け目の底
    n.add(bm, M["bark"], smooth=False, recalc=False, shade=K.shade_const(0.95))
    # 断面: 同心円の輪
    face = [(0.46, 0.62), (0.36, 0.625), (0.26, 0.625), (0.16, 0.625), (0.0, 0.625)]
    rel = lambda c: math.hypot(c.x, c.y) / 0.46  # noqa: E731
    n.add(K.lathe(list(reversed(face)), n=N, cap_top=False, cap_bottom=False), M["cut"], smooth=False,
          per_face_mat=cut_face_mat(rel), shade=K.shade_const(1.0))
    for i in range(4):
        a = math.radians(40 + 90 * i)
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * 0.35 + Z * 0.35, d * 0.8 + Z * 0.08, d * 1.15 + Z * -0.03]
        n.add(K.tube(pts, [0.22, 0.14, 0.04], n=5, tip=True, cap_start=False), M["bark"], smooth=True,
              shade=K.shade_height(0, 0.5, 0.72, 1.0))
    return n


def log(n, length, r, center, yaw, seed):
    prof = [(0.0, 0.0), (0.45 * r, 0.0), (0.8 * r, 0.0), (0.93 * r, 0.0), (r, 0.03),
            (r * 1.03, length * 0.5), (r, length - 0.03), (0.93 * r, length), (0.8 * r, length), (0.45 * r, length), (0.0, length)]
    m = K.trs(center, (0, 90, yaw)) @ K.trs((0, 0, -length / 2))
    inv = m.inverted()

    def radius_of(c):
        lc = inv @ c
        if 0.01 < lc.z < length - 0.01:
            return None
        return math.hypot(lc.x, lc.y) / (0.93 * r)
    n.add(K.lathe(prof, n=8, cap_top=False, cap_bottom=False, wobble=0.03, seed=seed, phase=0.2), M["bark"],
          matrix=m, smooth=False, per_face_mat=cut_face_mat(radius_of), shade=K.shade_height(0, 1.0, 0.8, 1.0))


# (鐘樹の段の作り直しで変更: 前の丸太。書き出しには使わない (前と後を比べるために残す)。今の丸太は下の「鐘樹の段の作り直し」の logs())
def logs_old():
    n = K.Node("belltree_logs")
    r = 0.3
    log(n, 2.1, r, (0.0, -0.31, r), 2, seed=31)
    log(n, 1.9, r, (0.12, 0.31, r), -3, seed=32)
    zt = r + math.sqrt((2 * r) ** 2 - 0.31 ** 2)
    log(n, 1.8, 0.28, (-0.08, 0.0, zt - 0.02), 5, seed=33)
    return n


# ---------------------------------------------------------------- 鐘樹の段の作り直し
# (鐘樹の段の作り直しで追加) 審査台への判断 (2026-09-24「そもそもBlenderのモデルが荒いママ」「切り株やマルタは樹木とくらべて精細化がされていない」
# 「鐘の釣り方が枝と揃っていないため、蜂の巣や実のような生えものにみえてしまう」) を受けて、芽・若木・株・丸太を成木と同じ作り込みにし、
# 鐘を枝から吊る。基準画は assets/textures/board/sheets/belltree.png と key-visuals/herd.png (鐘は枝から紐で下がる)。
# 色は頂点色で持つ (樹皮の筋と苔・地衣の斑、葉ごとの明暗と中肋、木口の年輪、土と苔と落ち葉)。

def clamp01(x):
    return min(1.0, max(0.0, x))


def smooth01(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def ground_patch(node, radius, height, seed, litter=6, blades=8, pebbles=2, cushions=1, subdiv=1, chips=0, aspect=1.0):
    """根元の地面: 土の盛りに苔の斑 (上ほど苔)、落ち葉、短い草、小石、苔の小山、木屑 (chips)。材質は ground (頂点色)。
    aspect で横に伸ばす (丸太の下)"""
    rnd = random.Random(seed)
    rx, ry = radius * aspect, radius
    bm = K.ico((rx, ry, height), subdiv=subdiv, jitter=0.1, seed=seed, flat_bottom=0.95)

    def col(v):
        p = v.co
        up = clamp01(p.z / max(1e-3, height))
        nz = K.vnoise(p.x * 4.5 / radius, p.y * 4.5 / radius, 0.0, seed)
        m = smooth01((up - 0.15) / 0.5) * smooth01((nz - 0.25) / 0.4)
        base = K.mix3(SOIL_DARK_LIN, SOIL_LIN, 0.4 + 0.6 * up)
        moss = K.mix3(MOSS_DEEP_LIN, MOSS_LIGHT_LIN, K.vnoise(p.x * 9 / radius, p.y * 9 / radius, 1.0, seed))
        return K.mul3(K.mix3(base, moss, m), 0.9 + 0.2 * nz)
    node.add(K.paint(bm, col), M["ground"], smooth=True, soft=((0, 0, -radius * 2), 0.6))

    def surface(x, y):
        t = (x / rx) ** 2 + (y / ry) ** 2
        return height * math.sqrt(max(0.0, 1 - t)) if t < 1 else 0.0

    def spot(rmin=0.25, rmax=0.95):
        a = rnd.uniform(0, 2 * math.pi)
        d = math.sqrt(rnd.uniform(rmin * rmin, rmax * rmax))
        x, y = math.cos(a) * d * rx, math.sin(a) * d * ry
        return x, y, surface(x, y)
    for i in range(litter):
        x, y, z = spot()
        L = rnd.uniform(0.07, 0.13) * min(1.0, radius * 2.5)
        c = LITTER_LIN[rnd.randrange(len(LITTER_LIN))]
        lf = K.leaf_folded(L, L * 0.55, k=2, fold=0.1, bend=-0.05, thick=0.004, base_col=K.mul3(c, 0.85), tip_col=c, edge=0.8)
        node.add(lf, M["ground"], matrix=K.trs((x, y, z + 0.004), (rnd.uniform(-8, 8), rnd.uniform(-8, 8), rnd.uniform(0, 360))),
                 smooth=True)
    for i in range(blades):
        x, y, z = spot(0.3, 1.0)
        a = rnd.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), 0))
        h = rnd.uniform(0.08, 0.2) * min(1.4, radius * 2.5)
        b0 = Vector((x, y, z - 0.01))
        pts = [b0, b0 + Z * h * 0.55 + d * h * 0.12, b0 + Z * h + d * h * 0.4]
        g = K.mul3(GRASS_LIN, rnd.uniform(0.85, 1.1))
        node.add(K.tube(pts, [0.012, 0.008, 0.0], n=3, tip=True, cap_start=False), M["ground"], smooth=True,
                 shade=lambda co, nrm, g=g, z0=z, h=h: K.mul3(g, 0.6 + 0.4 * clamp01((co.z - z0) / h)))
    for i in range(pebbles):
        x, y, z = spot(0.5, 1.0)
        s = rnd.uniform(0.03, 0.06) * min(1.5, radius * 3)
        node.add(K.ico((s, s * 0.8, s * 0.6), subdiv=0, jitter=0.2, seed=seed + 50 + i), M["ground"],
                 matrix=K.trs((x, y, z), (0, 0, rnd.uniform(0, 360))), smooth=False,
                 shade=K.shade_const(K.mul3(PEBBLE_LIN, rnd.uniform(0.8, 1.05))))
    for i in range(cushions):
        x, y, z = spot(0.3, 0.8)
        moss_cushion(node, (x, y, z - 0.01), rnd.uniform(0.07, 0.13) * min(2.0, radius * 3), seed + 70 + i)
    for i in range(chips):
        x, y, z = spot(0.45, 1.0)
        c = K.mul3(FIBRE_LIN, rnd.uniform(0.85, 1.02))
        node.add(K.box((rnd.uniform(0.05, 0.1), rnd.uniform(0.03, 0.05), 0.012), jitter=0.004, seed=seed + 90 + i), M["wood"],
                 matrix=K.trs((x, y, z + 0.006), (rnd.uniform(-10, 10), rnd.uniform(-10, 10), rnd.uniform(0, 360))),
                 shade=K.shade_const(c))


def moss_cushion(node, at, size, seed, flat=0.45):
    """苔の小山 (ふくらんだ塊、明るい苔と暗い苔の斑)"""
    bm = K.ico((size, size * 0.85, size * flat), subdiv=1, jitter=0.25, seed=seed, flat_bottom=0.9)

    def col(v):
        p = v.co
        n = K.vnoise(p.x * 18, p.y * 18, p.z * 18, seed)
        return K.mul3(K.mix3(MOSS_DEEP_LIN, MOSS_LIGHT_LIN, n), 0.75 + 0.35 * clamp01(p.z / (size * flat)))
    node.add(K.paint(bm, col), M["ground"], matrix=K.trs(at, (0, 0, (seed * 37) % 360)), smooth=True,
             soft=(Vector(at) - Z * size, 0.5))


def with_lichen(shade, seed, scale=6.0, thr=0.74, zmin=0.15, amount=0.75):
    """樹皮の陰りに地衣 (淡い灰緑の斑) を足す"""
    def f(co, nrm):
        v = shade(co, nrm)
        if co.z < zmin:
            return v
        n = K.vnoise(co.x * scale, co.y * scale, co.z * scale, seed)
        t = smooth01((n - thr) / 0.08) * amount
        return K.mix3(v, K.mul3(LICHEN_LIN, sum(v) / 3 / max(1e-3, sum(BARK_LIN) / 3)), t)
    return f


def placed_leaf(node, at, direction, length, width, cols, lod, roll=0.0, bend=0.22, shade=None, soft=None, k=None, petiole=0.0):
    """葉を 1 枚、付け根 at から direction へ付ける (葉柄 petiole m、roll 度で葉の軸まわりに傾ける)。cols = (付け根, 先, 中肋)"""
    d = Vector(direction).normalized()
    at = Vector(at)
    if petiole > 0 and lod == 0:
        node.add(K.tube([at, at + d * petiole], [0.006, 0.004], n=3, cap_start=False), M["leafv"], smooth=True,
                 shade=K.shade_const(K.mul3(cols[0], 0.9)))
        at = at + d * petiole
    m = K.aim(d) @ K.trs((0, 0, 0), (roll, 0, 0))
    m.translation = at
    kk = k if k is not None else (4 if lod == 0 else 2)
    lf = K.leaf_folded(length, width, k=kk, fold=0.2, bend=bend, thick=max(0.004, length * 0.03),
                       base_col=cols[0], tip_col=cols[1], rib_col=cols[2], edge=0.8)
    node.add(lf, M["leafv"], matrix=m, smooth=True, shade=shade, soft=soft)


# ---------------------------------------------------------------- 芽 (作り直し)

def seedling():
    """(鐘樹の段の作り直しで追加) 芽: 苔と落ち葉の乗った土の盛りから、淡い緑の茎が伸び、丸い子葉 2 枚と若い本葉 2 枚を開く。
    芽の先 (本葉の間) が淡く光る (基準画の芽は光る)"""
    n = K.Node("belltree_seedling")
    ground_patch(n, 0.22, 0.055, seed=1, litter=4, blades=5, pebbles=2, cushions=1, subdiv=2)
    stem = [(0, 0, 0.0), (0.012, 0.0, 0.1), (0.016, 0.006, 0.19), (0.004, 0.01, 0.28)]
    base_c, tip_c = K.hex_rgb("#8C6A48"), K.hex_rgb("#C9DB9A")
    n.add(K.tube(stem, [0.013, 0.011, 0.009, 0.007], n=5, cap_start=False), M["leafv"], smooth=True,
          shade=lambda co, nrm: K.mix3(base_c, tip_c, smooth01(co.z / 0.2)))
    top = Vector(stem[-1])
    rnd = random.Random(5)
    crown = top + Z * 0.05
    for i, a in enumerate((25, 205)):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0.32))
        cols = tuple(K.mul3(c, rnd.uniform(0.95, 1.05)) for c in SEEDLING_LEAF)
        placed_leaf(n, top - Z * 0.012, d, 0.16, 0.1, cols, 0, roll=rnd.uniform(-12, 12), bend=0.2,
                    shade=K.shade_const(1.0), soft=(crown - Z * 0.25, 0.35), k=4)
    for i, a in enumerate((115, 295)):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 1.6))
        cols = (K.hex_rgb("#7FAF45"), K.hex_rgb("#C8E07A"), K.hex_rgb("#E6F0B0"))
        placed_leaf(n, top, d, 0.075, 0.045, cols, 0, roll=0, bend=0.3, shade=K.shade_const(1.0), soft=(crown - Z * 0.2, 0.35), k=3)
    n.add(K.ico((0.013, 0.013, 0.02), subdiv=1, seed=2), M["glow"], matrix=K.trs(top + Z * 0.012), smooth=True)
    return n


# ---------------------------------------------------------------- 若木 (作り直し)

SAPLING_SPINE = [(0, 0, -0.02), (0.03, 0, 0.9), (-0.02, 0.02, 1.8), (0.01, 0, 2.75)]
SAPLING_RADII = [0.08, 0.058, 0.038, 0.012]
# (付け根の高さ, 方位 度, 長さ, 立ち上がり)
SAPLING_BRANCHES = [(1.2, 35, 0.8, 0.9), (1.55, 215, 0.72, 1.0), (1.95, 120, 0.55, 1.15)]


def sapling(lod=0):
    """(鐘樹の段の作り直しで追加) 若木 (~3 m): 淡い樹皮の細い幹 (縦の筋、根元に苔) から細い枝 3 本が上へ開き、幹と枝に大きな卵形の葉を
    互い違いに付ける (上ほど明るく若い、下の葉は大きく暗い)。葉は中肋で折った形で、葉ごとに明暗と色を揺らし、中肋が明るい。
    lod1 (belltree_sapling_lod1) は遠目用: 葉の数と細かさを減らし、地面の盛りを簡単にする"""
    name = "belltree_sapling" if lod == 0 else "belltree_sapling_lod1"
    n = K.Node(name)
    if lod == 0:
        ground_patch(n, 0.45, 0.08, seed=3, litter=6, blades=9, pebbles=2, cushions=2, subdiv=1)
    else:
        mound(n, 0.4, 0.08, seed=3)
    sides = 8 if lod == 0 else 5
    bark = K.bark_shade(SAPLING_SPINE, SAPLING_RADII, BARK_LIN, MOSS_LIN, lo=0.68, hi=1.0, z1=1.3, groove=0.22,
                        moss_z=(0.0, 0.4), seed=0.7)
    n.add(K.tube(SAPLING_SPINE, SAPLING_RADII, n=sides, cap_start=False, tip=True,
                 ridge=K.fissures(sides, depth=(0.03, 0.08), bump=0.03, seed=3)), M["trunk"], smooth=True, shade=bark)
    rnd = random.Random(4)
    crown = Vector((0, 0, 2.0))
    spine_v = [Vector(p) for p in SAPLING_SPINE]
    leaves = []  # (付け根, 向き, 長さ, 高さの割合)
    for z0, a, L, up in SAPLING_BRANCHES:
        p0 = trunk_at(spine_v, z0)
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        pts = [p0, p0 + d * L * 0.45 + Z * L * 0.35 * up, p0 + d * L + Z * L * 0.85 * up]
        n.add(K.tube(pts, [0.026, 0.017, 0.006], n=5 if lod == 0 else 3, tip=True, cap_start=False), M["trunk"], smooth=True,
              shade=K.shade_const(K.mul3(BARK_LIN, 0.9)))
        stops = (0.45, 0.72, 0.95) if lod == 0 else (0.6, 0.95)
        for j, t in enumerate(stops):
            q = pts[0].lerp(pts[1], t / 0.5) if t < 0.5 else pts[1].lerp(pts[2], (t - 0.5) / 0.5)
            side = Z.cross(d).normalized() * (1 if j % 2 else -1)
            dirl = (d * 0.6 + side * (0.7 if t < 0.9 else 0.1) + Z * (0.5 + 0.6 * t)).normalized()
            leaves.append((q, dirl, rnd.uniform(0.34, 0.44) * (1.0 if t < 0.9 else 0.85), (z0 - 1.1) / 1.6 + 0.2 * t))
    count = 18 if lod == 0 else 10
    for j in range(count):
        t = j / (count - 1)
        z = 1.2 + 1.52 * t
        a = math.radians(j * 137.5 + rnd.uniform(-12, 12))
        p = trunk_at(spine_v, z)
        up = 0.4 + 0.95 * t + rnd.uniform(-0.1, 0.1)
        d = Vector((math.cos(a), math.sin(a), up))
        L = (0.36 + 0.24 * math.sin(math.pi * (0.2 + 0.7 * t))) * rnd.uniform(0.9, 1.06) * (0.8 if t > 0.92 else 1.0)
        leaves.append((p, d, L, t))
    for q, d, L, t in leaves:
        light = clamp01(t)
        cols = tuple(K.mul3(c, (0.86 + 0.26 * light) * rnd.uniform(0.92, 1.06)) for c in SAPLING_LEAF)
        if rnd.random() < 0.15:  # ときどき黄ばんだ下の葉
            cols = tuple(K.mix3(c, K.hex_rgb("#A5A148"), 0.35) for c in cols)
        placed_leaf(n, q, d, L, L * 0.7, cols, lod, roll=rnd.uniform(-25, 25), bend=0.3,
                    shade=K.shade_canopy(crown, 0.9, lo=0.78, hi=1.0, warm=0.06), soft=(crown, 0.35), petiole=0.035)
    return n


# ---------------------------------------------------------------- 株 (作り直し)

STUMP_H = 0.72
STUMP_R = 0.55
STUMP_CUT_R = 0.47


def ringed_body(zs, rs, sides, ridge, phase=0.0):
    """縦の軸 (0, 0) まわりの輪を積んだ胴 (蓋なし)。ridge(i, k) で輪 i の k 番目の頂点を出し入れする"""
    bm = bmesh.new()
    rings = []
    for i, (z, r) in enumerate(zip(zs, rs)):
        rings.append([bm.verts.new((r * ridge(i, k) * math.cos(phase + 2 * math.pi * k / sides),
                                    r * ridge(i, k) * math.sin(phase + 2 * math.pi * k / sides), z)) for k in range(sides)])
    K._bridge(bm, rings, False, False)
    return bm


def stump():
    """(鐘樹の段の作り直しで追加) 伐った株: 淡い樹皮の胴 (縦の裂け目と筋、根元の苔、地衣の斑) が鰭の根 5 本で地面へ広がり、
    上は倒れるときに裂けた樹皮と木の繊維のぎざぎざの縁 (倒れた側ほど高い) が、年輪の出た明るい木口を囲む。
    根元に苔の小山、地面は苔の斑の土に落ち葉・木屑・短い草"""
    n = K.Node("belltree_stump")
    ground_patch(n, 1.2, 0.1, seed=21, litter=10, blades=12, pebbles=3, cushions=0, subdiv=2, chips=6)
    sides = 18
    zs = [-0.06, 0.12, 0.38, STUMP_H]
    rs = [0.8, 0.64, 0.57, STUMP_R]
    fis = K.fissures(sides, depth=(0.04, 0.1), bump=0.04, seed=21, flare=(2, 1.15))
    spine = [(0, 0, z) for z in zs]
    bark = with_lichen(K.bark_shade(spine, rs, BARK_LIN, MOSS_LIN, lo=0.6, hi=1.0, z1=0.75, groove=0.3, moss_z=(0.02, 0.42), seed=2.2),
                       seed=5, scale=7.0)
    n.add(ringed_body(zs, rs, sides, fis), M["trunk"], smooth=True, shade=bark)
    # 樹皮の厚みの縁 (外の輪から木口へ、暗い内樹皮)
    bm = bmesh.new()
    outer = [bm.verts.new((STUMP_R * fis(3, k) * math.cos(2 * math.pi * k / sides), STUMP_R * fis(3, k) * math.sin(2 * math.pi * k / sides),
                           STUMP_H)) for k in range(sides)]
    inner = [bm.verts.new((STUMP_CUT_R * math.cos(2 * math.pi * k / sides), STUMP_CUT_R * math.sin(2 * math.pi * k / sides), STUMP_H - 0.01))
             for k in range(sides)]
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((inner[k], outer[k], outer[j], inner[j]))
    n.add(bm, M["trunk"], smooth=False, recalc=False, shade=K.shade_const(INNER_BARK_LIN))
    # 木口の年輪 (髄は倒れた側と逆に片寄る)
    K.ring_disc(n, M["wood"], K.trs((0, 0, STUMP_H - 0.008)), STUMP_CUT_R, seed=24, rings=7, sides=sides,
                light=WOOD["light"], dark=WOOD["dark"], pith=WOOD["pith"], sap=WOOD["sap"], off=(-0.1, 0.05), cracks=3)
    # 裂けた樹皮と繊維の縁: 樹皮の外周の頂点ごとに楔を立てる。倒れた側 (hinge、方位 20°) ほど高い
    rnd = random.Random(23)
    hinge = math.radians(20)
    half = math.pi / sides * 0.8
    for k in range(sides):
        a = 2 * math.pi * k / sides
        near = 0.5 + 0.5 * math.cos(a - hinge)
        if rnd.random() < 0.18 and near < 0.6:
            continue
        h = 0.02 + near ** 2 * rnd.uniform(0.12, 0.3) + rnd.uniform(0, 0.05)
        ro = STUMP_R * fis(3, k) * 0.99
        ri = STUMP_CUT_R + 0.01 + rnd.uniform(0, 0.02) * near
        lean = rnd.uniform(-0.02, 0.05)
        ol = Vector((ro * math.cos(a - half), ro * math.sin(a - half), STUMP_H - 0.02))
        orr = Vector((ro * math.cos(a + half), ro * math.sin(a + half), STUMP_H - 0.02))
        il = Vector((ri * math.cos(a - half * 0.7), ri * math.sin(a - half * 0.7), STUMP_H - 0.02))
        ir = Vector((ri * math.cos(a + half * 0.7), ri * math.sin(a + half * 0.7), STUMP_H - 0.02))
        rad = Vector((math.cos(a), math.sin(a), 0))
        tw = rnd.uniform(-0.3, 0.3) * half
        to = Vector((ro * math.cos(a + tw), ro * math.sin(a + tw), STUMP_H + h)) + rad * lean
        ti = Vector(((ri + 0.02) * math.cos(a + tw), (ri + 0.02) * math.sin(a + tw), STUMP_H + h * rnd.uniform(0.7, 0.95))) + rad * lean
        bark_c = K.mul3(BARK_LIN, rnd.uniform(0.82, 0.98))
        fib = K.mul3(FIBRE_LIN, rnd.uniform(0.85, 1.0))
        # 楔 1 つを 1 つの形にして面の向きを揃える (外向きの面は樹皮、内と横は繊維の色)
        b2 = bmesh.new()
        vo_l, vo_r, vi_l, vi_r, vt_o, vt_i = (b2.verts.new(v) for v in (ol, orr, il, ir, to, ti))
        for f in ((vo_l, vo_r, vt_o), (vi_r, vi_l, vt_i), (vi_l, vo_l, vt_o, vt_i), (vo_r, vi_r, vt_i, vt_o), (vo_l, vi_l, vi_r, vo_r)):
            b2.faces.new(f)
        n.add(b2, M["wood"], smooth=False,
              shade=lambda co, nrm, rad=rad, bc=bark_c, fc=fib, h=h: K.mul3(bc if nrm.dot(rad) > 0.6 else fc,
                                                                            0.8 + 0.2 * clamp01((co.z - STUMP_H) / max(0.02, h))))
    # 木口の上に立つ細い裂け (倒れた側の縁の近く)
    for i in range(5):
        a = hinge + rnd.uniform(-0.6, 0.6)
        r0 = rnd.uniform(0.25, 0.42)
        b0 = Vector((r0 * math.cos(a), r0 * math.sin(a), STUMP_H - 0.01))
        tipp = b0 + Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.0, 0.05) + Z * rnd.uniform(0.06, 0.16)
        n.add(K.tube([b0, tipp], [0.018, 0.0], n=3, tip=True, cap_start=False), M["wood"], smooth=False,
              shade=K.shade_const(K.mul3(FIBRE_LIN, rnd.uniform(0.9, 1.0))))
    # 鰭の根 5 本
    for i in range(5):
        a = math.radians(40 + 72 * i + rnd.uniform(-12, 12))
        d = Vector((math.cos(a), math.sin(a), 0))
        L = 1.0 + 0.2 * math.sin(i * 2.1)
        pts = [d * 0.3 + Z * 0.42, d * 0.6 + Z * 0.15, d * 0.98 * L + Z * 0.02, d * 1.28 * L + Z * (-0.06)]
        n.add(K.tube(pts, [0.26, 0.2, 0.1, 0.03], n=6, tip=True, cap_start=False, aspect=(0.62, 1.35)), M["trunk"],
              smooth=True, shade=bark)
    # 根の間の苔の小山
    for i in range(3):
        a = math.radians(40 + 72 * (i * 2) + 36)
        d = Vector((math.cos(a), math.sin(a), 0))
        moss_cushion(n, d * 0.72 + Z * 0.02, 0.2, 30 + i)
    return n


# ---------------------------------------------------------------- 丸太 (作り直し)

def log_shade(inv, r, seed):
    """丸太の樹皮の陰り (丸太の座標 inv で角度と長さを取る): 縦の筋の裂け目・筋の濃淡・上を向いた面の苔の斑・地衣の斑・地面に接する所の汚れ"""
    def f(co, nrm):
        lc = inv @ co
        g = math.hypot(lc.x, lc.y) / r
        ang = math.atan2(lc.y, lc.x)
        gro = clamp01((0.985 - g) / 0.05)
        v = (0.9 + 0.14 * K.vnoise(ang * 2.2, lc.z * 1.4, 0, seed)) * (1 - 0.28 * gro)
        c = K.mul3(BARK_LIN, v)
        n1 = K.vnoise(lc.z * 2.2, ang * 1.3, 3.0, seed)
        m = smooth01((nrm.z - 0.25) / 0.4) * smooth01((n1 - 0.42) / 0.25)
        moss = K.mix3(MOSS_DEEP_LIN, MOSS_LIGHT_LIN, K.vnoise(lc.z * 8, ang * 5, 1.0, seed))
        c = K.mix3(c, moss, m * 0.9)
        li = smooth01((K.vnoise(lc.z * 6, ang * 3.5, 7.0, seed) - 0.7) / 0.08) * (1 - m)
        c = K.mix3(c, K.mul3(LICHEN_LIN, v), li * 0.7)
        low = clamp01((0.12 - co.z) / 0.12)
        return K.mix3(c, K.mul3(SOIL_LIN, 1.1), low * 0.5)
    return f


def look_matrix(at, d):
    """+Z を d へ向け、at に置く行列 (木口の円盤を折れた枝の先へ)"""
    q = Z.rotation_difference(Vector(d).normalized())
    mm = q.to_matrix().to_4x4()
    mm.translation = Vector(at)
    return mm


def log_piece(n, length, r, center, yaw, seed, stub=None):
    """丸太 1 本 (向きは X、yaw 度で回す)。樹皮の胴 (16 面、縦の筋) と、両の木口 (樹皮の縁と年輪)。stub=(長さの割合, 方位 度) で折れた枝の跡"""
    sides = 16
    m = K.trs(center, (0, 90, yaw)) @ K.trs((0, 0, -length / 2))
    inv = m.inverted()
    rnd = random.Random(seed)
    zs = [0.03] + [length * t for t in (0.14, 0.27, 0.4, 0.52, 0.64, 0.76, 0.88)] + [length - 0.03]
    rs = [r * (1.02 - 0.07 * (z / length) + rnd.uniform(-0.012, 0.012)) for z in zs]
    fis = K.fissures(sides, depth=(0.04, 0.1), bump=0.035, seed=seed)
    n.add(ringed_body(zs, rs, sides, fis, phase=0.2), M["trunk"], matrix=m, smooth=True, shade=log_shade(inv, r, seed))
    for end, z, rr, i_ring in ((0, 0.0, rs[0], 0), (1, length, rs[-1], len(zs) - 1)):
        zb = zs[i_ring]
        bm = bmesh.new()
        outer = [bm.verts.new((rr * fis(i_ring, k) * math.cos(0.2 + 2 * math.pi * k / sides),
                               rr * fis(i_ring, k) * math.sin(0.2 + 2 * math.pi * k / sides), zb)) for k in range(sides)]
        cr = rr * 0.9
        inner = [bm.verts.new((cr * math.cos(0.2 + 2 * math.pi * k / sides), cr * math.sin(0.2 + 2 * math.pi * k / sides), z))
                 for k in range(sides)]
        for k in range(sides):
            j = (k + 1) % sides
            f = (outer[k], outer[j], inner[j], inner[k]) if end == 1 else (inner[k], inner[j], outer[j], outer[k])
            bm.faces.new(f)
        n.add(bm, M["trunk"], matrix=m, smooth=False, shade=K.shade_const(INNER_BARK_LIN))
        face_m = m @ K.trs((0, 0, z), (0 if end == 1 else 180, 0, rnd.uniform(0, 360)))
        K.ring_disc(n, M["wood"], face_m, cr, seed=seed * 7 + end, rings=6, sides=sides,
                    light=WOOD["light"], dark=WOOD["dark"], pith=WOOD["pith"], sap=WOOD["sap"],
                    off=(rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)), cracks=2)
    if stub:
        t, a = stub
        a = math.radians(a)
        d = Vector((math.cos(a), math.sin(a), 0.25)).normalized()
        base = Vector((math.cos(a) * r * 0.85, math.sin(a) * r * 0.85, length * t))
        tipp = base + d * 0.2
        n.add(K.tube([base, base + d * 0.12, tipp], [0.07, 0.058, 0.05], n=8, cap_start=False, cap_end=False), M["trunk"], matrix=m,
              smooth=True, shade=log_shade(inv, r, seed))
        K.ring_disc(n, M["wood"], m @ look_matrix(tipp, d), 0.05, seed=seed + 3, rings=2, sides=8, light=WOOD["light"], dark=WOOD["dark"],
                    pith=WOOD["pith"], sap=WOOD["sap"], cracks=0)


def logs():
    """(鐘樹の段の作り直しで追加) 丸太 3 本: 淡い樹皮に縦の筋と裂け目、上の面に苔の斑、地衣の斑、地面に接する所の土の汚れ。
    木口は樹皮の縁 (内樹皮の暗い帯) に囲まれた年輪 (偏心した髄、放射状の割れ)。2 本に折れた枝の跡。地面は苔の斑の土に落ち葉と草"""
    n = K.Node("belltree_logs")
    ground_patch(n, 0.95, 0.06, seed=35, litter=9, blades=10, pebbles=2, cushions=1, subdiv=2, chips=3, aspect=1.35)
    r = 0.3
    log_piece(n, 2.1, r, (0.0, -0.31, r), 2, seed=31, stub=(0.62, 70))
    log_piece(n, 1.9, r, (0.12, 0.31, r), -3, seed=32)
    zt = r + math.sqrt((2 * r) ** 2 - 0.31 ** 2)
    log_piece(n, 1.8, 0.28, (-0.08, 0.0, zt - 0.02), 5, seed=33, stub=(0.3, 100))
    moss_cushion(n, (0.55, -0.05, zt + 0.22), 0.13, 41, flat=0.35)
    moss_cushion(n, (-0.7, 0.55, r * 1.6), 0.1, 42, flat=0.35)
    return n


# ---------------------------------------------------------------- 鐘を枝から吊る

# (鐘樹の段の作り直しで追加) 下の輪の房 5 つそれぞれに、太枝から小枝を 3 本出し、樹冠の縁の下へ伸ばす:
# (太枝の付け根からの長さの割合, 房の外向きからの振れ 度, 長さ m, 鐘を吊る小枝の上の位置 2 つ (割合))。
# 付け根に近い 2 本は房の横へ (房と房の間の下)、先に近い 1 本は房の外の縁の下へ。房あたり 6 個、全部で 30 個
# (並べ図で見直して変更: 鐘がみな同じ高さの帯に並んで飾り付けに見えたので、房ごとに小枝の付け根・振れ・長さ・先の高さを揺らし、
#  外への 1 本は樹冠の縁の外まで伸ばして先を縁の葉の下に差し込む (縁の鐘は外から枝の先に下がって見える)。
#  値は (割合の幅, 振れの幅 度, 長さの幅 m, 先の高さ (房の下の面から) の幅 m, 吊る位置))
TWIGS = [((0.5, 0.62), (-70, -45), (1.2, 1.6), (-0.4, -0.05), (0.5, 0.95)),
         ((0.58, 0.7), (40, 65), (1.1, 1.5), (-0.3, 0.0), (0.45, 0.95)),
         ((0.84, 0.9), (-12, 12), (1.9, 2.25), (0.05, 0.3), (0.5, 0.97))]
CORD = (0.15, 0.85)   # 紐の長さの幅 (m)
MATURE_SPINE = [(0, 0, 0), (0.06, 0.02, 0.6), (0.12, 0.06, 1.7), (0.05, 0.12, 3.0), (-0.02, 0.06, 4.3), (0.0, 0.0, 5.6), (0.05, -0.05, 6.8)]


def branch_polyline(c, r, upper, z0, spine_v):
    """mature() の太枝と同じ折れ線 (lod0 の形)"""
    p0 = trunk_at(spine_v, z0)
    d = Vector((c.x - p0.x, c.y - p0.y, 0)).normalized()
    end = c - Z * 0.2 * r
    sag = 0.25 if upper else 0.45
    p1 = p0.lerp(end, 0.33) + d * sag * 0.8 - Z * sag * 0.6
    p2 = p0.lerp(end, 0.68) + d * sag * 0.4 - Z * sag * 0.2
    return [p0, p1, p2, end]


def along(pts, t):
    """折れ線 pts の長さの割合 t の点"""
    seg = [(b - a).length for a, b in zip(pts, pts[1:])]
    s = t * sum(seg)
    for (a, b), L in zip(zip(pts, pts[1:]), seg):
        if s <= L:
            return a.lerp(b, s / max(1e-6, L))
        s -= L
    return pts[-1].copy()


def bell_twigs():
    """[(小枝の折れ線, 鐘を吊る位置の割合)]。形は lod0 の太枝から決め、lod1 も同じ位置に置く (切り替えで鐘が跳ばない)"""
    spine = [Vector(p) for p in MATURE_SPINE]
    rnd = random.Random(90)
    out = []
    for c, r, upper, z0 in cluster_centers():
        if upper:
            continue
        br = branch_polyline(c, r, upper, z0, spine)
        o = Vector((c.x, c.y, 0)).normalized()
        # 房の真ん中の塊の底 (flat_bottom 0.3) と、その下に垂れる葉のカードの層より下
        under = c.z - r * LUMP_K * 0.82 * 0.7 - 0.42
        for s_, ang_, L_, rise_, hangs in TWIGS:
            q = along(br, rnd.uniform(*s_))
            a = math.radians(rnd.uniform(*ang_))
            d = Vector((o.x * math.cos(a) - o.y * math.sin(a), o.x * math.sin(a) + o.y * math.cos(a), 0))
            end = Vector((q.x, q.y, 0)) + d * rnd.uniform(*L_)
            end.z = min(q.z + 0.45, under + rnd.uniform(*rise_))
            mid = q.lerp(end, 0.5) + Z * 0.15
            out.append(([q, mid, end], hangs))
    return out


def hang_points():
    """鐘を吊る点 (小枝の上) の一覧"""
    return [along(pts, h) for pts, hangs in bell_twigs() for h in hangs]


def hung_bell(node, top, lod, phase):
    """紐の下の鐘 (top は鐘の肩)。輪郭は bell() と同じ (丸い肩と開いた裾、裾の帯と口が光る)。lod0 は紐を受ける小さな頭を足す"""
    if lod == 0:
        prof = [(0.0, 0.04), (0.1, -0.02), (0.14, -0.24), (0.2, -0.4), (0.3, -0.5), (0.0, -0.38)]
        node.add(K.lathe(prof, n=6, phase=phase), M["bell"], matrix=K.trs(top), smooth=True, per_face_mat=bell_rim(top))
    else:
        prof = [(0.0, 0.0), (0.24, -0.42), (0.3, -0.5), (0.0, -0.38)]
        node.add(K.lathe(prof, n=4), M["bell"], matrix=K.trs(top), smooth=True, per_face_mat=bell_rim(top))


def hang_bells(node, lod, seed=100):
    """小枝を描き、小枝から紐を垂らして鐘を下げる。返り値は鐘の数。
    lod1 (38 m より先) は小枝を太い 3 角の錐 1 本にし、紐は描かない (38 m で紐は 1 画素に満たない。鐘の位置は lod0 と同じ)"""
    rnd = random.Random(seed)
    count = 0
    for i, (pts, hangs) in enumerate(bell_twigs()):
        if lod == 0:
            node.add(K.tube(pts, [0.085, 0.055, 0.022], n=5, tip=True, cap_start=False), M["bark"], smooth=True,
                     shade=K.shade_const(0.9))
        else:
            node.add(K.tube([pts[0], pts[-1]], [0.09, 0.02], n=3, tip=True, cap_start=False), M["bark"], smooth=True,
                     shade=K.shade_const(0.9))
        for h in hangs:
            p = along(pts, h)
            cord = rnd.uniform(*CORD)
            ph = rnd.uniform(0, 1)
            top = p - Z * cord
            if lod == 0:
                node.add(K.tube([p + Z * 0.03, top + Z * 0.03], [0.026, 0.026], n=3, cap_start=False, cap_end=False), M["rope"],
                         smooth=True, shade=K.shade_const(1.0))
            hung_bell(node, top, lod, ph)
            count += 1
    return count


if __name__ == "__main__":
    # (M23-04 で変更: 成木の影の代わりの形 mature_shadow を足す。既存のノードは同じ種で同じ形のまま)
    # (鐘樹の段の作り直しで変更: 芽・若木・株・丸太は作り直した形。若木の遠距離版 sapling(1) を足す)
    nodes = [seedling(), sapling(), sapling(1), mature(0), mature(1), stump(), logs(), mature_shadow()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "belltree.glb"), texcoords=True)
