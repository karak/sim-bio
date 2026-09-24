"""観察画面 (M22) の月鹿: Switch 世代の 3D ポケモン程度の密度で、丸めた形・スキン・5 つのアニメを持つモデルを組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_deer.py -- assets/models/observe
出力: <out_dir>/deer.glb と deer.blend
  - メッシュ `deer` (近 LOD、~3,000 三角形)、`deer_lod1` (群れ LOD、~900)、`deer_doe` (角の無い雌、近 LOD と同じ密度)。3 つとも同じアーマチュア `deer_rig` にスキン
  - (M23-08) メッシュ `deer_far` (遠い段、~210 三角形): 群れ LOD を島ごとに削った形 (creature_far.py)。光る角・脚・装甲板は多く残す。描画は切ってある (hide_render)
  - アクション idle (4 s)・walk (1.2 s)・run (0.6 s)・graze (5 s)・fall (2 s、ループしない)。30 fps、その場 (root は動かさない)
  - 材質 deer_body (頂点色で腹・喉・耳の内側を淡く) / deer_plate / deer_hoof / deer_antler_base / deer_glow (発光 #8FF5E6)
基準画: assets/textures/board/creatures/deer.png (承認済み)。造形の元は assets/textures/concept/deer-angular.png と tools/blender/deer.py (ローポリ版)。
検証: tools/blender/observe_deer_render.py で基準画と同じ向きを撮り、docs/design/qa/observe/ に並べる。

寸法: 単位 m、Blender では Z up・正面 -Y (glTF では Y up・正面 +Z)。き甲 (肩) の高さ 1.4 m、角の先まで ~2.95 m、原点は四つの蹄の間の地面。
作り方:
  - 胴・首・頭・脚は断面リングのロフト (Catmull-Rom で断面を補間して丸める)。スムーズシェード。LOD は断面数と周方向の頂点数だけを変える
  - 装甲板は胴の表面へ放射状に投影した縁取りから、縁 → 面取り → 頂の 3 段の殻にする。縁は硬いエッジ (丸めた角ばり)。光る継ぎ目は板の外側に貼る帯
  - 腹の線と胸の V 字は胴の表面に沿わせた細い帯 (発光)
  - スキンの重みは部品ごとに候補の骨を決め、骨の線分までの距離の逆 4 乗で配る (上位 3 本)
  - 脚のアニメは 2D の解析 IK (肩・腰の関節から球節まで)。蹄は立脚中は地面に固定し、遊脚で持ち上げて手首・飛節を曲げる
M22-05 残りの手直し (2026-09-24):
  - 装甲板の輪郭を基準画の側面から測り直し (尖った前の角を持つ六角・平行四辺形のき甲の板)、面取りを一定幅の内側オフセット、頂を平らな面の扇にした。
    光る継ぎ目は板の縁から少し離して胴に沿わせる帯 (build_seam、角は立てたまま) にした
  - 目は両端の尖ったアーモンド形 (前の目頭が下がる)、暗い縁は上まぶたと目頭で太く
  - graze は 10 s: 頭を下ろしたまま食み、前足を曲げて前半身を沈め、ときどき一歩出る。頭を上げて見回すのは 1 回、ゆっくり
  - fall は頭を世界に対して起こしたまま首を前へ伸ばして地面に置き、倒れる途中は地面より下へ出た分だけ体を持ち上げる (GROUND_CLAMP)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creature_far import build_far  # noqa: E402  (M23-08)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else "assets/models/observe"
FPS = 30
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


# ---------------------------------------------------------------- 色と材質
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# 基準画 (creatures/deer.png) の塗りから拾った代表色 (sRGB)
PAL = {k: lin(v) for k, v in {
    "fur": "#CB9C5E",       # 黄褐色の地
    "fur_back": "#B5854F",  # 背と脚の下のわずかに濃い面
    "belly": "#F0DAAA",     # 腹・喉・顎の下の淡い色
    "muzzle": "#E4C288",
    "ear_in": "#EFCFA8",
    "plate": "#3A766E",
    "hoof": "#1F4B47",
    "antler_base": "#24514C",
    "glow": "#8FF5E6",
    # (月鹿の手直しで追加) 装甲板の面取りと角の稜のハイライト (基準画の板の縁は明るい青緑、角の稜は白に近い光)
    "plate_hi": "#62A396",
    "glow_hi": "#E2FFFA",
}.items()}
WHITE = (1.0, 1.0, 1.0)

BODY, PLATE, HOOF, ABASE, GLOW = range(5)
MAT_NAMES = ["deer_body", "deer_plate", "deer_hoof", "deer_antler_base", "deer_glow"]
PLATE_HI, GLOW_HI = 5, 6  # (月鹿の手直しで追加) 装甲板の面取りのハイライト・角の稜の光
MAT_NAMES += ["deer_plate_hi", "deer_glow_hi"]


def make_materials():
    mats = []
    for name in MAT_NAMES:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
        key = {"deer_body": "fur", "deer_plate": "plate", "deer_hoof": "hoof", "deer_antler_base": "antler_base", "deer_glow": "glow",
               "deer_plate_hi": "plate_hi", "deer_glow_hi": "glow_hi"}[name]
        rgb = PAL[key]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        m.diffuse_color = (*rgb, 1)
        if name == "deer_body":
            # 腹・喉の淡い色は頂点色 (COLOR_0) で持つ。Three.js 側は vertexColors で掛ける
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        if name == "deer_glow":
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = 1.0
        if name == "deer_glow_hi":  # (月鹿の手直しで追加) 角の稜: deer_glow と同じ強さで白に近い色
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = 1.0
        mats.append(m)
    return mats


# ---------------------------------------------------------------- 骨 (頭・尾・親)。rest の位置は形の寸法と共有する
FRONT_X, HIND_X = 0.12, 0.13
BONES = {
    "root": ((0, 0, 0), (0, -0.3, 0), None),
    "pelvis": ((0, 0.50, 1.18), (0, 0.08, 1.21), "root"),
    "spine1": ((0, 0.08, 1.21), (0, -0.30, 1.23), "pelvis"),
    "chest": ((0, -0.30, 1.23), (0, -0.58, 1.22), "spine1"),
    "neck1": ((0, -0.62, 1.15), (0, -0.645, 1.45), "chest"),
    "neck2": ((0, -0.645, 1.45), (0, -0.665, 1.74), "neck1"),
    "head": ((0, -0.665, 1.78), (0, -1.12, 1.74), "neck2"),
    "jaw": ((0, -0.80, 1.74), (0, -1.12, 1.70), "head"),
    "tail1": ((0, 0.80, 1.20), (0, 0.87, 1.30), "pelvis"),
    "tail2": ((0, 0.87, 1.30), (0, 0.90, 1.40), "tail1"),
}
for s, sx in (("L", -1), ("R", 1)):
    BONES[f"ear_{s}"] = ((sx * 0.13, -0.60, 1.96), (sx * 0.40, -0.47, 1.99), "head")
    fx, hx = sx * FRONT_X, sx * HIND_X
    # 前脚: 肩関節 → 肘 (後ろ下) → 手首 (前下) → 球節 → 蹄の先
    fl = [(fx, -0.46, 1.12), (fx, -0.33, 0.75), (fx, -0.44, 0.40), (fx, -0.45, 0.12), (fx, -0.51, 0.0)]
    # 後脚: 股関節 → 膝 (前下) → 飛節 (後ろ下) → 球節 → 蹄の先
    hl = [(hx, 0.52, 1.12), (hx, 0.36, 0.70), (hx, 0.64, 0.44), (hx, 0.60, 0.12), (hx, 0.55, 0.0)]
    for pre, pts, par, names in (("fl", fl, "chest", ("upper", "fore", "cannon", "hoof")), ("hl", hl, "pelvis", ("thigh", "shin", "cannon", "hoof"))):
        prev = par
        for i, nm in enumerate(names):
            bn = f"{pre}_{nm}_{s}"
            BONES[bn] = (pts[i], pts[i + 1], prev)
            prev = bn
BONES = {k: (Vector(h), Vector(t), p) for k, (h, t, p) in BONES.items()}
LEG_BONES = {f"{pre}_{s}": [f"{pre}_{nm}_{s}" for nm in names]
             for s in "LR" for pre, names in (("fl", ("upper", "fore", "cannon", "hoof")), ("hl", ("thigh", "shin", "cannon", "hoof")))}


def joint(name, i):
    """脚の関節 i (0 = 肩/股、4 = 蹄の先) の rest 位置"""
    bones = LEG_BONES[name]
    return BONES[bones[i]][0] if i < 4 else BONES[bones[3]][1]


# ---------------------------------------------------------------- 形の道具
def catmull(p0, p1, p2, p3, t):
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def resample(keys, count):
    """キー断面の列を Catmull-Rom で count 断面に補間する (各成分を独立に)"""
    n = len(keys)
    out = []
    for i in range(count):
        s = i * (n - 1) / (count - 1)
        k = min(int(s), n - 2)
        t = s - k
        p0, p1, p2, p3 = keys[max(k - 1, 0)], keys[k], keys[k + 1], keys[min(k + 2, n - 1)]
        out.append(tuple(catmull(a, b, c, d, t) for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def resample_path(pts, count):
    return [Vector(p) for p in resample([tuple(p) for p in pts], count)]


def ring(bm, center, ux, uy, rx, ry_top, ry_bot, n, pinch=0.0, sq=2.0, phase=0.0):
    """ux/uy 平面の超楕円リング。+uy 側の半径 ry_top、-uy 側 ry_bot、pinch で -uy 側の幅を絞る (胸の竜骨・顎)"""
    vs = []
    for i in range(n):
        a = 2 * math.pi * i / n + phase
        c, s = math.cos(a), math.sin(a)
        cx = math.copysign(abs(c) ** (2 / sq), c)
        sy = math.copysign(abs(s) ** (2 / sq), s)
        ry = ry_top if s > 0 else ry_bot
        w = rx * (1 - pinch * max(0.0, -s))
        vs.append(bm.verts.new(center + ux * (w * cx) + uy * (ry * sy)))
    return vs


def loft(bm, rings, mat=BODY, mats=None):
    """リング (または先端の 1 点) の列を面で繋ぐ。mats[i] で i 番目の帯の材質を指定できる"""
    faces = []
    for idx, (a, b) in enumerate(zip(rings, rings[1:])):
        m = mats[idx] if mats else mat
        new = []
        if isinstance(a, list) and isinstance(b, list):
            n = len(a)
            for i in range(n):
                new.append(bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])))
        elif isinstance(a, list):
            n = len(a)
            for i in range(n):
                new.append(bm.faces.new((a[i], a[(i + 1) % n], b)))
        else:
            n = len(b)
            for i in range(n):
                new.append(bm.faces.new((a, b[(i + 1) % n], b[i])))
        for f in new:
            f.material_index = m
        faces += new
    return faces


def cap(bm, rng, mat=BODY):
    f = bm.faces.new(rng)
    f.material_index = mat
    return f


def tube(bm, pts, radii, n, mats=None, mat=GLOW, tip=True, phase=0.0, flat=1.0, ridge=0.0):
    """折れ線に沿ったチューブ (角・枝・尾)。tip=True で最後を 1 点に収束。flat で断面を横 (X) 方向に潰す
    (月鹿の手直しで追加: ridge (ラジアン) > 0 は断面の上側の角 (断面の上向き v の側、sin > 0.5 の 2 つ) を ±ridge の 2 点に割り、
    角に細い稜の面を立てて deer_glow_hi (白に近い光) にする。基準画の角の縁のハイライト。断面の頂点は n + 2 になる)"""
    rings = []
    for i, (p, r) in enumerate(zip(pts, radii)):
        if tip and i == len(pts) - 1:
            rings.append(bm.verts.new(p))
            continue
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = (Z.cross(d) if abs(d.z) < 0.9 else X.cross(d)).normalized()
        v = d.cross(u).normalized()
        if ridge > 0:
            vs = []
            for k in range(n):
                a0 = 2 * math.pi * k / n + phase
                for a in ((a0 - ridge, a0 + ridge) if math.sin(a0) > 0.5 else (a0,)):
                    vs.append(bm.verts.new(p + u * (r * flat * math.cos(a)) + v * (r * math.sin(a))))
            rings.append(vs)
            continue
        rings.append(ring(bm, p, u, v, r * flat, r, r, n, phase=phase))
    faces = loft(bm, rings, mat=mat, mats=mats)
    if ridge > 0:  # (月鹿の手直しで追加) 稜の面 (割った 2 点のあいだの帯) の光る面を deer_glow_hi に
        slots, j = [], 0
        for k in range(n):
            if math.sin(2 * math.pi * k / n + phase) > 0.5:
                slots.append(j)
                j += 2
            else:
                j += 1
        per = j
        for idx, f in enumerate(faces):
            if idx % per in slots and f.material_index == GLOW:
                f.material_index = GLOW_HI
    faces.append(cap(bm, list(reversed(rings[0])), mats[0] if mats else mat))
    if not tip:
        faces.append(cap(bm, rings[-1], mats[-1] if mats else mat))
    return faces


# ---------------------------------------------------------------- LOD の密度
HERO = dict(name="hero", body=(15, 16), neck=(7, 12), head=(10, 12), leg=(12, 8), hoof=8, antler=(12, 6), tine=(3, 6),
            ear=(4, 8), tail=(3, 6), plate_chaikin=True, ribbon_seg=12, eye=12, sq=2.4)  # (M22-05 残りの手直しで変更: eye 10 → 12、目尻の尖りを出す)
def far_ratio(c, mats, n):
    """(M23-08) 遠い段で群れ LOD の島を削る割合 (creature_far.build_far)。光る角 (1.9 m より上) は半分残し、胴の光る帯と目は除く。
    脚 (蹄の材質を持つ島。鼻の暗い色を持つ頭も入る) は関節の曲がりが読めるよう 3 割、装甲板は色の斑が残るよう 35%、胴・首・耳・尾は 2 割"""
    if "deer_glow" in mats:
        return 0.5 if c.z > 1.9 else 0.0
    if "deer_hoof" in mats:
        return 0.3
    if "deer_plate" in mats:
        return 0.35
    return 0.2


LOD1 = dict(name="lod1", body=(7, 10), neck=(4, 8), head=(6, 8), leg=(6, 5), hoof=0, antler=(6, 4), tine=(2, 4),
            ear=(2, 4), tail=(2, 4), plate_chaikin=False, ribbon_seg=4, eye=4, sq=2.2)

# 胴 (尻 → 胸): (y, 背の高さ, 腹の高さ, 半幅, 腹側の絞り)
BODY_KEYS = [
    (0.86, 1.22, 1.02, 0.06, 0.0),
    (0.80, 1.30, 0.92, 0.16, 0.10),
    (0.66, 1.355, 0.84, 0.22, 0.18),
    (0.45, 1.365, 0.83, 0.23, 0.24),
    (0.18, 1.36, 0.80, 0.23, 0.30),
    (-0.12, 1.37, 0.765, 0.235, 0.34),
    (-0.38, 1.41, 0.745, 0.235, 0.38),
    (-0.58, 1.40, 0.78, 0.21, 0.40),
    (-0.72, 1.36, 0.86, 0.175, 0.40),
    (-0.81, 1.27, 0.95, 0.10, 0.30),
]

def body_zc(y):
    ks = BODY_KEYS
    if y >= ks[0][0]:
        return (ks[0][1] + ks[0][2]) / 2
    for a, b in zip(ks, ks[1:]):
        if a[0] >= y >= b[0]:
            t = (a[0] - y) / (a[0] - b[0])
            return ((a[1] + a[2]) / 2) * (1 - t) + ((b[1] + b[2]) / 2) * t
    return (ks[-1][1] + ks[-1][2]) / 2


def build_body(bm, lod):
    nsec, n = lod["body"]
    secs = resample(BODY_KEYS, nsec)
    rings = [ring(bm, Vector((0, y, (top + bot) / 2)), X, Z, hw, (top - bot) / 2, (top - bot) / 2, n, pinch, sq=lod["sq"], phase=math.pi / 2)
             for y, top, bot, hw, pinch in secs]
    rear = bm.verts.new((0, secs[0][0] + 0.025, (secs[0][1] + secs[0][2]) / 2))
    front = bm.verts.new((0, secs[-1][0] - 0.02, (secs[-1][1] + secs[-1][2]) / 2))
    loft(bm, [rear] + rings + [front])


# 首: 胸の中から頭の下へ。(y, z, 横半径, 喉側, 鬣側)
NECK_KEYS = [(-0.60, 1.06, 0.17, 0.17, 0.16), (-0.635, 1.25, 0.20, 0.215, 0.18), (-0.655, 1.50, 0.185, 0.20, 0.155),
             (-0.665, 1.72, 0.165, 0.175, 0.135), (-0.665, 1.88, 0.14, 0.14, 0.12)]

def build_neck(bm, lod):
    nsec, n = lod["neck"]
    secs = resample(NECK_KEYS, nsec)
    pts = [Vector((0, s[0], s[1])) for s in secs]
    rings = []
    for i, (y, z, rx, rf, rb) in enumerate(secs):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        uy = X.cross(d).normalized()  # 首の前 (喉) 側
        rings.append(ring(bm, pts[i], X, uy, rx, rf, rb, n, phase=math.pi / 2))
    loft(bm, rings)
    cap(bm, list(reversed(rings[0])))
    cap(bm, rings[-1])


# 頭 (後頭部 → 鼻先): (y, 中心 z, 横半径, 上, 下, 下側の絞り)
HEAD_KEYS = [
    (-0.50, 1.865, 0.06, 0.06, 0.06, 0.0),
    (-0.545, 1.865, 0.15, 0.15, 0.15, 0.10),
    (-0.64, 1.855, 0.178, 0.16, 0.18, 0.20),
    (-0.76, 1.84, 0.17, 0.15, 0.175, 0.30),
    (-0.88, 1.81, 0.138, 0.125, 0.15, 0.35),
    (-0.98, 1.78, 0.105, 0.10, 0.12, 0.35),
    (-1.07, 1.755, 0.085, 0.085, 0.09, 0.30),
    (-1.13, 1.745, 0.07, 0.07, 0.065, 0.20),
    (-1.165, 1.74, 0.04, 0.04, 0.036, 0.10),
]
NOSE_Y = -1.152

def build_head(bm, lod):
    nsec, n = lod["head"]
    secs = resample(HEAD_KEYS, nsec)
    rings = [ring(bm, Vector((0, y, zc)), X, Z, rx, rt, rb, n, pinch, sq=2.2, phase=math.pi / 2) for y, zc, rx, rt, rb, pinch in secs]
    back = bm.verts.new((0, secs[0][0] + 0.012, secs[0][1]))
    tip = bm.verts.new((0, secs[-1][0] - 0.012, secs[-1][1]))
    faces = loft(bm, [back] + rings + [tip])
    for f in faces:
        if f.calc_center_median().y < NOSE_Y:
            f.material_index = HOOF  # 鼻 (基準画では暗い)


def build_ears(bm, lod, side):
    nsec, n = lod["ear"]
    base = Vector((side * 0.12, -0.60, 1.955))
    axis = Vector((side * 0.88, 0.38, 0.22)).normalized()
    front = Vector((0, -1, 0.35))
    front = (front - axis * front.dot(axis)).normalized()  # 耳の開き (前向き)
    w = axis.cross(front).normalized()
    keys = [(0.0, 0.05, 0.035), (0.08, 0.095, 0.03), (0.17, 0.105, 0.025), (0.26, 0.07, 0.018), (0.32, 0.025, 0.01)]
    secs = resample(keys, nsec + 1)
    rings = []
    for t, wd, th in secs[:-1]:
        c = base + axis * t
        vs = []
        for i in range(n):
            a = 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            # 前面 (耳の内側) を浅くくぼませる
            dz = th * sa * (0.35 if sa > 0 else 1.0)
            vs.append(bm.verts.new(c + w * (wd * ca) + front * dz))
        rings.append(vs)
    tip = bm.verts.new(base + axis * (secs[-1][0] + 0.03))
    loft(bm, rings + [tip])
    cap(bm, list(reversed(rings[0])))
    return front


# 基準画の側面・正面から: 深緑の根元は頭頂から外へ、発光する主幹は外・後ろへ張り出してから上がり、先は前・内へ巻く三日月。
# 眉枝 (前・内へ出て上を向く) と中ほどの枝 (上へ)。左 (-X) を正で書き、x に side を掛ける
ANTLER_BEAM = [(0.07, -0.71, 1.98), (0.20, -0.62, 2.03), (0.33, -0.50, 2.075),
               (0.47, -0.35, 2.14), (0.60, -0.15, 2.22), (0.665, 0.02, 2.36), (0.665, 0.08, 2.52), (0.62, 0.05, 2.68), (0.54, -0.05, 2.81), (0.45, -0.19, 2.90)]
ANTLER_R = [0.058, 0.056, 0.055, 0.058, 0.06, 0.06, 0.056, 0.05, 0.036, 0.008]
ANTLER_BASE_T = 0.28  # 主幹のうち根元 (深緑) の割合
# (月鹿の手直しで追加) 角の稜: 断面の上側の角を割る角度 (ラジアン、近 LOD だけ)
ANTLER_RIDGE = math.radians(7)
ANTLER_TINES = [[(0.37, -0.46, 2.095), (0.27, -0.66, 2.14), (0.18, -0.84, 2.24), (0.13, -0.91, 2.44)],
                [(0.54, -0.33, 2.19), (0.48, -0.37, 2.35), (0.41, -0.41, 2.52)]]
ANTLER_TINE_R = [[0.052, 0.046, 0.036, 0.0], [0.052, 0.04, 0.0]]

def antler_fit(p):
    return Vector(p)


def build_antler(bm, lod, side):
    nb, n = lod["antler"]
    pts = [antler_fit((side * x, y, z)) for x, y, z in ANTLER_BEAM]
    dense = resample_path(pts, nb)
    radii = [r for (r,) in resample([(r,) for r in ANTLER_R], nb)]
    radii[-1] = 0.0
    mats = [ABASE if (i + 0.5) / (nb - 1) < ANTLER_BASE_T else GLOW for i in range(nb - 1)]
    rg = ANTLER_RIDGE if lod["name"] == "hero" else 0.0  # (月鹿の手直しで追加) 近 LOD の角に光る稜
    faces = tube(bm, dense, radii, n, mats=mats, ridge=rg)
    nt, tn = lod["tine"]
    for tpts, trr in zip(ANTLER_TINES, ANTLER_TINE_R):
        cnt = nt + len(tpts) - 3
        tp = resample_path([antler_fit((side * x, y, z)) for x, y, z in tpts], cnt)
        rr = [r for (r,) in resample([(r,) for r in trr], cnt)]
        rr[-1] = 0.0
        faces += tube(bm, tp, rr, tn, mat=GLOW, ridge=rg)
    bmesh.ops.recalc_face_normals(bm, faces=faces)


# 脚の断面: (関節 i から i+1 への位置 t, 横半径, 前後半径)
FRONT_LEG = [(0.1, 0.11, 0.19), (0.55, 0.10, 0.17), (1.0, 0.07, 0.11), (1.3, 0.062, 0.09), (1.75, 0.046, 0.06), (2.0, 0.046, 0.054),
             (2.4, 0.034, 0.04), (2.85, 0.032, 0.038), (3.0, 0.04, 0.046), (3.35, 0.037, 0.042)]
HIND_LEG = [(0.1, 0.12, 0.23), (0.5, 0.115, 0.21), (0.85, 0.09, 0.16), (1.0, 0.08, 0.14), (1.35, 0.066, 0.12), (1.7, 0.05, 0.085),
            (2.0, 0.045, 0.066), (2.4, 0.034, 0.042), (2.85, 0.032, 0.038), (3.0, 0.04, 0.046), (3.35, 0.037, 0.042)]

def leg_point(name, t):
    i = min(int(t), 3)
    a, b = joint(name, i), joint(name, i + 1)
    return a + (b - a) * (t - i)


def build_leg(bm, lod, name):
    nsec, n = lod["leg"]
    keys = FRONT_LEG if name.startswith("fl") else HIND_LEG
    if lod["hoof"] == 0:
        keys = keys + [(3.7, 0.05, 0.058), (3.95, 0.055, 0.064)]  # 群れ LOD は蹄も脚のロフトで作る
    secs = resample(keys, nsec)
    pts = [leg_point(name, t) for t, _, _ in secs]
    if lod["hoof"] == 0:
        pts[-1] = Vector((pts[-1].x, pts[-1].y, 0.0))
        pts[-2] = Vector((pts[-2].x, pts[-2].y, 0.05))
    rings = []
    for i, (t, rx, ry) in enumerate(secs):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if lod["hoof"] == 0 and i >= len(secs) - 2:
            d = Vector((0, 0, -1))  # 群れ LOD の蹄の断面は水平に (地面より下へはみ出さない)
        uy = X.cross(d).normalized()
        rings.append(ring(bm, pts[i], X, uy, rx, ry, ry, n, phase=math.pi / 2))
    faces = loft(bm, rings)
    cap(bm, list(reversed(rings[0])))
    cap(bm, rings[-1], HOOF if lod["hoof"] == 0 else BODY)
    if lod["hoof"] == 0:
        for f in faces:
            if f.calc_center_median().z < 0.085:
                f.material_index = HOOF


def build_hoof(bm, lod, name):
    n = lod["hoof"]
    fet = joint(name, 3)
    x = fet.x
    keys = [(0.10, 0.038, 0.042, -0.01), (0.06, 0.047, 0.055, -0.028), (0.014, 0.052, 0.064, -0.045), (0.0, 0.049, 0.06, -0.045)]
    rings = [ring(bm, Vector((x, fet.y + dy, z)), X, -Y, rx, ry, ry * 0.85, n, phase=math.pi / 2) for z, rx, ry, dy in keys]
    loft(bm, rings, mat=HOOF)
    cap(bm, list(reversed(rings[0])), HOOF)
    bot = bm.verts.new((x, fet.y - 0.045, 0.0))
    loft(bm, [rings[-1], bot], mat=HOOF)


def build_tail(bm, lod):
    nsec, n = lod["tail"]
    pts = resample_path([(0, 0.79, 1.19), (0, 0.87, 1.30), (0, 0.905, 1.42)], nsec)
    radii = [r for (r,) in resample([(0.065,), (0.05,), (0.0,)], nsec)]
    tube(bm, pts, radii, n, mat=BODY, flat=0.8)


# ---------------------------------------------------------------- 胴の表面への投影 (装甲板と光る線)
def surf(bvh, y, z, side, off, phi=0.0, flat=False):
    """側面図の座標 (y, z) を表面へ投影し、法線方向へ off 浮かせる。
    視線は横 (side 側) から、上下に外れた点ほど体の中心へ向けて傾ける。phi (度) で前 (-Y) へ回す (胸の V 字)
    (M22-05 残りの手直しで追加: flat=True は先に真横の視線を試し、面をかすめない (法線の横成分 0.3 以上) なら採る。
    側面図の輪郭が真横から見てそのまま出る。外れたら従来の傾けた視線で、背の線の向こう側 (反対の側面) へは回り込ませない)"""
    ph = math.radians(phi)
    zc = body_zc(y)
    if flat:
        d = Vector((side, 0, 0))
        loc, nrm, _, _ = bvh.ray_cast(Vector((side * 2.0, y, z)), -d)
        if loc is not None and abs(nrm.x) > 0.3:
            if nrm.dot(d) < 0:
                nrm = -nrm
            return loc + nrm * off, nrm
    for k in range(40):
        zz = z + (zc - z) * k / 40
        tilt = max(-1.0, min(1.0, (zz - zc) / 0.35)) * 0.8
        d = Vector((side * math.cos(ph), -math.sin(ph), tilt)).normalized()
        q = Vector((0, y, zz))
        loc, nrm, _, _ = bvh.ray_cast(q + d * 2.0, -d)
        if loc is not None and flat and loc.x * side < 0.035:
            continue
        if loc is not None:
            break
    else:
        raise RuntimeError(f"surface miss y={y} z={z}")
    if nrm.dot(d) < 0:
        nrm = -nrm
    return loc + nrm * off, nrm


def split_edges(poly, glow):
    """閉じた多角形の各辺の中点に頂点を足す (角は立てたまま、胴の丸みに沿わせる)。glow[i] は辺 i (i → i+1) が光る継ぎ目か"""
    out, g = [], []
    k = len(poly)
    for i in range(k):
        a, b = poly[i], poly[(i + 1) % k]
        out += [a, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)]
        g += [glow[i], glow[i]]
    return out, g


def inset(poly, d):
    """凸多角形 (y, z) を各辺から d だけ内側へ寄せる (面取りの幅を一定にする)。M22-05 残りの手直しで追加"""
    k = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % k][1] - poly[(i + 1) % k][0] * poly[i][1] for i in range(k))
    orient = 1 if area > 0 else -1
    out = []
    for i in range(k):
        a, b, c = Vector(poly[(i - 1) % k]), Vector(poly[i]), Vector(poly[(i + 1) % k])
        n1 = Vector((a.y - b.y, b.x - a.x)).normalized() * orient  # 辺 a→b の内向き
        n2 = Vector((b.y - c.y, c.x - b.x)).normalized() * orient
        nn = (n1 + n2).normalized()
        s = d / max(0.35, nn.dot(n1))
        out.append((b.x + nn.x * s, b.y + nn.y * s))
    return out


def outside(poly, i, d):
    """多角形 (y, z) の角 i を、隣り合う 2 辺の外側へ d だけ離した点 (継ぎ目の帯の通り道)。M22-05 残りの手直しで追加"""
    p = inset(poly, -d)
    return p[i % len(poly)]


# (月鹿の手直しで追加) 装甲板の縁のハイライト: 基準画の板は面取りが明るい青緑に光り、縁取りのように読める (下を向く辺は陰で暗いまま)。
# 側面図で辺の外向きの法線の上下成分がこれより大きい辺の面取りを deer_plate_hi にする
PLATE_HI_MIN_NZ = -0.55


def edge_lit(poly, i):
    """(月鹿の手直しで追加) 多角形 (y, z) の辺 i (i → i+1) の面取りを明るくするか"""
    k = len(poly)
    area = sum(poly[j][0] * poly[(j + 1) % k][1] - poly[(j + 1) % k][0] * poly[j][1] for j in range(k))
    a, b = Vector(poly[i]), Vector(poly[(i + 1) % k])
    out = Vector((b.y - a.y, a.x - b.x)).normalized() * (1 if area > 0 else -1)  # 外向き
    return out.y > PLATE_HI_MIN_NZ


def build_plate(bm, bvh, lod, outline, glow_edges, side, thick=0.075, band=0.024, seam_band=False):
    """装甲板: 縁 (表面 +4 mm) → 縁の上 → 面取り (中心へ 74%) → 頂。光る辺には外側に帯を貼り、縁の壁も光らせる。
    outline は左側面から見た (y, z)。縁と面取りの境は硬いエッジ、頂はなめらか (丸めた角ばり)
    (M22-05 残りの手直しで変更: 面取りは中心へ縮めるのでなく辺から一定幅 (bevel) の内側オフセット、頂は平らな面の扇 (フラットシェード) にして
    宝石のように面を立てる。光る継ぎ目は build_seam の帯に移し、ここの帯と光る縁の壁は seam_band=True のときだけ作る)"""
    poly = list(outline)
    glow = [i in glow_edges for i in range(len(poly))]
    if lod["plate_chaikin"]:
        poly, glow = split_edges(poly, glow)
    k = len(poly)
    cy = sum(p[0] for p in poly) / k
    cz = sum(p[1] for p in poly) / k

    def P(p, off):
        return bm.verts.new(surf(bvh, p[0], p[1], side, off, flat=True)[0])  # (M22-05 残りの手直しで変更: 真横から投影)

    def scaled(p, f):
        return (cy + (p[0] - cy) * f, cz + (p[1] - cz) * f)

    r1 = [P(p, 0.004) for p in poly]
    r2 = [P(p, thick * 0.55) for p in poly]  # (M22-05 残りの手直しで変更: 縁の壁 0.6 → 0.55)
    rings = [r1, r2]
    if lod["plate_chaikin"]:
        # (M22-05 残りの手直しで変更: 中心へ 74% に縮める scaled(p, 0.74) から、辺から 3 cm の一定幅の面取りへ)
        rings.append([P(p, thick) for p in inset(poly, 0.03)])
    faces = []
    for ri, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(k):
            f = bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i]))
            f.material_index = GLOW if (ri == 0 and glow[i] and seam_band) else PLATE
            if ri == 1 and lod["plate_chaikin"] and edge_lit(poly, i):  # (月鹿の手直しで追加) 面取りの縁のハイライト
                f.material_index = PLATE_HI
            faces.append(f)
    for f in faces:
        f.smooth = False
    # (M22-05 残りの手直しで変更: 頂を中心の 1 点への扇 (なめらか) から、横に通した稜線で上下 2 枚の平らな面に割る形へ。
    # 基準画の板は上の面が明るく下の面が暗い宝石の切り子。上下それぞれの面の頂点を稜線を含む平面へ寄せて平らにする。
    # 中心の 1 点 center は作らない)
    top = rings[-1]
    top2d = inset(poly, 0.03) if lod["plate_chaikin"] else poly
    ys = [p[0] for p in poly]
    h_ridge = thick * (1.05 if lod["plate_chaikin"] else 0.85)
    cb = P((cy + 0.4 * (max(ys) - cy), cz), h_ridge)
    cf = P((cy - 0.4 * (cy - min(ys)), cz), h_ridge)
    upper = [p[1] > cz for p in top2d]

    def near(i):
        return cb if top2d[i][0] > cy else cf

    top_faces = []
    for i in range(k):
        j = (i + 1) % k
        ci, cj = near(i), near(j)
        tris = [(top[i], top[j], ci)] if ci is cj else [(top[i], top[j], cj), (top[i], cj, ci)]
        for t in tris:
            f = bm.faces.new(t)
            f.material_index = PLATE
            f.smooth = False
            top_faces.append(f)
    if lod["plate_chaikin"]:
        e = (cf.co - cb.co).normalized()
        for want in (True, False):
            vs = [(top[i], top2d[i]) for i in range(k) if upper[i] == want]
            if not vs:
                continue
            w = Vector()
            for v, _ in vs:
                d = v.co - cb.co
                w += d - e * d.dot(e)
            n = e.cross(w).normalized()
            for v, p2 in vs:
                s = surf(bvh, p2[0], p2[1], side, 0, flat=True)[1]
                t = -n.dot(v.co - cb.co) / (n.dot(s) if abs(n.dot(s)) > 0.2 else 1.0)
                v.co += s * max(-thick * 0.4, min(thick * 0.4, t))
    faces += top_faces
    # 光る帯: 辺の外側 (多角形の外向き法線方向) へ band だけ広げた点を表面に落とす
    area = sum(poly[i][0] * poly[(i + 1) % k][1] - poly[(i + 1) % k][0] * poly[i][1] for i in range(k))
    orient = 1 if area > 0 else -1
    outer = {}

    def out_pt(i):
        if i not in outer:
            a, b, c = poly[(i - 1) % k], poly[i], poly[(i + 1) % k]
            n1 = Vector((a[1] - b[1], b[0] - a[0])) * orient  # 辺 a→b の内向き
            n2 = Vector((b[1] - c[1], c[0] - b[0])) * orient
            nn = (n1.normalized() + n2.normalized()).normalized()
            outer[i] = P((b[0] - nn.x * band, b[1] - nn.y * band), 0.005)
        return outer[i]

    for i in range(k):
        if glow[i] and seam_band:  # (M22-05 残りの手直しで変更: 既定では作らない。継ぎ目は build_seam)
            j = (i + 1) % k
            f = bm.faces.new((out_pt(i), out_pt(j), r1[j], r1[i]))
            f.material_index = GLOW
            f.smooth = True
            faces.append(f)
    # 向きを揃える (頂の扇が外を向くように)
    ref_n = surf(bvh, cy, cz, side, 0, flat=True)[1]
    fan = top_faces[-1]  # (M22-05 残りの手直しで変更: 頂の面の最後の 1 枚で向きを見る)
    fan.normal_update()
    if fan.normal.dot(ref_n) < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)
    sharp = [r1, r2] + ([rings[2]] if len(rings) > 2 else [])
    for r in sharp:
        rs = set(r)
        for e in {e for v in r for e in v.link_edges}:
            if all(v in rs for v in e.verts):
                e.smooth = False  # 板の縁と面取りの境は硬いエッジ (丸めた角ばり)


def build_ribbon(bm, bvh, lod, path, side, width=0.026, nseg=None):
    """胴に沿う光る線。path は (y, z, phi)。断面は 3 点の低い山 (近 LOD) / 平らな帯 (群れ LOD)
    (M22-05 残りの手直しで追加: nseg で近 LOD の区切りの数を線ごとに減らせる。群れ LOD は lod の値のまま)"""
    nseg = min(nseg, lod["ribbon_seg"]) if nseg else lod["ribbon_seg"]
    dense = resample([tuple(p) for p in path], nseg + 1)
    hits = [surf(bvh, y, z, side, 0.0, phi) for y, z, phi in dense]
    prev = None
    faces = []
    for i, (loc, n) in enumerate(hits):
        d = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        sv = n.cross(d).normalized() * (width / 2)
        if lod["plate_chaikin"]:
            cur = [bm.verts.new(loc - sv + n * 0.004), bm.verts.new(loc + n * 0.012), bm.verts.new(loc + sv + n * 0.004)]
        else:
            cur = [bm.verts.new(loc - sv + n * 0.007), bm.verts.new(loc + sv + n * 0.007)]
        if prev:
            for j in range(len(cur) - 1):
                f = bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
                f.material_index = GLOW
                f.smooth = True
                f.normal_update()
                if f.normal.dot(n) < 0:
                    f.normal_flip()
                faces.append(f)
        prev = cur
    return faces


def build_seam(bm, bvh, lod, path, side, width=0.022, step=0.05):
    """装甲板の縁に沿う光る継ぎ目 (M22-05 残りの手直しで追加)。path は側面図の (y, z) の折れ線。
    build_ribbon と違って曲線で丸めず、直線で刻んで角を立てたまま胴へ投影する (基準画の継ぎ目は板の角で折れる)。
    断面は 3 点の低い山 (近 LOD) / 平らな帯 (群れ LOD)。群れ LOD は角と長い辺の中点だけ"""
    pts = []
    st = step if lod["plate_chaikin"] else 0.15
    for a, b in zip(path, path[1:]):
        a, b = Vector(a), Vector(b)
        cnt = max(1, math.ceil((b - a).length / st))
        pts += [a + (b - a) * (i / cnt) for i in range(cnt)]
    pts.append(Vector(path[-1]))
    hits = [surf(bvh, p.x, p.y, side, 0.0, flat=True) for p in pts]
    prev = None
    faces = []
    for i, (loc, n) in enumerate(hits):
        d = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        sv = n.cross(d).normalized() * (width / 2)
        if lod["plate_chaikin"]:
            cur = [bm.verts.new(loc - sv + n * 0.006), bm.verts.new(loc + n * 0.014), bm.verts.new(loc + sv + n * 0.006)]
        else:
            cur = [bm.verts.new(loc - sv + n * 0.009), bm.verts.new(loc + sv + n * 0.009)]
        if prev:
            for j in range(len(cur) - 1):
                f = bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
                f.material_index = GLOW
                f.smooth = True
                f.normal_update()
                if f.normal.dot(n) < 0:
                    f.normal_flip()
                faces.append(f)
        prev = cur
    return faces


def lens(k, lf, lb, ht, hb, pf=0.2, pb=1.2, lift=0.0, dx=0.0):
    """目の形 (M22-05 残りの手直しで追加)。(前 (目頭) へ +, 上へ +) の 2D 点を k 個、i = 0 が目頭、k/2 が目尻。
    lf / lb は目頭 / 目尻までの長さ、ht / hb は上 / 下まぶたの高さ。pf / pb は目頭 / 目尻の尖り (0 で楕円、1 で放物線の尖った角)。
    lift は目尻を上まぶたの高さに対して持ち上げる割合 (基準画の目は目尻が上がって尖り、目頭は丸い)、dx は前へずらす量"""
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k
        ca, sa = math.cos(a), math.sin(a)
        x = ca * (lf if ca > 0 else lb)
        y = sa * (ht if sa > 0 else hb) * abs(sa) ** (pf if ca > 0 else pb)
        y += lift * ht * max(0.0, -ca) ** 2
        out.append((x + dx, y))
    return out


# (月鹿の手直しで追加) 近 LOD の目の形。lens() の (目頭までの長さ, 目尻までの長さ, 上まぶたの高さ, 下まぶたの高さ) と尖り。空にすると前の形
EYE_HI = dict(rim=28, rim_shape=(0.070, 0.058, 0.027, 0.030), rim_pf=1.6, rim_pb=1.3, rim_lift=0.25,
              iris=24, iris_shape=(0.036, 0.033, 0.019, 0.021), iris_pf=0.3, iris_pb=0.3, iris_lift=0.1, iris_dx=-0.002)


def build_eye(bm, bvh_head, lod, side):
    loc, n, _, _ = bvh_head.ray_cast(Vector((side * 1.0, -0.84, 1.865)), Vector((-side, 0, 0)))
    if n.dot(Vector((side, 0, 0))) < 0:
        n = -n
    u = Vector((0, -1, -0.25))  # (M22-05 残りの手直しで変更: -0.12 → -0.25。頭の面の傾きと合わせて、真横から目頭が 20° ほど下がって見える)
    u = (u - n * u.dot(n)).normalized()  # 目の長軸 (鼻先へ少し下がる)
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v  # (M22-05 残りの手直しで追加: 上下で形が違うので v を上向きに揃える)
    k = lod["eye"]

    def disc(L, H, off, bulge, mat, shape=None):
        c = bm.verts.new(loc + n * (off + bulge))
        vs = []
        for i in range(k):
            a = 2 * math.pi * i / k
            ca, sa = math.cos(a), math.sin(a)
            # アーモンド形: 目尻 (後ろ) を尖らせる
            sharp = 1.0 - 0.35 * max(0.0, -ca)
            p = loc + u * (L * ca) + v * (H * sa * sharp) + n * off
            if shape:  # (M22-05 残りの手直しで追加: lens() の形。目頭・目尻とも尖らせ、上下のまぶたの丸みを変える)
                p = loc + u * shape[i][0] + v * shape[i][1] + n * off
            best = bvh_head.find_nearest(p)
            p = best[0] + n * off if best[0] is not None else p
            vs.append(bm.verts.new(p))
        for i in range(k):
            f = bm.faces.new((vs[i], vs[(i + 1) % k], c))
            f.material_index = mat
            f.normal_update()
            if f.normal.dot(n) < 0:
                f.normal_flip()

    # (M22-05 残りの手直しで変更: 楕円から lens() の形へ。暗い縁は目尻を後ろ上へ尖らせて伸ばし、目頭は丸く。光る瞳は丸みを残して前へ寄せる)
    if lod["name"] == "hero" and EYE_HI:
        # (月鹿の手直しで追加) 基準画の目 (creatures/deer.png の側面・斜め前・正面、concept/deer-angular.png) に寄せる。
        # 両端の尖った細長いレンズ: 目頭は前下へ細く尾を引いて尖り、目尻も後ろへ尖る (目尻の持ち上げは弱く、穏やかな目)。
        # 暗い縁は上下とも細く、両端の尖りで太る。光る瞳は縁の中をほぼ満たす卵形で、両端を少し尖らせる (まぶたの内の輪郭)。
        # 頂点は縁 28・瞳 24 (前は 12・12)。三角形は増えるが、両端の尖りと上下のまぶたの曲がりが滑らかに出る
        kk = EYE_HI
        k = kk["rim"]
        disc(0, 0, 0.003, 0.002, ABASE, shape=lens(k, *kk["rim_shape"], pf=kk["rim_pf"], pb=kk["rim_pb"], lift=kk["rim_lift"]))
        k = kk["iris"]
        disc(0, 0, 0.006, 0.004, GLOW, shape=lens(k, *kk["iris_shape"], pf=kk["iris_pf"], pb=kk["iris_pb"], lift=kk["iris_lift"],
                                                  dx=kk["iris_dx"]))
        return
    if lod["name"] == "hero":
        disc(0.064, 0.04, 0.003, 0.002, ABASE, shape=lens(k, 0.054, 0.066, 0.026, 0.032, pf=0.9, pb=1.2, lift=0.7))
    disc(0.052, 0.03, 0.006, 0.005, GLOW, shape=lens(k, 0.036, 0.034, 0.017, 0.022, pf=0.2, pb=0.4, dx=0.006))


# ---------------------------------------------------------------- 頂点色と重み
def color_for(part, co, n):
    if part in ("body",):
        c = mix(PAL["fur"], PAL["fur_back"], smoothstep(0.55, 0.95, n.z) * 0.6)
        c = mix(c, PAL["belly"], smoothstep(-0.25, -0.8, n.z))
        c = mix(c, PAL["belly"], smoothstep(-0.2, -0.8, n.y) * smoothstep(-0.55, -0.75, co.y))  # 胸の前 (首の喉から続く)
        return c
    if part == "neck":
        return mix(PAL["fur"], PAL["belly"], smoothstep(-0.1, -0.7, n.y) * (0.55 + 0.45 * smoothstep(1.85, 1.4, co.z)))
    if part == "head":
        c = mix(PAL["fur"], PAL["muzzle"], smoothstep(-0.95, -1.1, co.y))
        c = mix(c, PAL["belly"], smoothstep(-0.2, -0.7, n.z))
        return c
    if part.startswith("ear"):
        return PAL["ear_in"] if n.dot(EAR_FRONT[part]) > 0.25 else PAL["fur"]
    if part.startswith("leg"):
        side = 1 if co.x > 0 else -1
        c = mix(PAL["fur"], PAL["fur_back"], smoothstep(0.7, 0.25, co.z) * 0.8)
        return mix(c, PAL["belly"], smoothstep(0.2, 0.8, -n.x * side) * smoothstep(0.35, 0.8, co.z) * 0.8)
    if part == "tail":
        return mix(PAL["fur"], PAL["belly"], smoothstep(0.0, 0.7, n.y))
    return WHITE


EAR_FRONT = {}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def body_cands(co):
    c = [("pelvis", 1.0), ("spine1", 1.0), ("chest", 1.0), ("neck1", 0.4)]
    side = "L" if co.x < 0 else "R"
    if abs(co.x) > 0.03 and co.z < 1.12:
        c += [(f"fl_upper_{side}", 0.15), (f"hl_thigh_{side}", 0.15)]
    return c


def weights_for(co, cands):
    ws = []
    for bone, fac in cands:
        h, t, _ = BONES[bone]
        ws.append((bone, fac / (seg_dist(co, h, t) + 0.03) ** 4))
    ws.sort(key=lambda x: -x[1])
    ws = ws[:3]
    s = sum(w for _, w in ws)
    ws = [(b, w / s) for b, w in ws if w / s > 0.03]
    s = sum(w for _, w in ws)
    return [(b, w / s) for b, w in ws]


MOUTH = (Vector((0, -0.90, 1.79)), Vector((0, -1.20, 1.745)))


def head_weights(co):
    a, b = MOUTH
    t = (co.y - a.y) / (b.y - a.y)
    zl = a.z + (b.z - a.z) * t
    wj = smoothstep(0.0, 0.025, zl - co.z) * smoothstep(-0.86, -0.93, co.y)
    wn = smoothstep(-0.66, -0.60, co.y) * 0.5  # 後頭部は首へ少し
    out = [("head", max(0.0, 1.0 - wj - wn))]
    if wj > 0.02:
        out.append(("jaw", wj))
    if wn > 0.02:
        out.append(("neck2", wn))
    s = sum(w for _, w in out)
    return [(bb, w / s) for bb, w in out if w > 0]


# ---------------------------------------------------------------- メッシュの組み立て
PLATES_V1 = [  # (M22-05 残りの手直しで PLATES から改名。試作 1 の輪郭、比較のために残す)
    # (左側面から見た輪郭 (y, z)、光る辺 i (i → i+1))。基準画の側面 (creatures/deer.png 左上) の画素から 0.00795 m/px で起こした
    ([(-0.24, 1.30), (-0.44, 1.335), (-0.56, 1.22), (-0.59, 1.02), (-0.51, 0.86), (-0.33, 0.85), (-0.25, 1.00)], {1, 2, 3}),  # 肩の大きな板
    ([(-0.24, 1.335), (-0.28, 1.43), (-0.44, 1.47), (-0.57, 1.42), (-0.555, 1.35), (-0.44, 1.35)], {3, 4, 5}),               # 肩の上 (き甲) の板
    ([(0.40, 1.25), (0.58, 1.265), (0.70, 1.16), (0.715, 0.98), (0.62, 0.83), (0.45, 0.83), (0.34, 0.96), (0.33, 1.12)], {5, 6, 7}),  # 腰の板
]
BELLY_LINE_V1 = [(-0.34, 0.875, 0), (-0.10, 0.845, 0), (0.15, 0.845, 0), (0.345, 0.93, 0)]  # (M22-05 残りの手直しで改名)
CHEST_V_V1 = [(-0.575, 1.21, 0), (-0.64, 1.12, 35), (-0.66, 1.03, 65), (-0.66, 0.97, 90)]  # (M22-05 残りの手直しで改名)

# M22-05 残りの手直し: 基準画の側面を画素で測り直した輪郭 (y = (252 - px) × 0.00795、z = (386 - py) × 0.00795)。
# 肩の板は前上の長い斜めの辺と前へ尖った角を持つ六角、き甲の板は前上がりの平行四辺形、腰の板は前へ尖った六角。
# 光る継ぎ目は板の縁から離した帯 (build_seam) なので、光る辺の集合は空 (build_plate の seam_band=False)
SHOULDER = [(-0.275, 1.245), (-0.44, 1.31), (-0.636, 1.081), (-0.501, 0.843), (-0.318, 0.859), (-0.294, 1.065)]
WITHERS = [(-0.12, 1.395), (-0.375, 1.49), (-0.43, 1.375), (-0.255, 1.29)]
HIP = [(0.69, 1.16), (0.39, 1.28), (0.295, 1.035), (0.42, 0.82), (0.63, 0.865), (0.71, 0.985)]
PLATES = [
    (SHOULDER, set()),  # 肩の大きな板
    (WITHERS, set(), dict(thick=0.09)),   # 肩の上 (き甲) の板。背の上に乗るので厚く
    (HIP, set()),       # 腰の板
]
SEAM_GAP = 0.022
# 継ぎ目 (側面図の折れ線): 腰の板の前の 2 辺 (背の線から)、き甲の板の前の辺 → 肩の板の前上の斜めの辺、き甲の板と肩の板のあいだ
SEAMS = [
    [(0.335, 1.36), outside(HIP, 1, SEAM_GAP), outside(HIP, 2, SEAM_GAP),
     tuple(Vector(outside(HIP, 2, SEAM_GAP)).lerp(Vector(outside(HIP, 3, SEAM_GAP)), 0.8))],
    [outside(WITHERS, 1, SEAM_GAP), outside(SHOULDER, 1, SEAM_GAP), outside(SHOULDER, 2, SEAM_GAP)],
    [outside(SHOULDER, 0, SEAM_GAP), outside(SHOULDER, 1, SEAM_GAP)],
]
# 腹の線は腰の板の継ぎ目から肩の板の下の角へ、腹の中ほどで下へ折れる V (基準画)。胸の V 字は肩の板の前の角から胸の真ん中へ
BELLY_LINE = [(0.29, 0.955, 0), (0.02, 0.866, 0), (-0.29, 0.925, 0)]
_C = outside(SHOULDER, 2, SEAM_GAP)
CHEST_V = [(_C[0], _C[1], 0), (-0.675, 1.0, 35), (-0.695, 0.955, 65), (-0.695, 0.935, 90)]

def make_part(name, bm, part, cands, mats, recalc=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if part != "plate":
        for f in bm.faces:
            f.smooth = True  # 装甲板は build_plate が面ごとに決める (面取りは平ら、頂はなめらか)
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    groups = {}
    for v in me.vertices:
        c = color_for(part, v.co, v.normal)
        col.data[v.index].color = (*c, 1.0)
        ws = cands(v.co) if callable(cands) else weights_for(v.co, cands)
        for b, w in ws:
            if b not in groups:
                groups[b] = ob.vertex_groups.new(name=b)
            groups[b].add([v.index], w, "REPLACE")
    return ob


def build_lod(lod, obj_name, mats, antlers=True):
    parts = []
    shell_v, shell_f = [], []  # 装甲板の投影先 (胴・首・脚の付け根)

    def add_shell(bm):
        bm.verts.index_update()
        o = len(shell_v)
        shell_v.extend(v.co.copy() for v in bm.verts)
        shell_f.extend([o + v.index for v in f.verts] for f in bm.faces)

    bm = bmesh.new()
    build_body(bm, lod)
    add_shell(bm)
    parts.append(make_part(obj_name + "_body", bm, "body", lambda co: weights_for(co, body_cands(co)), mats))
    bm = bmesh.new()
    build_neck(bm, lod)
    add_shell(bm)
    parts.append(make_part(obj_name + "_neck", bm, "neck", [("chest", 0.6), ("neck1", 1), ("neck2", 1), ("head", 0.5)], mats))
    bm = bmesh.new()
    build_head(bm, lod)
    bm.normal_update()
    bvh_head = BVHTree.FromBMesh(bm)
    parts.append(make_part(obj_name + "_head", bm, "head", head_weights, mats))
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        EAR_FRONT[f"ear_{s}"] = build_ears(bm, lod, side)
        parts.append(make_part(f"{obj_name}_ear_{s}", bm, f"ear_{s}", [(f"ear_{s}", 1.0), ("head", 0.25)], mats))
        bm = bmesh.new()
        build_eye(bm, bvh_head, lod, side)
        if antlers:
            build_antler(bm, lod, side)
        parts.append(make_part(f"{obj_name}_headgear_{s}", bm, "rigid", lambda co: [("head", 1.0)], mats, recalc=False))
        for pre in ("fl", "hl"):
            name = f"{pre}_{s}"
            bones = LEG_BONES[name]
            parent = "chest" if pre == "fl" else "pelvis"
            bm = bmesh.new()
            build_leg(bm, lod, name)
            add_shell(bm)
            parts.append(make_part(f"{obj_name}_leg_{name}", bm, f"leg_{name}", [(b, 1.0) for b in bones] + [(parent, 0.5)], mats))
            if lod["hoof"]:
                bm = bmesh.new()
                build_hoof(bm, lod, name)
                parts.append(make_part(f"{obj_name}_hoof_{name}", bm, "rigid", lambda co, b=bones[3]: [(b, 1.0)], mats))
    bvh = BVHTree.FromPolygons(shell_v, shell_f)
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        for outline, glow, *opt in PLATES:  # (M22-05 残りの手直しで変更: 板ごとの厚さ opt を渡す)
            build_plate(bm, bvh, lod, outline, glow, side, **(opt[0] if opt else {}))
        for seam in SEAMS:  # (M22-05 残りの手直しで追加: 板の縁に沿う光る継ぎ目)
            build_seam(bm, bvh, lod, seam, side)
        build_ribbon(bm, bvh, lod, BELLY_LINE, side, width=0.022, nseg=9)  # (M22-05 残りの手直しで変更: 幅を継ぎ目と揃え、区切りを減らす)
        build_ribbon(bm, bvh, lod, CHEST_V, side, width=0.022, nseg=10)
        parts.append(make_part(f"{obj_name}_plates_{s}", bm, "plate", lambda co: weights_for(co, body_cands(co)), mats, recalc=False))
    bm = bmesh.new()
    build_tail(bm, lod)
    parts.append(make_part(obj_name + "_tail", bm, "tail", [("tail1", 1), ("tail2", 1), ("pelvis", 0.3)], mats))

    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = ob.data.name = obj_name
    col = ob.data.color_attributes["Col"]
    ob.data.color_attributes.active_color = col
    ob.data.color_attributes.render_color_index = ob.data.color_attributes.active_color_index
    return ob


# ---------------------------------------------------------------- アーマチュア
def build_rig():
    arm = bpy.data.armatures.new("deer_rig")
    rig = bpy.data.objects.new("deer_rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, par) in BONES.items():
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = h, t
        d = (t - h).normalized()
        eb.align_roll(X.cross(d))  # ローカル X = ワールド X (脚・背骨の曲げはローカル X 回り)
        eb.use_deform = name != "root"
    for name, (h, t, par) in BONES.items():
        if par:
            eb = arm.edit_bones[name]
            eb.parent = arm.edit_bones[par]
            eb.use_connect = (BONES[par][1] - h).length < 1e-4
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    bad = [b.name for b in arm.bones if b.x_axis.dot(X) < 0.9 and abs(b.head_local.x) < 0.05]
    print("bones:", len(arm.bones), "x-axis off:", bad)
    return rig


# ---------------------------------------------------------------- アニメーション
ORDER = []


def bone_order(rig):
    out = []

    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)
    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return out


def rest(rig, name):
    return rig.data.bones[name].matrix_local


def posed(rig, basis):
    P = {}
    for name in ORDER:
        b = rig.data.bones[name]
        M = basis.get(name, Matrix.Identity(4))
        if b.parent:
            P[name] = P[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local) @ M
        else:
            P[name] = b.matrix_local @ M
    return P


def ang(v):
    return math.atan2(v[1], v[0])  # (y, z) 平面の角度 (ローカル X 回りの回転で増える向き)


def yz(v):
    return Vector((v.y, v.z))


def solve_leg(rig, basis, leg, F, dth_c, dth_h, lift_ok=True):
    """前後の脚 1 本の 2D IK。F: 球節の目標 (アーマチュア空間)。dth_c / dth_h: 管骨・蹄の rest からの角度差 (ワールド)"""
    bones = LEG_BONES[leg]
    parent = rig.data.bones[bones[0]].parent.name
    P = posed(rig, basis)
    T = P[parent] @ rest(rig, parent).inverted()
    Ti = T.inverted()
    Fr = Ti @ F
    rot_par = ang(yz(T.to_3x3() @ Vector((0, 1, 0))))  # 親の回り込み (ピッチ)
    j = [yz(joint(leg, i)) for i in range(5)]
    th0 = [ang(j[i + 1] - j[i]) for i in range(4)]
    L = [(j[i + 1] - j[i]).length for i in range(4)]
    th_c = th0[2] + dth_c - rot_par
    th_h = th0[3] + dth_h - rot_par
    A = j[0]
    C = yz(Fr) - Vector((math.cos(th_c), math.sin(th_c))) * L[2]
    AC = C - A
    d = max(abs(L[0] - L[1]) + 1e-4, min(L[0] + L[1] - 1e-4, AC.length))
    phi = ang(AC)
    beta = math.acos(max(-1, min(1, (L[0] ** 2 + d * d - L[1] ** 2) / (2 * L[0] * d))))
    rest_sign = (j[2] - j[0]).x * (j[1] - j[0]).y - (j[2] - j[0]).y * (j[1] - j[0]).x
    best = None
    for sg in (1, -1):
        J = A + Vector((math.cos(phi + sg * beta), math.sin(phi + sg * beta))) * L[0]
        cr = AC.x * (J - A).y - AC.y * (J - A).x
        if (cr > 0) == (rest_sign > 0):
            best = J
    Cn = A + AC.normalized() * d
    th = [ang(best - A), ang(Cn - best), th_c, th_h]
    acc = 0.0
    for i, bn in enumerate(bones):
        delta = th[i] - th0[i] - acc
        acc += delta
        basis[bn] = Matrix.Rotation(delta, 4, "X")


# 符号: どの骨もローカル X = ワールド X なので、ex > 0 は「骨の向きを前・下へ倒す」。
# 首 (上向きの骨) は前へ倒れ、頭・背骨 (前向きの骨) は先が下がる。ez は首の横曲げ、ey は頭の横倒し (ロール)
def rot_basis(ex=0.0, ey=0.0, ez=0.0):
    return Euler((ex, ey, ez), "XYZ").to_matrix().to_4x4()


def pelvis_basis(rig, dloc=None, wrot=None, local=None):
    """骨盤をワールドで dloc 動かし、wrot (ワールドの回転、骨盤の頭が中心) と local (ローカル回転) を掛ける"""
    R = rest(rig, "pelvis")
    h = R.translation
    W = Matrix.Translation(h + (dloc if dloc is not None else Vector())) @ (wrot.to_matrix().to_4x4() if wrot else Matrix.Identity(4)) @ Matrix.Translation(-h)
    return R.inverted() @ W @ R @ (local or Matrix.Identity(4))


D = math.radians


def leg_rest_F(leg):
    return joint(leg, 3).copy()


def gait(leg, u, off, duty, stride, lift, flex, curl, reach=0.0):
    """立脚 (u' < duty) は蹄を地面に固定して後ろへ、遊脚は持ち上げて前へ戻す。戻り値 (F, 管骨の角度差, 蹄の角度差)"""
    F0 = leg_rest_F(leg)
    up = (u - off) % 1.0
    front = leg.startswith("fl")
    hip = joint(leg, 0)
    if up < duty:
        s = up / duty
        y = F0.y - stride / 2 - reach + (stride + reach) * s
        z = F0.z
        fl = 0.0
        cu = 0.0
    else:
        s = (up - duty) / (1 - duty)
        e = s * s * (3 - 2 * s)
        y = F0.y + stride / 2 - (stride + reach) * e
        z = F0.z + lift * math.sin(math.pi * s) ** 0.8
        fl = flex * math.sin(math.pi * min(1.0, s * 1.15))
        cu = curl * math.sin(math.pi * s)
    alpha = math.atan2(y - hip.y, hip.z - z) - math.atan2(F0.y - hip.y, hip.z - F0.z)
    dth_c = alpha + (fl if front else -fl)
    # 蹄: 立脚中は地面に平ら (rest の角度)。遊脚では管骨に付いて回り、さらに巻き込む。両端で立脚の角度に戻る
    dth_h = dth_c * math.sin(math.pi * s) + cu if up >= duty else 0.0
    return Vector((F0.x, y, z)), dth_c, dth_h


def planted(leg, dy=0.0):
    F = leg_rest_F(leg)
    F.y += dy
    return F, 0.0, 0.0


def pose_idle(rig, t):
    T = 4.0
    ph = 2 * math.pi * t / T
    b = {}
    breath = math.sin(2 * ph)
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.006 + 0.006 * breath)))
    b["spine1"] = rot_basis(D(0.6) * breath)
    b["chest"] = rot_basis(-D(0.8) * breath)
    look = math.sin(ph)
    b["neck1"] = rot_basis(D(1.5) * math.sin(2 * ph), D(4) * look)
    b["neck2"] = rot_basis(D(-1.0) * math.sin(2 * ph), D(4) * look)
    b["head"] = rot_basis(D(2) * math.sin(ph + 1.0), 0, D(-5) * look)

    def flick(t0, dur=0.35):
        x = (t - t0) / dur
        return math.sin(math.pi * x) ** 2 if 0 <= x <= 1 else 0.0
    b["ear_L"] = rot_basis(D(-25) * flick(1.0), 0, D(20) * flick(1.0))
    b["ear_R"] = rot_basis(D(-25) * flick(2.7), 0, D(-20) * flick(2.7))
    tf = flick(2.0, 0.5) - 0.6 * flick(2.3, 0.4)
    b["tail1"] = rot_basis(D(20) * tf, 0, D(15) * tf)
    b["tail2"] = rot_basis(D(15) * tf)
    for leg in LEG_BONES:
        solve_leg(rig, b, leg, *planted(leg))
    return b


