"""空の舟 (ship) の観察画面用アセット → assets/models/observe/ship.glb

建造の段階ごとに 1 ノード。ゲーム側は舟の進み (0〜120) で表示するノードを切り替える:
  ship_keel   竜骨と船首・船尾の柱を盤木 (cradle) の上に立て、柱を支柱で支える
  ship_ribs   竜骨 + 曲げた肋材 11 本 + 肋を留める細い通し材 (ribband)
  ship_planks 下から 4 段の外板 + 5 段目を中ほどだけ。上に肋が覗く。舷側を支える斜めの支柱
  ship_mast   外板を張り終えた船体 + 舷縁 + 甲板 + 帆柱
  ship_sails  完成: 帆桁に畳んだ編み繊維の帆・索具・縄梯子・手すり・舷側に吊った小さな青銅の鐘 (暖かく光る)
  ship_flying 飛び立ち: 完成と同じで帆を広げて風をはらむ。盤木と支柱は無く、竜骨の下にムーのシアンの光 (浮かぶ力)
と、造船場に置く timber_pile (鐘樹の丸太の山と荒く割った板)。

- 船体は鐘樹の淡い材。外板は鎧張り (clinker): 各段の下の縁を 3.5 cm 外へずらして下の段に重ね、段ごとに明るさを変える
- 全長 ≈ 14 m (船首の反りまで)、幅 ≈ 4 m。原点は竜骨の底の中心 (0, 0, 0)、Blender で船首は −Y (glTF では +Z)
- 盤木・支柱は原点より下 (z = −CRADLE_H まで) に伸びる。船台に載せるときは原点を盤木の高さぶん上げる
- 予算: 各段 ≤ 6,000 三角形、timber_pile ≤ 600
形は assets/textures/board/sheets/ship.png と key-visuals/{shipyard,departure}.png、画風は creatures/ に寄せる。

実行: blender -b --factory-startup --python tools/blender/observe_ship.py
"""
import math
import os
import random
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402
from observe_kit import Z  # noqa: E402

K.reset()


def translucent(m, alpha):
    """半透明 (glTF の alphaMode BLEND)。浮かぶ力の柔らかい光に使う"""
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Alpha"].default_value = alpha
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        m.blend_method = "BLEND"
    return m


M = {
    "hull": K.material("ship_hull", "#E4D6BC", rough=0.85, double=True),  # 鐘樹の淡い材 (外板は内側も見える)
    "timber": K.material("ship_timber", "#D8C6A4", rough=0.85),           # 竜骨・肋・帆柱・帆桁・手すり
    "deck": K.material("ship_deck", "#CDB58E", rough=0.9),
    "block": K.material("ship_block", "#A07A52", rough=0.9),              # 盤木と支柱 (集落の木と同じ色)
    "rope": K.material("ship_rope", "#B79E6E", rough=0.95),               # 編んだ縄
    "sail": K.material("ship_sail", "#EAE0C8", rough=0.95, double=True),  # 編み繊維の帆
    "bell": K.material("ship_bell", "#7A4E2A", rough=0.5, emit=K.BELL_AMBER, strength=0.2),
    "bell_rim": K.material("ship_bell_rim", "#FFD58F", rough=0.5, emit=K.BELL_AMBER, strength=3.0),
    "mu": K.material("ship_mu", "#8FF5E6", rough=0.5, emit=K.MU_CYAN, strength=2.0),
    "mu_ring": K.material("ship_mu_ring", "#8FF5E6", rough=0.5, emit=K.MU_CYAN, strength=2.0, double=True),
    "lift": translucent(K.material("ship_lift", "#8FF5E6", rough=0.5, emit=K.MU_CYAN, strength=1.0, double=True), 0.2),
    "bark": K.material("ship_log_bark", "#E6DFD1", rough=0.9),
    "cut": K.material("ship_log_cut", "#EFD6A8", rough=0.9),
    "ring": K.material("ship_log_ring", "#D2AC7B", rough=0.9),
}

# ---------------------------------------------------------------- 船体の形 (t: 0 船首 → 1 船尾、s: 0 竜骨 → 1 舷縁)

