"""集落の部品 (settlement) の観察画面用アセット → assets/models/observe/settlement.glb

ノード: hut (積み直した巨石の小屋、蔓と樹皮の屋根) / lantern_post (灯り柱、吊り灯籠が暖かく光る) /
slipway (舟を組む石の船台、~16 m) / stone_wall (低い空積みの石垣 4 m) / megalith (ムーの立石、シアンの継ぎ目が淡く光る)。
形は assets/textures/board/sheets/settlement.png、画風は creatures/ (丸めた角ばり・柔らかい量感・控えめなシアンの発光) に寄せる。
予算: hut 1,200〜2,000 / lantern_post ≤600 / slipway ≤1,500 / stone_wall ≤600 / megalith ≤800 三角形。
M22-06 で足したノード: woven_screen (二本の柱に張った編み繊維の衝立、≤400) / stone_wall_corner (L 字の空積みの石垣、≤800、
原点は L の外側の角)。lantern_post の灯籠に木の格子 (各面に X) を足した。

実行: blender -b --factory-startup --python tools/blender/observe_settlement.py
"""
import math
import os
import random
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402
from observe_kit import Y, Z  # noqa: E402
from observe_kit import X as X_AXIS  # noqa: E402

K.reset()

M = {
    "stone": K.material("settlement_stone", "#A3A194", rough=0.95),
    "moss": K.material("settlement_moss", "#8FA548", rough=0.95),
    "bark": K.material("settlement_bark", "#8E6240", rough=0.9),
    "wood": K.material("settlement_wood", "#A07A52", rough=0.9),
    "vine": K.material("settlement_vine", "#6E8235", rough=0.9),
    "straw": K.material("settlement_straw", "#C19C5E", rough=0.95),
    "lantern": K.material("settlement_lantern", "#FFC77A", rough=0.6, emit=K.BELL_AMBER, strength=2.5),
    "frame": K.material("settlement_frame", "#6A4A2F", rough=0.8),
    "rope": K.material("settlement_rope", "#B79E6E", rough=0.95),
    "glyph": K.material("settlement_glyph", "#8FF5E6", rough=0.5, emit=K.MU_CYAN, strength=1.5),
    "weave": K.material("settlement_weave", "#A8977A", rough=0.95, double=True),
    "bell": K.material("settlement_bell", "#7A4E2A", rough=0.5, emit=K.BELL_AMBER, strength=0.2),
    "bell_rim": K.material("settlement_bell_rim", "#FFD58F", rough=0.5, emit=K.BELL_AMBER, strength=3.0),
}


def stone_shade(mul, z0=0.0, z1=0.7):
    """石ごとの明るさ (mul) × 根元の陰り"""
    def f(co, n):
        t = min(1.0, max(0.0, (co.z - z0) / (z1 - z0)))
        v = mul * (0.72 + 0.28 * t)
        return (v, v * 0.995, v * 0.98)
    return f


def moss_on_top(chance, rnd, threshold=0.6):
    has = rnd.random() < chance
    return lambda c, n: M["moss"] if has and n.z > threshold else None


def stone(node, rnd, center, size, yaw=0.0, tilt=(0.0, 0.0), bevel=0.06, segments=1, jitter=0.03, taper=1.0,
          moss=0.0, base_z=False, mat="stone", z1=0.7):
    src = K.box(size, bevel=bevel, segments=segments, jitter=jitter, seed=rnd.randrange(1 << 30), taper=taper, base_z=base_z)
    mul = rnd.uniform(0.84, 1.0)
    return node.add(src, M[mat], matrix=K.trs(center, (tilt[0], tilt[1], yaw)), smooth=False,
                    shade=stone_shade(mul, 0.0, z1), per_face_mat=moss_on_top(moss, rnd))


def frame(x_axis, y_axis, origin):
    """ローカル X/Y 軸を与えた置き方 (Z は外積)"""
    x = Vector(x_axis).normalized()
    y = Vector(y_axis).normalized()
    z = x.cross(y).normalized()
    y = z.cross(x).normalized()
    m = Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))
    m.translation = Vector(origin)
    return m


# ---------------------------------------------------------------- 小屋

RIDGE_Z, EAVE_X, EAVE_Z = 3.35, 2.15, 1.95