def pose_walk(rig, t):
    T = 1.2
    u = t / T
    ph = 2 * math.pi * u
    b = {}
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.012 + 0.012 * math.cos(2 * ph))), local=rot_basis(D(1.2) * math.sin(2 * ph)))
    b["spine1"] = rot_basis(-D(0.8) * math.sin(2 * ph))
    b["chest"] = rot_basis(0, D(1.5) * math.sin(ph))
    b["neck1"] = rot_basis(D(3) * math.sin(2 * ph + 0.8))
    b["neck2"] = rot_basis(D(-2) * math.sin(2 * ph + 0.8))
    b["head"] = rot_basis(D(-2) * math.sin(2 * ph + 1.2))
    b["tail1"] = rot_basis(D(6), 0, D(8) * math.sin(ph))
    b["tail2"] = rot_basis(D(4) * math.sin(2 * ph))
    b["ear_L"] = rot_basis(D(-4) * math.sin(2 * ph))
    b["ear_R"] = rot_basis(D(-4) * math.sin(2 * ph + 0.5))
    offs = {"hl_L": 0.0, "fl_L": 0.25, "hl_R": 0.5, "fl_R": 0.75}
    for leg, o in offs.items():
        front = leg.startswith("fl")
        solve_leg(rig, b, leg, *gait(leg, u, o, 0.64, 0.50, 0.10 if front else 0.08, D(62) if front else D(28), D(35)))
    return b


