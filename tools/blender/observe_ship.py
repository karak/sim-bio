"""空の舟 (ship) の観察画面用アセット → assets/models/observe/ship.glb

建造の段階ごとに 1 ノード。ゲーム側は舟の進み (0〜120) で表示するノードを切り替える:
  ship_keel   竜骨と船首・船尾の柱を盤木 (cradle) の上に立て、柱を支柱で支える
  ship_ribs   竜骨 + 曲げた肋材 11 本 + 肋を留める細い通し材 (ribband)
  ship_planks 下から 4 段の外板 + 5 段目を中ほどだけ。上に肋が覗く。舷側を支える斜めの支柱
  ship_mast   外板を張り終えた船体 + 舷縁 + 甲板 + 帆柱
  ship_sails  完成: 帆桁に畳んだ編み繊維の帆・索具・縄梯子・手すり・舷側に吊った小さな青銅の鐘 (暖かく光る)
  ship_flying 飛び立ち: 完成と同じで帆を広げて風をはらむ。盤木と支柱は無く、竜骨の下にムーのシアンの光 (浮かぶ力)
と、造船場に置く timber_pile (鐘樹の丸太の山と荒く割った板)。
(M22-06 試作 2 の判断「船は大きく、立派な感じがほしい」で変更: 肋は 17 本、外板は 11 段 (板の段は下 7 段 + 8 段目の中ほど)。
 船尾に欄干つきの高い船尾楼、帆柱は 3 本 (前・主・後ろ)、帆は主と前に 2 段ずつ + 後ろに 1 枚 + 前の三角帆。
 舷側の太い腰板 (wale)、船首の巻いた柱に大きな鐘。飛び立ちは船体に沿ったシアンの象嵌の線と、船首の六角の紋を足す)

- 船体は鐘樹の淡い材。外板は鎧張り (clinker): 各段の下の縁を 3.5 cm 外へずらして下の段に重ね、段ごとに明るさを変える
  (M22-06 試作 2 の判断で変更: 重ねは 6 cm)
- 全長 ≈ 14 m (船首の反りまで)、幅 ≈ 4 m。原点は竜骨の底の中心 (0, 0, 0)、Blender で船首は −Y (glTF では +Z)
  (M22-06 試作 2 の判断で変更: 全長 ≈ 25 m (船首の巻きまで)、幅 ≈ 7 m、舷縁は中央で 5.8 m、船尾楼の欄干の上は ≈ 9.7 m、主帆柱の頂 22 m。原点と向きは同じ)
- 盤木・支柱は原点より下 (z = −CRADLE_H まで) に伸びる。船台に載せるときは原点を盤木の高さぶん上げる
  (M22-06 試作 2 の判断で変更: 盤木は −0.5 m まで。支柱の足は船台の敷石 (z = PAVE) と縁石の上 (z = CURB) まで下ろす)
- 予算: 各段 ≤ 6,000 三角形、timber_pile ≤ 600
  (M22-06 試作 2 の判断で変更: 各段 ≤ 12,000 三角形。timber_pile は変えない)
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

L2 = 10.3         # 竜骨の端から端の半分 (船首・船尾の傾きと反りで全長 ≈ 14 m) (M22-06 試作 2 の判断で変更: 6.3 → 10.3、全長 ≈ 26 m)
HB = 3.5          # 最大の半幅 (M22-06 試作 2 の判断で変更: 1.9 → 3.5、幅 7 m)
Z0 = 0.48         # 船体の底 (竜骨の上面) の高さ。竜骨の底が z = 0 (M22-06 試作 2 の判断で変更: 0.28 → 0.48 = KEEL_R × √2)
KEEL_R = 0.34     # 竜骨の四角い断面の外接半径 (半幅 0.14) (M22-06 試作 2 の判断で変更: 0.2 → 0.34、半幅 0.24)
CRADLE_H = 0.5    # 盤木の底 (原点より下) (M22-06 試作 2 の判断で変更: 0.35 → 0.5)
NT, NS = 40, 11   # 長さ方向の分割、外板の段数 (M22-06 試作 2 の判断で変更: 24, 7 → 40, 11)
LAP = 0.06        # 鎧張りの重なり (M22-06 試作 2 の判断で変更: 0.035 → 0.06)
MAST_T = 0.47     # 帆柱の位置 (t) (M22-06 試作 2 の判断で変更: 0.45 → 0.47、主帆柱。前と後ろの帆柱は MASTS)
MAST_TOP = 22.0   # (M22-06 試作 2 の判断で変更: 11.6 → 22.0、主帆柱の頂)
YARD_Z = 13.0     # (M22-06 試作 2 の判断で変更: 9.7 → 13.0、主帆柱の下の帆桁。帆桁は SAILS に並べる)
DECK_Z = 4.5      # (M22-06 試作 2 の判断で変更: 2.05 → 4.5)
# (M22-06 試作 2 の判断で足した形の数: 短く深い船体、船首を高く反らせ、船尾に高い船尾楼)
DEPTH = 5.6       # 船体の中央の舷縁の高さ (竜骨の底から)。前は 2.55
BOW_RISE, STERN_RISE = 2.8, 1.8  # 舷縁の反り (船首・船尾の端で足す高さ)。前は 1.75 / 1.35
KEEL_RISE = 2.4   # 竜骨の両端の反り上がり (端に寄せて e⁴ で上げる)。前は 1.3 (e³)
RAKE = 2.0        # 船首・船尾の柱の外への傾き。前は 0.75
CASTLE_T0 = 0.72  # 船尾楼の前の壁の位置 (t)
CASTLE_TOP = 8.6  # 船尾楼の舷の上端 (前の壁のところ。船尾へ向けて 0.5 m 上がる)
CASTLE_DECK = 7.4  # 船尾楼の床
# 船台 (observe_settlement.py の slipway) の高さを舟の原点から測ったもの。支柱の足をここに下ろす
PAVE = -(CRADLE_H + 0.38)   # 敷石の上面 (船台の盤木は敷石から 0.38 m 立つ)
CURB = -(CRADLE_H + 0.08)   # 両脇の縁石の上面
CURB_X = 3.35               # 縁石の中心の横位置
CRADLE_YS = (-7.25, -4.35, -1.45, 1.45, 4.35, 7.25)  # 盤木の前後位置 (船台の盤木の内側 6 つと同じ)


def e_(t):
    return abs(2 * t - 1)


def hb(t):
    return HB * max(0.0, 1 - e_(t) ** 2.6) ** 0.55  # (M22-06 試作 2 の判断で変更: 2.3 / 0.6 → 2.6 / 0.55、両端まで太く短く見せる)


def z0(t):
    return Z0 + KEEL_RISE * e_(t) ** 4  # (M22-06 試作 2 の判断で変更: 1.3 × e³ → KEEL_RISE × e⁴、底を長く平らに)


def z1(t):
    return DEPTH + (BOW_RISE if t < 0.5 else STERN_RISE) * e_(t) ** 2.4  # 船首を船尾より高く反らす


def ty(t):
    return -L2 + 2 * L2 * t


def ctop(t):
    """(M22-06 試作 2 で足した) 舷の上端。船尾楼より前は舷縁 (z1) のまま、船尾楼は CASTLE_TOP まで立ち上がる"""
    if t <= CASTLE_T0:
        return z1(t)
    k = min(1.0, (t - CASTLE_T0) / 0.035)
    k = k * k * (3 - 2 * k)
    target = CASTLE_TOP + 0.5 * (t - CASTLE_T0) / (1 - CASTLE_T0)
    return z1(t) + max(0.0, target - z1(t)) * k


def hull_pt(t, s, side=1, off=0.0):
    """船体の外面の点。off > 0 で断面の外向きにずらす (鎧張り・通し材)、< 0 で内側 (肋)"""
    th = s * math.pi / 2
    h, a, b = hb(t), z0(t), z1(t)
    x = h * math.sin(th)
    z = a + (b - a) * (1 - math.cos(th))
    sign = -1 if t < 0.5 else 1
    y = ty(t) + sign * RAKE * e_(t) ** 4 * s ** 1.5  # 船首・船尾の柱を外へ傾ける
    nx, nz = (b - a) * math.sin(th), -h * math.cos(th)
    ln = math.hypot(nx, nz) or 1.0
    return Vector((side * (x + off * nx / ln), y, z + off * nz / ln))


def wall_pt(t, dz, side=1, off=0.0):
    """(M22-06 試作 2 で足した) 舷縁より上の船尾楼の壁の点 (舷縁の外面から真上へ dz)"""
    return hull_pt(t, 1.0, side, off) + Z * dz


def tspan(a, b, n):
    return [a + (b - a) * i / n for i in range(n + 1)]


# ---------------------------------------------------------------- 部品

CURL = 1.8  # (M22-06 試作 2 で足した) 船首の巻きと船尾の柱の伸びの拡大率
# (試作 3 の判断で変更: 船首の巻きは下の渦巻き (VOLUTE_*) に替えたので、CURL は船首には使わない)

# (試作 3 の判断で足した) 船首の柱の先の大きな渦巻き (基準画 sheets/ship.png・key-visuals/departure.png の巻いた船首)。
# 角度は YZ 面内で 0 が前 (−Y)、90 が上、180 が船尾側。柱の傾きのまま前へ上がり、前の外周を上って頂で船尾側へ返り、
# 半径を VOLUTE_R0 から VOLUTE_R1 へ縮めながら 1.5 巻きして、目 (中心) の飾りの横で終わる
VOLUTE_REACH = 0.8             # 柱の先 (舷縁の高さ) から巻き始めまでの長さ
VOLUTE_R0, VOLUTE_R1 = 1.75, 0.4  # 巻き始めと巻き終わりの半径
VOLUTE_A0, VOLUTE_STEP, VOLUTE_SEGS = -45.0, 22.5, 25  # 巻き始めの角度・刻み・刻みの数 (−45° から 517.5° まで)
VOLUTE_W0, VOLUTE_W1 = 0.32, 0.1  # 材の太さ (巻き始め → 巻き終わり)


def volute(top_b, d):
    """(試作 3 の判断で足した) 船首の渦巻きの芯の点と太さ。top_b は船首の柱の先、d は柱の向き"""
    d = Vector((0, d.y, d.z)).normalized()
    start = top_b + d * VOLUTE_REACH
    a0 = math.radians(VOLUTE_A0)
    a1 = math.radians(VOLUTE_A0 + VOLUTE_STEP * VOLUTE_SEGS)
    k = math.log(VOLUTE_R1 / VOLUTE_R0) / (a1 - a0)

    def off(a):
        return Vector((0, -math.cos(a), math.sin(a))) * (VOLUTE_R0 * math.exp(k * (a - a0)))
    c = start - off(a0)
    pts, radii = [], []
    for i in range(VOLUTE_SEGS + 1):
        u = i / VOLUTE_SEGS
        pts.append(c + off(a0 + (a1 - a0) * u))
        radii.append(VOLUTE_W0 + (VOLUTE_W1 - VOLUTE_W0) * u ** 0.8)
    return pts, radii, c


def volute_front(pts):
    """(試作 3 の判断で足した) 船首の渦巻きの最も前の点 (船首の鐘の腕の付け根)"""
    return min(pts[-(VOLUTE_SEGS + 1):], key=lambda p: p.y)


def volute_top(pts):
    """(試作 3 の判断で足した) 船首の渦巻きの頂 (前の支えと三角の帆を張る所。最も前の点へ張ると縄が渦巻きを貫くため)"""
    return max(pts[-(VOLUTE_SEGS + 1):], key=lambda p: p.z)


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
    prof_pt_before_top = pts[-2]  # (試作 3 で足した) 船首の柱の向き (渦巻きの巻き始めを柱の傾きに揃える)
    radii = [KEEL_R] * len(pts)
    if curl:
        # (M22-06 試作 2 の判断で変更: 巻きを CURL 倍にし、船尾の柱は船尾楼の欄干より高く伸ばす)
        pts = [top_s + Vector((0, 0.6, 2.6)), top_s + Vector((0, 0.35, 1.3))] + pts
        # (試作 3 の判断で変更: 船首の先の四角い小さな鉤 (top_b から CURL 倍で 4 点、太さ 0.3〜0.12) をやめ、大きな渦巻きにする。
        #  渦巻きの目には丸く削った飾りを置く。竜骨の段から飛び立ちまで同じ形)
        vol, vol_r, eye = volute(top_b, top_b - prof_pt_before_top)
        pts += vol
        radii = [0.2, 0.28] + radii + vol_r
        node.add(K.ico((0.2, 0.3, 0.3), subdiv=1, seed=3), M["timber"], matrix=K.trs(eye), smooth=True,
                 shade=K.shade_const(0.92))
    node.add(K.tube(pts, radii, n=4, phase=math.pi / 4), M["timber"], smooth=False,
             shade=K.shade_height(0.0, 2.0, 0.78, 1.0))
    return pts


def keel_bottom(y):
    t = (y + L2) / (2 * L2)
    return z0(t) - KEEL_R * 1.4


def cradle(node, rnd, posts=False):
    """竜骨を受ける盤木。posts=True は竜骨だけの段で、船首・船尾の柱と竜骨を左右から支柱で支える"""
    for y in CRADLE_YS:  # (M22-06 試作 2 の判断で変更: 4 つ → 船台の盤木に合わせて 6 つ)
        top = keel_bottom(y) + 0.01
        h = top + CRADLE_H
        node.add(K.box((1.5, 0.7, h), jitter=0.015, seed=rnd.randrange(1 << 30)), M["block"],
                 matrix=K.trs((0, y, -CRADLE_H + h / 2), (0, 0, rnd.uniform(-3, 3))),
                 shade=K.shade_const(rnd.uniform(0.8, 0.95)))
        node.add(K.box((0.62, 0.8, 0.16), jitter=0.012, seed=rnd.randrange(1 << 30)), M["block"],
                 matrix=K.trs((0, y, top - 0.08), (0, 0, 90)), shade=K.shade_const(0.75))  # 楔
    if posts:
        for t, sgn in ((0.0, -1), (1.0, 1)):
            p = hull_pt(t, 0.62)
            for side in (-1, 1):
                a = Vector((side * 0.2, p.y, p.z))
                b = Vector((side * 2.6, p.y + sgn * 0.5, PAVE))
                node.add(K.tube([a, b], [0.12, 0.13], n=4), M["block"], shade=K.shade_const(0.85))
            a = Vector((0, p.y + sgn * 0.2, p.z - 0.5))
            b = Vector((0, p.y + sgn * 1.4, PAVE))
            node.add(K.tube([a, b], [0.12, 0.13], n=4), M["block"], shade=K.shade_const(0.85))
        for y in (-5.8, -2.9, 2.9, 5.8):
            for side in (-1, 1):
                a = Vector((side * 0.22, y, keel_bottom(y) + 0.35))
                b = Vector((side * 1.9, y, PAVE))
                node.add(K.tube([a, b], [0.1, 0.11], n=4), M["block"], shade=K.shade_const(0.85))


def shores(node, rnd):
    """舷側の曲がり (s ≈ 0.4) を地面から支える斜めの支柱と足の板"""
    # (M22-06 試作 2 の判断で変更: 3 本 → 4 本ずつ。足は船台の縁石の上 (CURB) に置く)
    for t in (0.22, 0.4, 0.6, 0.78):
        for side in (-1, 1):
            a = hull_pt(t, 0.42, side, off=0.1)
            b = Vector((side * CURB_X, a.y, CURB + 0.1))
            node.add(K.tube([a, b], [0.13, 0.14], n=4), M["block"], shade=K.shade_const(rnd.uniform(0.78, 0.9)))
            node.add(K.box((0.7, 0.5, 0.14), jitter=0.01, seed=rnd.randrange(1 << 30)), M["block"],
                     matrix=K.trs((side * CURB_X, a.y, CURB + 0.07)), shade=K.shade_const(0.75))


RIB_TS = tspan(0.1, 0.9, 16)  # (M22-06 試作 2 の判断で変更: 11 本 → 17 本)


def ribs(node, head=0.35, ts=RIB_TS):
    """曲げた肋材 (U 字、竜骨の上で左右がつながる)。head は舷縁より上に出る頭"""
    # (M22-06 試作 2 の判断で変更: 深い船体に合わせて曲がりの点を増やし、船尾楼の肋は頭を船尾楼の上端まで伸ばす)
    for t in ts:
        ss = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1]
        hd = (head + (ctop(t) - z1(t))) if head else 0.0
        pts = []
        if hd:
            pts.append(hull_pt(t, 1.0, -1, off=-0.16) + Z * hd)
        pts += [hull_pt(t, s, -1, off=-0.16) for s in ss]
        pts.append(hull_pt(t, 0.0, 1, off=-0.16))
        pts += [hull_pt(t, s, 1, off=-0.16) for s in reversed(ss)]
        if hd:
            pts.append(hull_pt(t, 1.0, 1, off=-0.16) + Z * hd)
        node.add(K.tube(pts, [0.13] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_height(0.5, 5.5, 0.8, 1.0))


def ribbands(node):
    for s in (0.35, 0.7, 1.0):  # (M22-06 試作 2 の判断で変更: 2 本 → 3 本)
        for side in (-1, 1):
            pts = [hull_pt(t, s, side, off=0.03) for t in tspan(0.07, 0.93, 16)]
            node.add(K.tube(pts, [0.08] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                     shade=K.shade_const(0.88))
    # (M22-06 試作 2 で足した) 船尾楼の肋の頭を留める通し材
    for side in (-1, 1):
        pts = [wall_pt(t, ctop(t) - z1(t), side, off=0.03) for t in tspan(RIB_TS[13], RIB_TS[16], 6)]
        node.add(K.tube(pts, [0.08] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
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
        v = mul * seam * (0.74 + 0.26 * min(1.0, max(0.0, (co.z - 0.4) / 5.0)))  # (M22-06 試作 2 の判断で変更: 深さに合わせて 0.2/2.4 → 0.4/5.0)
        return (v, v * 0.99, v * 0.96)
    node.add(bm, M["hull"], smooth=True, recalc=False, shade=shade)


def hull(node, rnd, full=True):
    for side in (-1, 1):
        if full:
            for k in range(NS):
                strake(node, k, side, rnd=rnd)
        else:
            for k in range(7):  # (M22-06 試作 2 の判断で変更: 下 4 段 → 下 7 段 + 8 段目の中ほど)
                strake(node, k, side, rnd=rnd)
            strake(node, 7, side, 0.22, 0.74, rnd=rnd)


def castle(node, rnd):
    """(M22-06 試作 2 で足した) 船尾楼: 舷縁から立ち上がる鎧張りの壁 3 段、床、前の壁 (戸口) と、主甲板から上がる階段"""
    t0, t1 = CASTLE_T0 + 0.004, 0.992
    ts = tspan(t0, t1, 14)
    for side in (-1, 1):
        for k in range(3):
            bm = bmesh.new()
            lo = [bm.verts.new(wall_pt(t, (ctop(t) - z1(t)) * k / 3, side, off=LAP if k else 0.0)) for t in ts]
            up = [bm.verts.new(wall_pt(t, (ctop(t) - z1(t)) * (k + 1) / 3, side)) for t in ts]
            for i in range(len(ts) - 1):
                f = (lo[i], lo[i + 1], up[i + 1], up[i])
                bm.faces.new(f if side > 0 else tuple(reversed(f)))
            v = (0.95, 0.88, 1.0)[k] * rnd.uniform(0.97, 1.0)
            node.add(bm, M["hull"], smooth=True, recalc=False, shade=K.shade_const((v, v * 0.99, v * 0.96)))
    # 床
    fts = tspan(CASTLE_T0 - 0.01, 0.975, 12)
    cols = 6
    for c in range(cols):
        bm = bmesh.new()
        u0, u1 = -1 + 2 * c / cols, -1 + 2 * (c + 1) / cols
        a = [bm.verts.new((deck_half(t, CASTLE_DECK) * u0, ty(t), CASTLE_DECK)) for t in fts]
        b = [bm.verts.new((deck_half(t, CASTLE_DECK) * u1, ty(t), CASTLE_DECK)) for t in fts]
        for i in range(len(fts) - 1):
            bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
        v = rnd.uniform(0.84, 1.0)
        node.add(bm, M["deck"], recalc=False, shade=K.shade_const((v, v * 0.98, v * 0.95)))
    # 前の壁: 主甲板から船尾楼の床まで、舷の内側いっぱいの板壁
    yf = ty(CASTLE_T0 - 0.01)
    zs = tspan(DECK_Z - 0.05, CASTLE_DECK, 4)
    bm = bmesh.new()
    rows = [(bm.verts.new((-deck_half(CASTLE_T0 - 0.01, z) - 0.05, yf, z)),
             bm.verts.new((deck_half(CASTLE_T0 - 0.01, z) + 0.05, yf, z))) for z in zs]
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, a1, b1, b0))
    node.add(bm, M["hull"], smooth=False, recalc=False, shade=K.shade_height(DECK_Z, CASTLE_DECK, 0.8, 0.95))
    node.add(K.box((1.3, 0.12, 2.05), bevel=0.03), M["block"], matrix=K.trs((-0.9, yf - 0.05, DECK_Z + 1.02)),
             shade=K.shade_const(0.55))  # 戸口 (暗い板戸)
    for x in (-1.62, -0.18):
        node.add(K.box((0.14, 0.2, 2.2), bevel=0.02), M["timber"], matrix=K.trs((x, yf - 0.08, DECK_Z + 1.1)),
                 shade=K.shade_const(0.9))  # 戸口の柱
    node.add(K.box((2 * deck_half(CASTLE_T0 - 0.01, CASTLE_DECK) + 0.2, 0.3, 0.22), bevel=0.03), M["timber"],
             matrix=K.trs((0, yf - 0.05, CASTLE_DECK - 0.05)), shade=K.shade_const(0.9))  # 床の縁の梁
    # 右舷寄りの階段 (二本の桁と 7 段の踏み板)
    ya, yb = yf - 2.6, yf - 0.1
    for x in (1.3, 2.5):
        node.add(K.tube([(x, ya, DECK_Z), (x, yb, CASTLE_DECK)], [0.07, 0.07], n=4), M["timber"],
                 shade=K.shade_const(0.85))
    for k in range(7):
        u = (k + 0.5) / 7
        node.add(K.box((1.25, 0.28, 0.07)), M["deck"], matrix=K.trs((1.9, ya + (yb - ya) * u, DECK_Z + (CASTLE_DECK - DECK_Z) * u)),
                 shade=K.shade_const(0.9))


def gunwale(node):
    # (M22-06 試作 2 の判断で変更: 船尾楼では壁の上端 (ctop) に沿わせる)
    for side in (-1, 1):
        pts = [hull_pt(t, 1.0, side, off=0.05) + Z * (0.05 + ctop(t) - z1(t)) for t in tspan(0.02, CASTLE_T0, 14) + tspan(CASTLE_T0 + 0.01, 0.985, 9)]
        node.add(K.tube(pts, [0.13] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_const(0.95))


def wale(node):
    """(M22-06 試作 2 で足した) 舷側の太い腰板 2 本 (横から見た船体に水平の帯を入れて、大きさの物差しにする)"""
    for s, r in ((0.8, 0.14), (0.62, 0.1)):
        for side in (-1, 1):
            pts = [hull_pt(t, s, side, off=LAP + 0.05) for t in tspan(0.035, 0.965, 16)]
            node.add(K.tube(pts, [r] * len(pts), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                     shade=K.shade_const(0.8))


def deck_half(t, zd):
    r = min(1.0, max(0.0, (zd - z0(t)) / (z1(t) - z0(t))))
    return hb(t) * math.sin(math.acos(1 - r)) - 0.1


def deck(node, rnd):
    """甲板: 舷の内側に長さ方向の板 6 枚"""
    # (M22-06 試作 2 の判断で変更: 板 10 枚、船尾楼の前の壁まで)
    ts = [t for t in tspan(0.05, CASTLE_T0 + 0.02, 20) if z0(t) + 0.3 < DECK_Z]
    cols = 10

    def half(t):
        return deck_half(t, DECK_Z)
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
    # (M22-06 試作 2 の判断で変更: 船尾の低い台は船尾楼 (castle) に替え、船首の腰掛けと 2 つの倉口を置く)
    for t, w, d, h in ((0.1, 1.3, 1.4, 0.5), (0.37, 1.2, 2.0, 0.4), (0.57, 1.1, 1.8, 0.4)):
        node.add(K.box((w * 2, d, h), bevel=0.04), M["deck"], matrix=K.trs((0, ty(t), DECK_Z + h / 2)),
                 shade=K.shade_const(0.88))


MAST_Y = ty(MAST_T)
# (M22-06 試作 2 で足した) 帆柱 3 本: 名前 -> (t, 根元の z (None は竜骨の上), 頂の z, 根元の太さ, 檣楼の高さ, 檣楼の半径)
MASTS = {
    "fore": (0.25, None, 18.8, 0.28, 11.75, 0.8),
    "main": (MAST_T, None, MAST_TOP, 0.34, 13.55, 1.0),
    "mizzen": (0.81, CASTLE_DECK, 15.8, 0.22, None, 0.0),
}
# (M22-06 試作 2 で足した) 帆: (帆柱, 帆桁の高さ, 帆桁の半幅, 帆の裾の高さ, 裾の半幅)。前と主は 2 段 (下の帆と上の帆)
SAILS = (
    ("fore", 11.2, 4.4, 7.6, 4.9),
    ("fore", 16.4, 3.1, 12.3, 3.9),
    ("main", YARD_Z, 5.2, 7.2, 5.9),
    ("main", 19.6, 3.6, 14.3, 4.6),
    ("mizzen", 13.9, 3.0, 9.9, 3.5),
)


def mast_y(name):
    return ty(MASTS[name][0])


def mast_head(name):
    return Vector((0, mast_y(name), MASTS[name][2] - 0.35))


def mast(node):
    # (M22-06 試作 2 の判断で変更: 帆柱 1 本 → 3 本。前と主には帆柱の中ほどに丸い檣楼)
    for name, (t, base, top, r, top_z, top_r) in MASTS.items():
        y = ty(t)
        zb = z0(t) if base is None else base
        mid = zb + (top - zb) * 0.45
        node.add(K.tube([(0, y, zb), (0, y, mid), (0, y, top)], [r, r * 0.82, r * 0.5], n=6),
                 M["timber"], smooth=True, shade=K.shade_height(DECK_Z, DECK_Z + 8.0, 0.85, 1.0))
        node.add(K.box((r * 2.2, r * 2.2, 0.4), bevel=0.06), M["timber"], matrix=K.trs((0, y, top - 0.4)),
                 shade=K.shade_const(0.85))
        deck_z = DECK_Z if base is None else base
        node.add(K.box((r * 2.4, r * 2.4, 0.3), bevel=0.04), M["timber"], matrix=K.trs((0, y, deck_z + 0.15)),
                 shade=K.shade_const(0.8))  # 甲板の帆柱受け
        if top_z:
            prof = [(0.0, -0.1), (top_r * 0.55, -0.16), (top_r, 0.02), (top_r, 0.3), (top_r * 0.9, 0.3), (0.0, 0.1)]
            node.add(K.lathe(prof, n=8, phase=math.pi / 8), M["deck"], matrix=K.trs((0, y, top_z)), smooth=False,
                     shade=K.shade_height(top_z - 0.2, top_z + 0.3, 0.75, 0.95))  # 檣楼


def yard_y(name):
    return mast_y(name) - 0.3


def yard(node):
    # (M22-06 試作 2 の判断で変更: 帆桁 1 本 → SAILS の 5 本)
    for name, yz, half, _, _ in SAILS:
        y, my = yard_y(name), mast_y(name)
        r = 0.07 + 0.02 * half
        pts = [(x * half, y, yz) for x in (-1.0, -0.5, 0.0, 0.5, 1.0)]
        node.add(K.tube(pts, [r * 0.5, r * 0.85, r, r * 0.85, r * 0.5], n=5), M["timber"], smooth=True,
                 shade=K.shade_const(0.95))
        node.add(K.tube([(0, my, yz + 0.14), (0, my, yz - 0.16)], [r * 2.1, r * 2.1], n=5), M["rope"],
                 shade=K.shade_const(0.85))  # 帆桁を帆柱に括る縄


def furled_sail(node):
    """帆桁の下に巻いて括った帆"""
    # (M22-06 試作 2 の判断で変更: 帆桁ごとに、帆の大きさに合わせた太さで巻く)
    for name, yz, half, foot, _ in SAILS:
        y = yard_y(name)
        k = half / 3.25
        big = 0.27 * k * (0.75 + 0.1 * (yz - foot))
        xs = [x * half / 3.25 for x in (-2.95, -2.2, -1.1, 0.0, 1.1, 2.2, 2.95)]
        rr = [big * f for f in (0.3, 0.63, 0.89, 1.0, 0.89, 0.63, 0.3)]
        pts = [(x, y, yz - big - 0.05 - 0.08 * k * math.cos(x / half * math.pi / 2)) for x in xs]
        node.add(K.tube(pts, rr, n=6), M["sail"], smooth=True, shade=K.shade_height(yz - 2.2 * big, yz, 0.8, 1.0),
                 soft=((0, y, yz + 2 * big), 0.3))
        for x in (-0.72, -0.37, 0.0, 0.37, 0.72):
            r = big * (1 - (abs(x) / 0.95) ** 2) + 0.05
            m = K.trs((x * half, y, yz - big - 0.05), (0, 90, 0))
            node.add(K.lathe([(r + 0.03, -0.05), (r + 0.03, 0.05)], n=6, cap_top=False, cap_bottom=False), M["rope"],
                     matrix=m, shade=K.shade_const(0.9))


def sail_pt(u, v, billow, sail):
    """帆の面の点。u: 0 左舷 → 1 右舷、v: 0 上 → 1 下。billow で船首側 (−Y) へ膨らむ"""
    # (M22-06 試作 2 の判断で変更: sail (SAILS の 1 行) ごとの帆桁の高さ・幅・裾で形を決める)
    name, yz, half, foot, half_foot = sail
    w = half * 0.93 + (half_foot - half * 0.93) * v
    x = (2 * u - 1) * w
    top = yz - 0.15
    z = top + (foot - top) * v
    bulge = billow * math.sin(math.pi * u) * math.sin(math.pi * (0.12 + 0.8 * v)) + 0.25 * billow * v * v
    return Vector((x, yard_y(name) - 0.05 - bulge, z + 0.35 * billow * v * (1 - v) * math.sin(math.pi * u)))


def sail_shade(mul, sail):
    # (M22-06 試作 2 の判断で変更: 帆ごとの上下で明るさを付ける)
    top, bot = sail[1] - 0.15, sail[3]

    def f(co, n):
        v = mul * (0.86 + 0.14 * (co.z - bot) / (top - bot))
        return (v, v, v * 0.97)
    return f


def open_sail(node, billow=1.15):
    """広げた帆: 縦の布の帯 8 枚 (帯ごとに明るさを変えて織った布の継ぎ目に見せる)"""
    # (M22-06 試作 2 の判断で変更: SAILS の 5 枚を張る。膨らみは帆の裾の半幅 × 0.3。返すのは帆ごとの裾の両角)
    NU, NV = 8, 6
    clews = []
    for sail in SAILS:
        bl = billow * sail[4] / 3.5 * 0.9
        for c in range(NU):
            bm = bmesh.new()
            rows = []
            for j in range(NV + 1):
                v = j / NV
                rows.append((bm.verts.new(sail_pt(c / NU, v, bl, sail)), bm.verts.new(sail_pt((c + 1) / NU, v, bl, sail))))
            for j in range(NV):
                a0, a1 = rows[j]
                b0, b1 = rows[j + 1]
                bm.faces.new((a0, b0, b1, a1))
            node.add(bm, M["sail"], smooth=True, recalc=False, shade=sail_shade(1.0 if c % 2 else 0.93, sail))
        foot = [sail_pt(u, 1.0, bl, sail) for u in tspan(0, 1, 8)]
        node.add(K.tube(foot, [0.05] * len(foot), n=3), M["rope"], shade=K.shade_const(0.9))  # 帆の裾の縄
        clews.append((sail, sail_pt(0, 1, bl, sail), sail_pt(1, 1, bl, sail)))
    return clews


def staysail(node, bow_top):
    """(M22-06 試作 2 で足した) 前の帆柱から船首の柱へ張った三角の帆 (飛び立ちだけ)。右舷へ少し膨らむ"""
    head = mast_head("fore")
    a, b = head.lerp(bow_top, 0.1), head.lerp(bow_top, 0.86)
    c = Vector((0, mast_y("fore") - 3.6, 8.3))
    bm = bmesh.new()
    n = 5
    rows = []  # 三角の格子: j 段目は j + 1 点 (a から c-b の辺へ)
    for j in range(n + 1):
        row = []
        for i in range(j + 1):
            wc, wb = (j - i) / n, i / n
            pt = a + (c - a) * wc + (b - a) * wb
            pt.x += 0.8 * 27 * (1 - wc - wb) * wc * wb
            row.append(bm.verts.new(pt))
        rows.append(row)
    for j in range(n):
        for i in range(j + 1):
            bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]))
            if i < j:
                bm.faces.new((rows[j][i], rows[j + 1][i + 1], rows[j][i + 1]))
    node.add(bm, M["sail"], smooth=True, recalc=False, shade=K.shade_height(8.0, 18.0, 0.85, 1.0))
    rope(node, c, hull_pt(0.2, 1.0, 1, off=0.1) + Z * 0.1, 0.035)  # 三角の帆の裾の角を舷へ


def rope(node, a, b, r=0.025):
    node.add(K.tube([Vector(a), Vector(b)], [r, r], n=3, cap_start=False, cap_end=False), M["rope"],
             shade=K.shade_const(0.9))


def rigging(node, bow_top, stern_top, clews=None):
    # (M22-06 試作 2 の判断で変更: 帆柱 3 本ぶんの横静索・縄梯子・前後の支え・帆桁の転桁索・帆の裾の縄。
    #  横静索の足は帆柱より船尾側に置いて、前へ膨らむ帆と交わらないようにする)
    for name, (t, base, top, r, top_z, top_r) in MASTS.items():
        head = mast_head(name)
        shroud_ts = (t, t + 0.025, t + 0.05)
        for side in (-1, 1):
            # 足は舷の外に張り出した板 (channel) の上。手すりの外を通して、横静索が手すりを貫かないようにする
            feet = [wall_pt(tt, ctop(tt) - z1(tt), side, off=0.5) - Z * 0.25 for tt in shroud_ts]
            ch = wall_pt(t + 0.025, ctop(t + 0.025) - z1(t + 0.025), side, off=0.3) - Z * 0.33
            node.add(K.box((0.5, 2 * L2 * 0.075, 0.12), bevel=0.02), M["timber"],
                     matrix=K.trs(ch, (0, 0, 0)), shade=K.shade_const(0.85))
            for f in feet:
                rope(node, head, f, 0.04)
            # 縄梯子: 前の 2 本の横縄
            if name != "mizzen":
                a0, b0 = feet[0], feet[1]
                for k in range(1, 12):
                    u = k / 14
                    rope(node, a0.lerp(head, u), b0.lerp(head, u), 0.028)
    rope(node, mast_head("fore") + Z * 0.2, bow_top, 0.05)     # 前の支え
    rope(node, mast_head("main") + Z * 0.1, mast_head("fore") - Z * 0.2, 0.045)  # 主帆柱から前の帆柱の頂へ (上の帆より上を通す)
    rope(node, mast_head("mizzen") + Z * 0.1, Vector((0, mast_y("main"), 16.0)), 0.04)  # 後ろの帆柱から主帆柱へ (後ろの帆の上を通す)
    rope(node, mast_head("mizzen") + Z * 0.1, stern_top, 0.045)   # 後ろの支え
    brace_to = {"fore": 0.47, "main": 0.7, "mizzen": 0.975}
    for sail in SAILS:
        name, yz = sail[0], sail[1]
        rope(node, mast_head(name) + Z * 0.05, (0, yard_y(name), yz + 0.12), 0.035)  # 帆桁の吊り
        for side in (-1, 1):
            end = Vector((side * sail[2] * 0.97, yard_y(name), yz))
            tb = brace_to[name]
            rope(node, end, wall_pt(tb, ctop(tb) - z1(tb), side, off=0.14) + Z * 0.05, 0.032)  # 帆桁の端を船尾へ引く縄
    if clews:
        for sail, cl, cr in clews:
            name = sail[0]
            tt = min(0.97, MASTS[name][0] + 0.12)
            for c, side in zip((cl, cr), (-1, 1)):
                rope(node, c, wall_pt(tt, ctop(tt) - z1(tt), side, off=0.14) + Z * 0.1, 0.035)  # 帆の裾の角を舷へ


def bell(node, top, scale, seed):
    """裾の開いた小さな青銅の鐘。裾の帯と内側は明るく光り (引いても鐘の形が読める)、胴は暗い青銅"""
    rnd = random.Random(seed)
    prof = [(0.0, 0.0), (0.075, -0.02), (0.085, -0.12), (0.12, -0.2), (0.16, -0.25), (0.0, -0.19)]
    prof = [(r * scale, z * scale) for r, z in prof]
    top = Vector(top)
    rim = lambda c, n: M["bell_rim"] if c.z - top.z < -0.2 * scale else None  # noqa: E731
    node.add(K.lathe(prof, n=6, phase=rnd.uniform(0, 1)), M["bell"], matrix=K.trs(top), smooth=True,
             per_face_mat=rim, shade=K.shade_height(top.z - 0.25 * scale, top.z, 0.8, 1.0))


RAIL_H = 0.8   # (M22-06 試作 2 で足した) 手すりの高さ (前は 0.5)
BELL_S = 1.8   # (M22-06 試作 2 で足した) 舷側の鐘の大きさ (前は 1.1)


def rail(node, bells=True):
    """舷縁の上の手すり (柱と横木) と、柱の間に吊った鐘"""
    # (M22-06 試作 2 の判断で変更: 腰の手すりは船尾楼の前まで、柱の間ごとに鐘。船尾楼の上には細い欄干 (手すり子) と
    #  3 つおきの鐘、前の縁にも欄干。船首の巻いた柱には大きな鐘を 1 つ吊る (bow_bell))
    ts = tspan(0.1, CASTLE_T0 + 0.005, 14)
    for side in (-1, 1):
        top = [hull_pt(t, 1.0, side, off=0.0) + Z * RAIL_H for t in tspan(0.08, CASTLE_T0 + 0.005, 20)]
        node.add(K.tube(top, [0.07] * len(top), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_const(0.95))
        for t in ts:
            p = hull_pt(t, 1.0, side, off=0.0)
            node.add(K.tube([p + Z * 0.08, p + Z * RAIL_H], [0.055, 0.055], n=3, cap_start=False, cap_end=False),
                     M["timber"], shade=K.shade_const(0.9))
        if bells:
            for i, t in enumerate(ts[:-1]):
                tm = (t + ts[i + 1]) / 2
                p = hull_pt(tm, 1.0, side, off=0.24) + Z * (RAIL_H - 0.05)
                node.add(K.tube([p + Z * 0.06, p - Z * 0.08], [0.018, 0.018], n=3, cap_start=False, cap_end=False),
                         M["rope"])
                bell(node, p - Z * 0.08, BELL_S, seed=int(tm * 1000) + (side > 0) * 7)
        # 船尾楼の欄干
        cts = tspan(CASTLE_T0 + 0.04, 0.975, 16)
        top = [wall_pt(t, ctop(t) - z1(t) + RAIL_H * 0.75, side) for t in cts]
        node.add(K.tube(top, [0.065] * len(top), n=4, phase=math.pi / 4), M["timber"], smooth=False,
                 shade=K.shade_const(0.95))
        for i, t in enumerate(cts):
            p = wall_pt(t, ctop(t) - z1(t), side)
            node.add(K.tube([p + Z * 0.1, p + Z * RAIL_H * 0.75], [0.045, 0.045], n=3, cap_start=False, cap_end=False),
                     M["timber"], shade=K.shade_const(0.9))
            if bells and i % 3 == 1 and i < len(cts) - 1:
                tm = (t + cts[i + 1]) / 2
                p = wall_pt(tm, ctop(tm) - z1(tm), side, off=0.24) + Z * (RAIL_H * 0.75 - 0.05)
                node.add(K.tube([p + Z * 0.06, p - Z * 0.08], [0.018, 0.018], n=3, cap_start=False, cap_end=False),
                         M["rope"])
                bell(node, p - Z * 0.08, BELL_S, seed=int(tm * 1000) + (side > 0) * 7 + 3)
    # 船尾楼の前の縁の欄干 (右舷寄りは階段の口を空ける)
    yf = ty(CASTLE_T0 - 0.01) + 0.05
    hw = deck_half(CASTLE_T0 - 0.01, CASTLE_DECK)
    zr = CASTLE_DECK + RAIL_H + 0.1
    node.add(K.tube([(-hw, yf, zr), (1.1, yf, zr)], [0.06, 0.06], n=4, phase=math.pi / 4), M["timber"],
             shade=K.shade_const(0.95))
    for x in tspan(-hw + 0.2, 1.1, 10):
        node.add(K.tube([(x, yf, CASTLE_DECK), (x, yf, zr)], [0.045, 0.045], n=3, cap_start=False, cap_end=False),
                 M["timber"], shade=K.shade_const(0.9))


def bow_bell(node, pts):
    """(M22-06 試作 2 で足した) 船首の巻いた柱の最も前の点から前へ腕を出し、大きな鐘を吊る"""
    p = volute_front(pts)  # (試作 3 の判断で変更: pts[-3] → 渦巻きの最も前の点)
    arm = p + Vector((0, -0.9, -0.1))
    node.add(K.tube([p + Vector((0, 0.1, 0)), arm], [0.09, 0.07], n=4), M["timber"], shade=K.shade_const(0.9))
    node.add(K.tube([arm, arm - Z * 0.35], [0.03, 0.03], n=3, cap_start=False, cap_end=False), M["rope"])
    bell(node, arm - Z * 0.35, 4.0, seed=5)


def mu_glow(node):
    """浮かぶ力: 竜骨の底のシアンの継ぎ目、竜骨の下に重なる細長い六角の光の輪 3 つ (土兎の六角の紋と同じ意匠)、
    ごく淡い光のレンズ 1 枚"""
    # (M22-06 試作 2 の判断で変更: 大きな船体に合わせて輪とレンズを広げ、舷側の象嵌の線と船首の六角の紋を足す)
    pts = [hull_pt(t, 0.0) for t in tspan(0.1, 0.9, 14)]
    pts = [Vector((0, p.y, p.z - KEEL_R * 1.42)) for p in pts]
    node.add(K.tube(pts, [0.09] * len(pts), n=4, phase=math.pi / 4), M["mu"])
    for z, rx, ry in ((-0.6, 1.5, 7.8), (-1.5, 2.4, 9.4), (-2.5, 3.3, 10.8)):
        node.add(K.lathe([(0.9, 0.0), (1.0, 0.0)], n=6, phase=math.pi / 2, cap_top=False, cap_bottom=False),
                 M["mu_ring"], matrix=K.trs((0, 0, z), scale=(rx, ry, 1.0)))
    node.add(K.ico((2.9, 10.6, 1.1), subdiv=1, seed=2), M["lift"], matrix=K.trs((0, 0, -1.5)), smooth=True)
    # 舷側の象嵌: 外板の段の継ぎ目 2 本に沿って細く光る線 (動物の甲の継ぎ目と同じ光り方)
    for s in (4 / NS, 8 / NS):
        for side in (-1, 1):
            line = [hull_pt(t, s, side, off=LAP + 0.02) for t in tspan(0.08, 0.92, 16)]
            node.add(K.tube(line, [0.045] * len(line), n=3, phase=math.pi / 2), M["mu"])
    # 船首の両舷の六角の紋 (土兎の六角と同じ意匠)
    for side in (-1, 1):
        p = hull_pt(0.13, 0.78, side, off=LAP + 0.03)
        q = hull_pt(0.13, 0.78, side, off=LAP + 1.0)
        m = K.aim(q - p)
        m.translation = p
        node.add(K.lathe([(0.8, 0.0), (1.0, 0.0)], n=6, phase=math.pi / 2, cap_top=False, cap_bottom=False),
                 M["mu_ring"], matrix=m @ K.trs(rot=(0, 90, 0), scale=0.55))


# ---------------------------------------------------------------- 段階

STAGES = ["ship_keel", "ship_ribs", "ship_planks", "ship_mast", "ship_sails", "ship_flying"]


def stage(name):
    n = K.Node(name)
    rnd = random.Random(11)  # 段階をまたいで同じ部品は同じ形にする
    i = STAGES.index(name)
    pts = keel(n)
    # (M22-06 試作 2 の判断で変更: 前の支えは船首の巻きの最も前の点へ張る)
    # (試作 3 の判断で変更: 渦巻きにしたので、前の支えは渦巻きの頂へ張る。最も前の点へ張ると縄が渦巻きを貫く)
    bow_top, stern_top = volute_top(pts), pts[0]
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
        castle(n, random.Random(61))  # (M22-06 試作 2 で足した)
        wale(n)  # (M22-06 試作 2 で足した)
        gunwale(n)
        deck(n, random.Random(41))
        mast(n)
        ribs(n, head=0.0, ts=RIB_TS[2:-2:3])  # 甲板の上に覗く肋の頭の代わりに、内側の肋を少しだけ (M22-06 試作 2 の判断で変更: 1 本おき → 2 本おき)
        if name != "ship_flying":
            shores(n, random.Random(31))
    if i >= 4:
        yard(n)
        rail(n)
        bow_bell(n, pts)  # (M22-06 試作 2 で足した)
        if name == "ship_flying":
            clews = open_sail(n)
            staysail(n, bow_top)  # (M22-06 試作 2 で足した)
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