def roof_point(s, u, y, lift=0.0):
    """屋根面の点。s=±1 は面の側、u=0 棟 → 1 軒"""
    nrm = Vector((s * (RIDGE_Z - EAVE_Z), 0, EAVE_X)).normalized()
    return Vector((s * EAVE_X * u, y, RIDGE_Z - (RIDGE_Z - EAVE_Z) * u)) + nrm * lift, nrm


def hut():
    n = K.Node("hut")
    rnd = random.Random(101)
    # 床の敷き藁と入口の敷石
    n.add(K.box((2.9, 2.4, 0.05), jitter=0.01, seed=1), M["straw"], matrix=K.trs((0, 0.05, 0.025)), shade=K.shade_const(0.95))
    stone(n, rnd, (0.0, -1.55, 0.04), (1.0, 0.7, 0.08), yaw=4, bevel=0.03)
    # 四隅の巨石の柱
    for sx in (-1, 1):
        for sy in (-1, 1):
            stone(n, rnd, (sx * 1.5, sy * 1.25, 0), (0.52, 0.5, 2.42), yaw=rnd.uniform(-8, 8),
                  tilt=(rnd.uniform(-2, 2), rnd.uniform(-2, 2)), bevel=0.11, jitter=0.03, taper=0.86, moss=0.8,
                  base_z=True, z1=1.4)
    # 空積みの低い壁 (後ろ・左右・入口の両脇)、2 段
    courses = [(0.0, 0.36), (0.36, 0.32)]
    for ci, (z0, h) in enumerate(courses):
        off = 0.3 * ci
        xs = [-0.95 + off, -0.3 + off, 0.35 + off][: 3] if ci else [-0.95, -0.32, 0.32, 0.95]
        for x in xs:
            stone(n, rnd, (x, 1.3, z0 + h / 2), (0.62, 0.36, h), yaw=rnd.uniform(-5, 5), bevel=0.05, moss=0.5 if ci else 0)
        for sx in (-1, 1):
            ys = [-0.6 + off, 0.15 + off] if ci else [-0.7, 0.0, 0.7]
            for y in ys:
                stone(n, rnd, (sx * 1.55, y, z0 + h / 2), (0.36, 0.66, h), yaw=rnd.uniform(-5, 5), bevel=0.05,
                      moss=0.5 if ci else 0)
            stone(n, rnd, (sx * 0.98, -1.3, z0 + h / 2), (0.55, 0.36, h), yaw=rnd.uniform(-6, 6), bevel=0.05,
                  moss=0.5 if ci else 0)
    # 柱の上の梁
    for sx in (-1, 1):
        n.add(K.tube([(sx * 1.5, -1.85, 2.42), (sx * 1.5, 1.85, 2.44)], [0.1, 0.1], n=6), M["wood"],
              smooth=True, shade=K.shade_const(0.9))
    # 屋根の下地と樹皮の板
    for s in (-1, 1):
        p, nrm = roof_point(s, 0.5, 0.0)
        down = Vector((s * EAVE_X, 0, -(RIDGE_Z - EAVE_Z))).normalized()
        slope_len = Vector((EAVE_X, 0, RIDGE_Z - EAVE_Z)).length
        n.add(K.box((slope_len * 1.02, 3.9, 0.06)), M["bark"], matrix=frame(down, Y, p), shade=K.shade_const(0.62))
        for r, u in enumerate((0.22, 0.52, 0.82)):
            for c in range(5):
                y = -1.6 + 0.8 * c + (0.4 if r % 2 else 0) + rnd.uniform(-0.05, 0.05)
                if abs(y) > 1.85:
                    continue
                q, _ = roof_point(s, u, y, lift=0.07 + 0.015 * (2 - r))
                ang = math.radians(rnd.uniform(-7, 7))
                side = (Y * math.cos(ang) + down * math.sin(ang)).normalized()
                src = K.box((slope_len * 0.4, 0.84, 0.06), jitter=0.02, seed=rnd.randrange(1 << 30))
                n.add(src, M["bark"], matrix=frame(down, side, q), shade=K.shade_const(rnd.uniform(0.78, 1.0)))
    # 棟の丸太と、妻の交差した竿
    n.add(K.tube([(0, -2.05, RIDGE_Z + 0.1), (0, 2.05, RIDGE_Z + 0.1)], [0.13, 0.13], n=6), M["wood"], smooth=True)
    for y in (-1.95, 1.95):
        for s in (-1, 1):
            a = Vector((s * (EAVE_X + 0.1), y, EAVE_Z - 0.08))
            b = Vector((-s * 0.45, y, RIDGE_Z + 0.42))
            n.add(K.tube([a, b], [0.07, 0.06], n=5), M["wood"], smooth=True, shade=K.shade_const(0.9))
    # 屋根にかかる蔓と葉
    for k, y0 in enumerate((-1.3, 0.2, 1.35)):
        pts = []
        for s, us in ((-1, (1.05, 0.7, 0.35)), (1, (0.0, 0.35, 0.7, 1.05))):
            for u in us:
                y = y0 + 0.35 * math.sin(u * 5 + k * 1.7 + s)
                q, _ = roof_point(s, u, y, lift=0.13)
                pts.append(q)
        pts.insert(0, pts[0] - Z * 0.55)
        pts.append(pts[-1] - Z * (0.4 + 0.2 * k))
        n.add(K.tube(pts, [0.04] * (len(pts) - 1) + [0.02], n=4, cap_start=False), M["vine"], smooth=True)
        for j in (2, 5):
            d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0.8)).normalized()
            m = K.aim(d)
            m.translation = pts[j]
            n.add(K.leaf(0.28, 0.18, 0.03, bend=0.2), M["vine"], matrix=m, smooth=True, soft=(pts[j] - Z * 0.3, 0.4))
    return n