def pose_run(rig, t):
    T = 0.6
    u = t / T
    ph = 2 * math.pi * u
    b = {}
    # 回転ギャロップ: 右後 → 左後 → 右前 → 左前、その後に宙に浮く
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.03 + 0.05 * math.sin(ph - 0.6))), local=rot_basis(D(7) * math.sin(ph + 0.3)))
    b["spine1"] = rot_basis(-D(6) * math.sin(ph + 0.3))
    b["chest"] = rot_basis(-D(3) * math.sin(ph + 0.8))
    b["neck1"] = rot_basis(D(16) + D(8) * math.sin(ph + 1.6))
    b["neck2"] = rot_basis(D(6) + D(5) * math.sin(ph + 1.9))
    b["head"] = rot_basis(-D(16) - D(6) * math.sin(ph + 2.1))
    b["ear_L"] = rot_basis(D(30), 0, D(-18))
    b["ear_R"] = rot_basis(D(30), 0, D(18))
    b["tail1"] = rot_basis(D(25) + D(10) * math.sin(ph))
    b["tail2"] = rot_basis(D(15) * math.sin(ph + 0.5))
    offs = {"hl_R": 0.0, "hl_L": 0.1, "fl_R": 0.36, "fl_L": 0.46}
    for leg, o in offs.items():
        front = leg.startswith("fl")
        solve_leg(rig, b, leg, *gait(leg, u, o, 0.36, 0.78, 0.26 if front else 0.2, D(105) if front else D(55), D(45), reach=0.0))
    return b


