"""観察画面 (M22) の灰狼: 月鹿 (observe_deer.py) と同じ作り方で、丸めた形・スキン・6 つのアニメを持つモデルを組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf.py -- assets/models/observe
出力: <out_dir>/wolf.glb と wolf.blend
  - メッシュ `wolf` (近 LOD、~2,500 三角形)、`wolf_lod1` (群れ LOD、~800)。どちらも同じアーマチュア `wolf_rig` にスキン
  - アクション idle (4 s)・walk (1.1 s)・stalk (1.6 s)・run (0.5 s)・pounce (1.2 s、ループしない)・fall (2 s、ループしない)。30 fps、その場 (root は動かさない)
  - 材質 wolf_body (頂点色で喉・胸・腹・鼻づらの下を淡く) / wolf_dark (脚の下) / wolf_pale (頬と胸の飾り毛) / wolf_nose / wolf_glow (発光 #8FF5E6)
基準画: assets/textures/board/creatures/wolf.png (承認済み)。造形の元は assets/textures/concept/wolf-angular.png と tools/blender/wolf.py (ローポリ版)。
検証: tools/blender/observe_wolf_render.py で基準画と同じ向きを撮り、docs/design/qa/observe/ に並べる。

寸法: 単位 m、Blender では Z up・正面 -Y (glTF では Y up・正面 +Z)。背の最も高いところ (肩) 0.85 m、原点は四つの足の間の地面。
基準画の側面 (左上) を 0.0029 m/px で測った (地面 y=368 px、肩の背 y=68 px)。頭は背より低く前へ出し、尾は後ろ下へ垂らす (低い構え)。
作り方 (月鹿と同じ):
  - 胴・首・頭・脚・尾は断面リングのロフト (Catmull-Rom で断面を補間)。スムーズシェード。LOD は断面数と周方向の頂点数だけを変える
  - 背の稜線は胴・首・頭・尾の表面に上から落とした低い三角の畝 (発光)。肩と首の上に後ろへ倒れた棘 (前の面が発光)
  - 脇の継ぎ目 (肩の後ろ・肩の前・腰) は胴の表面に沿わせた細い帯 (発光)
  - スキンの重みは部品ごとに候補の骨を決め、骨の線分までの距離の逆 4 乗で配る (上位 3 本)
  - 脚のアニメは 2D の解析 IK (肩・股関節から足の付け根まで)。立脚中は足を地面に固定する
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

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


# 基準画 (creatures/wolf.png) の塗りから拾った代表色 (sRGB)。淡い色は基準画では陰の側にあるので、明るい面の値に戻してある
# (M22-05 残りの手直しで変更: 撮影で明るく桃色寄りに見えたので、地は青みを抜いて少し暗く、背の明るい面は黄みへ寄せた。
#  基準画の明るい面 #E7965D・中間 #D07544・陰 #BE673C に合わせ、陰の赤み fur_shade を足した。淡い色も桃色を抜いて暖かく暗めに)
PAL = {k: lin(v) for k, v in {
    "fur": "#CC6E40",       # 珊瑚色の地 (M22-05 残りの手直しで変更: #D8754C → #CC6E40)
    "fur_top": "#E49C5C",   # 背のわずかに明るい面 (M22-05 残りの手直しで変更: #E48A56 → #E49C5C、黄み)
    "fur_shade": "#B2623A",  # (M22-05 残りの手直しで追加) 脇の下側・腿の裏の陰の赤み
    "pale": "#A8856C",      # 喉・胸・腹・鼻づらの下・頬の淡い色 (灰色がかった淡い茶) (M22-05 残りの手直しで変更: #B08C78 → #A8856C)
    "ear_in": "#8E4E36",    # 耳の内側
    "dark": "#6B412F",      # 脚の下 (焦げ茶)
    "nose": "#3A2826",
    "glow": "#8FF5E6",
}.items()}
WHITE = (1.0, 1.0, 1.0)

BODY, DARK, PALE, NOSE, GLOW = range(5)
MAT_NAMES = ["wolf_body", "wolf_dark", "wolf_pale", "wolf_nose", "wolf_glow"]


def make_materials():
    mats = []
    for name in MAT_NAMES:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
        key = {"wolf_body": "fur", "wolf_dark": "dark", "wolf_pale": "pale", "wolf_nose": "nose", "wolf_glow": "glow"}[name]
        rgb = PAL[key]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        m.diffuse_color = (*rgb, 1)
        if name == "wolf_body":
            # 喉・胸の淡い色は頂点色 (COLOR_0) で持つ。Three.js 側は vertexColors で掛ける
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        if name == "wolf_glow":
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = 1.0
        mats.append(m)
    return mats


# ---------------------------------------------------------------- 骨 (頭・尾・親)。rest の位置は形の寸法と共有する
# (M22-05 残りの手直しで変更: 正面で前脚の間が狭く胸が頭より細く見えたので、前脚を 0.10 → 0.112 へ開いた)
FRONT_X, HIND_X = 0.112, 0.105
BONES = {
    "root": ((0, 0, 0), (0, -0.3, 0), None),
    "pelvis": ((0, 0.30, 0.57), (0, 0.05, 0.66), "root"),
    "spine1": ((0, 0.05, 0.66), (0, -0.18, 0.70), "pelvis"),
    "chest": ((0, -0.18, 0.70), (0, -0.34, 0.66), "spine1"),
    "neck1": ((0, -0.30, 0.64), (0, -0.42, 0.615), "chest"),
    "neck2": ((0, -0.42, 0.615), (0, -0.51, 0.585), "neck1"),
    "head": ((0, -0.51, 0.585), (0, -0.85, 0.41), "neck2"),
    "jaw": ((0, -0.57, 0.47), (0, -0.83, 0.38), "head"),
    "tail1": ((0, 0.32, 0.565), (0, 0.44, 0.50), "pelvis"),
    "tail2": ((0, 0.44, 0.50), (0, 0.56, 0.39), "tail1"),
    "tail3": ((0, 0.56, 0.39), (0, 0.69, 0.25), "tail2"),
}
for s, sx in (("L", -1), ("R", 1)):
    BONES[f"ear_{s}"] = ((sx * 0.08, -0.55, 0.67), (sx * 0.145, -0.53, 0.86), "head")
    fx, hx = sx * FRONT_X, sx * HIND_X
    # 前脚: 肩関節 → 肘 (後ろ下) → 手首 (前下) → 足の付け根 → 指先
    # (M22-05 残りの手直しで変更: 基準画の側面・忍び寄りは前脚を前へ突き出すので、手首から先を 4 cm 前へ。前腕が前下へ傾く)
    fl = [(fx, -0.25, 0.62), (fx, -0.20, 0.355), (fx, -0.285, 0.11), (fx, -0.30, 0.035), (fx, -0.365, 0.0)]
    # 後脚: 股関節 → 膝 (前下) → 飛節 (後ろ下) → 足の付け根 → 指先
    # (M22-05 残りの手直しで変更: 飛節から先を 2 cm 後ろへ。前後の足の中点 (原点) をほぼ保つ)
    hl = [(hx, 0.25, 0.55), (hx, 0.15, 0.33), (hx, 0.34, 0.14), (hx, 0.32, 0.035), (hx, 0.255, 0.0)]
    for pre, pts, par, names in (("fl", fl, "chest", ("upper", "fore", "meta", "paw")), ("hl", hl, "pelvis", ("thigh", "shin", "meta", "paw"))):
        prev = par
        for i, nm in enumerate(names):
            bn = f"{pre}_{nm}_{s}"
            BONES[bn] = (pts[i], pts[i + 1], prev)
            prev = bn
# 頭を持ち上げる量 (基準画の側面は頭が低く、正面・斜め前は高い。rest はその間にし、忍び寄りで下げる)
HEAD_DZ = 0.05
for k in list(BONES):
    h, t, p = BONES[k]
    if k in ("head", "jaw") or k.startswith("ear_"):
        BONES[k] = ((h[0], h[1], h[2] + HEAD_DZ), (t[0], t[1], t[2] + HEAD_DZ), p)
    elif k == "neck2":
        BONES[k] = ((h[0], h[1], h[2] + HEAD_DZ / 2), (t[0], t[1], t[2] + HEAD_DZ), p)
    elif k == "neck1":
        BONES[k] = (h, (t[0], t[1], t[2] + HEAD_DZ / 2), p)
BONES = {k: (Vector(h), Vector(t), p) for k, (h, t, p) in BONES.items()}
LEG_BONES = {f"{pre}_{s}": [f"{pre}_{nm}_{s}" for nm in names]
             for s in "LR" for pre, names in (("fl", ("upper", "fore", "meta", "paw")), ("hl", ("thigh", "shin", "meta", "paw")))}


def joint(name, i):
    """脚の関節 i (0 = 肩/股、4 = 指先) の rest 位置"""
    bones = LEG_BONES[name]
    return BONES[bones[i]][0] if i < 4 else BONES[bones[3]][1]


# ---------------------------------------------------------------- 形の道具 (observe_deer.py と同じ)
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


def facet_ring(bm, center, rx, ry_top, ry_bot, pinch, n, bevel=0.2):
    """(M22-05 残りの手直しで追加) 面の立った断面のリング。基準画の胴は背の面・脇の面・腹の面がはっきり分かれるので、
    超楕円 (樽) の代わりに角を持つ多角形を置く。角ごとに 2 点 (両隣の辺へ bevel の割合だけ寄せる) を置き、スムーズシェードでも
    面の中ほどは平らに、角は丸めて読ませる (月鹿と同じ「角ばりを丸めた」密度)。
    n = 18: 背の稜 1 + 片側の角 4 × 2 点 × 2 側 + 腹の中心 1。n = 10: 角 1 点ずつ (群れ LOD)。
    並びは ring() と同じ (上 → -X の脇 → 下 → +X の脇)"""
    # 右半分 (x >= 0) の角 (上から下へ): 背の稜・背と脇の境・脇の張り (最も幅の広いところ)・脇と腹の境・腹の縁・腹の中心
    corners = [(0.0, ry_top), (0.58 * rx, 0.80 * ry_top), (rx, 0.16 * ry_top), (0.90 * rx * (1 - 0.25 * pinch), -0.50 * ry_bot),
               (0.50 * rx * (1 - pinch), -0.93 * ry_bot), (0.0, -ry_bot)]
    pts = [corners[0]]
    for i in range(1, 5):
        c = Vector(corners[i])
        if n >= 18:
            a, b = Vector(corners[i - 1]), Vector(corners[i + 1])
            pts += [tuple(c + (a - c) * bevel), tuple(c + (b - c) * bevel)]
        else:
            pts.append(tuple(c))
    pts.append(corners[5])
    # 上 → -X 側を下へ → 下 → +X 側を上へ
    loop = [(-x, z) for x, z in pts] + [(x, z) for x, z in reversed(pts[1:-1])]
    return [bm.verts.new(center + X * x + Z * z) for x, z in loop]


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


def tube(bm, pts, radii, n, mats=None, mat=GLOW, tip=True, phase=0.0, flat=1.0):
    """折れ線に沿ったチューブ (尾)。tip=True で最後を 1 点に収束。flat で断面を横 (X) 方向に潰す"""
    rings = []
    for i, (p, r) in enumerate(zip(pts, radii)):
        if tip and i == len(pts) - 1:
            rings.append(bm.verts.new(p))
            continue
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = (Z.cross(d) if abs(d.z) < 0.9 else X.cross(d)).normalized()
        v = d.cross(u).normalized()
        rings.append(ring(bm, p, u, v, r * flat, r, r, n, phase=phase))
    faces = loft(bm, rings, mat=mat, mats=mats)
    faces.append(cap(bm, list(reversed(rings[0])), mats[0] if mats else mat))
    if not tip:
        faces.append(cap(bm, rings[-1], mats[-1] if mats else mat))
    return faces


# ---------------------------------------------------------------- LOD の密度
# (M22-05 残りの手直しで変更: 胴の断面を面の立った多角形 (facet_ring) にし、周方向を 16 → 18、脚の断面を 11 → 10、稜線を 44 → 36 に。
#  継ぎ目と眉の光を足した分の三角形をここで返す)
HERO = dict(name="hero", body=(14, 18), neck=(6, 14), head=(11, 14), leg=(10, 8), paw=6, ear=(4, 8), tail=(8, 10),
            crest=36, ribbon_seg=8, eye=10, sq=2.3, spikes=True, tufts=True, brow=True)
LOD1 = dict(name="lod1", body=(7, 10), neck=(3, 8), head=(6, 8), leg=(6, 5), paw=0, ear=(2, 4), tail=(4, 6),
            crest=14, ribbon_seg=3, eye=4, sq=2.2, spikes=True, tufts=False, brow=False)

# 胴 (尻 → 胸): (y, 背の高さ, 腹の高さ, 半幅, 腹側の絞り)。肩が最も高く、腹は巻き上がり、胸は深い
BODY_KEYS = [
    (0.37, 0.55, 0.43, 0.05, 0.0),
    (0.33, 0.585, 0.38, 0.11, 0.10),
    (0.25, 0.635, 0.36, 0.14, 0.18),
    (0.14, 0.70, 0.40, 0.135, 0.26),
    (0.02, 0.77, 0.42, 0.145, 0.30),
    (-0.10, 0.83, 0.39, 0.17, 0.34),
    (-0.21, 0.85, 0.345, 0.195, 0.40),
    (-0.31, 0.815, 0.33, 0.19, 0.42),
    (-0.39, 0.745, 0.355, 0.16, 0.42),
    (-0.445, 0.66, 0.43, 0.09, 0.30),
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
    # (M22-05 残りの手直しで変更: 超楕円の ring() から面の立った facet_ring() へ。元は
    #  ring(bm, Vector((0, y, (top + bot) / 2)), X, Z, hw, (top - bot) / 2, (top - bot) / 2, n, pinch, sq=lod["sq"], phase=math.pi / 2))
    rings = [facet_ring(bm, Vector((0, y, (top + bot) / 2)), hw, (top - bot) / 2, (top - bot) / 2, pinch, n)
             for y, top, bot, hw, pinch in secs]
    rear = bm.verts.new((0, secs[0][0] + 0.02, (secs[0][1] + secs[0][2]) / 2))
    front = bm.verts.new((0, secs[-1][0] - 0.02, (secs[-1][1] + secs[-1][2]) / 2))
    loft(bm, [rear] + rings + [front])


# 首: 胸の中から頭の後ろへ、前下がりに太く短く。(y, z, 横半径, 喉側, 項側)
NECK_KEYS = [(-0.27, 0.62, 0.14, 0.20, 0.17), (-0.36, 0.605 + HEAD_DZ * 0.4, 0.145, 0.215, 0.165), (-0.45, 0.575 + HEAD_DZ * 0.8, 0.135, 0.19, 0.135),
             (-0.52, 0.56 + HEAD_DZ, 0.12, 0.16, 0.115), (-0.56, 0.555 + HEAD_DZ, 0.10, 0.12, 0.09)]


def build_neck(bm, lod):
    nsec, n = lod["neck"]
    secs = resample(NECK_KEYS, nsec)
    pts = [Vector((0, s[0], s[1])) for s in secs]
    rings = []
    for i, (y, z, rx, rf, rb) in enumerate(secs):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        uy = X.cross(d).normalized()  # d が前 (-Y) なので uy は上。喉 (下) 側は -uy
        rings.append(ring(bm, pts[i], X, uy, rx, rb, rf, n, pinch=0.2, phase=math.pi / 2))
    loft(bm, rings)
    cap(bm, list(reversed(rings[0])))
    cap(bm, rings[-1])


# 頭 (後頭部 → 鼻先): (y, 中心 z, 横半径, 上, 下, 下側の絞り)。額から鼻先へ下がる楔形
HEAD_KEYS = [
    (-0.465, 0.60, 0.05, 0.05, 0.05, 0.0),
    (-0.495, 0.60, 0.12, 0.10, 0.12, 0.10),
    (-0.555, 0.575, 0.14, 0.115, 0.16, 0.20),
    # (M22-05 残りの手直しで変更: 鼻づらが細く尖って狐寄りだったので、額から鼻づらへの段 (ストップ) を付け、鼻づらの上の線を
    #  頬を広げ、鼻先を 3 cm 下げて頭を前下がりにし、鼻づらは楔のまま先を太く (深さ 0.07 → 0.086 m、幅 0.08 → 0.09 m)、顎の線を鼻先へ上げた。断面は head_sq で箱寄りに。元の値は
    #  (-0.615, 0.54, 0.128, 0.11, 0.15, 0.30), (-0.675, 0.49, 0.092, 0.095, 0.115, 0.32), (-0.735, 0.452, 0.072, 0.08, 0.085, 0.30),
    #  (-0.795, 0.43, 0.062, 0.064, 0.068, 0.25), (-0.835, 0.422, 0.054, 0.05, 0.056, 0.18), (-0.855, 0.418, 0.036, 0.032, 0.036, 0.1))
    (-0.615, 0.54, 0.137, 0.120, 0.150, 0.30),
    (-0.675, 0.495, 0.106, 0.113, 0.120, 0.30),
    (-0.735, 0.462, 0.077, 0.096, 0.096, 0.26),
    (-0.795, 0.442, 0.062, 0.076, 0.076, 0.20),
    (-0.835, 0.430, 0.053, 0.060, 0.060, 0.14),
    (-0.862, 0.425, 0.042, 0.041, 0.041, 0.08),
]
HEAD_KEYS = [(y, zc + HEAD_DZ, rx * 1.06, rt * 1.04, rb * 1.04, pn) for y, zc, rx, rt, rb, pn in HEAD_KEYS]
NOSE_Y = -0.812


def head_sq(y):
    """(M22-05 残りの手直しで追加) 頭の断面の角ばり: 頭蓋は丸め (2.2)、鼻づらは箱寄り (2.7。上・横・下の面が立つ)"""
    return 2.2 + 0.5 * smoothstep(-0.64, -0.74, y)


def build_head(bm, lod):
    nsec, n = lod["head"]
    secs = resample(HEAD_KEYS, nsec)
    # (M22-05 残りの手直しで変更: 断面の角ばりを y で変える (sq=2.2 → head_sq(y))。先の 1 点は 8 mm → 4 mm 前にして鼻先を平らに)
    rings = [ring(bm, Vector((0, y, zc)), X, Z, rx, rt, rb, n, pinch, sq=head_sq(y), phase=math.pi / 2) for y, zc, rx, rt, rb, pinch in secs]
    back = bm.verts.new((0, secs[0][0] + 0.01, secs[0][1]))
    tip = bm.verts.new((0, secs[-1][0] - 0.004, secs[-1][1] + 0.01))
    faces = loft(bm, [back] + rings + [tip])
    # (M22-05 残りの手直しで変更: 鼻は鼻先に載せた小さな塊 (build_nose) にし、頭の面には付けない。元は鼻先全体
    #  (c.y < NOSE_Y - 0.012 and c.z > 0.41 + HEAD_DZ) を鼻の材質にしていて、正面から大きな黒い玉に見えた)
    return faces


def build_nose(bm, lod):
    """(M22-05 残りの手直しで追加) 鼻: 鼻先の前・上に載せた小さな丸い塊 (幅 4.6 cm、高さ 3 cm、前へ 1 cm 出す)。
    正面では鼻づらの幅の半分ほどの逆三角寄りの形、側面では鼻先の小さな黒い突起に見える"""
    y0, zc = HEAD_KEYS[-1][0], HEAD_KEYS[-1][1]
    n = 8 if lod["name"] == "hero" else 5
    c = Vector((0, y0 - 0.004, zc + 0.014))
    rings = []
    for k, (dy, s) in enumerate(((0.020, 0.55), (0.006, 1.0), (-0.008, 0.75))):
        vs = []
        for i in range(n):
            a = 2 * math.pi * i / n + math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            w = 0.023 * s * (1 - 0.35 * max(0.0, -sa))  # 下側を絞る (逆三角寄り)
            vs.append(bm.verts.new(c + Vector((w * ca, dy, 0.015 * s * sa))))
        rings.append(vs)
    tip = bm.verts.new(c + Vector((0, -0.016, 0.002)))
    loft(bm, rings + [tip], mat=NOSE)
    cap(bm, list(reversed(rings[0])), NOSE)


def build_ears(bm, lod, side):
    """尖った三角の耳。前面 (内側) をくぼませ、内側は頂点色で濃くする"""
    nsec, n = lod["ear"]
    h, t = BONES["ear_L" if side < 0 else "ear_R"][:2]
    base = h.copy()
    axis = (t - h).normalized()
    front = Vector((side * 0.55, -1, 0.1))
    front = (front - axis * front.dot(axis)).normalized()  # 耳の開き (前・少し外)
    w = axis.cross(front).normalized()
    keys = [(0.0, 0.08, 0.038), (0.055, 0.076, 0.032), (0.115, 0.05, 0.022), (0.17, 0.02, 0.01)]
    secs = resample(keys, nsec + 1)
    rings = []
    for tt, wd, th in secs[:-1]:
        c = base + axis * tt
        vs = []
        for i in range(n):
            a = 2 * math.pi * i / n
            ca, sa = math.cos(a), math.sin(a)
            dz = th * sa * (0.3 if sa > 0 else 1.0)  # 前面 (耳の内側) を浅く
            vs.append(bm.verts.new(c + w * (wd * ca) + front * dz))
        rings.append(vs)
    tip = bm.verts.new(base + axis * (secs[-1][0] + 0.03))
    loft(bm, rings + [tip])
    cap(bm, list(reversed(rings[0])))
    return front


# 脚の断面: (関節 i から i+1 への位置 t, 横半径, 前後半径)。DARK_T より先 (下) は焦げ茶の材質
# (M22-05 残りの手直しで変更: 肩の付け根を横に薄く前後に広い板 (0.085 x 0.12 → 0.078 x 0.14) にして肩の面を作る)
FRONT_LEG = [(0.05, 0.078, 0.14), (0.45, 0.062, 0.088), (0.85, 0.046, 0.058), (1.05, 0.042, 0.05), (1.5, 0.036, 0.042),
             (1.9, 0.032, 0.038), (2.05, 0.034, 0.04), (2.5, 0.032, 0.036), (3.0, 0.03, 0.034)]
HIND_LEG = [(0.05, 0.085, 0.14), (0.4, 0.07, 0.11), (0.8, 0.052, 0.075), (1.0, 0.046, 0.058), (1.4, 0.04, 0.046),
            (1.85, 0.034, 0.04), (2.05, 0.036, 0.044), (2.5, 0.031, 0.036), (3.0, 0.03, 0.034)]
DARK_T = {"fl": 0.7, "hl": 0.8}
LEG_DARK_Z = {"fl": 0.44, "hl": 0.38}  # 焦げ茶の境のおおよその高さ (その上を頂点色で暗くしてつなぐ)


def leg_point(name, t):
    i = min(int(t), 3)
    a, b = joint(name, i), joint(name, i + 1)
    return a + (b - a) * (t - i)


def build_leg(bm, lod, name):
    nsec, n = lod["leg"]
    keys = FRONT_LEG if name.startswith("fl") else HIND_LEG
    if lod["paw"] == 0:
        keys = keys + [(3.5, 0.042, 0.058), (3.95, 0.045, 0.055)]  # 群れ LOD は足も脚のロフトで作る
    secs = resample(keys, nsec)
    pts = [leg_point(name, t) for t, _, _ in secs]
    if lod["paw"] == 0:
        pts[-1] = Vector((pts[-1].x, pts[-1].y, 0.012))
        pts[-2] = Vector((pts[-2].x, pts[-2].y, 0.03))
    rings = []
    for i, (t, rx, ry) in enumerate(secs):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if lod["paw"] == 0 and i >= len(secs) - 2:
            d = Vector((0, 0, -1))  # 群れ LOD の足の断面は水平に (地面より下へはみ出さない)
        uy = X.cross(d).normalized()
        # (M22-05 残りの手直しで変更: 肩・腿の断面を箱寄りに (sq 2 → 2.9、下へ行くほど 2 に戻す)。肩と腿の面を立てる)
        sq = 2.0 + 0.9 * smoothstep(1.1, 0.3, t)
        rings.append(ring(bm, pts[i], X, uy, rx, ry, ry, n, sq=sq, phase=math.pi / 2))
    dark_t = DARK_T[name[:2]]
    mats = [DARK if (secs[i][0] + secs[i + 1][0]) / 2 > dark_t else BODY for i in range(len(secs) - 1)]
    loft(bm, rings, mats=mats)
    cap(bm, list(reversed(rings[0])))
    cap(bm, rings[-1], DARK)


def build_paw(bm, lod, name):
    """足: 付け根の下から指先へ伸びる丸い塊。底は地面 (z = 0) に平ら"""
    n = lod["paw"]
    base = joint(name, 3)
    x = base.x
    # (付け根からの前後 dy (前が負), 横半径, 上の半径, 中心の高さ)
    keys = [(0.04, 0.026, 0.022, 0.032), (0.015, 0.043, 0.036, 0.036), (-0.035, 0.05, 0.032, 0.032), (-0.078, 0.043, 0.022, 0.024)]
    rings = [ring(bm, Vector((x, base.y + dy, zc)), X, Z, rx, rt, zc, n, phase=math.pi / 2) for dy, rx, rt, zc in keys]
    back = bm.verts.new((x, base.y + 0.055, 0.03))
    toe = bm.verts.new((x, base.y - 0.1, 0.016))
    loft(bm, [back] + rings + [toe], mat=DARK)


def build_tail(bm, lod):
    """ふさふさの尾: 付け根は細く、中ほどで太り、先は尖る。横に少し潰す"""
    nsec, n = lod["tail"]
    # (M22-05 残りの手直しで変更: 基準画より長く細かったので、長さ 0.53 → 0.45 m、最も太いところ 0.078 → 0.092 m に。
    #  元は pts (0.30, 0.575)…(0.72, 0.20)、radii 0.04 / 0.068 / 0.078 / 0.055 / 0)
    pts = resample_path([(0, 0.30, 0.575), (0, 0.40, 0.522), (0, 0.50, 0.435), (0, 0.59, 0.325), (0, 0.655, 0.235)], nsec)
    radii = [r for (r,) in resample([(0.045,), (0.080,), (0.092,), (0.066,), (0.0,)], nsec)]
    tube(bm, pts, radii, n, mat=BODY, flat=0.8)


# ---------------------------------------------------------------- 表面への投影 (稜線・継ぎ目)
def surf(bvh, y, z, side, off, phi=0.0):
    """側面図の座標 (y, z) を表面へ投影し、法線方向へ off 浮かせる。
    視線は横 (side 側) から、上下に外れた点ほど体の中心へ向けて傾ける。phi (度) で前 (-Y) へ回す"""
    ph = math.radians(phi)
    zc = body_zc(y)
    for k in range(40):
        zz = z + (zc - z) * k / 40
        tilt = max(-1.0, min(1.0, (zz - zc) / 0.2)) * 0.8
        d = Vector((side * math.cos(ph), -math.sin(ph), tilt)).normalized()
        q = Vector((0, y, zz))
        loc, nrm, _, _ = bvh.ray_cast(q + d * 2.0, -d)
        if loc is not None:
            break
    else:
        raise RuntimeError(f"surface miss y={y} z={z}")
    if nrm.dot(d) < 0:
        nrm = -nrm
    return loc + nrm * off, nrm


def build_ribbon(bm, bvh, lod, path, side, width=0.02):
    """胴に沿う光る継ぎ目。path は (y, z, phi)。断面は 3 点の低い山 (近 LOD) / 平らな帯 (群れ LOD)"""
    nseg = lod["ribbon_seg"]
    dense = resample([tuple(p) for p in path], nseg + 1)
    hits = [surf(bvh, y, z, side, 0.0, phi) for y, z, phi in dense]
    prev = None
    for i, (loc, n) in enumerate(hits):
        d = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        # 先へ細る (筆の払い)
        wi = width * (1.0 - 0.6 * (i / (len(hits) - 1)) ** 2)
        sv = n.cross(d).normalized() * (wi / 2)
        if lod["name"] == "hero":
            cur = [bm.verts.new(loc - sv + n * 0.003), bm.verts.new(loc + n * 0.009), bm.verts.new(loc + sv + n * 0.003)]
        else:
            cur = [bm.verts.new(loc - sv * 1.4 + n * 0.006), bm.verts.new(loc + sv * 1.4 + n * 0.006)]
        if prev:
            for j in range(len(cur) - 1):
                f = bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
                f.material_index = GLOW
                f.smooth = True
                f.normal_update()
                if f.normal.dot(n) < 0:
                    f.normal_flip()
        prev = cur


def crest_path(bvh, count):
    """背の中心線: 頭の上から尾の先まで、上から落とした点を弧長で count 点に並べ直す"""
    raw = []
    y = -0.47
    while y <= 0.70:
        loc, nrm, _, _ = bvh.ray_cast(Vector((0, y, 3.0)), Vector((0, 0, -1)))
        if loc is not None:
            raw.append((loc, nrm))
        y += 0.005
    acc = [0.0]
    for a, b in zip(raw, raw[1:]):
        acc.append(acc[-1] + (b[0] - a[0]).length)
    out = []
    j = 0
    for i in range(count):
        s = acc[-1] * i / (count - 1)
        while j < len(acc) - 2 and acc[j + 1] < s:
            j += 1
        t = (s - acc[j]) / max(1e-6, acc[j + 1] - acc[j])
        p = raw[j][0].lerp(raw[j + 1][0], t)
        n = raw[j][1].lerp(raw[j + 1][1], t).normalized()
        if n.z < 0:
            n = -n
        out.append((p, n))
    return out


def build_crest(bm, bvh, lod):
    """背の稜線: 中心線に沿う低い三角の畝 (発光)。群れ LOD は平らな帯"""
    path = crest_path(bvh, lod["crest"] + 1)
    prev = None
    for i, (p, n) in enumerate(path):
        d = (path[min(i + 1, len(path) - 1)][0] - path[max(i - 1, 0)][0]).normalized()
        side = d.cross(n).normalized()
        # 尾の先へ細る
        u = i / (len(path) - 1)
        w = 0.03 * (1.0 - 0.55 * smoothstep(0.7, 1.0, u)) * (0.6 + 0.4 * smoothstep(0.0, 0.08, u))
        if lod["name"] == "hero":
            cur = [bm.verts.new(p - side * w + n * 0.002), bm.verts.new(p + n * 0.024), bm.verts.new(p + side * w + n * 0.002)]
        else:
            cur = [bm.verts.new(p - side * w * 1.3 + n * 0.012), bm.verts.new(p + side * w * 1.3 + n * 0.012)]
        if prev:
            for j in range(len(cur) - 1):
                f = bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
                f.material_index = GLOW
                f.smooth = True
                f.normal_update()
                if f.normal.z < 0 and f.normal.dot(n) < 0:
                    f.normal_flip()
        prev = cur
    return path


# 棘 (首と肩の上): (y, 高さ, 長さ)。後ろへ倒れた薄い楔。前の上の面が発光、後ろの面は毛
SPIKES_HERO = [(-0.33, 0.065, 0.075), (-0.26, 0.085, 0.085), (-0.185, 0.085, 0.09), (-0.11, 0.07, 0.08), (-0.04, 0.055, 0.07), (0.03, 0.04, 0.06)]
SPIKES_LOD1 = [(-0.30, 0.08, 0.09), (-0.19, 0.09, 0.1), (-0.08, 0.07, 0.085)]


def build_spikes(bm, bvh, lod):
    spikes = SPIKES_HERO if lod["name"] == "hero" else SPIKES_LOD1
    for y, h, ln in spikes:
        loc, nrm, _, _ = bvh.ray_cast(Vector((0, y, 3.0)), Vector((0, 0, -1)))
        fwd = Vector((0, -1, 0))
        fwd = (fwd - nrm * fwd.dot(nrm)).normalized()
        F = loc + fwd * (ln * 0.55) - nrm * 0.01
        B = loc - fwd * (ln * 0.45) - nrm * 0.01
        A = loc + nrm * h - fwd * (ln * 0.9)  # 先は後ろへ倒す
        mid = (F + B + A) / 3
        wv = X * (0.018 if lod["name"] == "hero" else 0.022)
        L, R = mid - wv, mid + wv
        for tri, mat in (((F, A, L), GLOW), ((A, B, L), BODY), ((F, R, A), GLOW), ((A, R, B), BODY)):
            vs = [bm.verts.new(v) for v in tri]
            f = bm.faces.new(vs)
            f.material_index = mat
            f.smooth = False
            f.normal_update()
            c = f.calc_center_median()
            if f.normal.dot(c - (loc + nrm * h * 0.3)) < 0:
                f.normal_flip()


# 飾り毛 (淡い色の楔): 頬の後ろと胸の前。(位置, 向き, 長さ, 太さ)
TUFTS = []
for sx in (-1, 1):
    TUFTS += [((sx * 0.12, -0.565, 0.47 + HEAD_DZ), (sx * 0.6, 0.6, -0.5), 0.085, 0.034),
              ((sx * 0.10, -0.52, 0.43 + HEAD_DZ), (sx * 0.55, 0.6, -0.6), 0.09, 0.036),
              ((sx * 0.08, -0.46, 0.40), (sx * 0.4, 0.35, -0.85), 0.075, 0.032)]
TUFTS += [((0.0, -0.44, 0.38), (0, -0.25, -1), 0.07, 0.035), ((-0.05, -0.42, 0.37), (-0.2, -0.2, -1), 0.06, 0.03),
          ((0.05, -0.42, 0.37), (0.2, -0.2, -1), 0.06, 0.03)]


def build_tufts(bm, bvh):
    for pos, dirv, ln, th in TUFTS:
        p = Vector(pos)
        loc = bvh.find_nearest(p)[0]
        d = Vector(dirv).normalized()
        u = (d.cross(Z) if abs(d.z) < 0.95 else d.cross(X)).normalized()
        v = d.cross(u).normalized()
        base = [loc + u * th - d * 0.01, loc - u * th - d * 0.01, loc + v * th * 0.7 - d * 0.01]
        apex = loc + d * ln
        vs = [bm.verts.new(b) for b in base]
        a = bm.verts.new(apex)
        for i in range(3):
            f = bm.faces.new((vs[i], vs[(i + 1) % 3], a))
            f.material_index = PALE
            f.smooth = False
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - (loc + d * ln * 0.3)) < 0:
                f.normal_flip()


def build_eye(bm, bvh_head, lod, side):
    """吊り上がったアーモンド形の光る目。目尻は後ろ上へ伸ばして隈取りの線にする"""
    loc, n, _, _ = bvh_head.ray_cast(Vector((side * 1.0, -0.625, 0.545 + HEAD_DZ)), Vector((-side, 0, 0)))
    if n.dot(Vector((side, 0, 0))) < 0:
        n = -n
    u = Vector((0, -1, -0.3))
    u = (u - n * u.dot(n)).normalized()  # 目の長軸 (目頭は前下、目尻は後ろ上)
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v
    k = lod["eye"]

    def disc(L, H, off, bulge, mat, tail=1.0):
        c = bm.verts.new(loc + n * (off + bulge))
        vs = []
        for i in range(k):
            a = 2 * math.pi * i / k
            ca, sa = math.cos(a), math.sin(a)
            # 目尻 (後ろ、ca < 0) を尖らせて伸ばす
            sharp = 1.0 - 0.55 * max(0.0, -ca)
            ll = L * (tail if ca < 0 else 1.0)
            p = loc + u * (ll * ca) + v * (H * sa * sharp) + n * off
            best = bvh_head.find_nearest(p)
            p = best[0] + n * off if best[0] is not None else p
            vs.append(bm.verts.new(p))
        for i in range(k):
            f = bm.faces.new((vs[i], vs[(i + 1) % k], c))
            f.material_index = mat
            f.normal_update()
            if f.normal.dot(n) < 0:
                f.normal_flip()

    # (M22-05 残りの手直しで変更: 基準画の目は大きく光るので 1 割大きく。元は disc(0.036, 0.019, …) と disc(0.028, 0.012, …))
    if lod["name"] == "hero":
        disc(0.040, 0.021, 0.003, 0.003, NOSE, tail=1.5)
    disc(0.031, 0.0135, 0.006, 0.007, GLOW, tail=1.7)


def build_brow(bm, bvh_head, lod, side, width=0.011):
    """(M22-05 残りの手直しで追加) 眉の光る線: BROW を頭の表面へ吸わせた細い帯 (目頭側を太く、耳の側へ細る)"""
    nseg = lod["ribbon_seg"] - 2
    dense = resample_path([Vector((side * x, y, z)) for x, y, z in BROW], nseg + 1)
    hits = []
    for p in dense:
        loc, n, _, _ = bvh_head.find_nearest(p)
        if n.dot(loc - Vector((0, loc.y, 0.58))) < 0:
            n = -n
        hits.append((loc, n))
    prev = None
    for i, (loc, n) in enumerate(hits):
        d = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        wi = width * (1.0 - 0.55 * i / (len(hits) - 1))
        sv = n.cross(d).normalized() * (wi / 2)
        cur = [bm.verts.new(loc - sv + n * 0.003), bm.verts.new(loc + n * 0.006), bm.verts.new(loc + sv + n * 0.003)]
        if prev:
            for j in range(2):
                f = bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
                f.material_index = GLOW
                f.normal_update()
                if f.normal.dot(n) < 0:
                    f.normal_flip()
        prev = cur


# ---------------------------------------------------------------- 頂点色と重み
def color_for(part, co, n):
    if part == "body":
        # (M22-05 残りの手直しで変更: 面ごとの明暗を頂点色でも付ける。背の面は黄みの明るい色 (0.5..0.95 → 0.3..0.8、0.7 → 0.9)、
        #  脇の下側は陰の赤み、淡い色は腹の面だけ (-0.2..-0.6 → -0.5..-0.85)。基準画の明暗の幅に寄せる)
        c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.3, 0.8, n.z) * 0.9)
        c = mix(c, PAL["fur_shade"], smoothstep(0.05, -0.4, n.z) * 0.8)
        c = mix(c, PAL["pale"], smoothstep(-0.5, -0.85, n.z))
        c = mix(c, PAL["pale"], smoothstep(-0.1, -0.6, n.y) * smoothstep(-0.26, -0.36, co.y) * smoothstep(0.66, 0.54, co.z))  # 胸の前
        return c
    if part == "neck":
        # 喉 (首の下側) は淡い。項は毛
        return mix(PAL["fur"], PAL["pale"], smoothstep(0.2, -0.3, n.z) * smoothstep(0.66, 0.56, co.z))
    if part == "head":
        # 鼻づらの下・頬・顎の下は淡い。境は目の下から鼻先へ下がる斜めの線
        zb = 0.50 + HEAD_DZ + (co.y + 0.60) * 0.3 if co.y < -0.60 else 0.50 + HEAD_DZ
        c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.3, 0.85, n.z) * 0.8)  # (M22-05 残りの手直しで追加) 額と鼻づらの上の面は明るく
        c = mix(c, PAL["pale"], smoothstep(zb + 0.012, zb - 0.02, co.z))
        # (M22-05 残りの手直しで変更: 上の行を足したので、淡い色の mix の起点 PAL["fur"] を c に)
        return c
    if part.startswith("ear"):
        return PAL["ear_in"] if n.dot(EAR_FRONT[part]) > 0.3 else PAL["fur"]
    if part.startswith("leg"):
        side = 1 if co.x > 0 else -1
        c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.2, 0.8, n.z) * 0.7)  # (M22-05 残りの手直しで追加) 肩・腿の上の面は明るく
        c = mix(c, PAL["fur_shade"], smoothstep(0.3, 0.9, n.y) * smoothstep(0.35, 0.6, co.z) * 0.6)  # (M22-05 残りの手直しで追加) 腿の裏は陰
        c = mix(c, PAL["pale"], smoothstep(0.2, 0.8, -n.x * side) * smoothstep(0.3, 0.5, co.z) * 0.5)  # 脚の内側
        # (M22-05 残りの手直しで変更: 上の 2 行を足したので、この行の元の mix の起点 PAL["fur"] を c に)
        zd = LEG_DARK_Z[part[4:6]]
        return mix(c, PAL["dark"], smoothstep(zd + 0.14, zd - 0.01, co.z) * 0.55)  # 焦げ茶の手前で暗くしてつなぐ
    if part == "spike":
        return mix(PAL["fur"], PAL["fur_top"], 0.6)  # 棘の後ろの面は背の毛の色
    if part == "tail":
        c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.3, 0.9, n.z) * 0.6)
        c = mix(c, PAL["fur_shade"], smoothstep(0.1, -0.4, n.z) * 0.5)  # (M22-05 残りの手直しで追加) 尾の下側の陰
        return mix(c, PAL["pale"], smoothstep(-0.2, -0.8, n.z) * 0.55)
    return WHITE


EAR_FRONT = {}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def body_cands(co):
    c = [("pelvis", 1.0), ("spine1", 1.0), ("chest", 1.0), ("neck1", 0.4), ("tail1", 0.2)]
    side = "L" if co.x < 0 else "R"
    if abs(co.x) > 0.03 and co.z < 0.6:
        c += [(f"fl_upper_{side}", 0.15), (f"hl_thigh_{side}", 0.15)]
    return c


def neck_cands(co):
    return [("chest", 0.6), ("neck1", 1.0), ("neck2", 1.0), ("head", 0.5)]


def weights_for(co, cands):
    ws = []
    for bone, fac in cands:
        h, t, _ = BONES[bone]
        ws.append((bone, fac / (seg_dist(co, h, t) + 0.02) ** 4))
    ws.sort(key=lambda x: -x[1])
    ws = ws[:3]
    s = sum(w for _, w in ws)
    ws = [(b, w / s) for b, w in ws if w / s > 0.03]
    s = sum(w for _, w in ws)
    return [(b, w / s) for b, w in ws]


def crest_weights(co):
    """稜線・棘: 頭の上は頭、首の上は首、背は胴、尾の上は尾"""
    if co.y < -0.47:
        return head_weights(co)
    if co.y > 0.35:
        return weights_for(co, [("tail1", 1), ("tail2", 1), ("tail3", 1), ("pelvis", 0.3)])
    if co.y < -0.28 and co.z < 0.8:
        return weights_for(co, neck_cands(co) + [("spine1", 0.5)])
    return weights_for(co, body_cands(co))


# (M22-05 残りの手直しで変更: 鼻づらを深くしたので口の線の先を 0.405 → 0.41 へ (鼻先の下 1/3))
MOUTH = (Vector((0, -0.62, 0.465 + HEAD_DZ)), Vector((0, -0.87, 0.41 + HEAD_DZ)))


def head_weights(co):
    a, b = MOUTH
    t = (co.y - a.y) / (b.y - a.y)
    zl = a.z + (b.z - a.z) * t
    wj = smoothstep(0.0, 0.02, zl - co.z) * smoothstep(-0.58, -0.64, co.y)
    wn = smoothstep(-0.53, -0.47, co.y) * 0.5  # 後頭部は首へ少し
    out = [("head", max(0.0, 1.0 - wj - wn))]
    if wj > 0.02:
        out.append(("jaw", wj))
    if wn > 0.02:
        out.append(("neck2", wn))
    s = sum(w for _, w in out)
    return [(bb, w / s) for bb, w in out if w > 0]


# ---------------------------------------------------------------- メッシュの組み立て
# 継ぎ目 (左側面から見た (y, z, phi))。基準画の側面の画素から 0.0029 m/px で起こした
SEAMS = [
    [(-0.09, 0.825, 0), (-0.12, 0.76, 0), (-0.15, 0.69, 0)],                     # 肩の後ろ (肩甲骨の縁、後ろ上から前下へ)
    # 肩の前 (首との境)
    # (M22-05 残りの手直しで変更: 基準画は胸の前の輪郭も光るので、肩の前の線を胸の前へ下ろし、前へ回して正面の輪郭に出す。
    #  元は [(-0.30, 0.80, 0), (-0.34, 0.74, 0), (-0.37, 0.67, 0)])
    [(-0.30, 0.80, 0), (-0.34, 0.74, 0), (-0.37, 0.67, 12), (-0.39, 0.585, 40), (-0.385, 0.50, 58)],
    [(0.13, 0.70, 0), (0.105, 0.63, 0), (0.09, 0.56, 0)],                        # 腰の前 (腿との境)
    # (M22-05 残りの手直しで追加) 尻の後ろの輪郭 (基準画は腿の後ろの縁も光る)。phi を負にして後ろへ回す。
    #  腿の外の面に載るよう、胴の後ろの端 (尾の下に隠れる) より前・横に置く
    [(0.27, 0.62, 0), (0.315, 0.53, -6), (0.33, 0.44, -10)],
]
# (M22-05 残りの手直しで追加) 眉の光: 目頭の上から耳の付け根の前へ上がる線 (基準画の正面・斜め前の、目の上の V 字の隈取り)。
# +X 側の 3D の点 (-X 側は鏡映)。頭の表面へ吸わせる
BROW = [(0.050, -0.668, 0.632), (0.072, -0.642, 0.662), (0.090, -0.612, 0.688)]


def make_part(name, bm, part, cands, mats, recalc=True, smooth=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if smooth:
        for f in bm.faces:
            f.smooth = True
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


def build_lod(lod, obj_name, mats):
    parts = []
    shell_v, shell_f = [], []  # 継ぎ目の投影先 (胴・首・脚の付け根)
    top_v, top_f = [], []      # 稜線の投影先 (胴・首・頭・尾)

    def add(bm, *targets):
        bm.verts.index_update()
        for vv, ff in targets:
            o = len(vv)
            vv.extend(v.co.copy() for v in bm.verts)
            ff.extend([o + v.index for v in f.verts] for f in bm.faces)

    bm = bmesh.new()
    build_body(bm, lod)
    add(bm, (shell_v, shell_f), (top_v, top_f))
    parts.append(make_part(obj_name + "_body", bm, "body", lambda co: weights_for(co, body_cands(co)), mats))
    bm = bmesh.new()
    build_neck(bm, lod)
    add(bm, (shell_v, shell_f), (top_v, top_f))
    parts.append(make_part(obj_name + "_neck", bm, "neck", neck_cands(None), mats))
    bm = bmesh.new()
    build_head(bm, lod)
    bm.normal_update()
    bvh_head = BVHTree.FromBMesh(bm)
    add(bm, (top_v, top_f))
    parts.append(make_part(obj_name + "_head", bm, "head", head_weights, mats))
    bm = bmesh.new()
    build_tail(bm, lod)
    add(bm, (top_v, top_f))
    parts.append(make_part(obj_name + "_tail", bm, "tail", [("tail1", 1), ("tail2", 1), ("tail3", 1), ("pelvis", 0.3)], mats))
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        EAR_FRONT[f"ear_{s}"] = build_ears(bm, lod, side)
        parts.append(make_part(f"{obj_name}_ear_{s}", bm, f"ear_{s}", [(f"ear_{s}", 1.0), ("head", 0.25)], mats))
        if side < 0:  # (M22-05 残りの手直しで追加) 鼻 (1 つ。左右のループの最初で作る)
            bm = bmesh.new()
            build_nose(bm, lod)
            parts.append(make_part(f"{obj_name}_nose", bm, "rigid", head_weights, mats))
        bm = bmesh.new()
        build_eye(bm, bvh_head, lod, side)
        parts.append(make_part(f"{obj_name}_eye_{s}", bm, "rigid", lambda co: [("head", 1.0)], mats, recalc=False))
        if lod["brow"]:  # (M22-05 残りの手直しで追加) 眉の光
            bm = bmesh.new()
            build_brow(bm, bvh_head, lod, side)
            parts.append(make_part(f"{obj_name}_brow_{s}", bm, "rigid", lambda co: [("head", 1.0)], mats, recalc=False))
        for pre in ("fl", "hl"):
            name = f"{pre}_{s}"
            bones = LEG_BONES[name]
            parent = "chest" if pre == "fl" else "pelvis"
            bm = bmesh.new()
            build_leg(bm, lod, name)
            add(bm, (shell_v, shell_f))
            parts.append(make_part(f"{obj_name}_leg_{name}", bm, f"leg_{name}", [(b, 1.0) for b in bones] + [(parent, 0.5)], mats))
            if lod["paw"]:
                bm = bmesh.new()
                build_paw(bm, lod, name)
                parts.append(make_part(f"{obj_name}_paw_{name}", bm, "rigid", lambda co, b=bones[3]: [(b, 1.0)], mats))
    bvh = BVHTree.FromPolygons(shell_v, shell_f)
    bvh_top = BVHTree.FromPolygons(top_v, top_f)
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        for path in SEAMS:
            build_ribbon(bm, bvh, lod, path, side)
        parts.append(make_part(f"{obj_name}_seams_{s}", bm, "rigid", lambda co: weights_for(co, body_cands(co) + [("neck1", 0.5)]), mats,
                               recalc=False))
    bm = bmesh.new()
    build_crest(bm, bvh_top, lod)
    parts.append(make_part(obj_name + "_crest", bm, "rigid", crest_weights, mats, recalc=False))
    if lod["spikes"]:
        bm = bmesh.new()
        build_spikes(bm, bvh_top, lod)
        parts.append(make_part(obj_name + "_spikes", bm, "spike", crest_weights, mats, recalc=False, smooth=False))
    if lod["tufts"]:
        bm = bmesh.new()
        build_tufts(bm, BVHTree.FromPolygons(top_v, top_f))
        parts.append(make_part(obj_name + "_tufts", bm, "rigid",
                               lambda co: head_weights(co) if co.y < -0.5 else weights_for(co, neck_cands(co)), mats, recalc=False, smooth=False))

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
    arm = bpy.data.armatures.new("wolf_rig")
    rig = bpy.data.objects.new("wolf_rig", arm)
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


# ---------------------------------------------------------------- アニメーション (IK と骨の扱いは observe_deer.py と同じ)
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


def solve_leg(rig, basis, leg, F, dth_c, dth_h):
    """前後の脚 1 本の 2D IK。F: 足の付け根の目標 (アーマチュア空間)。dth_c / dth_h: 中足・足の rest からの角度差 (ワールド)"""
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
# 前向きの骨 (背骨・首・頭) は先が下がる。ez は横曲げ、ey はロール
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


# (M22-05 残りの手直しで追加) 足の塊の底の目安の点 (足の付け根からの (前後, 上下)。build_paw の後ろの点・底の前後・指先)
PAW_PTS = [(0.055, -0.005), (0.04, -0.035), (-0.035, -0.035), (-0.078, -0.035), (-0.10, -0.019)]


def paw_clear(F, dth_h):
    """(M22-05 残りの手直しで追加) 足をワールドで dth_h 回したときに底が地面 (z = 0) より下へ出ないよう、足の付け根の目標 F を持ち上げる。
    遊脚の出だしで足を巻き込む・蹴り出しでかかとを上げるときに、指先や後ろの縁が地面へ潜っていた (stalk -1.5 cm、pounce -2.7 cm)"""
    s, c = math.sin(dth_h), math.cos(dth_h)
    low = min(dy * s + dz * c for dy, dz in PAW_PTS)
    if F.z + low < 0:
        F = Vector((F.x, F.y, -low))
    return F


def gait(leg, u, off, duty, stride, lift, flex, curl, reach=0.0):
    """立脚 (u' < duty) は足を地面に固定して後ろへ、遊脚は持ち上げて前へ戻す。戻り値 (F, 中足の角度差, 足の角度差)"""
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
    # 足: 立脚中は地面に平ら (rest の角度)。遊脚では中足に付いて回り、さらに巻き込む。両端で立脚の角度に戻る
    dth_h = dth_c * math.sin(math.pi * s) + cu if up >= duty else 0.0
    # (M22-05 残りの手直しで変更: 足の底が地面へ潜らないよう paw_clear を通す。元は Vector((F0.x, y, z)) をそのまま返した)
    return paw_clear(Vector((F0.x, y, z)), dth_h), dth_c, dth_h


def planted(leg, dy=0.0, dz=0.0):
    F = leg_rest_F(leg)
    F.y += dy
    F.z += dz
    return F, 0.0, 0.0


def ease(a, b, t):
    return smoothstep(a, b, t)


def flick(t, t0, dur=0.35):
    x = (t - t0) / dur
    return math.sin(math.pi * x) ** 2 if 0 <= x <= 1 else 0.0


def pose_idle(rig, t):
    T = 4.0
    ph = 2 * math.pi * t / T
    b = {}
    breath = math.sin(2 * ph)
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.004 + 0.004 * breath)))
    b["spine1"] = rot_basis(D(0.8) * breath)
    b["chest"] = rot_basis(-D(1.0) * breath)
    look = math.sin(ph)
    b["neck1"] = rot_basis(D(1.5) * math.sin(2 * ph), 0, D(5) * look)
    b["neck2"] = rot_basis(D(-1.0) * math.sin(2 * ph), 0, D(5) * look)
    b["head"] = rot_basis(D(2) * math.sin(ph + 1.0), D(-4) * look, D(3) * look)
    b["jaw"] = rot_basis(D(1.5) * max(0.0, breath))
    # 耳: 1.0 s に左、2.7 s に右をはじく
    b["ear_L"] = rot_basis(D(-25) * flick(t, 1.0), 0, D(20) * flick(t, 1.0))
    b["ear_R"] = rot_basis(D(-25) * flick(t, 2.7), 0, D(-20) * flick(t, 2.7))
    # 尾: ゆっくり左右に揺らし、2.0 s に一度振る
    tf = flick(t, 2.0, 0.5) - 0.6 * flick(t, 2.3, 0.4)
    sway = math.sin(ph)
    b["tail1"] = rot_basis(D(3) * breath, 0, D(6) * sway + D(18) * tf)
    b["tail2"] = rot_basis(0, 0, D(5) * math.sin(ph - 0.6) + D(12) * tf)
    b["tail3"] = rot_basis(0, 0, D(5) * math.sin(ph - 1.2) + D(8) * tf)
    for leg in LEG_BONES:
        solve_leg(rig, b, leg, *planted(leg))
    return b