L2 = 6.3          # 竜骨の端から端の半分 (船首・船尾の傾きと反りで全長 ≈ 14 m)
HB = 1.9          # 最大の半幅
Z0 = 0.28         # 船体の底 (竜骨の上面) の高さ。竜骨の底が z = 0
KEEL_R = 0.2      # 竜骨の四角い断面の外接半径 (半幅 0.14)
CRADLE_H = 0.35   # 盤木の底 (原点より下)
NT, NS = 24, 7    # 長さ方向の分割、外板の段数
LAP = 0.035       # 鎧張りの重なり
MAST_T = 0.45     # 帆柱の位置 (t)
MAST_TOP = 11.6
YARD_Z = 9.7
DECK_Z = 2.05


def e_(t):
    return abs(2 * t - 1)


def hb(t):
    return HB * max(0.0, 1 - e_(t) ** 2.3) ** 0.6


def z0(t):
    return Z0 + 1.3 * e_(t) ** 3


def z1(t):
    return 2.55 + (1.75 if t < 0.5 else 1.35) * e_(t) ** 2.4  # 船首を船尾より高く反らす


def ty(t):
    return -L2 + 2 * L2 * t


def hull_pt(t, s, side=1, off=0.0):
    """船体の外面の点。off > 0 で断面の外向きにずらす (鎧張り・通し材)、< 0 で内側 (肋)"""
    th = s * math.pi / 2
    h, a, b = hb(t), z0(t), z1(t)
    x = h * math.sin(th)
    z = a + (b - a) * (1 - math.cos(th))
    sign = -1 if t < 0.5 else 1
    y = ty(t) + sign * 0.75 * e_(t) ** 4 * s ** 1.5  # 船首・船尾の柱を外へ傾ける
    nx, nz = (b - a) * math.sin(th), -h * math.cos(th)
    ln = math.hypot(nx, nz) or 1.0
    return Vector((side * (x + off * nx / ln), y, z + off * nz / ln))


def tspan(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]


# ---------------------------------------------------------------- 部品

def keel(node, curl=True):
    """竜骨と船首・船尾の柱 (一本の四角い材)。船首の先は前へ反って巻く"""
    prof = [hull_pt(1.0, s) for s in (1.0, 0.75, 0.5, 0.25)]
    prof += [hull_pt(t, 0.0) for t in (1.0, 0.93, 0.84, 0.72, 0.6, 0.5, 0.4, 0.28, 0.16, 0.07, 0.0)]
    prof += [hull_pt(0.0, s) for s in (0.25, 0.5, 0.75, 1.0)]
    pts = []
    for i, p in enumerate(prof):
        d = prof[min(i + 1, len(prof) - 1)] - prof[max(i - 1, 0)]
        d = Vector((0, d.y, d.z)).normalized()
        nrm = Vector((0, -d.z, d.y))  # 輪郭の外向き (YZ 面内)
        pts.append(Vector((0, p.y, p.z)) + nrm * KEEL_R * 0.7)
    top_b, top_s = pts[-1], pts[0]
    radii = [KEEL_R] * len(pts)
    if curl:
        pts = [top_s + Vector((0, 0.35, 0.75)), top_s + Vector((0, 0.18, 0.4))] + pts
        pts += [top_b + Vector((0, -0.28, 0.5)), top_b + Vector((0, -0.42, 1.0)), top_b + Vector((0, -0.25, 1.4)),
                top_b + Vector((0, 0.02, 1.52))]
        radii = [0.12, 0.17] + radii + [0.18, 0.15, 0.12, 0.08]
    node.add(K.tube(pts, radii, n=4, phase=math.pi / 4), M["timber"], smooth=False,
             shade=K.shade_height(0.0, 2.0, 0.78, 1.0))
    return pts


def keel_bottom(y):
    t = (y + L2) / (2 * L2)
    return z0(t) - KEEL_R * 1.4