def ease(a, b, t):
    return smoothstep(a, b, t)


def pose_graze_v1(rig, t):  # (M22-05 残りの手直しで pose_graze から改名。首だけ上下する試作 1 の食む動き、比較のために残す)
    # 0-1.2 s 頭を下げる、1.2-3.8 s 食む (顎を 3 回/秒)、3.8-5 s 上げる
    down = ease(0.0, 1.2, t) * (1 - ease(3.8, 5.0, t))
    chew = ease(1.2, 1.5, t) * (1 - ease(3.5, 3.8, t))
    b = {}
    # 胸を 10° 前へ下げ、首の付け根で 115°・中ほどで 30° 倒し、頭は -60° 起こして鼻先を地面へ (鼻先の高さ ~0.1 m)
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.03 * down)), local=rot_basis(D(2) * down))
    b["spine1"] = rot_basis(D(3) * down)
    b["chest"] = rot_basis(D(5) * down)
    nod = math.sin(2 * math.pi * 1.5 * t) * chew
    b["neck1"] = rot_basis(D(115) * down, D(3) * math.sin(2 * math.pi * t / 5 * 2) * down)
    b["neck2"] = rot_basis(D(30) * down - D(2) * nod)
    b["head"] = rot_basis(-D(60) * down + D(3) * nod)
    b["jaw"] = rot_basis(D(7) * max(0.0, math.sin(2 * math.pi * 3 * t)) * chew)
    fl = math.sin(math.pi * max(0.0, min(1.0, (t - 2.4) / 0.35))) ** 2
    b["ear_L"] = rot_basis(D(-15) * down, 0, D(12) * down + D(15) * fl)
    b["ear_R"] = rot_basis(D(-15) * down, 0, D(-12) * down)
    b["tail1"] = rot_basis(D(5) * math.sin(2 * math.pi * t / 2.5))
    for leg in LEG_BONES:
        solve_leg(rig, b, leg, *planted(leg))
    return b


