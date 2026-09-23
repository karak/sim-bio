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
    "bell": K.material("belltree_bell", "#A8703F", rough=0.55, emit=K.BELL_AMBER, strength=0.9),
    "glow": K.material("belltree_glow", "#FFE7A8", rough=0.6, emit="#FFD98A", strength=3.0),
    "soil": K.material("belltree_soil", "#7B6043", rough=0.95),
    "moss": K.material("belltree_moss", "#8AA743", rough=0.95),
    "cut": K.material("belltree_cut", "#EFD6A8", rough=0.9),
    "ring": K.material("belltree_cut_ring", "#D2AC7B", rough=0.9),
}

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

def canopy_clumps(lod):
    """(中心, 半径, 細かさ)。lod1 も同じ塊を粗く持つ (輪郭と鐘の位置を lod0 と揃える)"""
    cl = [((0.0, 0.0, 7.05), 2.45, 2, 1), ((0.25, -0.35, 8.0), 1.55, 2, 1)]
    for i in range(6):
        a = math.radians(15 + 60 * i)
        r = 2.75 + (0.25 if i % 2 else -0.1)
        z = 6.05 + (0.35 if i % 2 else -0.1)
        rad = 1.85 if i % 2 == 0 else 1.6
        cl.append(((r * math.cos(a), r * math.sin(a), z), rad, 2 if i % 2 == 0 else 1, 1 if i % 2 == 0 else 0))
    for i in range(3):
        a = math.radians(75 + 120 * i)
        cl.append(((1.75 * math.cos(a), 1.75 * math.sin(a), 7.85), 1.3, 1, 0))
    return [(Vector(c), r, s0 if lod == 0 else s1) for c, r, s0, s1 in cl]


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


def bell(node, p, lod, seed):
    rnd = random.Random(seed)
    stem = 0.14 + rnd.uniform(0, 0.12)
    top = p - Z * stem
    if lod == 0:
        node.add(K.tube([p, top], [0.018, 0.015], n=3, cap_start=False, cap_end=False), M["bark"])
        prof = [(0.0, 0.0), (0.13, -0.05), (0.155, -0.26), (0.27, -0.49), (0.0, -0.4)]  # 丸い肩と開いた裾
        node.add(K.lathe(prof, n=6, phase=rnd.uniform(0, 1)), M["bell"], matrix=K.trs(top), smooth=True)
    else:
        prof = [(0.0, 0.0), (0.26, -0.49), (0.0, -0.4)]
        node.add(K.lathe(prof, n=5), M["bell"], matrix=K.trs(top), smooth=True)


def mature(lod=0):
    name = "belltree_mature" if lod == 0 else "belltree_mature_lod1"
    n = K.Node(name)
    sides = 8 if lod == 0 else 6
    spine = [(0, 0, 0), (0.06, 0.02, 0.6), (0.12, 0.06, 1.7), (0.05, 0.12, 3.0), (-0.02, 0.06, 4.3), (0.0, 0.0, 5.6), (0.05, -0.05, 6.8)]
    radii = [0.8, 0.6, 0.5, 0.46, 0.4, 0.3, 0.18]
    if lod:
        spine, radii = spine[::2], radii[::2]
    bark_shade = K.shade_height(0, 2.0, 0.7, 1.0)
    n.add(K.tube(spine, radii, n=sides, cap_start=False), M["bark"], smooth=True, shade=bark_shade)
    roots = 5 if lod == 0 else 3
    for i in range(roots):
        a = math.radians(20 + 360 * i / roots)
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [d * 0.3 + Z * 1.1, d * 0.85 + Z * 0.32, d * 1.5 + Z * (-0.03)]
        n.add(K.tube(pts, [0.36, 0.24, 0.06], n=5 if lod == 0 else 4, tip=True, cap_start=False), M["bark"],
              smooth=True, shade=bark_shade)
    clumps = canopy_clumps(lod)
    branches = [(3.2, 30, 0), (3.6, 150, 1), (3.4, 270, 2), (4.2, 90, 3), (4.4, 210, 4)][: 5 if lod == 0 else 3]
    ring = [c for c in clumps if abs(c[0].z - 6.0) < 0.6]
    for z0, a, k in branches:
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        p0 = Vector((0.04, 0.06, z0))
        target = min(ring, key=lambda c: (Vector((c[0].x, c[0].y, 0)).normalized() - d).length)[0] if ring else p0 + d * 2
        p2 = p0.lerp(target, 0.85)
        p1 = p0 + (p2 - p0) * 0.45 + d * 0.45 - Z * 0.35
        n.add(K.tube([p0, p1, p2], [0.26, 0.16, 0.07], n=5 if lod == 0 else 4, tip=True, cap_start=False), M["bark"],
              smooth=True, shade=K.shade_const(0.92))
    rnd = random.Random(7)
    for i, (c, r, s) in enumerate(clumps):
        src = K.ico((r, r, r * 0.82), subdiv=s, jitter=(0.03, 0.07, 0.1)[s], seed=10 + i, flat_bottom=0.3)
        n.add(src, M["leaf"], matrix=K.trs(c, (0, 0, rnd.uniform(0, 360))), smooth=True,
              shade=K.shade_canopy(CANOPY_C, 2.6, lo=0.55, hi=1.0, warm=0.2), soft=(CANOPY_C, 0.55))
    bell_clumps = [(c, r, s) for c, r, s in canopy_clumps(0)]
    pts = bell_points(bell_clumps, 30, seed=11)
    print(f"  {name}: bells={len(pts)}")
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
    K.export_glb(objs, os.path.join(K.OUT_DIR, "belltree.glb"))
