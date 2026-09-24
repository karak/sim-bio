"""集落の部品 (settlement) の観察画面用アセット → assets/models/observe/settlement.glb

ノード: hut (積み直した巨石の小屋、蔓と樹皮の屋根) / lantern_post (灯り柱、吊り灯籠が暖かく光る) /
slipway (舟を組む石の船台、~16 m) / stone_wall (低い空積みの石垣 4 m) / megalith (ムーの立石、シアンの継ぎ目が淡く光る)。
形は assets/textures/board/sheets/settlement.png、画風は creatures/ (丸めた角ばり・柔らかい量感・控えめなシアンの発光) に寄せる。
予算: hut 1,200〜2,000 / lantern_post ≤600 / slipway ≤1,500 / stone_wall ≤600 / megalith ≤800 三角形。
M22-06 で足したノード: woven_screen (二本の柱に張った編み繊維の衝立、≤400) / stone_wall_corner (L 字の空積みの石垣、≤800、
原点は L の外側の角)。lantern_post の灯籠に木の格子 (各面に X) を足した。
(M22-06 試作 2 の判断「船は大きく、立派な感じがほしい」で slipway を 27 × 7.6 m に広げた (≤2,500 三角形)。他のノードは変えない。

(集落の建物の作り直し (M22-06、ユーザーの判断「集落の建物も最終的にはこの水準を超えたい」) で変更:
 hut を作り直し (手で割った屋根板の段・垂木と桁と縛り縄・石の段・戸口と敷石・炉と熾火・薪・干し棚・籠・壺・鐘・吊り灯籠・
 蔓と苔・柱に刻んだ六角の紋・斜面の土台)、≤ 7,000 三角形。遠景用の hut_lod1 (≤ 1,200) を用意した (ゲーム側の切り替えは
 三角形を減らす段で)。戸口から広場へ下りる敷石 stepping_stone (ゲーム側が斜面に沿って 1 枚ずつ置く) を足した。
 lantern_post は基準画どおり四角の灯籠 (四面に X の木の格子) と太い石の腕木に、stone_wall / stone_wall_corner は 3 段の石に、
 stone_wall_corner の端の石の紋を彫り込んだ枠に、woven_screen は束ねた柱・細かい編み目・縁に並べた小さな鐘にした。
 slipway と megalith は変えない)

実行: blender -b --factory-startup --python tools/blender/observe_settlement.py
"""
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402
from observe_kit import Y, Z  # noqa: E402
from observe_kit import X as X_AXIS  # noqa: E402
from lowpoly_kit import hex_rgb  # noqa: E402

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
    # (集落の建物の作り直しで追加) 屋根板は白の材質に色ごと頂点色で載せる (板ごとに茶・灰・苔を混ぜる)。
    # 炉の熾火 (暖かく光る)、焦げた薪、薪の切り口、素焼きの壺、干した草
    "roof": K.material("settlement_roof", "#FFFFFF", rough=0.9),
    "ember": K.material("settlement_ember", "#FFB070", rough=0.6, emit="#FF9A48", strength=3.0),
    "char": K.material("settlement_char", "#4A3A30", rough=0.95),
    "cut": K.material("settlement_cut", "#D9BC8C", rough=0.9),
    "clay": K.material("settlement_clay", "#A8704A", rough=0.9),
    "herb": K.material("settlement_herb", "#A3A060", rough=0.95),
    # (集落の建物の作り直しで追加) 石も白の材質に色ごと頂点色で載せる (石ごとの色のゆらぎ・根元から這い上がる苔・目地の陰り)
    "stone_paint": K.material("settlement_stone_paint", "#FFFFFF", rough=0.95),
}


def stone_shade(mul, z0=0.0, z1=0.7):
    """石ごとの明るさ (mul) × 根元の陰り"""
    def f(co, n):
        t = min(1.0, max(0.0, (co.z - z0) / (z1 - z0)))
        v = mul * (0.72 + 0.28 * t)
        return (v, v * 0.995, v * 0.98)
    return f


STONE_LIN = hex_rgb("#A3A194")
STONE_WARM, STONE_COOL = hex_rgb("#AFA38E"), hex_rgb("#959CA0")
MOSS_LIN = hex_rgb("#7E9A46")


def stone_paint(mul, hue, seed, z1=0.7, moss_z=0.45):
    """(集落の建物の作り直しで追加) 白の材質に載せる石の色: 石ごとに暖かい灰と冷たい灰の間で揺らし、根元の陰り、
    地面から moss_z までは苔が這い上がる (位置でむらを付ける)。石の縁 (横向きの面の下) は少し暗い"""
    base = tuple(STONE_LIN[i] + (STONE_WARM[i] - STONE_LIN[i]) * max(0.0, hue) + (STONE_COOL[i] - STONE_LIN[i]) * max(0.0, -hue)
                 for i in range(3))

    def f(co, n):
        t = min(1.0, max(0.0, co.z / z1))
        v = mul * (0.72 + 0.28 * t)
        m = min(1.0, max(0.0, (moss_z - co.z) / moss_z)) * (0.55 + 0.45 * math.sin(co.x * 4.1 + co.y * 3.3 + seed) ** 2)
        m *= 0.7 + 0.3 * max(0.0, n.z)
        return tuple((base[i] * (1 - m) + MOSS_LIN[i] * m) * v for i in range(3))
    return f


def pstone(*a, **k):
    """(集落の建物の作り直しで追加) stone(paint=True)"""
    return stone(*a, paint=True, **k)


def moss_on_top(chance, rnd, threshold=0.6):
    has = rnd.random() < chance
    return lambda c, n: M["moss"] if has and n.z > threshold else None


def stone(node, rnd, center, size, yaw=0.0, tilt=(0.0, 0.0), bevel=0.06, segments=1, jitter=0.03, taper=1.0,
          moss=0.0, base_z=False, mat="stone", z1=0.7, ao=None, shear=0.0, paint=False):
    # (集落の建物の作り直しで追加) ao(co, n) -> 乗数 で軒の下・小屋の中の陰りを掛ける。shear で頭を斜めに割る。
    # paint=True で stone_paint (白の材質) に色ごと載せる (石ごとの色のゆらぎ・根元の苔)
    src = K.box(size, bevel=bevel, segments=segments, jitter=jitter, seed=rnd.randrange(1 << 30), taper=taper, base_z=base_z,
                shear=shear)
    mul = rnd.uniform(0.84, 1.0)
    shade = stone_shade(mul, 0.0, z1)
    if paint:
        mat = "stone_paint"
        shade = stone_paint(mul, rnd.uniform(-1, 1), rnd.uniform(0, 6.3), z1)
    if ao is not None:
        base = shade
        shade = lambda co, n: tuple(c * ao(co, n) for c in base(co, n))  # noqa: E731
    return node.add(src, M[mat], matrix=K.trs(center, (tilt[0], tilt[1], yaw)), smooth=False,
                    shade=shade, per_face_mat=moss_on_top(moss, rnd))


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

# (集落の建物の作り直しで変更: 元の hut は遠景用の hut_lod1 にし、下の 3 つの数は作り直した hut と同じ輪郭
#  (棟 4.3 m、軒の出 2.55 m、軒 1.95 m) にした。元は 3.35, 2.15, 1.95)
RIDGE_Z, EAVE_X, EAVE_Z = 4.3, 2.55, 1.95


def roof_point(s, u, y, lift=0.0):
    """屋根面の点。s=±1 は面の側、u=0 棟 → 1 軒"""
    nrm = Vector((s * (RIDGE_Z - EAVE_Z), 0, EAVE_X)).normalized()
    return Vector((s * EAVE_X * u, y, RIDGE_Z - (RIDGE_Z - EAVE_Z) * u)) + nrm * lift, nrm