def pose_fall_v1(rig, t):  # (M22-05 残りの手直しで pose_fall から改名。最後に角が地面下 0.93 m まで刺さっていた試作 1、比較のために残す)
    # 0-0.6 s 前膝が折れて胸が落ちる、0.5-1.4 s 横倒し、1.3-2 s 頭が地に落ちて静まる
    k1 = ease(0.0, 0.6, t)
    k2 = ease(0.45, 1.4, t)
    k3 = ease(1.2, 2.0, t)
    b = {}
    roll = Quaternion(Vector((0, 1, 0)), D(88) * k2)  # +Y 軸回り (体の右側を下に)
    drop = Vector((0.0, 0.0, -0.2 * k1 - 0.68 * k2)) + Vector((0.2, 0, 0)) * k2
    b["pelvis"] = pelvis_basis(rig, drop, wrot=roll, local=rot_basis(D(12) * k1 * (1 - k2) - D(3) * k2))
    b["spine1"] = rot_basis(D(4) * k1, 0, 0)
    b["chest"] = rot_basis(D(6) * k1 * (1 - k2))
    # 横倒しの後は首を地面側 (体の右 = ローカル -Z 回り) へ曲げ、頭は起こし気味にロールして角が地面に刺さらないようにする
    b["neck1"] = rot_basis(D(25) * k1 - D(5) * k2, 0, -D(28) * k3)
    b["neck2"] = rot_basis(D(10) * k1 + D(10) * k3, 0, -D(22) * k3)
    b["head"] = rot_basis(-D(10) * k1 - D(15) * k3, D(70) * k3, 0)
    b["jaw"] = rot_basis(D(4) * k3)
    b["ear_L"] = rot_basis(D(20) * k3, 0, D(-15) * k3)
    b["ear_R"] = rot_basis(D(20) * k3, 0, D(15) * k3)
    b["tail1"] = rot_basis(-D(15) * k3)
    fold_f = [D(25), -D(70), D(95), D(40)]   # 前脚: 肘・手首を折る
    fold_h = [-D(30), D(55), -D(60), D(40)]  # 後脚
    relax_f = [D(35), -D(25), D(30), D(25)]  # 横倒し後: 軽く曲げて投げ出す
    relax_h = [-D(40), D(20), -D(25), D(25)]
    for leg, bones in LEG_BONES.items():
        front = leg.startswith("fl")
        fold, relax = (fold_f, relax_f) if front else (fold_h, relax_h)
        kk = k1 if front else ease(0.2, 0.8, t)
        for i, bn in enumerate(bones):
            a = fold[i] * kk * (1 - k2) + relax[i] * k2
            b[bn] = Matrix.Rotation(a, 4, "X")
    return b