# ---------------------------------------------------------------- 灯り柱

def lantern_post():
    n = K.Node("lantern_post")
    rnd = random.Random(202)
    stone(n, rnd, (0, 0, 0), (0.44, 0.4, 2.3), yaw=3, bevel=0.1, segments=2, jitter=0.02, taper=0.82, moss=1.0,
          base_z=True, z1=1.2)
    for a in (40, 210):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        stone(n, rnd, d * 0.38 + Z * 0.08, (0.34, 0.3, 0.2), yaw=a, bevel=0.05, moss=0.6)
    # 腕木 (石の張り出し) と吊り紐
    stone(n, rnd, (0.36, 0, 1.98), (0.62, 0.16, 0.16), yaw=0, bevel=0.03, jitter=0.01, z1=3)
    n.add(K.tube([(0.6, 0, 1.9), (0.6, 0, 1.76)], [0.012, 0.012], n=3), M["rope"])
    # 灯籠: 六角の屋根・光る胴・台
    prof = [(0.0, 1.8), (0.06, 1.77), (0.26, 1.64), (0.2, 1.6), (0.18, 1.58), (0.18, 1.22), (0.22, 1.19), (0.19, 1.13), (0.0, 1.13)]

    def lantern_mat(c, nrm):
        return M["lantern"] if 1.2 < c.z < 1.59 and abs(nrm.z) < 0.5 else None
    n.add(K.lathe(prof, n=6, phase=math.radians(30)), M["frame"], matrix=K.trs((0.6, 0, 0)), smooth=False,
          per_face_mat=lantern_mat)
    for i in range(6):
        a = math.radians(60 * i + 30)
        p = Vector((0.6 + 0.188 * math.cos(a), 0.188 * math.sin(a), 0))
        n.add(K.tube([p + Z * 1.2, p + Z * 1.6], [0.018, 0.018], n=3, cap_start=False, cap_end=False), M["frame"])
    # 灯籠の格子: 六つの面それぞれに X に組んだ細い木 (基準画の格子)
    apo = 0.18 * math.cos(math.radians(30)) + 0.012
    diag = math.degrees(math.atan2(0.36, 0.18))
    for i in range(6):
        a = math.radians(60 * i)
        c = (0.6 + apo * math.cos(a), apo * math.sin(a), 1.4)
        for sgn in (-1, 1):
            n.add(K.box((0.4, 0.018, 0.022)), M["frame"], matrix=K.trs(c, (0, sgn * diag, 60 * i + 90)),
                  shade=K.shade_const(0.9))
    return n


# ---------------------------------------------------------------- 船台

SLIP_L, SLIP_W = 16.0, 4.4