def hut_lod1():
    # (集落の建物の作り直しで変更: 遠景用 (ゲーム側の切り替えは三角形を減らす段で)。作り直した hut と同じ輪郭 (柱・3 段の壁・
    #  屋根板の段・棟・妻の竿・炉と吊り灯籠の光・薪・斜面の土台) を、面取りの無い石と段ごとの 1 枚の板で組む。≤ 1,200 三角形)
    n = K.Node("hut_lod1")
    rnd = random.Random(101)
    # 床の敷き藁と入口の敷石
    n.add(K.box((2.95, 2.55, 0.07), jitter=0.01, seed=1), M["straw"], matrix=K.trs((0, 0.02, H_G + 0.02)),
          shade=K.shade_const(0.7))
    # (集落の建物の作り直しで変更: 入口の敷石はゲーム側が stepping_stone を地面に置く。代わりに hut と同じ斜面の土台)
    for (cx, cy, sx_, sy_) in ((0, H_PY, 3.0, 0.5), (0, -H_PY, 3.0, 0.5), (-H_PX, 0, 0.5, 2.5), (H_PX, 0, 0.5, 2.5)):
        pstone(n, rnd, (cx, cy, -0.48), (sx_, sy_, 1.0), bevel=0.0, jitter=0.03, z1=0.2, ao=hut_ao)
    # 四隅の巨石の柱
    for sx in (-1, 1):
        for sy in (-1, 1):
            pstone(n, rnd, (sx * H_PX, sy * H_PY, -0.9), (0.58, 0.54, H_POST + 1.02), yaw=rnd.uniform(-6, 6), bevel=0.0,
                  jitter=0.02, taper=0.9, moss=0.8, base_z=True, z1=1.6, ao=hut_ao)
    # 空積みの低い壁 (後ろ・左右・入口の両脇)、2 段
    # (集落の建物の作り直しで変更: hut と同じ 3 段。段ごとに 2 つの長い石)
    courses = [(0.0, 0.42), (0.42, 0.3), (0.72, 0.27)]
    for ci, (z0, h) in enumerate(courses):
        off = 0.12 * (ci % 2)
        for x in (-0.68 + off, 0.68 + off):
            pstone(n, rnd, (x, H_PY, z0 + h / 2), (1.3, 0.42, h), yaw=rnd.uniform(-3, 3), bevel=0.0, moss=0.7 if ci == 2 else 0,
                  ao=hut_ao)
        for sx in (-1, 1):
            for y in (-0.58 + off, 0.58 + off):
                pstone(n, rnd, (sx * H_PX, y, z0 + h / 2), (0.42, 1.12, h), yaw=rnd.uniform(-3, 3), bevel=0.0,
                      moss=0.7 if ci == 2 else 0, ao=hut_ao)
            if ci < 2:
                pstone(n, rnd, (sx * 1.0, -H_PY, z0 + h / 2), (0.7, 0.42, h), yaw=rnd.uniform(-4, 4), bevel=0.0,
                      moss=0.7 if ci == 1 else 0, ao=hut_ao)
    # 柱の上の梁
    for sx in (-1, 1):
        n.add(K.tube([(sx * H_PX, -H_PY - 0.35, H_BEAM), (sx * H_PX, H_PY + 0.35, H_BEAM)], [0.1, 0.1], n=5), M["wood"],
              smooth=True, shade=K.shade_const(0.8))
    n.add(K.tube([(-H_PX - 0.3, -H_PY, H_BEAM), (H_PX + 0.3, -H_PY, H_BEAM)], [0.09, 0.09], n=5), M["wood"], smooth=True,
          shade=K.shade_const(0.8))
    # 屋根の下地と樹皮の板
    # (集落の建物の作り直しで変更: 樹皮の板は、段ごとに 1 枚の長い板 (hut の屋根板の 6 段と同じ間隔)。板の縁が段の影の線になる)
    for s in (-1, 1):
        p, nrm = roof_point(s, 0.5, 0.0)
        down = Vector((s * EAVE_X, 0, -(RIDGE_Z - EAVE_Z))).normalized()
        slope_len = Vector((EAVE_X, 0, RIDGE_Z - EAVE_Z)).length
        n.add(K.box((slope_len * 1.02, 2 * H_YR, 0.06)), M["bark"], matrix=frame(down, Y * s, p), shade=K.shade_const(0.5))
        for r in range(6):
            ab = slope_len + 0.14 - r * 0.6
            ah = max(ab - 0.92, 0.02)
            q, _ = roof_point(s, (ab + ah) / 2 / slope_len, 0.0, lift=0.07 + 0.012 * (r % 2))
            g = 0.15 + 0.1 * r
            col = tuple(lin(ROOF_BASE)[i] * (1 - g) + lin(ROOF_GREY)[i] * g for i in range(3))
            m_amt = (0.5, 0.28, 0.1, 0.05, 0.08, 0.14)[r] * 0.8

            def f(co, nr, col=col, m_amt=m_amt, nrm=nrm):
                v = 1.0 if nr.dot(nrm) > 0.5 else 0.5
                mo = lin("#7C9443")
                return tuple((col[i] * (1 - m_amt) + mo[i] * m_amt) * v for i in range(3))
            n.add(K.box((ab - ah, 2 * H_YR + 0.2, 0.05), jitter=0.015, seed=r), M["roof"],
                  matrix=frame(down, Y * s, q), shade=f)
    # 棟の丸太と、妻の交差した竿
    n.add(K.tube([(0, -H_YR - 0.2, RIDGE_Z + 0.1), (0, H_YR + 0.2, RIDGE_Z + 0.1)], [0.14, 0.14], n=5), M["wood"], smooth=True,
          shade=K.shade_const(0.85))
    for y in (-H_YR - 0.04, H_YR + 0.04):
        for s in (-1, 1):
            a = Vector((s * (EAVE_X + 0.1), y, EAVE_Z + 0.02))
            b = Vector((-s * 0.45, y, RIDGE_Z + 0.52))
            n.add(K.tube([a, b], [0.075, 0.06], n=4), M["wood"], smooth=True, shade=K.shade_const(0.9))
    # 屋根にかかる蔓と葉
    # (集落の建物の作り直しで変更: 遠景では葉を省き、hut の 2 本の蔓の通り道を細い管だけで)
    for y0, s0 in ((1.3, -1), (-1.2, 1)):
        pts = [roof_point(s0, u, y0 + 0.2 * math.sin(u * 4), lift=0.17)[0] for u in (1.02, 0.5, 0.0)]
        pts += [roof_point(-s0, u, y0 - 0.2 + 0.2 * math.sin(u * 4), lift=0.17)[0] for u in (0.5, 1.03)]
        n.add(K.tube(pts, [0.06] * len(pts), n=3), M["vine"], smooth=True)
    # (集落の建物の作り直しで追加) 奥の妻の板壁 (三角の板)、軒の鼻の丸太
    bm = bmesh.new()
    tri = [bm.verts.new((x, H_PY + 0.06, z)) for x, z in ((-1.75, H_BEAM), (1.75, H_BEAM), (0.0, RIDGE_Z - 0.12))]
    bm.faces.new(tri)
    bm.faces.new(list(reversed([bm.verts.new(v.co + Vector((0, 0.06, 0))) for v in tri])))
    n.add(bm, M["wood"], shade=K.shade_const(0.62))
    for s in (-1, 1):
        e, _ = roof_point(s, 1.0, 0.0, lift=0.0)
        n.add(K.tube([(e.x, -H_YR - 0.15, e.z), (e.x, H_YR + 0.15, e.z)], [0.09, 0.09], n=4), M["wood"],
              shade=K.shade_const(0.78))
    # (集落の建物の作り直しで追加) 炉の熾火と妻の吊り灯籠の光 (夜に遠くからも灯りが読める)、薪の山
    n.add(K.box((0.5, 0.5, 0.1)), M["ember"], matrix=K.trs((0, -0.3, H_G + 0.08)))
    n.add(K.box((0.24, 0.24, 0.3)), M["lantern"], matrix=K.trs((0, -H_YR + 0.45, RIDGE_Z - 1.05)))
    n.add(K.box((0.5, 1.7, 0.6)), M["bark"], matrix=K.trs((2.15, 0, H_G + 0.2)), shade=K.shade_const(0.8),
          per_face_mat=lambda c, nr: M["cut"] if abs(nr.y) > 0.8 else None)
    return n

# ---------------------------------------------------------------- 小屋の作り直し (M22-06)
# (集落の建物の作り直しで追加) 舟の造形 (板の段・肋・索具・鐘・船首の渦) と同じく、どう組んだかが見える形にする。
# 四隅の巨石の柱に石の笠、その上に丸太の桁と梁、垂木を渡して下地を張り、手で割った屋根板を軒から 6 段重ねる
# (板の端はぎざぎざ、段の縁は影の線になる)。棟は丸太と苔、妻は交差した竿を縄で括る。壁は一つずつの石の 3 段。
# 暮らしの小物: 戸口の敷石、炉と熾火、薪の山、干し棚、籠、壺、敷物、梁の鐘、妻の吊り灯籠。蔓が柱を登って屋根を越える。
# ムーの意匠は控えめに、戸口の左の柱に刻んだ六角の紋だけが淡いシアンに光る (巨石・月鹿の継ぎ目と同じ)。
# 原点は地面の中心、戸口は −Y (glTF では +Z)。view.ts は地面から 0.15 m 沈めて置くので、床・敷石の上面は H_G の上に出す。

