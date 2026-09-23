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
}


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

def moongrass_tuft_seed():
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


def fern():
    n = K.Node("fern")
    rnd = random.Random(21)
    for i in range(5):
        yaw = 72 * i + rnd.uniform(-15, 15)
        frond(n, (0, 0, 0.02), yaw, rnd.uniform(0.58, 0.72), rnd.uniform(0.62, 0.78), 0.13)
    return n


def flower_patch():
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
    sides = 7 if lod == 0 else 5
    spine = [(0, 0, 0), (0.05, 0.02, 1.1), (-0.02, 0.05, 2.2), (0.03, 0.0, 3.0)]
    radii = [0.34, 0.26, 0.21, 0.16]
    if lod:
        spine, radii = [spine[0], spine[2], spine[3]], [radii[0], radii[2], radii[3]]
    bark = K.shade_height(0, 2.5, 0.65, 1.0)
    n.add(K.tube(spine, radii, n=sides, cap_start=False), M["forest_bark"], smooth=True, shade=bark)
    if lod == 0:
        for i in range(4):
            a = math.radians(30 + 90 * i)
            d = Vector((math.cos(a), math.sin(a), 0))
            n.add(K.tube([d * 0.15 + Z * 0.6, d * 0.45 + Z * 0.14, d * 0.78 + Z * -0.03], [0.17, 0.1, 0.03], n=4,
                         tip=True, cap_start=False), M["forest_bark"], smooth=True, shade=bark)
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
    for k, (c, r, upper, _) in enumerate(forest_clusters()):
        lumps = forest_lumps(c, r, upper)
        if lod:
            g = sum((lc * lr ** 3 for lc, lr in lumps), Vector()) / sum(lr ** 3 for _, lr in lumps)
            lumps = [(g, r * 1.02)]  # (試作 3 の判断で変更: 1.08 → 1.02。房を大きくしたので、lod1 の隙間が lod0 より詰まりすぎないように)
        for j, (lc, lr) in enumerate(lumps):
            n.add(K.ico((lr, lr, lr * 0.88), subdiv=1, jitter=0.09, seed=50 + 3 * k + j, flat_bottom=0.25),
                  M["forest_leaf"], matrix=K.trs(lc, (0, 0, rnd.uniform(0, 360))), smooth=True,
                  shade=K.shade_canopy(FOREST_C, 2.2, lo=0.5, hi=1.0, warm=0.12), soft=(c + Z * 0.15 * r, 0.6))
    return n


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


if __name__ == "__main__":
    nodes = [grass_tuft(), moongrass_tuft(), moss_clump(), rock(),
             forest_tree(0), forest_tree(1), moongrass_tuft_seed(), fern(), flower_patch()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "flora.glb"))