def pose_walk(rig, t):
    T = 1.1
    u = t / T
    ph = 2 * math.pi * u
    b = {}
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.01 + 0.01 * math.cos(2 * ph))), local=rot_basis(D(1.2) * math.sin(2 * ph), 0, D(2) * math.sin(ph)))
    b["spine1"] = rot_basis(-D(0.8) * math.sin(2 * ph), 0, -D(2) * math.sin(ph))
    b["chest"] = rot_basis(0, D(1.5) * math.sin(ph), -D(1.5) * math.sin(ph))
    b["neck1"] = rot_basis(D(2.5) * math.sin(2 * ph + 0.8))
    b["neck2"] = rot_basis(D(-1.5) * math.sin(2 * ph + 0.8))
    b["head"] = rot_basis(D(-2) * math.sin(2 * ph + 1.2))
    b["tail1"] = rot_basis(D(3), 0, D(7) * math.sin(ph))
    b["tail2"] = rot_basis(0, 0, D(6) * math.sin(ph - 0.7))
    b["tail3"] = rot_basis(0, 0, D(5) * math.sin(ph - 1.4))
    b["ear_L"] = rot_basis(D(-3) * math.sin(2 * ph))
    b["ear_R"] = rot_basis(D(-3) * math.sin(2 * ph + 0.5))
    offs = {"hl_L": 0.0, "fl_L": 0.25, "hl_R": 0.5, "fl_R": 0.75}
    for leg, o in offs.items():
        front = leg.startswith("fl")
        solve_leg(rig, b, leg, *gait(leg, u, o, 0.62, 0.40, 0.08 if front else 0.07, D(60) if front else D(30), D(30)))
    return b