GRAZE_T = 10.0


def track(t, keys):
    """(時刻, 値) のキーを smoothstep で繋ぐ (M22-05 残りの手直しで追加)。最初と最後の値を同じにすればループが閉じ、キーでは速さ 0"""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * smoothstep(t0, t1, t)
    return keys[-1][1]


def swing(t, t0, t1):
    """t0〜t1 の遊脚の持ち上げ (0 → 1 → 0)"""
    return math.sin(math.pi * (t - t0) / (t1 - t0)) if t0 < t < t1 else 0.0


# 食む (M22-05 残りの手直しで作り直し、10 s ループ)。ユーザー (2026-09-24):「首だけおもちゃのように上下を繰り返すのはおかしい。
# 食べるときは一定、頭を下ろしたままだし、動きももっと前足を曲げて全身を落とすでしょう」。
#   0.3〜2.2 s 頭を下ろし、前足を曲げて前半身ごと沈める → 2.4〜4.2 s 食む (口元の小さな動きと、ときどき草を引きちぎる小さな引き)
#   4.3〜5.2 s 左前足をゆっくり一歩前へ (体重も少し前へ) → 5.6〜7.6 s 食む → 7.9〜9.7 s ゆっくり頭を上げて見回す (8.0〜8.9 s に左前足を体の下へ戻す)
#   → 9.7 s〜次の 0.3 s は頭を上げたまま (ループの継ぎ目。群れの VAT は個体ごとに位相をずらす)
GRAZE_DOWN = [(0, 0), (0.3, 0), (2.2, 1), (7.9, 1), (9.7, 0), (10, 0)]
GRAZE_CROUCH = [(0, 0), (0.5, 0), (2.4, 1), (7.7, 1), (9.5, 0), (10, 0)]
GRAZE_STEP = [(0, 0), (4.3, 0), (5.2, 1), (8.0, 1), (8.9, 0), (10, 0)]
GRAZE_CHEW = [(0, 0), (2.1, 0), (2.5, 1), (4.1, 1), (4.4, 0), (5.3, 0), (5.7, 1), (7.5, 1), (7.8, 0), (10, 0)]
GRAZE_LOOK = [(0, 1), (0.4, 1), (2.0, 0), (8.3, 0), (9.6, 1), (10, 1)]
GRAZE_STEP_Y = 0.17  # 一歩の長さ (m)
GRAZE_POSE = dict(pelvis_drop=0.07, pelvis_pitch=8.0, spine=2.0, chest=3.0, neck1=86.0, neck2=40.0, head=-52.0, carpus=20.0)