def cradle(node, rnd, posts=False):
    """竜骨を受ける盤木。posts=True は竜骨だけの段で、船首・船尾の柱と竜骨を左右から支柱で支える"""
    for y in (-3.85, -1.3, 1.25, 3.8):
        top = keel_bottom(y) + 0.01
        h = top + CRADLE_H
        node.add(K.box((0.95, 0.45, h), jitter=0.012, seed=rnd.randrange(1 << 30)), M["block"],
                 matrix=K.trs((0, y, -CRADLE_H + h / 2), (0, 0, rnd.uniform(-3, 3))),
                 shade=K.shade_const(rnd.uniform(0.8, 0.95)))
        node.add(K.box((0.4, 0.5, 0.12), jitter=0.01, seed=rnd.randrange(1 << 30)), M["block"],
                 matrix=K.trs((0, y, top - 0.06), (0, 0, 90)), shade=K.shade_const(0.75))  # 楔
    if posts:
        for t, sgn in ((0.0, -1), (1.0, 1)):
            p = hull_pt(t, 0.62)
            for side in (-1, 1):
                a = Vector((side * 0.12, p.y, p.z))
                b = Vector((side * 1.7, p.y + sgn * 0.3, -CRADLE_H))
                node.add(K.tube([a, b], [0.07, 0.08], n=4), M["block"], shade=K.shade_const(0.85))
            a = Vector((0, p.y + sgn * 0.12, p.z - 0.3))
            b = Vector((0, p.y + sgn * 1.6, -CRADLE_H))
            node.add(K.tube([a, b], [0.07, 0.08], n=4), M["block"], shade=K.shade_const(0.85))
        for y in (-2.5, 2.5):
            for side in (-1, 1):
                a = Vector((side * 0.13, y, 0.18))
                b = Vector((side * 1.1, y, -CRADLE_H))
                node.add(K.tube([a, b], [0.06, 0.07], n=4), M["block"], shade=K.shade_const(0.85))


def shores(node, rnd):
    """舷側の曲がり (s ≈ 0.4) を地面から支える斜めの支柱と足の板"""
    for t in (0.28, 0.5, 0.72):
        for side in (-1, 1):
            a = hull_pt(t, 0.42, side, off=0.06)
            b = Vector((side * 2.55, a.y, -CRADLE_H + 0.06))
            node.add(K.tube([a, b], [0.075, 0.085], n=4), M["block"], shade=K.shade_const(rnd.uniform(0.78, 0.9)))
            node.add(K.box((0.5, 0.35, 0.1), jitter=0.01, seed=rnd.randrange(1 << 30)), M["block"],
                     matrix=K.trs((side * 2.6, a.y, -CRADLE_H + 0.05)), shade=K.shade_const(0.75))


RIB_TS = tspan(0.14, 0.86, 10)