STALK_DROP = 0.10


def pose_stalk(rig, t):
    """低く構えた忍び足: 体を沈め、胸を下げ、首を前へ伸ばして頭を水平に保つ。脚は大きく曲げてゆっくり運ぶ"""
    T = 1.6
    u = t / T
    ph = 2 * math.pi * u
    b = {}
    bob = 0.006 * math.cos(2 * ph)
    pitch = D(4)  # 骨盤: 前を下げる
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0.02, -STALK_DROP + bob)), local=rot_basis(pitch + D(0.8) * math.sin(2 * ph)))
    b["spine1"] = rot_basis(D(3) - D(0.6) * math.sin(2 * ph))
    b["chest"] = rot_basis(D(2), D(1.2) * math.sin(ph))
    # 首は前へ伸ばして下げ、頭は水平に戻す (鎖の X 回転の和を 0 に)
    n1 = D(8) + D(1.0) * math.sin(2 * ph + 0.5)
    n2 = D(4)
    b["neck1"] = rot_basis(n1)
    b["neck2"] = rot_basis(n2)
    b["head"] = rot_basis(-(pitch + D(3) + D(2) + n1 + n2) + D(3), 0, 0)
    b["ear_L"] = rot_basis(D(10), 0, D(-4))
    b["ear_R"] = rot_basis(D(10), 0, D(4))
    # 尾は低く、先をわずかに揺らす (後ろ向きの骨は X 回りの正で先が上がる)
    b["tail1"] = rot_basis(-D(4), 0, D(3) * math.sin(ph))
    b["tail2"] = rot_basis(D(3), 0, D(3) * math.sin(ph - 0.8))
    b["tail3"] = rot_basis(D(4), 0, D(4) * math.sin(ph - 1.6))
    offs = {"hl_L": 0.0, "fl_L": 0.25, "hl_R": 0.5, "fl_R": 0.75}
    for leg, o in offs.items():
        front = leg.startswith("fl")
        solve_leg(rig, b, leg, *gait(leg, u, o, 0.76, 0.30, 0.065 if front else 0.05, D(70) if front else D(35), D(30)))
    return b