H_PX, H_PY = 1.65, 1.45      # 四隅の柱の中心
H_POST = 2.25                # 柱の高さ (その上に 0.12 m の石の笠)
H_BEAM = 2.47                # 桁と梁の丸太の中心の高さ
H_G = 0.15                   # 置いたときの地面の高さ
H_RIDGE, H_EX, H_EZ = 4.3, 2.55, 1.95  # 棟の高さ、軒の出 (中心から)、軒の高さ
H_YR = 2.35                  # 棟の半分の長さ (妻の出は柱から 0.9 m)
H_SAG = 0.1                  # 棟と屋根面の中ほどの垂れ
H_SL = math.hypot(H_EX, H_RIDGE - H_EZ)  # 屋根面の斜めの長さ (棟 → 軒)


def lin(h):
    return hex_rgb(h)


def clamp01(v):
    return min(1.0, max(0.0, v))


def h_down(s):
    return Vector((s * H_EX, 0, -(H_RIDGE - H_EZ))) / H_SL


def h_nrm(s):
    return Vector((s * (H_RIDGE - H_EZ), 0, H_EX)) / H_SL


def h_roof(s, a, y, lift=0.0):
    """屋根面の点。s=±1 は面の側、a は棟から軒へ斜めに測った長さ、lift は面から外へ。棟と面の中ほどが少し垂れる"""
    t = max(0.0, 1 - (y / H_YR) ** 2)
    sag = -H_SAG * t * (1 - 0.35 * clamp01(a / H_SL))
    return Vector((0, y, H_RIDGE + sag)) + h_down(s) * a + h_nrm(s) * lift


def hut_ao(co, n):
    """軒の下と小屋の中の陰り (頂点色の乗数)。低いほど・奥ほど暗い"""
    if abs(co.x) > H_EX or abs(co.y) > H_YR or co.z > H_RIDGE:
        return 1.0
    v = 0.72 + 0.28 * clamp01((co.z - H_G) / 2.2)
    if abs(co.x) < H_PX - 0.15 and abs(co.y) < H_PY - 0.15:
        v *= 0.8 + 0.2 * clamp01((-co.y + H_PY) / (2 * H_PY) - 0.3)  # 奥 (+Y) ほど暗い
    return v


def with_ao(shade):
    return lambda co, n: tuple(c * hut_ao(co, n) for c in shade(co, n))


def slab(fn, nu, nv, thick):
    """媒介変数の面 fn(u, v, lift) (u, v は 0〜1) を厚み thick の閉じた板にする (屋根の下地)"""
    bm = bmesh.new()
    grids = []
    for lift in (thick / 2, -thick / 2):
        grids.append([[bm.verts.new(fn(i / nu, j / nv, lift)) for j in range(nv + 1)] for i in range(nu + 1)])
    top, bot = grids
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]))
            bm.faces.new((bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j], bot[i][j]))
    ring = [(i, 0) for i in range(nu)] + [(nu, j) for j in range(nv)] + [(i, nv) for i in range(nu, 0, -1)] + \
        [(0, j) for j in range(nv, 0, -1)]
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        bm.faces.new((top[i0][j0], bot[i0][j0], bot[i1][j1], top[i1][j1]))
    return bm


def shingle(L, w, t, rnd, jag=0.12):
    """手で割った屋根板 1 枚。+X が軒へ (長さ L)、Y が幅、Z が厚み (上面の法線 +Z)。軒側の端はぎざぎざに欠ける。
    上面と縁だけ (下面と棟側の縁は下地と上の段に隠れる)。recalc=False で置く"""
    bm = bmesh.new()
    hw = w / 2
    outline = [(0.0, -hw), (L + rnd.uniform(-0.4, 0.6) * jag, -hw),
               (L - rnd.uniform(0.2, 1.0) * jag, -hw * rnd.uniform(0.1, 0.5)),
               (L + rnd.uniform(0.0, 1.0) * jag, hw * rnd.uniform(0.2, 0.6)), (L + rnd.uniform(-0.6, 0.3) * jag, hw), (0.0, hw)]
    top = [bm.verts.new((x, y, t / 2)) for x, y in outline]
    bot = [bm.verts.new((x, y, -t / 2)) for x, y in outline]
    bm.faces.new(top)
    k = len(outline)
    for i in range(k - 1):
        j = i + 1
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    return bm


ROOF_BASE, ROOF_GREY, ROOF_MOSS = "#8C6242", "#857566", "#7C9443"  # 屋根板の地の色、雨に晒された灰、苔


def roof_side(n, rnd, s):
    """屋根の片面: 軒から棟へ 6 段の屋根板。段ごとに幅をずらし、ときどき 1 枚欠ける。板の縁は暗く (段の影の線)、
    板の根元 (上の段の下) ほど暗い。軒に近い段に苔を載せる"""
    E, L = 0.8, 1.18  # (段の間隔と板の長さ。基準画の長い割り板に寄せて 5 段)
    nrm = h_nrm(s)
    moss = lin(ROOF_MOSS)
    base, grey = lin(ROOF_BASE), lin(ROOF_GREY)
    # 板ごとの色は地の色から少しだけ揺らす (ばらばらの色は引きで雑音になる。舟の外板と同じく段の影の線で読ませる)。
    # 上の段ほど雨に晒されて灰に寄り、苔は軒に近い段ほど多い
    moss_by_course = (0.5, 0.24, 0.08, 0.06, 0.14, 0.14)
    k = 0
    while True:
        ab = H_SL + 0.14 - k * E
        if ab <= 0.3:
            break
        ah = max(ab - L, 0.02)
        ln = ab - ah
        y = -H_YR - 0.1 - (0.0 if k % 2 == 0 else 0.3)
        while y < H_YR + 0.1:
            w = rnd.uniform(0.45, 0.8)
            y0, y1 = max(y, -H_YR - 0.1), min(y + w, H_YR + 0.1)
            y += w + 0.02
            if y1 - y0 < 0.22 or (0 < k < 4 and rnd.random() < 0.03):
                continue
            yc = (y0 + y1) / 2
            curl = 0.06 if rnd.random() < 0.15 else 0.0  # ときどき反り上がった板
            head = h_roof(s, ah, yc, 0.04 + 0.014 * (k % 2))
            butt = h_roof(s, ab, yc, 0.1 + 0.014 * (k % 2) + curl)
            xa = (butt - head).normalized()
            ang = math.radians(rnd.uniform(-6, 6))
            side = (Y * s * math.cos(ang) + xa * math.sin(ang))
            g = clamp01(0.15 + 0.1 * k + rnd.uniform(-0.15, 0.15))
            col = tuple(base[i] * (1 - g) + grey[i] * g for i in range(3))
            jit = rnd.uniform(0.86, 1.04)
            m_amt = clamp01(moss_by_course[min(k, 5)] * rnd.uniform(0.3, 1.6))

            def f(co, nr, head=head, xa=xa, ln=ln, col=col, jit=jit, m_amt=m_amt):
                along = clamp01((co - head).dot(xa) / ln)
                v = (0.72 + 0.28 * along) * jit
                if nr.dot(nrm) < 0.5:
                    v *= 0.5
                m = m_amt * along
                return tuple((col[i] * (1 - m) + moss[i] * m) * v for i in range(3))
            n.add(shingle(ln, y1 - y0, 0.07, rnd, jag=0.16), M["roof"], matrix=frame(xa, side, head), recalc=False, shade=f)
        k += 1
    # 軒の鼻の丸太 (板の最下段を受ける。舟の腰板のように屋根の下の縁を一本の線で締める)
    n.add(K.tube([h_roof(s, H_SL + 0.02, y, -0.02) for y in (-H_YR - 0.15, -1.2, 0.0, 1.2, H_YR + 0.15)], [0.09] * 5, n=6),
          M["wood"], smooth=True, shade=K.shade_const(0.78))


def lashing(n, center, axis, r, w=0.07):
    """縛り縄の輪 (axis のまわりに半径 r、幅 w)"""
    d = Vector(axis).normalized()
    m = K.aim(d) @ K.trs((0, 0, 0), (0, 90, 0))
    m.translation = Vector(center)
    n.add(K.lathe([(r, -w / 2), (r, w / 2)], n=5, cap_top=False, cap_bottom=False), M["rope"], matrix=m,
          shade=K.shade_const(0.85))