def slip_z(y):
    return 0.25 + (y + SLIP_L / 2) / SLIP_L * 0.9


def slipway():
    n = K.Node("slipway")
    rnd = random.Random(303)
    ang = math.degrees(math.atan2(0.9, SLIP_L))
    # 土台の楔
    import bmesh
    bm = bmesh.new()
    hw, hl = SLIP_W / 2 - 0.2, SLIP_L / 2
    v = [bm.verts.new(p) for p in ((-hw, -hl, 0), (hw, -hl, 0), (hw, hl, 0), (-hw, hl, 0),
                                   (-hw, -hl, slip_z(-hl) - 0.1), (hw, -hl, slip_z(-hl) - 0.1),
                                   (hw, hl, slip_z(hl) - 0.1), (-hw, hl, slip_z(hl) - 0.1))]
    for f in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
        bm.faces.new([v[i] for i in f])
    n.add(bm, M["stone"], shade=K.shade_const(0.62))
    # 敷石 (8 列 × 3)
    rows = 8
    for r in range(rows):
        y = -hl + (r + 0.5) * SLIP_L / rows
        for c, x in enumerate((-1.05, 0.0, 1.05)):
            xx = x + rnd.uniform(-0.04, 0.04) + (0.2 if r % 2 and c == 1 else 0)
            stone(n, rnd, (xx, y, slip_z(y) - 0.06), (1.0, SLIP_L / rows - 0.08, 0.18), yaw=rnd.uniform(-1.5, 1.5),
                  tilt=(ang, 0), bevel=0.0, jitter=0.025, moss=0.06, z1=1.4)
    # 両脇の縁石 (6 個ずつ) と上端の柱石・壁
    for sx in (-1, 1):
        for k in range(6):
            y = -hl + (k + 0.5) * SLIP_L / 6
            stone(n, rnd, (sx * (SLIP_W / 2 - 0.1), y, slip_z(y) + 0.02), (0.6, SLIP_L / 6 - 0.1, 0.62), yaw=rnd.uniform(-2, 2),
                  tilt=(ang, rnd.uniform(-2, 2)), bevel=0.08, jitter=0.03, moss=0.3, z1=1.6)
        stone(n, rnd, (sx * (SLIP_W / 2 - 0.1), hl + 0.1, 0), (0.85, 0.85, 1.75), yaw=rnd.uniform(-4, 4), bevel=0.08,
              jitter=0.03, taper=0.88, moss=0.9, base_z=True, z1=1.6)
    for x in (-0.8, 0.8):
        stone(n, rnd, (x, hl + 0.2, 0), (1.5, 0.6, 1.2), yaw=rnd.uniform(-3, 3), bevel=0.07, moss=0.5, base_z=True, z1=1.4)
    # 竜骨を受ける木の盤木と、左右の滑り材
    for k in range(6):
        y = -hl + 1.6 + k * 2.55
        n.add(K.box((0.9, 0.45, 0.28), bevel=0.0, jitter=0.015, seed=k), M["wood"],
              matrix=K.trs((0, y, slip_z(y) + 0.15), (ang, 0, rnd.uniform(-3, 3))), shade=K.shade_const(rnd.uniform(0.8, 0.95)))
    for x in (-0.75, 0.75):
        n.add(K.tube([(x, -hl + 0.4, slip_z(-hl + 0.4) + 0.12), (x, hl - 0.4, slip_z(hl - 0.4) + 0.12)], [0.1, 0.1], n=6),
              M["wood"], smooth=True, shade=K.shade_const(0.85))
    return n


# ---------------------------------------------------------------- 石垣

def stone_wall():
    n = K.Node("stone_wall")
    rnd = random.Random(404)
    L = 4.0
    for k in range(5):
        x = -L / 2 + (k + 0.5) * L / 5
        stone(n, rnd, (x + rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 0.2), (L / 5 - 0.05, 0.56, 0.4),
              yaw=rnd.uniform(-4, 4), bevel=0.08, jitter=0.03)
    for k in range(4):
        x = -L / 2 + 0.4 + (k + 0.5) * (L - 0.8) / 4 - 0.35
        stone(n, rnd, (x, rnd.uniform(-0.03, 0.03), 0.57), ((L - 0.8) / 4 - 0.06, 0.46, 0.34),
              yaw=rnd.uniform(-5, 5), tilt=(rnd.uniform(-3, 3), rnd.uniform(-3, 3)), bevel=0.08, jitter=0.03, moss=0.7)
    stone(n, rnd, (L / 2 - 0.3, 0, 0), (0.62, 0.62, 0.92), yaw=rnd.uniform(-5, 5), bevel=0.07, jitter=0.02, taper=0.9,
          moss=0.9, base_z=True, z1=0.9)
    return n