def pose_run(rig, t):
    T = 0.5
    u = t / T
    ph = 2 * math.pi * u
    b = {}
    # 回転ギャロップ: 右後 → 左後 → 右前 → 左前、その後に宙に浮く。背を大きく曲げ伸ばしする
    flex = math.sin(ph + 0.3)
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, -0.03 + 0.04 * math.sin(ph - 0.6))), local=rot_basis(D(8) * flex))
    b["spine1"] = rot_basis(-D(8) * flex)
    b["chest"] = rot_basis(-D(4) * math.sin(ph + 0.8))
    # 頭は水平に前へ
    b["neck1"] = rot_basis(-D(4) + D(5) * math.sin(ph + 1.6))
    b["neck2"] = rot_basis(D(3) * math.sin(ph + 1.9))
    b["head"] = rot_basis(D(6) - D(5) * math.sin(ph + 2.1))
    b["ear_L"] = rot_basis(-D(35), 0, D(-12))
    b["ear_R"] = rot_basis(-D(35), 0, D(12))
    # 尾は後ろへ真っ直ぐ伸ばす (後ろ向きの骨は X 回りの正で先が上がる)
    b["tail1"] = rot_basis(D(26) + D(6) * math.sin(ph), 0, 0)
    b["tail2"] = rot_basis(D(12) + D(6) * math.sin(ph - 0.6))
    b["tail3"] = rot_basis(D(6) + D(6) * math.sin(ph - 1.2))
    offs = {"hl_R": 0.0, "hl_L": 0.1, "fl_R": 0.40, "fl_L": 0.50}
    for leg, o in offs.items():
        front = leg.startswith("fl")
        solve_leg(rig, b, leg, *gait(leg, u, o, 0.34, 0.72, 0.18 if front else 0.15, D(100) if front else D(50), D(40) if front else D(15)))
    return b