def bell(n, top, size=1.0, cord=0.2):
    """鐘樹の青銅の小さな鐘 (口が暖かく光る。舟の舷の鐘と同じ意匠)。top は吊り紐の上端"""
    top = Vector(top)
    b = top - Z * cord
    n.add(K.tube([top, b], [0.008, 0.008], n=3, cap_start=False, cap_end=False), M["rope"])
    prof = [(0.0, 0.0), (0.045 * size, -0.02 * size), (0.06 * size, -0.08 * size), (0.085 * size, -0.14 * size),
            (0.0, -0.11 * size)]
    n.add(K.lathe(prof, n=6), M["bell"], matrix=K.trs(b), smooth=True,
          per_face_mat=lambda c, nrm, t=b: M["bell_rim"] if c.z - t.z < -0.12 * size else None)


def lantern(n, top, s=1.0):
    """吊り灯籠 (基準画の灯籠): 四角の胴が暖かく光り、四隅の柱と四面の X の木の格子、四角錐の笠、吊り輪。
    top は吊り輪の上端、胴の幅 0.3 × s。胴の中心を返す"""
    top = Vector(top)
    w, h = 0.3 * s, 0.36 * s
    ring_c = top - Z * 0.05 * s
    n.add(K.tube([ring_c + Vector((0.045 * s * math.cos(a), 0, 0.045 * s * math.sin(a)))
                  for a in [math.radians(90 + 60 * i) for i in range(7)]], [0.011 * s] * 7, n=4, cap_start=False, cap_end=False),
          M["frame"], smooth=True)
    cap_top = top - Z * 0.1 * s
    body_top = cap_top - Z * 0.13 * s
    c = body_top - Z * h / 2
    # 笠 (四角錐) と台
    n.add(K.lathe([(0.0, 0.0), (0.035 * s, -0.01 * s), (w * 0.78, -0.12 * s), (w * 0.72, -0.15 * s), (0.0, -0.15 * s)], n=4,
                  phase=math.radians(45)), M["frame"], matrix=K.trs(cap_top + Z * 0.02 * s), shade=K.shade_const(0.9))
    n.add(K.box((w + 0.05 * s, w + 0.05 * s, 0.045 * s)), M["frame"], matrix=K.trs(c - Z * (h / 2 + 0.02 * s)),
          shade=K.shade_const(0.8))
    # 光る胴 (紙を張った内箱)
    n.add(K.box((w - 0.03 * s, w - 0.03 * s, h)), M["lantern"], matrix=K.trs(c))
    # 四隅の柱
    for sx in (-1, 1):
        for sy in (-1, 1):
            n.add(K.box((0.035 * s, 0.035 * s, h + 0.02 * s)), M["frame"],
                  matrix=K.trs(c + Vector((sx * w / 2, sy * w / 2, 0))), shade=K.shade_const(0.85))
    # 四面の X の格子
    diag = math.hypot(w, h)
    for nx, ny in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nrm = Vector((nx, ny, 0))
        tang = Vector((-ny, nx, 0))
        fc = c + nrm * (w / 2 + 0.006 * s)
        for sgn in (-1, 1):
            d = (tang * w + Z * h * sgn).normalized()
            n.add(K.box((diag, 0.016 * s, 0.024 * s)), M["frame"], matrix=frame(d, nrm, fc), shade=K.shade_const(0.95))
    return c


def wall_run(n, rnd, a, b, courses, thick, moss_top=0.7, ao=None, z0=0.0):
    """a → b に一つずつの石を段に積んだ空積みの壁。courses = [(高さ, 石の数), …] (下から)。
    石の長さはばらし、段ごとに目地がずれる"""
    a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
    d = b - a
    L = d.length
    u = d / L
    perp = Vector((-u.y, u.x, 0))
    yaw = math.degrees(math.atan2(u.y, u.x))
    z = z0
    for ci, (h, cnt) in enumerate(courses):
        ws = [rnd.uniform(0.7, 1.3) for _ in range(cnt)]
        tot = sum(ws)
        x = 0.0
        top = ci == len(courses) - 1
        for w in ws:
            w = w / tot * L
            hh = h * rnd.uniform(0.9, 1.04)
            th = thick * rnd.uniform(0.88, 1.02) * (0.94 if top else 1.0)
            p = a + u * (x + w / 2) + perp * rnd.uniform(-0.03, 0.03)
            pstone(n, rnd, (p.x, p.y, z + hh / 2), (w - 0.04, th, hh), yaw=yaw + rnd.uniform(-4, 4),
                  tilt=(rnd.uniform(-2, 2), rnd.uniform(-2.5, 2.5)) if top else (0, 0), bevel=0.06 if top else 0.05,
                  jitter=0.025, moss=moss_top if top else 0.12, z1=1.2, ao=ao)
            x += w
        z += h


def vine(n, pts, rnd, every=1, r=0.07, curls=2):
    """蔓 (柱を登って屋根を越える) と葉。pts は通り道。点の間に横の揺れを入れて太い蔓がうねるようにし、
    every 点ごとに葉を 3 枚の房で、curls か所に細い巻きひげ (基準画の蔓)"""
    pts = [Vector(p) for p in pts]
    wavy = [pts[0]]
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        d = b - a
        up = Z if abs(d.normalized().z) < 0.9 else X_AXIS
        side = d.cross(up).normalized()
        for t in (0.33, 0.66):
            wavy.append(a + d * t + side * math.sin((i * 2 + t * 3) * 1.7) * 0.08)
        wavy.append(b)
    k = len(wavy)
    n.add(K.tube(wavy, [r * (1.15 - 0.6 * i / (k - 1)) for i in range(k)], n=4, cap_start=False), M["vine"], smooth=True,
          shade=K.shade_height(0, 3.5, 0.7, 0.95))
    for j in range(2, len(pts), every):
        for _ in range(3):
            d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.3, 1.0))).normalized()
            m = K.aim(d)
            m.translation = pts[j] + d * 0.04
            sc = rnd.uniform(0.9, 1.35)
            n.add(K.leaf(0.34 * sc, 0.21 * sc, 0.03, bend=0.25), M["vine"], matrix=m, smooth=True,
                  shade=K.shade_const(rnd.uniform(0.8, 1.05)), soft=(pts[j] - Z * 0.25, 0.4))
    for j in rnd.sample(range(2, len(pts)), min(curls, len(pts) - 2)):
        c0 = pts[j]
        a0 = rnd.uniform(0, 6.3)
        tw = [c0] + [c0 + Vector((math.cos(a0 + t * 0.9) * 0.1 * (1 - t / 10), math.sin(a0 + t * 0.9) * 0.1 * (1 - t / 10),
                                  0.08 + 0.012 * t)) for t in range(9)]
        n.add(K.tube(tw, [0.016] * len(tw), n=3), M["vine"], smooth=True, shade=K.shade_const(0.9))