def pose_graze(rig, t):
    g = GRAZE_POSE
    down = track(t, GRAZE_DOWN)
    crouch = track(t, GRAZE_CROUCH)
    step = track(t, GRAZE_STEP)
    chew = track(t, GRAZE_CHEW)
    look = track(t, GRAZE_LOOK)
    w = 2 * math.pi / GRAZE_T
    b = {}
    breath = math.sin(w * 3 * t)
    # 前足を曲げて前半身を沈める: 骨盤を下げて前へ傾け、背と胸で少し足す。左前足を出したら体重も少し前へ
    b["pelvis"] = pelvis_basis(rig, Vector((0, -0.035 * step, -g["pelvis_drop"] * crouch - 0.004 + 0.004 * breath)),
                               local=rot_basis(D(g["pelvis_pitch"]) * crouch))
    b["spine1"] = rot_basis(D(g["spine"]) * crouch + D(0.5) * breath)
    b["chest"] = rot_basis(D(g["chest"]) * crouch - D(0.5) * breath)
    # 口元: 顎を 1.6 回/秒で小さく開け閉め。1.25 s ごとに頭を少し引いて草をちぎる (首は動かさない)
    bite = math.sin(w * 16 * t)
    tug = max(0.0, math.sin(w * 8 * t)) ** 4 * chew
    sweep = math.sin(w * 2 * t) * down  # 食みながら鼻先を左右へゆっくり
    b["neck1"] = rot_basis(D(g["neck1"]) * down + D(6) * (1 - down) * (1 - look), D(4) * sweep, 0)
    b["neck2"] = rot_basis(D(g["neck2"]) * down + D(1.0) * tug, D(-10) * look)
    b["head"] = rot_basis(D(g["head"]) * down - D(3.0) * tug, 0, D(5) * sweep + D(-12) * look)
    b["jaw"] = rot_basis(D(5) * (0.5 - 0.5 * bite) * chew)
    fl = max(0.0, math.sin(math.pi * (t - 3.1) / 0.35)) ** 2 if 3.1 < t < 3.45 else 0.0
    fr = max(0.0, math.sin(math.pi * (t - 6.6) / 0.35)) ** 2 if 6.6 < t < 6.95 else 0.0
    b["ear_L"] = rot_basis(D(-15) * down - D(20) * look, 0, D(12) * down + D(18) * fl)
    b["ear_R"] = rot_basis(D(-15) * down - D(20) * look, 0, D(-12) * down - D(18) * fr)
    tf = max(0.0, math.sin(math.pi * (t - 6.0) / 0.5)) if 6.0 < t < 6.5 else 0.0
    b["tail1"] = rot_basis(D(4) * math.sin(w * 4 * t) + D(15) * tf, 0, D(10) * tf)
    b["tail2"] = rot_basis(D(6) * tf)
    for leg in LEG_BONES:
        F, dc, dh = planted(leg)
        if leg.startswith("fl"):
            dc += D(g["carpus"]) * crouch  # 手首 (前膝) を前へ出して前足を曲げる
        if leg == "fl_L":
            F.y -= GRAZE_STEP_Y * step
            lift = swing(t, 4.3, 5.2) + swing(t, 8.0, 8.9)
            F.z += 0.07 * lift
            dc += D(35) * lift
            dh += D(25) * lift
        solve_leg(rig, b, leg, F, dc, dh)
    return b