def arc(t, t0, t1):
    """t0 → t1 の間に 0 → 1 へ進む量と、その間の持ち上げ (sin)"""
    s = max(0.0, min(1.0, (t - t0) / (t1 - t0)))
    return s * s * (3 - 2 * s), math.sin(math.pi * s)


def pose_pounce(rig, t):
    """0-0.35 s 後ろへ沈んで溜める、0.35-0.6 s 前下へ飛び込み前足で押さえる (顎を開く)、0.75-1.2 s 元の姿勢へ戻る"""
    crouch = ease(0.0, 0.32, t) * (1 - ease(0.32, 0.5, t))
    lunge = ease(0.34, 0.58, t) * (1 - ease(0.72, 1.12, t))
    b = {}
    dloc = Vector((0, 0.07 * crouch - 0.30 * lunge, -0.10 * crouch - 0.08 * lunge))
    pitch = -D(4) * crouch + D(7) * lunge
    b["pelvis"] = pelvis_basis(rig, dloc, local=rot_basis(pitch))
    b["spine1"] = rot_basis(D(6) * crouch - D(6) * lunge)
    b["chest"] = rot_basis(D(4) * crouch + D(2) * lunge)
    b["neck1"] = rot_basis(D(4) * crouch - D(4) * lunge)
    b["neck2"] = rot_basis(D(2) * crouch)
    b["head"] = rot_basis(-D(4) * crouch + D(2) * lunge)
    b["jaw"] = rot_basis(D(26) * ease(0.4, 0.55, t) * (1 - ease(0.62, 0.8, t)))
    b["ear_L"] = rot_basis(D(-20) * crouch + D(25) * lunge, 0, D(-6))
    b["ear_R"] = rot_basis(D(-20) * crouch + D(25) * lunge, 0, D(6))
    b["tail1"] = rot_basis(-D(8) * crouch + D(24) * lunge)
    b["tail2"] = rot_basis(-D(6) * crouch + D(10) * lunge)
    b["tail3"] = rot_basis(-D(6) * crouch + D(8) * lunge)
    # 前足: 飛び込みで前へ 0.45 m 運んで押さえ、戻りで元へ一歩戻す。後足: 飛び込みで地面を蹴り (かかとを上げ)、戻りで一歩寄せる
    for leg in LEG_BONES:
        front = leg.startswith("fl")
        if front:
            go, lift1 = arc(t, 0.34, 0.58)
            back, lift2 = arc(t, 0.78, 1.08) if leg.endswith("L") else arc(t, 0.86, 1.14)
            dy = -0.45 * go + 0.45 * back
            dz = 0.16 * lift1 + 0.07 * lift2
            curl = D(50) * lift1
            F, _, _ = planted(leg, dy, dz)
            F = paw_clear(F, curl)  # (M22-05 残りの手直しで追加) 足の底を地面の上に保つ
            solve_leg(rig, b, leg, F, D(35) * lift1 - D(20) * go * (1 - back), curl)
        else:
            go, lift1 = arc(t, 0.5, 0.72) if leg.endswith("L") else arc(t, 0.56, 0.78)
            back, lift2 = arc(t, 0.9, 1.15)
            dy = -0.18 * go + 0.18 * back
            dz = 0.07 * lift1 + 0.05 * lift2
            heel = D(30) * lunge * (1 - go)  # 蹴り出しでかかとを上げる
            F, _, _ = planted(leg, dy, dz)
            F = paw_clear(F, D(20) * lift1 + heel)  # (M22-05 残りの手直しで追加) かかとを上げたときは指先を支点に付け根を持ち上げる
            solve_leg(rig, b, leg, F, -D(30) * lift1 - D(20) * lift2 - heel, D(20) * lift1 + heel)
    return b