# ---------------------------------------------------------------- ムーの立石

def megalith():
    """一本の立石を 3 つに割って積み直したもの。割れ目が淡いシアンに光り (月鹿の装甲の継ぎ目と同じ意匠)、
    上の石の正面に六角の紋 (土兎の紋と同じ意匠)。字や人の形に見えないよう、線は継ぎ目と紋だけにする"""
    n = K.Node("megalith")
    rnd = random.Random(505)
    for z, w, d in ((1.37, 1.0, 0.6), (2.56, 0.92, 0.54)):  # 割れ目を満たす光る薄板 (四方から継ぎ目として見える)
        n.add(K.box((w, d, 0.07)), M["glyph"], matrix=K.trs((0.04, 0.0, z)))
    # (中心, 大きさ, yaw, 先細り, 傾き, 上面の傾き)
    blocks = [((0, 0, 0.0), (1.15, 0.72, 1.35), 0, 0.96, 0.0, 0.05),
              ((0.03, 0.0, 1.39), (1.08, 0.68, 1.15), 3, 0.92, 1.2, -0.06),
              ((0.06, 0.02, 2.58), (0.97, 0.6, 0.95), -2, 0.72, -1.5, 0.38)]
    for c, size, yaw, taper, tilt, shear in blocks:
        src = K.box(size, bevel=0.1, segments=2, jitter=0.02, seed=rnd.randrange(1 << 30), taper=taper, base_z=True,
                    shear=shear)
        n.add(src, M["stone"], matrix=K.trs(c, (0, tilt, yaw)), shade=stone_shade(rnd.uniform(0.9, 1.0), 0.0, 2.2),
              per_face_mat=moss_on_top(0.9 if shear > 0.2 else 0.0, rnd, threshold=0.75))

    def front(z):
        """その高さの正面 (−Y) の面の y (先細りを近似)"""
        for (_, _, z0), (_, dep, h), _, taper, _, _ in blocks:
            if z0 <= z <= z0 + h + 0.02:
                return -dep / 2 * (1 - (1 - taper) * (z - z0) / h)
        return -0.3

    def seam(a, b, w=0.035):
        a, b = Vector(a), Vector(b)
        mid = (a + b) / 2
        d = b - a
        m = K.aim(Vector((d.x, 0, d.z)), up=-Y)
        m.translation = Vector((mid.x, front(mid.z) + 0.012, mid.z))
        n.add(K.box((d.length + w, w, 0.07)), M["glyph"], matrix=m)  # aim(up=-Y): X=線の向き, Y=面内の幅, Z=奥行き
    # 六角の紋 (上の石)
    cz, r = 2.95, 0.17
    hexv = [(0.05 + r * math.cos(math.radians(90 + 60 * i)), cz + r * math.sin(math.radians(90 + 60 * i))) for i in range(6)]
    for i in range(6):
        (x0, z0), (x1, z1) = hexv[i], hexv[(i + 1) % 6]
        seam((x0, 0, z0), (x1, 0, z1))
    # 根元の割れ石
    for i in range(4):
        a = math.radians(30 + 90 * i + rnd.uniform(-15, 15))
        d = Vector((math.cos(a), math.sin(a), 0))
        stone(n, rnd, d * 0.85 + Z * 0.08, (0.45, 0.38, 0.28), yaw=math.degrees(a), tilt=(rnd.uniform(-10, 10), 0),
              bevel=0.06, jitter=0.03, moss=0.8)
    return n


# ---------------------------------------------------------------- 編んだ衝立 (M22-06)