def hut():
    n = K.Node("hut")
    rnd = random.Random(111)
    ao = hut_ao
    # 床: 踏み固めた土の上の敷き藁と、奥の編んだ敷物
    n.add(K.box((2.95, 2.55, 0.07), jitter=0.01, seed=1), M["straw"], matrix=K.trs((0, 0.02, H_G + 0.02)),
          shade=with_ao(K.shade_const(0.95)))
    for x, tone in ((-0.4, 0.95), (0.05, 0.78), (0.5, 0.95)):
        n.add(K.box((0.45, 0.95, 0.02)), M["straw"], matrix=K.trs((x + 0.35, 0.62, H_G + 0.065), (0, 0, 2)),
              shade=with_ao(K.shade_const(tone * 0.78)))  # 両面の weave にすると焼きの両面の組 (draw call 2 つ) が増える
    # 戸口の敷居 (広場へ下りる敷石は、斜面に沿わせるためゲーム側が stepping_stone を地面に置く)
    pstone(n, rnd, (0, -H_PY - 0.02, H_G - 0.02), (1.1, 0.38, 0.12), yaw=1, bevel=0.03, jitter=0.02, ao=ao)
    # 斜面の土台: 壁と柱の下に大きな石を 1 m 埋める (斜面では小屋を戸口の側の地面に合わせて上げるので、下り側に土台が覗く)
    for (cx, cy, sx_, sy_) in ((0, H_PY, 3.0, 0.5), (0, -H_PY, 3.0, 0.5), (-H_PX, 0, 0.5, 2.5), (H_PX, 0, 0.5, 2.5)):
        for k in (-1, 1):
            off = Vector((sx_ / 4 * k, 0, 0)) if sx_ > sy_ else Vector((0, sy_ / 4 * k, 0))
            size = (sx_ / 2 - 0.04, sy_, 1.0) if sx_ > sy_ else (sx_, sy_ / 2 - 0.04, 1.0)
            pstone(n, rnd, (cx + off.x, cy + off.y, -0.48), size, yaw=rnd.uniform(-2, 2), bevel=0.05, jitter=0.03,
                  z1=0.2, ao=ao)
    # 四隅の巨石の柱と石の笠
    for sx in (-1, 1):
        for sy in (-1, 1):
            front_left = sx < 0 and sy < 0
            pstone(n, rnd, (sx * H_PX, sy * H_PY, -0.9), (0.56, 0.52, H_POST + 0.9), yaw=0 if front_left else rnd.uniform(-6, 6),
                  tilt=(0, 0) if front_left else (rnd.uniform(-1.5, 1.5), rnd.uniform(-1.5, 1.5)), bevel=0.1, jitter=0.025,
                  taper=0.88, moss=0.6, base_z=True, z1=1.6, ao=ao)
            pstone(n, rnd, (sx * H_PX, sy * H_PY, H_POST + 0.06), (0.66, 0.62, 0.13), yaw=rnd.uniform(-5, 5), bevel=0.04,
                  jitter=0.015, moss=0.7, z1=3.0)
    # 空積みの壁: 奥・左右は 4 段、戸口の両脇は 3 段
    wall_run(n, rnd, (-H_PX + 0.28, H_PY), (H_PX - 0.28, H_PY), [(0.36, 5), (0.26, 4), (0.22, 5), (0.18, 4)], 0.42, ao=ao)
    for sx in (-1, 1):
        wall_run(n, rnd, (sx * H_PX, -H_PY + 0.26), (sx * H_PX, H_PY - 0.26), [(0.36, 4), (0.26, 5), (0.22, 4), (0.18, 4)], 0.42,
                 ao=ao)
        wall_run(n, rnd, (sx * (H_PX - 0.28), -H_PY), (sx * 0.62, -H_PY), [(0.36, 2), (0.26, 2), (0.2, 1)], 0.42, ao=ao)
    # 桁 (柱の上を前後に) と梁 (前後の妻を左右に)。前の梁は戸口の鴨居
    for sx in (-1, 1):
        n.add(K.tube([(sx * H_PX, -H_PY - 0.35, H_BEAM), (sx * H_PX, 0, H_BEAM - 0.02), (sx * H_PX, H_PY + 0.35, H_BEAM)],
                     [0.1, 0.105, 0.1], n=6), M["wood"], smooth=True, shade=with_ao(K.shade_const(0.92)))
    for sy in (-1, 1):
        n.add(K.tube([(-H_PX - 0.3, sy * H_PY, H_BEAM + 0.02), (H_PX + 0.3, sy * H_PY, H_BEAM + 0.02)], [0.09, 0.09], n=6),
              M["wood"], smooth=True, shade=with_ao(K.shade_const(0.88)))
        for sx in (-1, 1):
            lashing(n, (sx * H_PX, sy * H_PY, H_BEAM + 0.01), Vector((1, 1, 0)), 0.14, w=0.09)
    # 垂木 (下地の下、軒から尾が覗く)・下地・屋根板
    for s in (-1, 1):
        for y in (-2.1, -1.05, 0.0, 1.05, 2.1):
            n.add(K.tube([h_roof(s, 0.05, y, -0.1), h_roof(s, H_SL * 0.5, y, -0.1), h_roof(s, H_SL + 0.12, y, -0.1)],
                         [0.055, 0.055, 0.05], n=5), M["wood"], smooth=True, shade=K.shade_const(0.7))

        def deck(u, v, lift, s=s):
            return h_roof(s, u * H_SL, -H_YR + 2 * H_YR * v, lift)
        n.add(slab(deck, 3, 6, 0.05), M["bark"], shade=lambda co, nr: (0.5, 0.48, 0.46) if nr.z < 0 else (0.62, 0.6, 0.58))
        roof_side(n, rnd, s)
    # 棟の丸太と苔
    ridge = [h_roof(1, 0, y, 0.12) for y in (-H_YR - 0.2, -1.6, -0.8, 0.0, 0.8, 1.6, H_YR + 0.2)]
    n.add(K.tube(ridge, [0.16] * 7, n=6), M["wood"], smooth=True, shade=K.shade_const(0.85))
    for y in (-0.9, 1.3):
        p = h_roof(1, 0, y + rnd.uniform(-0.2, 0.2), 0.2)
        n.add(K.ico((0.2, rnd.uniform(0.4, 0.55), 0.09), subdiv=0, jitter=0.12, seed=rnd.randrange(1000), flat_bottom=0.6),
              M["moss"], matrix=K.trs(p, (0, 0, rnd.uniform(-10, 10))), smooth=True, shade=K.shade_const(rnd.uniform(0.7, 0.8)))
    # 妻の交差した竿と縛り縄。竿の先は外へ巻いた渦 (舟の船首の渦と同じ手の彫り。集落と舟を同じ民が作ったと読める)
    for y in (-H_YR - 0.04, H_YR + 0.04):
        for s in (-1, 1):
            a = h_roof(s, H_SL + 0.22, y, 0.12)
            m = h_roof(s, 0.0, y, 0.12)
            b = h_roof(s, -0.5, y, 0.12)
            d = (b - m).normalized()
            p = Vector((-d.z * s, 0, d.x * s))
            R0 = 0.2
            c = b + p * R0
            spiral = []
            for i in range(1, 15):
                ph = 2.2 * math.pi * i / 14
                R = R0 * (1 - 0.6 * ph / (2.2 * math.pi))
                spiral.append(c + (-p * math.cos(ph) + d * math.sin(ph)) * R)
            pts = [a, m, b] + spiral
            radii = [0.075, 0.07, 0.06] + [0.055 - 0.03 * i / 13 for i in range(14)]
            n.add(K.tube(pts, radii, n=5), M["wood"], smooth=True, shade=K.shade_const(0.9))
        lashing(n, h_roof(1, 0.0, y, 0.12) + Z * 0.02, Y, 0.1, w=0.1)
    # 奥の妻を縦に割った板で塞ぐ (上端は屋根の下に合わせる)
    for i in range(7):
        x0 = -1.5 + i * 0.43
        bm = K.box((0.4, 0.06, 1.0), jitter=0.01, seed=i)
        for v in bm.verts:
            xx = x0 + 0.2 + v.co.x
            if v.co.z > 0:
                v.co.z = h_roof(1 if xx >= 0 else -1, abs(xx) / H_EX * H_SL, H_PY, -0.14).z - (H_BEAM + 0.05) - 0.5
            v.co.x = xx
        n.add(bm, M["wood"], matrix=K.trs((0, H_PY + 0.06, H_BEAM + 0.05 + 0.5)),
              shade=K.shade_const(rnd.uniform(0.62, 0.78)))
    # 炉: 石の輪、熾火、焦げた薪
    hc = Vector((0.0, -0.3, H_G + 0.06))
    for i in range(8):
        a = math.radians(45 * i + rnd.uniform(-8, 8))
        d = Vector((math.cos(a), math.sin(a), 0))
        stone(n, rnd, hc + d * 0.4 + Z * 0.04, (0.2, 0.15, 0.14), yaw=math.degrees(a) + 90, bevel=0.0, jitter=0.02, ao=ao)
    n.add(K.ico((0.3, 0.3, 0.08), subdiv=0, jitter=0.1, seed=3), M["ember"], matrix=K.trs(hc + Z * 0.02))
    for i in range(3):
        a = math.radians(120 * i + 30)
        d = Vector((math.cos(a), math.sin(a), 0))
        n.add(K.tube([hc + d * 0.34 + Z * 0.07, hc - d * 0.02 + Z * 0.17], [0.05, 0.04], n=5), M["char"],
              per_face_mat=lambda c, nr, hc=hc: M["ember"] if (c - hc).length < 0.12 else None)
    # 壺と籠
    n.add(K.lathe([(0.0, 0.0), (0.12, 0.0), (0.2, 0.12), (0.19, 0.25), (0.11, 0.33), (0.12, 0.37), (0.09, 0.38), (0.08, 0.3)],
                  n=8, cap_top=False), M["clay"], matrix=K.trs((-0.95, 0.85, H_G + 0.05)), smooth=True,
          shade=with_ao(K.shade_height(H_G, H_G + 0.4, 0.75, 1.0)))
    for (x, y, sc) in ((1.1, -1.95, 1.0), (1.5, -2.25, 0.8), (-1.15, 0.8, 0.75)):
        prof = [(0.0, 0.0), (0.17, 0.0), (0.24, 0.12), (0.26, 0.26), (0.28, 0.3), (0.24, 0.3), (0.22, 0.08), (0.0, 0.08)]
        n.add(K.lathe([(r * sc, z * sc) for r, z in prof], n=8, cap_top=False, cap_bottom=False), M["straw"],
              matrix=K.trs((x, y, H_G - 0.02)), smooth=True,
              shade=with_ao(lambda co, nr: (0.8 + 0.2 * (0.5 + 0.5 * math.sin(co.z * 55)),) * 3))
    # 薪の山 (右の壁の外、軒の下)。切り口は明るい
    for (x, z, r) in ((2.02, 0.12, 0.12), (2.28, 0.12, 0.12), (2.15, 0.34, 0.12), (2.06, 0.54, 0.1), (2.3, 0.35, 0.1)):
        y0 = rnd.uniform(-0.1, 0.1)
        n.add(K.tube([(x, y0 - 0.85, H_G + z - 0.05), (x, y0 + 0.85, H_G + z - 0.05)], [r, r], n=6, phase=rnd.uniform(0, 1)),
              M["bark"], shade=with_ao(K.shade_const(rnd.uniform(0.8, 1.0))),
              per_face_mat=lambda c, nr: M["cut"] if abs(nr.y) > 0.8 else None)
    # 干し棚 (左の壁の外): X に組んだ脚と横木、干した草の束
    for y in (-0.8, 0.8):
        for sgn in (-1, 1):
            n.add(K.tube([(-2.25 + sgn * 0.25, y, H_G - 0.1), (-2.25 - sgn * 0.12, y, H_G + 1.55)], [0.035, 0.03], n=4),
                  M["wood"], shade=K.shade_const(0.85))
    n.add(K.tube([(-2.24, -1.0, H_G + 1.38), (-2.24, 1.0, H_G + 1.38)], [0.035, 0.035], n=4), M["wood"])
    for i, y in enumerate((-0.55, -0.2, 0.18, 0.52)):
        top = Vector((-2.24, y, H_G + 1.36))
        n.add(K.lathe([(0.0, 0.0), (0.05, -0.06), (0.11, -0.45), (0.0, -0.5)], n=5, wobble=0.15, seed=i), M["herb"],
              matrix=K.trs(top), smooth=True, shade=K.shade_const(0.8 + 0.2 * (i % 2)))
    # 鴨居に吊った鐘と、戸口の左の柱に刻んだ六角の紋 (淡いシアン)
    for x in (-0.75, 0.75):
        bell(n, (x, -H_PY - 0.02, H_BEAM - 0.08), size=1.1, cord=0.22)
    gz = 1.45
    face_y = -H_PY - (0.26 - (0.26 - 0.26 * 0.88) * (gz + 0.9) / (H_POST + 0.9)) - 0.014
    for i in range(6):
        a0, a1 = math.radians(90 + 60 * i), math.radians(150 + 60 * i)
        p0 = Vector((-H_PX + 0.12 * math.cos(a0), face_y, gz + 0.12 * math.sin(a0)))
        p1 = Vector((-H_PX + 0.12 * math.cos(a1), face_y, gz + 0.12 * math.sin(a1)))
        m = K.aim(p1 - p0, up=-Y)
        m.translation = (p0 + p1) / 2
        n.add(K.box(((p1 - p0).length + 0.03, 0.028, 0.04)), M["glyph"], matrix=m)
    # 妻の吊り灯籠 (棟から下ろす)
    hook = h_roof(1, 0.0, -H_YR + 0.45, -0.14)
    n.add(K.tube([hook, hook - Z * 0.55], [0.01, 0.01], n=3, cap_start=False, cap_end=False), M["rope"])
    lantern(n, hook - Z * 0.55, s=0.85)
    # 蔓: 奥の左の柱を登って屋根を越え、右の軒から垂れる。もう 1 本は戸口の右の柱から左へ
    v1 = [(-1.97, 1.72, 0.05), (-1.95, 1.74, 0.9), (-1.92, 1.7, 1.7), (-1.9, 1.66, 2.35),
          h_roof(-1, H_SL + 0.05, 1.55, 0.17), h_roof(-1, 2.6, 1.25, 0.17), h_roof(-1, 1.7, 1.5, 0.17),
          h_roof(-1, 0.8, 1.15, 0.17),
          h_roof(-1, 0.0, 1.25, 0.26), h_roof(1, 0.9, 0.95, 0.17), h_roof(1, 1.9, 1.3, 0.17), h_roof(1, 2.9, 1.0, 0.17),
          h_roof(1, H_SL + 0.14, 1.15, 0.15)]
    v1 += [Vector(v1[-1]) + Vector((0.05, 0, -0.45)), Vector(v1[-1]) + Vector((0.03, 0.04, -0.85))]
    vine(n, v1, rnd, every=1)
    v2 = [(1.97, -1.73, 0.05), (1.93, -1.75, 1.0), (1.9, -1.7, 2.3), h_roof(1, H_SL + 0.05, -1.45, 0.17),
          h_roof(1, 2.2, -1.15, 0.17), h_roof(1, 1.1, -1.4, 0.17), h_roof(1, 0.0, -1.1, 0.26), h_roof(-1, 1.2, -0.85, 0.17),
          h_roof(-1, 2.5, -1.05, 0.17), h_roof(-1, H_SL + 0.14, -0.8, 0.15)]
    v2 += [Vector(v2[-1]) + Vector((-0.04, 0, -0.6))]
    vine(n, v2, rnd, every=1)
    # 3 本目: 奥の右の柱から登り、右の屋根の奥を斜めに這って棟で止まる
    v3 = [(1.97, 1.73, 0.05), (1.95, 1.72, 1.1), (1.9, 1.7, 2.3), h_roof(1, H_SL + 0.05, 1.95, 0.17),
          h_roof(1, 2.4, 2.1, 0.17), h_roof(1, 1.4, 1.75, 0.17), h_roof(1, 0.5, 2.0, 0.19), h_roof(1, 0.05, 1.85, 0.27)]
    vine(n, v3, rnd, every=1, r=0.05)
    for y in (-0.2, 0.55):  # 左の軒から垂れる短い蔓
        p = h_roof(-1, H_SL + 0.1, y, 0.1)
        vine(n, [p + Z * 0.02, p - Z * 0.35 + X_AXIS * -0.03, p - Z * 0.7], rnd, every=2, r=0.03)
    return n


