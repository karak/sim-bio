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

CANOPY_C = Vector((0, 0, 6.9))  # 成木の樹冠の中心 (柔らかい法線の向きの基準)


def moss_top(threshold=0.55):
    """上を向いた面は苔、それ以外は土"""
    return lambda c, n: M["moss"] if n.z > threshold else M["soil"]


def mound(node, radius, height, seed, subdiv=1):
    node.add(K.ico((radius, radius, height), subdiv=subdiv, jitter=0.12, seed=seed, flat_bottom=0.95), M["soil"],
             matrix=K.trs((0, 0, 0.0)), smooth=True, shade=K.shade_height(-0.02, height, 0.75, 1.0),
             per_face_mat=moss_top())


# ---------------------------------------------------------------- 芽

def seedling():
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

def sapling():
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
    print(f"  {name}: bells={len(pts)} cards={cards}")
    # (木の磨き上げで追加) 鐘の付け根を、いちばん近い塊の中心から BELL_OUT 倍だけ外へ出す (カードの葉の層の外に吊るし、葉に埋もれない)
    pts = [bell_out(p, bell_clumps) for p in pts]
    for j, p in enumerate(pts):
        bell(n, p, lod, seed=100 + j)
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


def stump():
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


def logs():
    n = K.Node("belltree_logs")
    r = 0.3
    log(n, 2.1, r, (0.0, -0.31, r), 2, seed=31)
    log(n, 1.9, r, (0.12, 0.31, r), -3, seed=32)
    zt = r + math.sqrt((2 * r) ** 2 - 0.31 ** 2)
    log(n, 1.8, 0.28, (-0.08, 0.0, zt - 0.02), 5, seed=33)
    return n


if __name__ == "__main__":
    nodes = [seedling(), sapling(), mature(0), mature(1), stump(), logs()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "belltree.glb"), texcoords=True)