def woven_screen():
    """二本の柱 (束ねた枝) の間に、横 5・縦 6 の繊維の帯を上下に編んだ衝立。四隅を縄で括り、蔓と小さな鐘を 2 つ下げる。
    面は X 方向 (幅 2 m)、正面は −Y"""
    n = K.Node("woven_screen")
    rnd = random.Random(606)
    for sx in (-1, 1):
        x = sx * 0.95
        n.add(K.tube([(x, 0, -0.05), (x + sx * 0.02, 0, 1.0), (x, 0, 2.02)], [0.065, 0.058, 0.045], n=5), M["wood"],
              smooth=True, shade=K.shade_height(0, 1.0, 0.75, 1.0))
        n.add(K.tube([(x + sx * 0.08, 0.03, -0.05), (x + sx * 0.1, 0.02, 1.86)], [0.035, 0.025], n=3), M["wood"],
              smooth=True, shade=K.shade_const(0.85))  # 束ねた細い枝
    for z in (0.42, 1.78):
        n.add(K.tube([(-1.0, 0, z), (1.0, 0, z + rnd.uniform(-0.03, 0.03))], [0.04, 0.04], n=4), M["wood"],
              shade=K.shade_const(0.9))
    import bmesh
    H = [0.56 + 0.26 * k for k in range(5)]   # 横の帯の高さ
    V = [-0.72 + 0.288 * k for k in range(6)]  # 縦の帯の位置

    def ribbon(pts, width_dir, shade, w):
        bm = bmesh.new()
        rows = [(bm.verts.new(p - width_dir * w / 2), bm.verts.new(p + width_dir * w / 2)) for p in pts]
        for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
            bm.faces.new((a0, b0, b1, a1))
        n.add(bm, M["weave"], smooth=True, recalc=False, shade=shade)
    for k, z in enumerate(H):
        xs = [-0.9] + V + [0.9]
        pts = [Vector((x, (0.018 if (j + k) % 2 else -0.018) if 0 < j < len(xs) - 1 else 0.0, z)) for j, x in enumerate(xs)]
        ribbon(pts, Z, K.shade_const(rnd.uniform(0.85, 1.0)), 0.2)
    for k, x in enumerate(V):
        zs = [0.44] + H + [1.76]
        pts = [Vector((x, (-0.018 if (j + k) % 2 else 0.018) if 0 < j < len(zs) - 1 else 0.0, z)) for j, z in enumerate(zs)]
        ribbon(pts, X_AXIS, K.shade_const(rnd.uniform(0.75, 0.9)), 0.18)
    for sx in (-1, 1):  # 四隅の括り縄
        for z in (0.42, 1.78):
            n.add(K.lathe([(0.075, -0.05), (0.075, 0.05)], n=4, cap_top=False, cap_bottom=False), M["rope"],
                  matrix=K.trs((sx * 0.95, 0, z)), shade=K.shade_const(0.9))
    vine = [(-0.95, -0.06, 1.95), (-0.55, -0.07, 1.62), (-0.1, -0.06, 1.7), (0.3, -0.07, 1.35), (0.55, -0.06, 0.9)]
    n.add(K.tube(vine, [0.028] * 4 + [0.015], n=3), M["vine"], smooth=True)
    m = K.aim(Vector((0.4, -0.5, 0.6)))
    m.translation = Vector(vine[2])
    n.add(K.leaf(0.24, 0.15, 0.025, bend=0.2), M["vine"], matrix=m, smooth=True)
    for x, z in ((-0.5, 1.78), (0.45, 1.78)):  # 上の横木に吊った小さな鐘
        top = Vector((x, -0.05, z - 0.14))
        n.add(K.tube([top + Z * 0.12, top], [0.008, 0.008], n=3, cap_start=False, cap_end=False), M["rope"])
        prof = [(0.0, 0.0), (0.05, -0.06), (0.07, -0.12), (0.0, -0.09)]
        n.add(K.lathe(prof, n=5), M["bell"], matrix=K.trs(top), smooth=True,
              per_face_mat=lambda c, nrm, t=top: M["bell_rim"] if c.z - t.z < -0.09 else None)
    return n


# ---------------------------------------------------------------- L 字の石垣 (M22-06)