def stepping_stone():
    """(集落の建物の作り直しで追加) 小屋の戸口から広場へ下りる平たい敷石 1 枚 (0.72 × 0.52 m)。ゲーム側が道に沿って斜面に置く"""
    n = K.Node("stepping_stone")
    rnd = random.Random(121)
    pstone(n, rnd, (0, 0, 0.0), (0.72, 0.52, 0.16), bevel=0.04, jitter=0.02, moss=0.3, z1=0.2)
    return n


# ---------------------------------------------------------------- 灯り柱

def lantern_post():
    n = K.Node("lantern_post")
    rnd = random.Random(202)
    # (集落の建物の作り直しで変更: 基準画の太い柱に合わせて 0.44 × 0.4 → 0.64 × 0.56、2.3 → 2.75 m。頭は斜めに割り、上に彫った帯)
    pstone(n, rnd, (0, 0, 0), (0.64, 0.56, 2.75), yaw=3, bevel=0.12, segments=2, jitter=0.02, taper=0.84, moss=1.0,
           base_z=True, z1=1.2, shear=0.1)
    n.add(K.box((0.58, 0.51, 0.07), bevel=0.02), M["stone"], matrix=K.trs((0, 0, 2.02), (0, 0, 3)), shade=K.shade_const(0.55))
    for a in (40, 210):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        pstone(n, rnd, d * 0.5 + Z * 0.08, (0.38, 0.32, 0.22), yaw=a, bevel=0.05, moss=0.6)
    # 腕木 (石の張り出し) と吊り紐
    # (集落の建物の作り直しで変更: 太い腕木の先に下へ出た石の鼻、根元を縄で括り、鼻から吊り紐)
    pstone(n, rnd, (0.5, 0, 2.36), (0.78, 0.27, 0.27), yaw=0, bevel=0.05, jitter=0.01, z1=3, moss=0.5)
    pstone(n, rnd, (0.82, 0, 2.24), (0.22, 0.29, 0.34), yaw=0, bevel=0.05, jitter=0.01, z1=3)
    lashing(n, (0.4, 0, 2.36), X_AXIS, 0.17, w=0.1)
    n.add(K.tube([(0.82, 0, 2.09), (0.82, 0, 1.97)], [0.012, 0.012], n=3), M["rope"])
    # 灯籠: 六角の屋根・光る胴・台
    # (集落の建物の作り直しで変更: 基準画どおり四角の灯籠 (四角錐の笠・光る胴・四隅の柱・台・吊り輪)。lantern() が組む)
    lantern(n, (0.82, 0, 1.99), s=1.3)
    # 灯籠の格子: 六つの面それぞれに X に組んだ細い木 (基準画の格子)
    # (集落の建物の作り直しで変更: 四角の胴の四面に X。lantern() が組む)
    return n