def pose_fall(rig, t):
    # 0-0.6 s 前脚が折れて胸が落ちる、0.45-1.4 s 右側を下に横倒し、1.2-2 s 首と頭が地に落ちて静まる
    k1 = ease(0.0, 0.6, t)
    k2 = ease(0.45, 1.4, t)
    k3 = ease(1.2, 2.0, t)
    b = {}
    roll = Quaternion(Vector((0, 1, 0)), D(86) * k2)  # +Y 軸回り (体の +X 側を下に)
    drop = Vector((0.0, 0.0, -0.12 * k1 - 0.30 * k2)) + Vector((0.16, 0, 0)) * k2
    b["pelvis"] = pelvis_basis(rig, drop, wrot=roll, local=rot_basis(D(10) * k1 * (1 - k2) - D(3) * k2))
    b["spine1"] = rot_basis(D(4) * k1, 0, 0)
    b["chest"] = rot_basis(D(6) * k1 * (1 - k2))
    # 横倒しの後は首を地面側へ曲げ、頭を地面に寝かせる
    # 横倒しの後の体の -X は上なので、ローカル Z 回りの負で首を地面側へ曲げる
    b["neck1"] = rot_basis(D(12) * k1 - D(8) * k2, 0, -D(16) * k3)
    b["neck2"] = rot_basis(D(6) * k1, 0, -D(12) * k3)
    b["head"] = rot_basis(-D(8) * k1 + D(4) * k3, 0, -D(6) * k3)
    b["jaw"] = rot_basis(D(8) * k3)
    b["ear_L"] = rot_basis(D(25) * k3, 0, D(-10) * k3)
    b["ear_R"] = rot_basis(D(25) * k3, 0, D(10) * k3)
    b["tail1"] = rot_basis(-D(10) * k3, 0, D(10) * k3)
    b["tail2"] = rot_basis(0, 0, D(8) * k3)
    fold_f = [D(25), -D(70), D(90), D(35)]   # 前脚: 肘・手首を折る
    fold_h = [-D(30), D(55), -D(60), D(35)]  # 後脚
    relax_f = [D(30), -D(20), D(25), D(20)]  # 横倒し後: 軽く曲げて投げ出す
    relax_h = [-D(35), D(20), -D(25), D(20)]
    # (M22-05 残りの手直しで変更: 折り畳み (fold) を FK で掛けると足が地面へ 0.12〜0.21 m 潜っていたので、倒れ始めるまでは足を地面に
    #  残したまま (IK) 胸と腰が落ちて脚が折れ、横倒しにつれて投げ出した形 (relax、FK) へ移る (土兎の fall と同じ)。接地の高さは
    #  bake_actions が各フレームで地面に合わせる。fold_f / fold_h は使わなくなったが、元の折り方の記録として残す。元は
    #  a = fold[i] * kk * (1 - k2) + relax[i] * k2 (kk = 前脚は k1、後脚は ease(0.2, 0.8, t)) を FK で掛けていた)
    ik = dict(b)
    for leg in LEG_BONES:
        solve_leg(rig, ik, leg, *planted(leg))
    for leg, bones in LEG_BONES.items():
        front = leg.startswith("fl")
        fold, relax = (fold_f, relax_f) if front else (fold_h, relax_h)
        for i, bn in enumerate(bones):
            q = ik[bn].to_quaternion().slerp(Quaternion(X, relax[i]), k2)
            b[bn] = q.to_matrix().to_4x4()
    return b