def stone_wall_corner():
    """L 字に曲がる 2 段の空積みの石垣。腕 A は +X へ 3 m、腕 B は +Y へ 2.4 m、原点は L の外側の角。
    角と腕 A の端に太い立石 (端の石の正面に浅く彫った六角の枠)"""
    n = K.Node("stone_wall_corner")
    rnd = random.Random(707)
    T = 0.55  # 壁の厚み
    # 角の立石
    stone(n, rnd, (T / 2, T / 2, 0), (0.72, 0.72, 0.98), yaw=rnd.uniform(-4, 4), bevel=0.08, jitter=0.02, taper=0.9,
          moss=1.0, base_z=True, z1=0.9)
    # 腕 A (+X)
    LA0, LA1 = 0.62, 2.7
    for k in range(3):
        x = LA0 + (k + 0.5) * (LA1 - LA0) / 3
        stone(n, rnd, (x, T / 2 + rnd.uniform(-0.03, 0.03), 0.2), ((LA1 - LA0) / 3 - 0.05, T, 0.4),
              yaw=rnd.uniform(-4, 4), bevel=0.08, jitter=0.03)
    for k in range(3):
        x = LA0 + 0.1 + (k + 0.5) * (LA1 - LA0 - 0.2) / 3
        stone(n, rnd, (x, T / 2, 0.57), ((LA1 - LA0 - 0.2) / 3 - 0.06, T - 0.1, 0.34),
              yaw=rnd.uniform(-5, 5), tilt=(rnd.uniform(-3, 3), rnd.uniform(-3, 3)), bevel=0.08, jitter=0.03, moss=0.7)
    end = (LA1 + 0.3, T / 2, 0)
    stone(n, rnd, end, (0.6, 0.64, 0.92), yaw=rnd.uniform(-3, 3), bevel=0.07, jitter=0.02, taper=0.9, moss=0.9,
          base_z=True, z1=0.9)
    # 腕 B (+Y)
    LB0, LB1 = 0.62, 2.4
    for k in range(3):
        y = LB0 + (k + 0.5) * (LB1 - LB0) / 3
        stone(n, rnd, (T / 2 + rnd.uniform(-0.03, 0.03), y, 0.2), (T, (LB1 - LB0) / 3 - 0.05, 0.4),
              yaw=rnd.uniform(-4, 4), bevel=0.08, jitter=0.03)
    for k in range(2):
        y = LB0 + 0.15 + (k + 0.5) * (LB1 - LB0 - 0.5) / 2
        stone(n, rnd, (T / 2, y, 0.57), (T - 0.1, (LB1 - LB0 - 0.5) / 2 - 0.06, 0.34),
              yaw=rnd.uniform(-5, 5), tilt=(rnd.uniform(-3, 3), rnd.uniform(-3, 3)), bevel=0.08, jitter=0.03, moss=0.7)
    stone(n, rnd, (T / 2 + 0.05, LB1 - 0.2, 0.46), (0.4, 0.36, 0.14), yaw=20, bevel=0.0, jitter=0.03, z1=0.6)  # 崩れかけた天端の石
    # 端の立石の正面 (−Y) に浅く彫った六角の枠 (光らない、影になった溝)
    for i in range(6):
        a0, a1 = math.radians(90 + 60 * i), math.radians(150 + 60 * i)
        p0 = Vector((end[0] + 0.14 * math.cos(a0), 0.0, 0.55 + 0.14 * math.sin(a0)))
        p1 = Vector((end[0] + 0.14 * math.cos(a1), 0.0, 0.55 + 0.14 * math.sin(a1)))
        d = p1 - p0
        m = K.aim(d, up=-Y)
        m.translation = (p0 + p1) / 2 + Vector((0, T / 2 - 0.32 - 0.004, 0))
        n.add(K.box((d.length + 0.03, 0.03, 0.02)), M["stone"], matrix=m, shade=K.shade_const(0.45))
    for i in range(2):  # 足元の落ちた石
        stone(n, rnd, (1.2 + 0.8 * i, -0.35 - 0.1 * i, 0.08), (0.3, 0.26, 0.16), yaw=rnd.uniform(0, 90), bevel=0.0,
              jitter=0.03, moss=0.5)
    return n


if __name__ == "__main__":
    nodes = [hut(), lantern_post(), slipway(), stone_wall(), megalith(), woven_screen(), stone_wall_corner()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "settlement.glb"))