# ---------------------------------------------------------------- 船台

# (M22-06 試作 2 の判断「船は大きく、立派な感じがほしい」で変更: 舟 (全長 ≈ 25 m、幅 7 m) に合わせて 16 × 4.4 → 27 × 7.6 m、
#  上がり 0.9 → 1.5 m (傾き atan(1.5/27) ≈ 3.2°、船首側 (−Y、glTF の +Z) が下は同じ)。盤木は 0.28 → 0.4 m の高さで 8 つ、
#  前後位置は observe_ship.py の CRADLE_YS (内側の 6 つ) と同じ。中央の盤木の上面 (SLIP_TOP) は 0.2 + 0.75 + 0.01 + 0.4 = 1.36 m)
SLIP_L, SLIP_W = 27.0, 7.6
SLIP_RISE = 1.5
SLIP_BLOCK_H = 0.4
SLIP_BLOCK_YS = (-10.15, -7.25, -4.35, -1.45, 1.45, 4.35, 7.25, 10.15)


def slip_z(y):
    return 0.2 + (y + SLIP_L / 2) / SLIP_L * SLIP_RISE  # (M22-06 試作 2 の判断で変更: 0.25 + … × 0.9 → 0.2 + … × SLIP_RISE)


def slipway():
    n = K.Node("slipway")
    rnd = random.Random(303)
    ang = math.degrees(math.atan2(SLIP_RISE, SLIP_L))  # (M22-06 試作 2 の判断で変更: 0.9 → SLIP_RISE)
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
    # (M22-06 試作 2 の判断で変更: 13 列 × 5、敷石は 1.1 m 幅)
    rows = 13
    for r in range(rows):
        y = -hl + (r + 0.5) * SLIP_L / rows
        for c, x in enumerate((-2.3, -1.15, 0.0, 1.15, 2.3)):
            xx = x + rnd.uniform(-0.04, 0.04) + (0.2 if r % 2 and c in (1, 3) else 0)
            stone(n, rnd, (xx, y, slip_z(y) - 0.06), (1.05, SLIP_L / rows - 0.08, 0.18), yaw=rnd.uniform(-1.5, 1.5),
                  tilt=(ang, 0), bevel=0.0, jitter=0.025, moss=0.06, z1=1.4)
    # 両脇の縁石 (6 個ずつ) と上端の柱石・壁
    # (M22-06 試作 2 の判断で変更: 縁石は 9 個ずつ、幅 0.9 m。上面 (slip_z + 0.33) に舟の舷側の支柱の足が載る。柱石は 2.6 m)
    for sx in (-1, 1):
        for k in range(9):
            y = -hl + (k + 0.5) * SLIP_L / 9
            stone(n, rnd, (sx * (SLIP_W / 2 - 0.45), y, slip_z(y) + 0.02), (0.9, SLIP_L / 9 - 0.1, 0.62), yaw=rnd.uniform(-2, 2),
                  tilt=(ang, rnd.uniform(-2, 2)), bevel=0.08, jitter=0.03, moss=0.3, z1=1.6)
        stone(n, rnd, (sx * (SLIP_W / 2 - 0.3), hl + 0.15, 0), (1.2, 1.2, 2.6), yaw=rnd.uniform(-4, 4), bevel=0.1,
              jitter=0.03, taper=0.88, moss=0.9, base_z=True, z1=2.4)
    for x in (-1.9, -0.6, 0.7, 2.0):
        stone(n, rnd, (x, hl + 0.3, 0), (1.3, 0.7, 1.9), yaw=rnd.uniform(-3, 3), bevel=0.07, moss=0.5, base_z=True, z1=1.8)
    # 竜骨を受ける木の盤木と、左右の滑り材
    # (M22-06 試作 2 の判断で変更: 盤木は 1.5 × 0.7 × 0.4 m を SLIP_BLOCK_YS の 8 か所、滑り材は ±1.1 m)
    for k, y in enumerate(SLIP_BLOCK_YS):
        n.add(K.box((1.5, 0.7, SLIP_BLOCK_H), bevel=0.0, jitter=0.015, seed=k), M["wood"],
              matrix=K.trs((0, y, slip_z(y) + 0.01 + SLIP_BLOCK_H / 2), (ang, 0, rnd.uniform(-3, 3))),
              shade=K.shade_const(rnd.uniform(0.8, 0.95)))
    for x in (-1.1, 1.1):
        n.add(K.tube([(x, -hl + 0.4, slip_z(-hl + 0.4) + 0.14), (x, hl - 0.4, slip_z(hl - 0.4) + 0.14)], [0.13, 0.13], n=6),
              M["wood"], smooth=True, shade=K.shade_const(0.85))
    return n


# ---------------------------------------------------------------- 石垣