# 倒れる (M22-05 残りの手直しで作り直し)。兎の担当の検証で、試作 1 は最後に角が地面下 0.93 m まで刺さっていた (右へ倒れた体と一緒に頭も転がり、右の角が下を向く)。
#   0〜0.6 s 前膝が折れて胸が落ちる (前足は蹄を地面に置いたまま IK で折る) → 0.45〜1.4 s 右側を下に横倒し
#   → 1.1〜2 s 首を前へ伸ばして地面に置く。頭は体と一緒に転がさず、世界に対して起こしたまま (角は上へ) 顎を地面に付ける
#   途中で蹄や脚が地面より下へ出るフレームは、bake_actions が出た分だけ体を持ち上げる (GROUND_CLAMP)
def pose_fall(rig, t, lift=0.0):
    k1 = ease(0.0, 0.6, t)
    k2 = ease(0.45, 1.4, t)
    k3 = ease(1.1, 2.0, t)
    b = {}
    roll = Quaternion(Vector((0, 1, 0)), D(88) * k2)  # +Y 軸回り (体の右側を下に)
    drop = Vector((0.12 * k2, 0.0, -0.22 * k1 - 0.75 * k2))
    pel_local = rot_basis(D(10) * k1 * (1 - k2) - D(3) * k2)
    b["pelvis"] = pelvis_basis(rig, drop, wrot=roll, local=pel_local)
    b["spine1"] = rot_basis(D(4) * k1 * (1 - k2), 0, 0)
    b["chest"] = rot_basis(D(6) * k1 * (1 - k2))
    # 首: 前へ伸ばし (体の前 = -Y へ寝かせる)、地面の側 (体の右 = ローカル -Z 回り) へ少し下ろす。体の転がりは首の捩じりで少し戻す
    b["neck1"] = rot_basis(D(25) * k1 * (1 - k3) + D(62) * k3, D(22) * k3, D(16) * k3)
    b["neck2"] = rot_basis(D(8) * k1 * (1 - k3) + D(22) * k3, D(22) * k3, D(14) * k3)
    b["jaw"] = rot_basis(D(4) * k3)
    b["ear_L"] = rot_basis(D(20) * k3, 0, D(-15) * k3)
    b["ear_R"] = rot_basis(D(20) * k3, 0, D(15) * k3)
    b["tail1"] = rot_basis(-D(15) * k3)
    relax_f = [D(35), -D(25), D(30), D(25)]  # 横倒し後: 軽く曲げて投げ出す
    relax_h = [-D(40), D(20), -D(25), D(25)]
    for leg, bones in LEG_BONES.items():
        front = leg.startswith("fl")
        relax = relax_f if front else relax_h
        if front:
            tmp = dict(b)
            solve_leg(rig, tmp, leg, leg_rest_F(leg), D(85) * k1, 0.0)  # 前膝をつく: 手首を前へ大きく折る
        else:
            tmp = dict(b)
            F = leg_rest_F(leg)
            solve_leg(rig, tmp, leg, F, -D(10) * ease(0.2, 0.8, t), 0.0)
        for i, bn in enumerate(bones):
            a_ik = tmp[bn].to_euler().x
            b[bn] = Matrix.Rotation(a_ik * (1 - k2) + relax[i] * k2, 4, "X")
    # 頭: 首の先に付いたままの向き (FK) から、世界に対して起こした向きへ移す。最後は鼻先を少し下げ、地面の側へ 12° 傾ける
    P = posed(rig, b)
    head = rig.data.bones["head"]
    par = P["neck2"] @ (head.parent.matrix_local.inverted() @ head.matrix_local)
    fk = par.to_quaternion()
    want = (Quaternion(Vector((0, 1, 0)), D(12) * k3) @ Quaternion(Vector((1, 0, 0)), D(8) * k3)) @ head.matrix_local.to_quaternion()
    q = fk.slerp(want, ease(0.3, 1.2, t))
    b["head"] = (fk.inverted() @ q).to_matrix().to_4x4()
    # 持ち上げは脚の IK を解いたあとに骨盤ごと平行移動する (先に動かすと IK が蹄を地面の下の目標へ引き戻す)
    b["pelvis"] = pelvis_basis(rig, drop + Vector((0, 0, lift)), wrot=roll, local=pel_local)
    return b


GROUND_CLAMP = {"fall"}  # (M22-05 残りの手直しで追加) 地面より下へ出た分だけ体を持ち上げるアクション


ACTIONS = [("idle", 4.0, pose_idle, True), ("walk", 1.2, pose_walk, True), ("run", 0.6, pose_run, True),
           ("graze", GRAZE_T, pose_graze, True), ("fall", 2.0, pose_fall, False)]  # (M22-05 残りの手直しで変更: graze 5 s → 10 s)
GROUND_TOL = 0.0  # 持ち上げたあとの一番低い頂点の高さ (m)


def set_pose(rig, basis):
    for bn in ORDER:
        M = basis.get(bn, Matrix.Identity(4))
        loc, q, _ = M.decompose()
        pb = rig.pose.bones[bn]
        pb.location = loc
        pb.rotation_quaternion = q


def lowest(meshes):
    """今の姿勢での 3 メッシュの一番低い頂点の高さ"""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    lo = 1e9
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        lo = min(lo, min((ev.matrix_world @ v.co).z for v in me.vertices))
        ev.to_mesh_clear()
    return lo


def ground_lifts(rig, fn, nf, meshes):
    """(M22-05 残りの手直しで追加) GROUND_CLAMP のアクションで、各フレームの一番低い頂点が地面 (z = 0) より下なら、その分だけ体を持ち上げる量。
    持ち上げは骨盤の平行移動なので正確に効く。前後 2 フレームの最大を取ってから平均してなめらかにする (どのフレームも元の量以上になる)"""
    rig.animation_data.action = None
    raw = []
    for f in range(nf + 1):
        set_pose(rig, fn(rig, f / FPS))
        raw.append(max(0.0, GROUND_TOL - lowest(meshes)))
    mx = [max(raw[max(0, i - 2):i + 3]) for i in range(len(raw))]
    return [sum(mx[max(0, i - 2):i + 3]) / len(mx[max(0, i - 2):i + 3]) for i in range(len(mx))]


def bake_actions(rig, meshes=()):
    global ORDER
    ORDER = bone_order(rig)
    rig.animation_data_create()
    acts = []
    for name, dur, fn, loop in ACTIONS:
        nf = round(dur * FPS)
        lifts = ground_lifts(rig, fn, nf, meshes) if name in GROUND_CLAMP and meshes else None  # (M22-05 残りの手直しで追加)
        if lifts:
            print(f"action {name}: ground lift max {max(lifts):.3f} m (frames {[i for i, v in enumerate(lifts) if v > 1e-4][:1]}..)")
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        last = {}
        for f in range(nf + 1):
            t = f / FPS
            basis = fn(rig, t if (f < nf or not loop) else 0.0)  # ループはの最後のフレームを最初と同じにする
            if lifts:
                basis = fn(rig, t, lift=lifts[f])
            for bn in ORDER:
                pb = rig.pose.bones[bn]
                M = basis.get(bn, Matrix.Identity(4))
                loc, q, _ = M.decompose()
                if bn in last and last[bn].dot(q) < 0:
                    q.negate()
                last[bn] = q
                pb.location = loc
                pb.rotation_quaternion = q
                pb.keyframe_insert("location", frame=f, group=bn)
                pb.keyframe_insert("rotation_quaternion", frame=f, group=bn)
        act.use_frame_range = True
        act.frame_start, act.frame_end = 0, nf
        act.use_cyclic = loop
        acts.append(act)
        print(f"action {name}: {nf} frames ({dur} s){' loop' if loop else ''}")
    rig.animation_data.action = None
    for act in acts:
        tr = rig.animation_data.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, 0, act)
        st.name = act.name
        tr.mute = True
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    return acts


# ---------------------------------------------------------------- 本体
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, 150
    os.makedirs(OUT_DIR, exist_ok=True)
    mats = make_materials()
    rig = build_rig()
    meshes = [build_lod(HERO, "deer", mats), build_lod(LOD1, "deer_lod1", mats), build_lod(HERO, "deer_doe", mats, antlers=False)]
    for ob in meshes:
        # アーマチュアの子にしない (glTF ではスキンのメッシュをルートに置く。親の変換はスキンに効かないため)
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f"mesh {ob.name}: {len(ob.data.vertices)} verts / {tris} tris, groups {len(ob.vertex_groups)}")
    bake_actions(rig, meshes)  # (M22-05 残りの手直しで変更: 地面へのめり込みを測るためにメッシュを渡す)
    # (M23-08) 遠い段はアクションを焼いた後に作る (接地の持ち上げは渡したメッシュの一番低い頂点で決まるので、先に作ると lod0・lod1 のアニメが変わる)
    build_far(meshes[1], "deer_far", rig, far_ratio)
    scene.frame_set(0)
    for o in scene.objects:
        o.select_set(True)
    blend = os.path.abspath(os.path.join(OUT_DIR, "deer.blend"))
    glb = os.path.abspath(os.path.join(OUT_DIR, "deer.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_animation_mode="ACTIONS",
                              export_force_sampling=True, export_frame_step=1, export_skins=True, export_influence_nb=4,
                              export_vertex_color="ACTIVE", export_yup=True, export_apply=False, export_def_bones=False,
                              export_optimize_animation_size=True, export_anim_slide_to_zero=True, export_rest_position_armature=True)
    print("saved", blend)
    print("saved", glb)


main()