def ribs(node, head=0.35, ts=RIB_TS):
    """曲げた肋材 (U 字、竜骨の上で左右がつながる)。head は舷縁より上に出る頭"""
    for t in ts:
        ss = [1.0, 0.8, 0.6, 0.4, 0.2]
        pts = []
        if head:
            pts.append(hull_pt(t, 1.0, -1, off=-0.09) + Z * head)
        pts += [hull_pt(t, s, -1, off=-0.09) for s in ss]
        pts.append(hull_pt(t, 0.0, 1, off=-0.09))
        pts += [hull_pt(t, s, 1, off=-0.09) for s in reversed(ss)]
        if head:
            pts.append(hull_pt(t, 1.0, 1, off=-0.09) + Z * head)
        node.add(K.tube(pts, [0.075] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_height(0.3, 2.5, 0.8, 1.0))


def ribbands(node):
    for s in (0.5, 1.0):
        for side in (-1, 1):
            pts = [hull_pt(t, s, side, off=0.02) for t in tspan(0.09, 0.91, 12)]
            node.add(K.tube(pts, [0.05] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                     shade=K.shade_const(0.88))


def strake(node, k, side, t0=0.0, t1=1.0, rnd=None):
    """外板の k 段目 (片舷)。下の縁を LAP だけ外へずらして下の段に重ねる (鎧張り)"""
    s0, s1 = k / NS, (k + 1) / NS
    n = max(2, round(NT * (t1 - t0)))
    bm = bmesh.new()
    lo = [bm.verts.new(hull_pt(t, s0, side, off=LAP)) for t in tspan(t0, t1, n)]
    up = [bm.verts.new(hull_pt(t, s1, side, off=0.0)) for t in tspan(t0, t1, n)]
    for i in range(n):
        f = (lo[i], lo[i + 1], up[i + 1], up[i])
        bm.faces.new(f if side > 0 else tuple(reversed(f)))
    lower = {tuple(round(c, 4) for c in v.co) for v in lo}
    mul = (0.9, 1.0, 0.94, 0.98, 0.9, 1.0, 0.95)[k % 7] * (rnd.uniform(0.97, 1.0) if rnd else 1.0)

    def shade(co, nrm):
        seam = 0.8 if tuple(round(c, 4) for c in co) in lower else 1.0  # 段の下の縁の影
        v = mul * seam * (0.74 + 0.26 * min(1.0, max(0.0, (co.z - 0.2) / 2.4)))
        return (v, v * 0.99, v * 0.96)
    node.add(bm, M["hull"], smooth=True, recalc=False, shade=shade)


def hull(node, rnd, full=True):
    for side in (-1, 1):
        if full:
            for k in range(NS):
                strake(node, k, side, rnd=rnd)
        else:
            for k in range(4):
                strake(node, k, side, rnd=rnd)
            strake(node, 4, side, 0.22, 0.74, rnd=rnd)


def gunwale(node):
    for side in (-1, 1):
        pts = [hull_pt(t, 1.0, side, off=0.03) + Z * 0.03 for t in tspan(0.02, 0.98, 20)]
        node.add(K.tube(pts, [0.075] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_const(0.95))


def deck(node, rnd):
    """甲板: 舷の内側に長さ方向の板 6 枚"""
    ts = [t for t in tspan(0.05, 0.95, 36) if z0(t) + 0.2 < DECK_Z]
    cols = 6

    def half(t):
        r = min(1.0, (DECK_Z - z0(t)) / (z1(t) - z0(t)))
        return hb(t) * math.sin(math.acos(1 - r)) - 0.08
    for c in range(cols):
        bm = bmesh.new()
        u0, u1 = -1 + 2 * c / cols, -1 + 2 * (c + 1) / cols
        a = [bm.verts.new((half(t) * u0, ty(t), DECK_Z)) for t in ts]
        b = [bm.verts.new((half(t) * u1, ty(t), DECK_Z)) for t in ts]
        for i in range(len(ts) - 1):
            bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
        v = rnd.uniform(0.84, 1.0)
        node.add(bm, M["deck"], recalc=False, shade=K.shade_const((v, v * 0.98, v * 0.95)))
    # 船尾の低い台と、船首の腰掛け
    for t, w, h in ((0.86, 0.9, 0.35), (0.14, 0.7, 0.3)):
        node.add(K.box((w * 2, 0.9, h), bevel=0.03), M["deck"], matrix=K.trs((0, ty(t), DECK_Z + h / 2)),
                 shade=K.shade_const(0.88))


MAST_Y = ty(MAST_T)


def mast(node):
    node.add(K.tube([(0, MAST_Y, z0(MAST_T)), (0, MAST_Y, 5.5), (0, MAST_Y, MAST_TOP)], [0.17, 0.14, 0.09], n=6),
             M["timber"], smooth=True, shade=K.shade_height(2.0, 6.0, 0.85, 1.0))
    node.add(K.box((0.34, 0.34, 0.22), bevel=0.04), M["timber"], matrix=K.trs((0, MAST_Y, MAST_TOP - 0.25)),
             shade=K.shade_const(0.85))
    node.add(K.box((0.3, 0.3, 0.2), bevel=0.03), M["timber"], matrix=K.trs((0, MAST_Y, DECK_Z + 0.1)),
             shade=K.shade_const(0.8))  # 甲板の帆柱受け


YARD_Y = MAST_Y - 0.22


def yard(node):
    pts = [(x, YARD_Y, YARD_Z) for x in (-3.25, -1.6, 0.0, 1.6, 3.25)]
    node.add(K.tube(pts, [0.05, 0.085, 0.1, 0.085, 0.05], n=5), M["timber"], smooth=True, shade=K.shade_const(0.95))
    node.add(K.tube([(0, MAST_Y, YARD_Z + 0.1), (0, MAST_Y, YARD_Z - 0.12)], [0.2, 0.2], n=5), M["rope"],
             shade=K.shade_const(0.85))  # 帆桁を帆柱に括る縄


def furled_sail(node):
    """帆桁の下に巻いて括った帆"""
    xs = (-2.95, -2.2, -1.1, 0.0, 1.1, 2.2, 2.95)
    rr = (0.08, 0.17, 0.24, 0.27, 0.24, 0.17, 0.08)
    pts = [(x, YARD_Y, YARD_Z - 0.26 - 0.08 * math.cos(x / 3.0 * math.pi / 2)) for x in xs]
    node.add(K.tube(pts, rr, n=6), M["sail"], smooth=True, shade=K.shade_height(YARD_Z - 0.6, YARD_Z, 0.8, 1.0),
             soft=((0, YARD_Y, YARD_Z + 0.5), 0.3))
    for x in (-2.3, -1.2, 0.0, 1.2, 2.3):
        r = 0.27 * (1 - (abs(x) / 3.1) ** 2) + 0.05
        m = K.trs((x, YARD_Y, YARD_Z - 0.28), (0, 90, 0))
        node.add(K.lathe([(r + 0.02, -0.035), (r + 0.02, 0.035)], n=6, cap_top=False, cap_bottom=False), M["rope"],
                 matrix=m, shade=K.shade_const(0.9))


SAIL_TOP, SAIL_BOT = YARD_Z - 0.15, 4.15


def sail_pt(u, v, billow):
    """帆の面の点。u: 0 左舷 → 1 右舷、v: 0 上 → 1 下。billow で船首側 (−Y) へ膨らむ"""
    w = 3.0 + 0.35 * v
    x = (2 * u - 1) * w
    z = SAIL_TOP + (SAIL_BOT - SAIL_TOP) * v
    bulge = billow * math.sin(math.pi * u) * math.sin(math.pi * (0.12 + 0.8 * v)) + 0.25 * billow * v * v
    return Vector((x, YARD_Y - 0.05 - bulge, z + 0.35 * billow * v * (1 - v) * math.sin(math.pi * u)))


def sail_shade(mul):
    def f(co, n):
        v = mul * (0.86 + 0.14 * (co.z - SAIL_BOT) / (SAIL_TOP - SAIL_BOT))
        return (v, v, v * 0.97)
    return f


def open_sail(node, billow=1.15):
    """広げた帆: 縦の布の帯 8 枚 (帯ごとに明るさを変えて織った布の継ぎ目に見せる)"""
    NU, NV = 8, 6
    for c in range(NU):
        bm = bmesh.new()
        rows = []
        for j in range(NV + 1):
            v = j / NV
            rows.append((bm.verts.new(sail_pt(c / NU, v, billow)), bm.verts.new(sail_pt((c + 1) / NU, v, billow))))
        for j in range(NV):
            a0, a1 = rows[j]
            b0, b1 = rows[j + 1]
            bm.faces.new((a0, b0, b1, a1))
        node.add(bm, M["sail"], smooth=True, recalc=False, shade=sail_shade(1.0 if c % 2 else 0.93))
    foot = [sail_pt(u, 1.0, billow) for u in tspan(0, 1, 8)]
    node.add(K.tube(foot, [0.035] * len(foot), n=3), M["rope"], shade=K.shade_const(0.9))  # 帆の裾の縄
    return sail_pt(0, 1, billow), sail_pt(1, 1, billow)


def rope(node, a, b, r=0.025):
    node.add(K.tube([Vector(a), Vector(b)], [r, r], n=3, cap_start=False, cap_end=False), M["rope"],
             shade=K.shade_const(0.9))


def rigging(node, bow_top, stern_top, clews=None):
    head = Vector((0, MAST_Y, MAST_TOP - 0.35))
    shroud_ts = (0.38, 0.47, 0.56)
    for side in (-1, 1):
        feet = [hull_pt(t, 1.0, side, off=0.08) + Z * 0.05 for t in shroud_ts]
        for f in feet:
            rope(node, head, f, 0.028)
        # 縄梯子: 前の 2 本の横縄
        a0, b0 = feet[0], feet[1]
        for k in range(1, 9):
            u = k / 10
            rope(node, a0.lerp(head, u), b0.lerp(head, u), 0.02)
    rope(node, head + Z * 0.2, bow_top, 0.03)     # 前の支え
    rope(node, head + Z * 0.1, stern_top, 0.03)   # 後ろの支え
    rope(node, (0, MAST_Y, MAST_TOP - 0.3), (0, YARD_Y, YARD_Z + 0.1), 0.025)  # 帆桁の吊り
    for side in (-1, 1):
        end = Vector((side * 3.2, YARD_Y, YARD_Z))
        rope(node, end, hull_pt(0.8, 1.0, side, off=0.08) + Z * 0.05, 0.022)  # 帆桁の端を船尾へ引く縄
    if clews:
        for c, side in zip(clews, (-1, 1)):
            rope(node, c, hull_pt(0.66, 1.0, side, off=0.08) + Z * 0.1, 0.025)  # 帆の裾の角を舷へ


def bell(node, top, scale, seed):
    """裾の開いた小さな青銅の鐘。裾の帯と内側は明るく光り (引いても鐘の形が読める)、胴は暗い青銅"""
    rnd = random.Random(seed)
    prof = [(0.0, 0.0), (0.075, -0.02), (0.085, -0.12), (0.12, -0.2), (0.16, -0.25), (0.0, -0.19)]
    prof = [(r * scale, z * scale) for r, z in prof]
    top = Vector(top)
    rim = lambda c, n: M["bell_rim"] if c.z - top.z < -0.2 * scale else None  # noqa: E731
    node.add(K.lathe(prof, n=6, phase=rnd.uniform(0, 1)), M["bell"], matrix=K.trs(top), smooth=True,
             per_face_mat=rim, shade=K.shade_height(top.z - 0.25 * scale, top.z, 0.8, 1.0))


def rail(node, bells=True):
    """舷縁の上の手すり (柱と横木) と、柱の間に吊った鐘"""
    ts = tspan(0.12, 0.88, 12)
    for side in (-1, 1):
        top = [hull_pt(t, 1.0, side, off=0.0) + Z * 0.5 for t in tspan(0.1, 0.9, 16)]
        node.add(K.tube(top, [0.045] * len(top), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_const(0.95))
        for t in ts:
            p = hull_pt(t, 1.0, side, off=0.0)
            node.add(K.tube([p + Z * 0.05, p + Z * 0.5], [0.035, 0.035], n=3, cap_start=False, cap_end=False),
                     M["timber"], shade=K.shade_const(0.9))
        if bells:
            for i, t in enumerate(ts[:-1]):
                if i % 2:
                    continue
                tm = (t + ts[i + 1]) / 2
                p = hull_pt(tm, 1.0, side, off=0.14) + Z * 0.46
                node.add(K.tube([p + Z * 0.04, p - Z * 0.05], [0.012, 0.012], n=3, cap_start=False, cap_end=False),
                         M["rope"])
                bell(node, p - Z * 0.05, 1.1, seed=int(tm * 1000) + (side > 0) * 7)


def mu_glow(node):
    """浮かぶ力: 竜骨の底のシアンの継ぎ目、竜骨の下に重なる細長い六角の光の輪 3 つ (土兎の六角の紋と同じ意匠)、
    ごく淡い光のレンズ 1 枚"""
    pts = [hull_pt(t, 0.0) for t in tspan(0.1, 0.9, 10)]
    pts = [Vector((0, p.y, p.z - KEEL_R * 1.42)) for p in pts]
    node.add(K.tube(pts, [0.06] * len(pts), n=4, phase=math.pi / 4), M["mu"])
    for z, rx, ry in ((-0.4, 0.9, 4.6), (-0.95, 1.45, 5.6), (-1.55, 2.0, 6.5)):
        node.add(K.lathe([(0.9, 0.0), (1.0, 0.0)], n=6, phase=math.pi / 2, cap_top=False, cap_bottom=False),
                 M["mu_ring"], matrix=K.trs((0, 0, z), scale=(rx, ry, 1.0)))
    node.add(K.ico((1.7, 6.2, 0.7), subdiv=1, seed=2), M["lift"], matrix=K.trs((0, 0, -0.9)), smooth=True)


# ---------------------------------------------------------------- 段階

STAGES = ["ship_keel", "ship_ribs", "ship_planks", "ship_mast", "ship_sails", "ship_flying"]


def stage(name):
    n = K.Node(name)
    rnd = random.Random(11)  # 段階をまたいで同じ部品は同じ形にする
    i = STAGES.index(name)
    pts = keel(n)
    bow_top, stern_top = pts[-1], pts[0]
    if name != "ship_flying":
        cradle(n, random.Random(21), posts=(i == 0))
    if i == 1:
        ribs(n)
        ribbands(n)
    if i == 2:
        ribs(n)
        hull(n, rnd, full=False)
        shores(n, random.Random(31))
    if i >= 3:
        hull(n, rnd, full=True)
        gunwale(n)
        deck(n, random.Random(41))
        mast(n)
        ribs(n, head=0.0, ts=RIB_TS[1:-1:2])  # 甲板の上に覗く肋の頭の代わりに、内側の肋を少しだけ
        if name != "ship_flying":
            shores(n, random.Random(31))
    if i >= 4:
        yard(n)
        rail(n)
        if name == "ship_flying":
            clews = open_sail(n)
            rigging(n, bow_top, stern_top, clews)
            mu_glow(n)
        else:
            furled_sail(n)
            rigging(n, bow_top, stern_top)
    return n


# ---------------------------------------------------------------- 丸太の山

def log(node, length, r, center, yaw, seed, pitch=90):
    prof = [(0.0, 0.0), (0.5 * r, 0.0), (0.93 * r, 0.0), (r, 0.03), (r * 1.02, length * 0.5), (r, length - 0.03),
            (0.93 * r, length), (0.5 * r, length), (0.0, length)]
    m = K.trs(center, (0, pitch, yaw)) @ K.trs((0, 0, -length / 2))
    inv = m.inverted()

    def mat(c, nrm):
        lc = inv @ c
        if 0.01 < lc.z < length - 0.01:
            return None
        rel = math.hypot(lc.x, lc.y) / r
        return M["ring"] if rel < 0.5 else M["cut"]
    node.add(K.lathe(prof, n=6, cap_top=False, cap_bottom=False, wobble=0.03, seed=seed, phase=0.3), M["bark"],
             matrix=m, smooth=False, per_face_mat=mat, shade=K.shade_height(0, 0.9, 0.78, 1.0))


def timber_pile():
    """造船場の材木置き場: 鐘樹の丸太 5 本 (下 3・上 2) と荒く割った板 3 枚、丸太止めの杭"""
    n = K.Node("timber_pile")
    rnd = random.Random(51)
    r = 0.22
    for k, x in enumerate((-0.45, 0.0, 0.45)):
        log(n, 3.0 + rnd.uniform(-0.2, 0.2), r, (rnd.uniform(-0.1, 0.1), x, r), rnd.uniform(-2, 2),
            seed=60 + k, pitch=90)
    zt = r + math.sqrt((2 * r) ** 2 - 0.225 ** 2)
    for k, x in enumerate((-0.225, 0.225)):
        log(n, 2.7 + rnd.uniform(-0.2, 0.2), r * 0.95, (0.1, x, zt - 0.02), rnd.uniform(-3, 3), seed=70 + k, pitch=90)
    # 丸太は X 方向に寝かせる。転がり止めの杭は Y の両脇
    for y in (-0.78, 0.78):
        n.add(K.tube([(0.9, y, -0.05), (0.9, y, 0.75)], [0.06, 0.05], n=4), M["block"], shade=K.shade_const(0.85))
        n.add(K.tube([(-0.9, y, -0.05), (-0.9, y, 0.7)], [0.06, 0.05], n=4), M["block"], shade=K.shade_const(0.85))
    for k in range(3):
        n.add(K.box((2.6, 0.32, 0.06), jitter=0.015, seed=80 + k), M["timber"],
              matrix=K.trs((rnd.uniform(-0.2, 0.2), -1.25 + 0.05 * k, 0.03 + 0.065 * k), (0, 0, rnd.uniform(-6, 6))),
              shade=K.shade_const(rnd.uniform(0.85, 1.0)))
    n.add(K.box((2.4, 0.3, 0.06), jitter=0.015, seed=90), M["timber"],
          matrix=K.trs((0.2, 1.05, 0.42), (-62, 0, 3)), shade=K.shade_const(0.9))  # 丸太に立てかけた板
    return n


if __name__ == "__main__":
    nodes = [stage(s) for s in STAGES] + [timber_pile()]
    objs = [nd.build() for nd in nodes]
    K.export_glb(objs, os.path.join(K.OUT_DIR, "ship.glb"))