def stone_wall():
    n = K.Node("stone_wall")
    rnd = random.Random(404)
    L = 4.0
    # (集落の建物の作り直しで変更: 一つずつの石を 4 段 (下は大きく、上は平たい笠石に苔)。端の太い立石と、足元に落ちた石)
    wall_run(n, rnd, (-L / 2, 0), (L / 2 - 0.62, 0), [(0.32, 6), (0.26, 5), (0.22, 5), (0.2, 4)], 0.58)
    pstone(n, rnd, (L / 2 - 0.3, 0, 0), (0.64, 0.66, 1.02), yaw=rnd.uniform(-5, 5), bevel=0.07, jitter=0.02, taper=0.9,
          moss=0.9, base_z=True, z1=0.9)
    for x, y in ((-1.3, -0.5), (0.4, 0.48)):
        pstone(n, rnd, (x, y, 0.08), (0.3, 0.24, 0.16), yaw=rnd.uniform(0, 90), bevel=0.0, jitter=0.03, moss=0.5)
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
    # (集落の建物の作り直しで変更: 柱は 3 本の枝を束ねて縄で括り、帯は横 9・縦 11 の細い繊維を隙間を残して編む。
    #  蔓を 2 本斜めに絡ませ、上の横木に小さな鐘を 5 つ、両の柱に 1 つずつ下げる (基準画の衝立))
    n = K.Node("woven_screen")
    rnd = random.Random(606)
    for sx in (-1, 1):
        x = sx * 0.95
        n.add(K.tube([(x, 0, -0.05), (x + sx * 0.02, 0, 1.0), (x, 0, 2.02)], [0.065, 0.058, 0.045], n=5), M["wood"],
              smooth=True, shade=K.shade_height(0, 1.0, 0.75, 1.0))
        n.add(K.tube([(x + sx * 0.08, 0.03, -0.05), (x + sx * 0.1, 0.02, 1.86)], [0.035, 0.025], n=3), M["wood"],
              smooth=True, shade=K.shade_const(0.85))  # 束ねた細い枝
        n.add(K.tube([(x + sx * 0.05, -0.06, -0.05), (x + sx * 0.06, -0.07, 1.2), (x + sx * 0.03, -0.06, 2.12)],
                     [0.03, 0.028, 0.02], n=4), M["wood"], smooth=True, shade=K.shade_const(0.78))
        for z in (0.16, 1.1, 1.92):
            lashing(n, (x + sx * 0.04, -0.01, z), Z, 0.125, w=0.13)
    for z in (0.42, 1.78):
        n.add(K.tube([(-1.0, 0, z), (1.0, 0, z + rnd.uniform(-0.03, 0.03))], [0.04, 0.04], n=4), M["wood"],
              shade=K.shade_const(0.9))
    import bmesh
    H = [0.56 + 0.26 * k for k in range(5)]   # 横の帯の高さ
    V = [-0.72 + 0.288 * k for k in range(6)]  # 縦の帯の位置
    # (集落の建物の作り直しで変更: 横 9・縦 11 の細い帯)
    H = [0.53 + 0.1525 * k + rnd.uniform(-0.012, 0.012) for k in range(9)]
    V = [-0.8 + 0.16 * k + rnd.uniform(-0.012, 0.012) for k in range(11)]

    def ribbon(pts, width_dir, shade, w):
        bm = bmesh.new()
        rows = [(bm.verts.new(p - width_dir * w / 2), bm.verts.new(p + width_dir * w / 2)) for p in pts]
        for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
            bm.faces.new((a0, b0, b1, a1))
        n.add(bm, M["weave"], smooth=True, recalc=False, shade=shade)
    for k, z in enumerate(H):
        xs = [-0.9] + V + [0.9]
        pts = [Vector((x, (0.018 if (j + k) % 2 else -0.018) if 0 < j < len(xs) - 1 else 0.0, z)) for j, x in enumerate(xs)]
        ribbon(pts, Z, K.shade_const(rnd.uniform(0.82, 1.0)), 0.11)
    for k, x in enumerate(V):
        zs = [0.44] + H + [1.76]
        pts = [Vector((x, (-0.018 if (j + k) % 2 else 0.018) if 0 < j < len(zs) - 1 else 0.0, z)) for j, z in enumerate(zs)]
        ribbon(pts, X_AXIS, K.shade_const(rnd.uniform(0.7, 0.88)), 0.1)
    for sx in (-1, 1):  # 四隅の括り縄
        for z in (0.42, 1.78):
            n.add(K.lathe([(0.075, -0.05), (0.075, 0.05)], n=4, cap_top=False, cap_bottom=False), M["rope"],
                  matrix=K.trs((sx * 0.95, 0, z)), shade=K.shade_const(0.9))
    vine = [(-0.95, -0.06, 1.95), (-0.55, -0.07, 1.62), (-0.1, -0.06, 1.7), (0.3, -0.07, 1.35), (0.55, -0.06, 0.9)]
    n.add(K.tube(vine, [0.028] * 4 + [0.015], n=3), M["vine"], smooth=True)
    m = K.aim(Vector((0.4, -0.5, 0.6)))
    m.translation = Vector(vine[2])
    n.add(K.leaf(0.24, 0.15, 0.025, bend=0.2), M["vine"], matrix=m, smooth=True)
    # (集落の建物の作り直しで追加) 右の柱の根元から斜めに登る 2 本目の蔓と葉
    vine2 = [(1.0, -0.05, 0.0), (0.85, -0.06, 0.5), (0.4, -0.05, 0.75), (-0.1, -0.06, 1.1), (-0.5, -0.06, 1.25),
             (-0.85, -0.07, 1.55)]
    n.add(K.tube(vine2, [0.03] * 5 + [0.015], n=3), M["vine"], smooth=True)
    for j, d in ((1, (0.5, -0.6, 0.5)), (3, (-0.3, -0.6, 0.7)), (4, (0.2, -0.7, -0.4)), (5, (-0.6, -0.5, 0.4))):
        m = K.aim(Vector(d))
        m.translation = Vector(vine2[j])
        n.add(K.leaf(0.22, 0.14, 0.025, bend=0.2), M["vine"], matrix=m, smooth=True, shade=K.shade_const(0.9))
    for x, z in ((-0.5, 1.78), (0.45, 1.78)):  # 上の横木に吊った小さな鐘
        top = Vector((x, -0.05, z - 0.14))
        n.add(K.tube([top + Z * 0.12, top], [0.008, 0.008], n=3, cap_start=False, cap_end=False), M["rope"])
        prof = [(0.0, 0.0), (0.05, -0.06), (0.07, -0.12), (0.0, -0.09)]
        n.add(K.lathe(prof, n=5), M["bell"], matrix=K.trs(top), smooth=True,
              per_face_mat=lambda c, nrm, t=top: M["bell_rim"] if c.z - t.z < -0.09 else None)
    # (集落の建物の作り直しで追加) 上の横木にさらに 3 つ、両の柱に 1 つずつ
    for x, y, z in ((-0.8, -0.05, 1.74), (0.0, -0.05, 1.74), (0.78, -0.05, 1.74), (-1.02, -0.07, 1.35), (1.02, -0.07, 1.05)):
        bell(n, (x, y, z), size=0.8, cord=0.12 + 0.04 * (abs(x) > 0.9))
    return n


# ---------------------------------------------------------------- L 字の石垣 (M22-06)

def stone_wall_corner():
    """L 字に曲がる 2 段の空積みの石垣。腕 A は +X へ 3 m、腕 B は +Y へ 2.4 m、原点は L の外側の角。
    角と腕 A の端に太い立石 (端の石の正面に浅く彫った六角の枠)"""
    # (集落の建物の作り直しで変更: 腕は一つずつの石の 4 段 (腕 B は崩れかけて上の段が短い)。端の立石を 1.05 m にし、
    #  紋は彫り込んだ四角の枠の中の六角と、その上下の短い溝 (基準画の端の石の刻み。字に見えないよう線は枠と紋だけ))
    n = K.Node("stone_wall_corner")
    rnd = random.Random(707)
    T = 0.55  # 壁の厚み
    # 角の立石
    pstone(n, rnd, (T / 2, T / 2, 0), (0.72, 0.72, 0.98), yaw=rnd.uniform(-4, 4), bevel=0.08, jitter=0.02, taper=0.9,
          moss=1.0, base_z=True, z1=0.9)
    # 腕 A (+X)
    LA0, LA1 = 0.62, 2.7
    wall_run(n, rnd, (LA0, T / 2), (LA1, T / 2), [(0.3, 5), (0.26, 4), (0.22, 4), (0.2, 3)], T)
    end = (LA1 + 0.3, T / 2, 0)
    pstone(n, rnd, end, (0.6, 0.66, 1.05), yaw=0, bevel=0.07, jitter=0.015, taper=0.9, moss=0.9,
          base_z=True, z1=0.9)
    # 腕 B (+Y)
    LB0, LB1 = 0.62, 2.4
    wall_run(n, rnd, (T / 2, LB0), (T / 2, LB1), [(0.3, 4), (0.26, 4)], T)
    wall_run(n, rnd, (T / 2, LB0), (T / 2, LB1 - 0.7), [(0.22, 3), (0.2, 2)], T, z0=0.56)
    pstone(n, rnd, (T / 2 + 0.05, LB1 - 0.3, 0.63), (0.4, 0.36, 0.14), yaw=20, bevel=0.0, jitter=0.03, z1=0.6)  # 崩れかけた天端の石
    # 端の立石の正面 (−Y) に浅く彫った六角の枠 (光らない、影になった溝)
    cz = 0.6
    face = T / 2 - 0.33 * (1 - 0.1 * cz / 1.05) - 0.006  # (集落の建物の作り直しで変更: 先細りの面に合わせる)

    def groove(p0, p1, w=0.03):
        d = p1 - p0
        m = K.aim(d, up=-Y)
        m.translation = (p0 + p1) / 2 + Vector((0, face, 0))
        n.add(K.box((d.length + w, w, 0.02)), M["stone"], matrix=m, shade=K.shade_const(0.45))
    for i in range(6):
        a0, a1 = math.radians(90 + 60 * i), math.radians(150 + 60 * i)
        p0 = Vector((end[0] + 0.12 * math.cos(a0), 0.0, cz + 0.12 * math.sin(a0)))
        p1 = Vector((end[0] + 0.12 * math.cos(a1), 0.0, cz + 0.12 * math.sin(a1)))
        groove(p0, p1)
    # 彫り込んだ四角の枠と、紋の上下の短い溝
    x0, x1, z0, z1 = end[0] - 0.2, end[0] + 0.2, cz - 0.27, cz + 0.27
    for a, b in (((x0, z0), (x1, z0)), ((x1, z0), (x1, z1)), ((x1, z1), (x0, z1)), ((x0, z1), (x0, z0)),
                 ((end[0], cz + 0.15), (end[0], cz + 0.23)), ((end[0], cz - 0.15), (end[0], cz - 0.23))):
        groove(Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1])), w=0.025)
    for i in range(2):  # 足元の落ちた石
        pstone(n, rnd, (1.2 + 0.8 * i, -0.35 - 0.1 * i, 0.08), (0.3, 0.26, 0.16), yaw=rnd.uniform(0, 90), bevel=0.0,
              jitter=0.03, moss=0.5)
    return n


if __name__ == "__main__":
    nodes = [hut(), hut_lod1(), stepping_stone(), lantern_post(), slipway(), stone_wall(), megalith(), woven_screen(),
             stone_wall_corner()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "settlement.glb"))