ACTIONS = [("idle", 4.0, pose_idle, True), ("walk", 1.1, pose_walk, True), ("stalk", 1.6, pose_stalk, True),
           ("run", 0.5, pose_run, True), ("pounce", 1.2, pose_pounce, False), ("fall", 2.0, pose_fall, False)]
# (M22-05 残りの手直しで追加) 近 LOD の一番低い頂点を rest と同じ高さ (地面) に合わせるアクション (横倒しで地面へめり込まない・浮かない。土兎と同じ)
GROUND = {"fall"}


def apply_pose(rig, basis):
    """(M22-05 残りの手直しで追加) basis を pose に置く (接地の高さを測るため)"""
    for bn in ORDER:
        pb = rig.pose.bones[bn]
        loc, q, _ = basis.get(bn, Matrix.Identity(4)).decompose()
        pb.location = loc
        pb.rotation_quaternion = q


def min_z(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    z = min((ev.matrix_world @ v.co).z for v in me.vertices)
    ev.to_mesh_clear()
    return z


def ground(rig, ob, basis, z0):
    """(M22-05 残りの手直しで追加) 骨盤をワールドの上下に動かして、メッシュの一番低い点を z0 に合わせる"""
    apply_pose(rig, basis)
    dz = z0 - min_z(ob)
    R = rest(rig, "pelvis")
    basis["pelvis"] = R.inverted() @ Matrix.Translation((0, 0, dz)) @ R @ basis.get("pelvis", Matrix.Identity(4))
    return basis


def bake_actions(rig, hero=None):
    global ORDER
    ORDER = bone_order(rig)
    # (M22-05 残りの手直しで追加) 接地の基準 (rest の一番低い点)
    apply_pose(rig, {})
    z_rest = min_z(hero) if hero else 0.0
    rig.animation_data_create()
    acts = []
    for name, dur, fn, loop in ACTIONS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        nf = round(dur * FPS)
        last = {}
        for f in range(nf + 1):
            t = f / FPS
            basis = fn(rig, t if (f < nf or not loop) else 0.0)  # ループはの最後のフレームを最初と同じにする
            if hero and name in GROUND:  # (M22-05 残りの手直しで追加)
                rig.animation_data.action = None
                basis = ground(rig, hero, basis, z_rest)
                rig.animation_data.action = act
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
    scene.frame_start, scene.frame_end = 0, 120
    os.makedirs(OUT_DIR, exist_ok=True)
    mats = make_materials()
    rig = build_rig()
    meshes = [build_lod(HERO, "wolf", mats), build_lod(LOD1, "wolf_lod1", mats)]
    for ob in meshes:
        # アーマチュアの子にしない (glTF ではスキンのメッシュをルートに置く。親の変換はスキンに効かないため)
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f"mesh {ob.name}: {len(ob.data.vertices)} verts / {tris} tris, groups {len(ob.vertex_groups)}")
    bake_actions(rig, meshes[0])  # (M22-05 残りの手直しで変更: 接地を合わせるため近 LOD を渡す。元は bake_actions(rig))
    scene.frame_set(0)
    for o in scene.objects:
        o.select_set(True)
    blend = os.path.abspath(os.path.join(OUT_DIR, "wolf.blend"))
    glb = os.path.abspath(os.path.join(OUT_DIR, "wolf.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_animation_mode="ACTIONS",
                              export_force_sampling=True, export_frame_step=1, export_skins=True, export_influence_nb=4,
                              export_vertex_color="ACTIVE", export_yup=True, export_apply=False, export_def_bones=False,
                              export_optimize_animation_size=True, export_anim_slide_to_zero=True, export_rest_position_armature=True)
    print("saved", blend)
    print("saved", glb)


main()
