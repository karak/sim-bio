"""観察画面 (M22) の灰狼: 月鹿 (observe_deer.py) と同じ作り方で、丸めた形・スキン・6 つのアニメを持つモデルを組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf.py -- assets/models/observe
出力: <out_dir>/wolf.glb と wolf.blend
  - メッシュ `wolf` (近 LOD、~2,500 三角形)、`wolf_lod1` (群れ LOD、~800)。どちらも同じアーマチュア `wolf_rig` にスキン
  - (M23-08) メッシュ `wolf_far` (遠い段、~150 三角形): 群れ LOD を島ごとに削った形 (creature_far.py)。背の稜線・耳・脚は多く残す。描画は切ってある (hide_render)
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
# (灰狼の作り直しで追加) 目の周りの暗い隈・房の先の明るい毛・歯・口の中・唇。脚の焦げ茶は頂点色で持つので、Three.js で暗く沈みすぎない値へ上げた
# (元の "dark" #6B412F は材質の色で、頂点色 (焦げ茶の手前の暗み) と掛け合わさって黒く見えていた)。淡い色は基準画の灰茶へ少し寄せる
PAL.update({k: lin(v) for k, v in {
    "dark": "#6E4230",
    "pale": "#A58A74",
    "mask": "#8C4A31",
    "tip": "#F0B27A",
    "lip": "#3A2622",
    "mouth": "#5A2A26",
    "teeth": "#EDE4D0",
}.items()})

BODY, DARK, PALE, NOSE, GLOW = range(5)
MAT_NAMES = ["wolf_body", "wolf_dark", "wolf_pale", "wolf_nose", "wolf_glow"]
# (灰狼の作り直しで変更: 脚の焦げ茶 (wolf_dark) と飾り毛の淡い色 (wolf_pale) の材質をやめて頂点色へ移し、歯の材質 wolf_teeth を足した。
#  DARK・PALE は元の部品の関数のために名前だけ残す (DARK は毛、PALE は歯の材質を指す))
MAT_NAMES = ["wolf_body", "wolf_teeth", "wolf_nose", "wolf_glow"]
BODY, TEETH, NOSE, GLOW = range(4)
DARK, PALE = BODY, TEETH


def make_materials():
    mats = []
    for name in MAT_NAMES:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
        key = {"wolf_body": "fur", "wolf_dark": "dark", "wolf_pale": "pale", "wolf_nose": "nose", "wolf_glow": "glow", "wolf_teeth": "teeth"}[name]
        rgb = PAL[key]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        m.diffuse_color = (*rgb, 1)
        if name == "wolf_body":
            # 喉・胸の淡い色は頂点色 (COLOR_0) で持つ。Three.js 側は vertexColors で掛ける
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        if name == "wolf_body" and FUR_TEXTURE:  # (灰狼の 3 回目で追加) テクスチャは FUR_TEXTURE のときだけ (既定は切る)
            # (灰狼の作り直しで追加) 毛皮のテクスチャ × 頂点色。glTF には baseColorTexture と COLOR_0 として出る (GLTFLoader が両方を掛ける)
            tx = nt.nodes.new("ShaderNodeTexImage")
            tx.image = make_fur_image()
            mx = nt.nodes.new("ShaderNodeMix")
            mx.data_type = "RGBA"
            mx.blend_type = "MULTIPLY"
            mx.inputs[0].default_value = 1.0
            nt.links.new(tx.outputs["Color"], mx.inputs[6])
            nt.links.new(vc.outputs["Color"], mx.inputs[7])
            nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
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
# (灰狼の作り直しで追加) 下顎を別の部品にしたので、顎の骨の付け根を口の角の後ろ (蝶番) に、先を下顎の先に置く。
# 耳は幅の広い頭蓋の上の外寄りから、外へ開いて立てる (値は HEAD_DZ を足した後の位置)
BONES["jaw"] = (Vector((0, -0.600, 0.556)), Vector((0, -0.878, 0.516)), "head")
for s, sx in (("L", -1), ("R", 1)):
    BONES[f"ear_{s}"] = (Vector((sx * 0.084, -0.552, 0.738)), Vector((sx * 0.128, -0.548, 0.885)), "head")
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
def far_ratio(c, mats, n):
    """(M23-08) 遠い段で群れ LOD の島を削る割合 (creature_far.build_far)。光る島は背の稜線 (10 三角形以上) を半分残し、脇の細い帯と棘は除く。
    脚 (wolf_dark) は関節の曲がりが読めるよう 3 割、耳 (0.7 m より上) は半分、胴・首・頭・尾・鼻は 2 割"""
    if "wolf_glow" in mats:
        return 0.0 if n < 10 else 0.5
    if "wolf_dark" in mats:
        return 0.3
    # (灰狼の作り直しで追加) 脚の焦げ茶は頂点色になって wolf_dark の島が無いので、脚は位置 (低く、横へ寄った島) で見分ける
    if c.z < 0.45 and abs(c.x) > 0.05:
        return 0.3
    if c.z > 0.7:
        return 0.5
    return 0.2


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


# ================================================================ 灰狼の作り直し (2026-09-24 審査台 t05-wolf の不合格)
# 判断「狐に見える。折り紙のよう。全体的にフォルムがまるっこいのでシャープにしたうえで形状の再現性をあげること。顔まわりはもっと形状も段差も
# 制裁にする。眼および歯を内包する口の鋭さを出す。テクスチャは毛皮の感じが出して野生味をあたえる」に沿って作り直した部品。
#   - 頭は手で置いた断面の輪郭 (平らな頭頂・眉の稜・眼窩のくぼみ・頬骨の張り・額から鼻づらへの段・箱の鼻づら・口の縁) のロフトにし、
#     下顎を別の部品 (顎の骨) にして、口の線・唇・歯 (牙・門歯・臼歯) を入れる
#   - 目は眼窩に沈めた吊り上がったアーモンド (暗い縁・光る虹彩・瞳)、鼻は角ばった大きな塊
#   - 頬・首の周り・胸・背の逆立つ毛・肘・腿の裏・腹・尾に、立体の毛の房 (曲がった尖った塊) を重ねる (紙のような薄い楔の代わり)
#   - 脚を太く、足に指と爪。脚の焦げ茶は材質を分けず頂点色で持つ
#   - 毛皮のテクスチャ (筆の毛並みを numpy で生成、FUR_PATH) を毛の材質に掛ける。UV は部品の軸に沿う円筒の展開で、毛並みは軸の向き
# 元の部品の関数 (build_head・build_nose・build_ears・build_eye・build_tufts・build_spikes・build_paw) は記録として残し、build_lod から新しい関数を呼ぶ
# (灰狼の 3 回目で追加) ユーザーの判断「テクスチャが細かすぎる。もとの絵画的ないい意味で荒い毛並みを再現すること。また、目も口元も悪役すぎる。
# 神の使いの穏やかさと神々しさを出すように」。細かい毛のテクスチャはやめ (FUR_TEXTURE = False)、毛並みは頂点色の大きな筆の塗り (STROKES) と
# 面の明暗、毛の房で持つ。テクスチャを持たない材質は観察画面の bake.ts で 1 つにまとまるので、1 頭 1 draw call に戻る。
# 生成の関数 (make_fur_image・uv_faces) は残し、FUR_TEXTURE = True で 2 回目のテクスチャに戻せる
FUR_TEXTURE = False
FUR_TILE = 0.36  # 毛皮のテクスチャ 1 枚が覆う長さ (m)
FUR_SIZE = 512
FUR_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "assets", "textures", "observe", "wolf_fur.png")
FUR_GAIN = 1.0  # テクスチャの平均の明るさ (リニア) の逆数。頂点色に掛けて、テクスチャで暗くなった分を戻す (make_fur_image が決める)
_FUR_IMAGE = []


def make_fur_image():
    """毛皮のテクスチャ (FUR_SIZE²、上下左右につながる灰色)。筆の毛並み: 根元が暗く先が明るい細長い房を +v (行の向き) に重ね、
    房の縁を暗くして隙間の影にする。大きな明暗のむらを薄く足す。頂点色 (珊瑚色・淡い色・焦げ茶) に掛けるので色は持たず、暗い所だけわずかに赤みへ寄せる。
    乱数の種は固定 (作り直すたびに同じ絵)"""
    global FUR_GAIN
    if _FUR_IMAGE:
        return _FUR_IMAGE[0]
    import numpy as np
    rng = np.random.default_rng(7)
    H = W = FUR_SIZE
    yy, xx = np.mgrid[0:H, 0:W] * (2 * np.pi / FUR_SIZE)
    img = np.full((H, W), 0.80)
    low = np.zeros((H, W))
    for _ in range(6):
        kx, ky = rng.integers(1, 4, 2)
        low += np.sin(kx * xx + ky * yy + rng.uniform(0, 2 * np.pi))
    img += 0.06 * low / 3
    for _ in range(2000):
        L = rng.uniform(32, 84)
        w0 = rng.uniform(4.5, 10.5)
        a = np.pi / 2 + rng.normal(0, 0.16)
        dx, dy = np.cos(a), np.sin(a)
        x0, y0 = rng.uniform(0, W), rng.uniform(0, H)
        bend = rng.normal(0, 0.10) * L
        tone = rng.uniform(-0.10, 0.07)
        xs = np.arange(int(np.floor(min(x0, x0 + dx * L) - w0 - abs(bend))), int(np.ceil(max(x0, x0 + dx * L) + w0 + abs(bend))) + 1)
        ys = np.arange(int(np.floor(min(y0, y0 + dy * L) - w0)), int(np.ceil(max(y0, y0 + dy * L) + w0)) + 1)
        X, Y = np.meshgrid(xs, ys)
        px, py = X - x0, Y - y0
        t = (px * dx + py * dy) / L
        d = -px * dy + py * dx - bend * t * t
        w = w0 * np.clip(1 - t, 0, 1) ** 0.6
        inside = (t >= 0) & (t <= 1) & (np.abs(d) < w)
        if not inside.any():
            continue
        q = np.abs(d) / np.maximum(w, 1e-6)
        val = (0.58 + 0.42 * t + tone) * (1 - 0.30 * q * q)
        alpha = np.clip((1 - q) * 3, 0, 1) * inside
        rows, cols = Y % H, X % W
        img[rows, cols] = img[rows, cols] * (1 - alpha) + val * alpha
    img = np.clip(img, 0.42, 1.0)
    FUR_GAIN = float(1.0 / img.mean())
    warm = np.clip((1 - img) * 1.6, 0, 1)
    rgb = np.stack([img, img * (1 - 0.07 * warm), img * (1 - 0.12 * warm)], axis=-1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    rgba = np.concatenate([srgb, np.ones((H, W, 1))], axis=-1)
    im = bpy.data.images.new("wolf_fur", W, H, alpha=False)
    im.pixels.foreach_set(rgba.astype(np.float32).ravel())
    os.makedirs(os.path.dirname(FUR_PATH), exist_ok=True)
    im.filepath_raw = FUR_PATH
    im.file_format = "PNG"
    im.save()
    im.pack()
    print(f"fur texture {FUR_PATH}: mean {img.mean():.3f} (gain {FUR_GAIN:.3f})")
    _FUR_IMAGE.append(im)
    return im


def fur_gain(c):
    return tuple(min(1.0, x * FUR_GAIN) for x in c)


def uv_faces(bm, faces, axis, R, tile=FUR_TILE):
    """部品の軸 (折れ線) に沿う円筒の展開: v = 軸に沿った長さ / tile (毛並みの向き)、u = 軸の周りの角度 × 周の枚数 K。
    K は周の長さ 2πR を tile で割って丸めた整数 (継ぎ目でテクスチャがつながる)。継ぎ目をまたぐ面は u を 1 周ずらす"""
    uvl = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    pts = [Vector(p) for p in axis]
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + (b - a).length)
    K = max(1, round(2 * math.pi * R / tile))

    def proj(co):
        best = None
        for i, (a, b) in enumerate(zip(pts, pts[1:])):
            ab = b - a
            t = max(0.0, min(1.0, (co - a).dot(ab) / ab.length_squared))
            q = a + ab * t
            dd = (co - q).length_squared
            if best is None or dd < best[0]:
                best = (dd, acc[i] + ab.length * t, q, ab.normalized())
        _, s, q, tg = best
        ref = Z if abs(tg.z) < 0.9 else -Y
        e1 = (ref - tg * ref.dot(tg)).normalized()
        e2 = tg.cross(e1)
        r = co - q
        return math.atan2(r.dot(e2), r.dot(e1)) / (2 * math.pi) * K, s / tile

    for f in faces:
        uv = [proj(lp.vert.co) for lp in f.loops]
        us = [u for u, _ in uv]
        if max(us) - min(us) > K / 2:
            uv = [(u + K if u < 0 else u, v) for u, v in uv]
        for lp, x in zip(f.loops, uv):
            lp[uvl].uv = x


def bm_colors(bm):
    """(毛の房・耳) 部品が自分で頂点色を持つときの層。make_part はこの層があれば色を塗り直さない"""
    return bm.verts.layers.float_color.get("Col") or bm.verts.layers.float_color.new("Col")


def interp(keys, x):
    """(x, 値) の折れ線の補間 (x は昇順でも降順でもよい)"""
    ks = sorted(keys)
    if x <= ks[0][0]:
        return ks[0][1]
    for (x0, v0), (x1, v1) in zip(ks, ks[1:]):
        if x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)
    return ks[-1][1]


# ---- 頭 (上の顎まで)。断面 (y, 右半分の輪郭 10 点 (x, z))。点の並び: 頭頂の中心・頭頂の面・額の横・眉の稜 (鼻づらでは上の角)・
# 眼窩 (鼻づらでは横の上)・頬骨 (横の中)・横の下・口の縁 (上唇の角、頭蓋では下の角)・下の面 (口蓋)・下の中心。値は HEAD_DZ を足した高さ
HEAD2_KEYS = [
    (-0.462, [(0, 0.695), (0.030, 0.693), (0.048, 0.685), (0.060, 0.668), (0.070, 0.645), (0.074, 0.618), (0.070, 0.592), (0.058, 0.568), (0.030, 0.553), (0, 0.550)]),
    (-0.500, [(0, 0.745), (0.040, 0.742), (0.066, 0.730), (0.084, 0.708), (0.096, 0.675), (0.102, 0.635), (0.097, 0.590), (0.080, 0.548), (0.042, 0.527), (0, 0.522)]),
    (-0.553, [(0, 0.766), (0.045, 0.763), (0.074, 0.750), (0.094, 0.725), (0.106, 0.685), (0.122, 0.635), (0.108, 0.585), (0.088, 0.540), (0.046, 0.512), (0, 0.507)]),
    (-0.600, [(0, 0.757), (0.045, 0.754), (0.073, 0.743), (0.092, 0.714), (0.090, 0.676), (0.128, 0.622), (0.104, 0.577), (0.078, 0.540), (0.042, 0.518), (0, 0.513)]),
    (-0.638, [(0, 0.738), (0.043, 0.736), (0.070, 0.725), (0.088, 0.697), (0.076, 0.654), (0.104, 0.604), (0.080, 0.576), (0.066, 0.560), (0.034, 0.549), (0, 0.546)]),
    (-0.672, [(0, 0.690), (0.040, 0.689), (0.058, 0.683), (0.068, 0.670), (0.069, 0.641), (0.076, 0.606), (0.072, 0.575), (0.066, 0.558), (0.036, 0.552), (0, 0.550)]),
    (-0.709, [(0, 0.671), (0.036, 0.670), (0.052, 0.665), (0.062, 0.654), (0.065, 0.630), (0.069, 0.600), (0.070, 0.570), (0.067, 0.550), (0.037, 0.544), (0, 0.543)]),
    (-0.764, [(0, 0.650), (0.033, 0.649), (0.048, 0.645), (0.057, 0.636), (0.060, 0.612), (0.063, 0.585), (0.064, 0.557), (0.061, 0.538), (0.034, 0.533), (0, 0.532)]),
    (-0.819, [(0, 0.634), (0.033, 0.633), (0.047, 0.630), (0.055, 0.622), (0.058, 0.598), (0.060, 0.571), (0.060, 0.545), (0.055, 0.527), (0.031, 0.523), (0, 0.522)]),
    (-0.847, [(0, 0.624), (0.030, 0.623), (0.043, 0.620), (0.051, 0.612), (0.054, 0.590), (0.056, 0.564), (0.056, 0.541), (0.048, 0.526), (0.027, 0.522), (0, 0.521)]),
]
HEAD2_TIP = Vector((0, -0.858, 0.578))
MOUTH_Y = -0.636  # 口の角 (これより前が上の顎と下顎に分かれる)
LIP2 = [(y, pts[7]) for y, pts in HEAD2_KEYS]  # 口の縁 (y, (x, z))
# (灰狼の 4 回目で追加) 3 回目への判断「口花の突起が長すぎる、一方、正面向きだと鼻筋はもっと通っており、目や眉が前からもみえる」。
# 基準画の側面 (creatures/wolf.png 左上) で測ると、耳の付け根の後ろ (x 475 px) → 目の中心 (547) → 鼻先 (610) は 72 : 63 px
# (頭の長さ 135 px のうち、目が後ろから 0.53、目 → 鼻先が 0.47)。3 回目は耳の後ろ (y -0.50) → 目 (-0.650) → 鼻先 (-0.872) で 0.150 : 0.222 m
# (目 → 鼻先が 0.60)。目を 4.8 cm 前 (-0.698) へ、鼻先を 2 cm 後ろ (-0.852) へ寄せて 0.198 : 0.154 m (0.56 : 0.44) にし、鼻づらを短く深く。
# 目の前に額から鼻づらへの段 (ストップ、-0.718 で 2.6 cm 下がる) を置き、鼻づらの上に中心の稜 (鼻筋) を立てる (中心の点を隣より 5〜7 mm 高く)
HEAD2_KEYS = [
    (-0.462, [(0, 0.695), (0.030, 0.693), (0.048, 0.685), (0.060, 0.668), (0.070, 0.645), (0.074, 0.618), (0.070, 0.592), (0.058, 0.568), (0.030, 0.553), (0, 0.550)]),
    (-0.500, [(0, 0.745), (0.040, 0.742), (0.066, 0.730), (0.084, 0.708), (0.096, 0.675), (0.102, 0.635), (0.097, 0.590), (0.080, 0.548), (0.042, 0.527), (0, 0.522)]),
    (-0.553, [(0, 0.766), (0.045, 0.763), (0.074, 0.750), (0.094, 0.725), (0.106, 0.685), (0.122, 0.635), (0.108, 0.585), (0.088, 0.540), (0.046, 0.512), (0, 0.507)]),
    (-0.605, [(0, 0.762), (0.045, 0.759), (0.074, 0.748), (0.094, 0.722), (0.100, 0.684), (0.124, 0.628), (0.106, 0.580), (0.082, 0.541), (0.044, 0.518), (0, 0.513)]),
    (-0.650, [(0, 0.754), (0.044, 0.752), (0.073, 0.742), (0.092, 0.718), (0.096, 0.680), (0.112, 0.620), (0.094, 0.578), (0.073, 0.552), (0.038, 0.540), (0, 0.537)]),
    (-0.690, [(0, 0.738), (0.040, 0.736), (0.066, 0.728), (0.084, 0.708), (0.084, 0.672), (0.090, 0.614), (0.078, 0.578), (0.068, 0.556), (0.036, 0.549), (0, 0.547)]),
    (-0.718, [(0, 0.712), (0.028, 0.707), (0.050, 0.701), (0.064, 0.689), (0.068, 0.656), (0.072, 0.608), (0.070, 0.576), (0.066, 0.556), (0.035, 0.550), (0, 0.548)]),
    (-0.748, [(0, 0.692), (0.021, 0.685), (0.041, 0.680), (0.057, 0.670), (0.062, 0.641), (0.065, 0.603), (0.064, 0.573), (0.061, 0.555), (0.033, 0.549), (0, 0.547)]),
    (-0.790, [(0, 0.656), (0.018, 0.650), (0.035, 0.645), (0.049, 0.637), (0.054, 0.614), (0.056, 0.588), (0.055, 0.564), (0.052, 0.550), (0.028, 0.545), (0, 0.544)]),
    (-0.827, [(0, 0.620), (0.015, 0.615), (0.028, 0.611), (0.040, 0.605), (0.044, 0.590), (0.046, 0.573), (0.046, 0.556), (0.043, 0.546), (0.023, 0.542), (0, 0.541)]),
]
HEAD2_TIP = Vector((0, -0.836, 0.585))
LIP2 = [(y, pts[7]) for y, pts in HEAD2_KEYS]
MOUTH_Y = -0.640
# (灰狼の 4 回目の見直しで追加) 上の断面では鼻づらの先が高さ 8 cm・幅 9 cm の箱のまま (正面の先の面が鼻の 3 倍の高さ) で、短くても鈍く見えた。
# 基準画の側面は鼻づらが鼻へ尖る楔、正面は細い鼻筋の稜の両脇が斜めに下がる面 (台形の断面) で、目は鼻筋のすぐ脇の前を向く面にある
# (正面で目の中心は頬の幅の 0.39〜0.46、上の断面では 0.60)。そこで:
#  - 目の後ろ (-0.688) は広く、目の前 (-0.722) で急に絞る。二つの断面の間の目の高さの面が前・外を向き (法線は約 (0.52, -0.85))、目をそこへ置く (EYE2 を x 0.058 へ)
#  - 鼻づらの断面は上の稜 (幅 2〜2.6 cm) から脇が外下へ開く台形。先 (-0.832) は稜の高さ 0.610・唇 0.563 で高さ 4.7 cm・幅 7.4 cm に
#  - 額から鼻先への上の線は目の前の段を浅くして一本に通す (段 -0.688 → -0.722 で 2.7 cm)
# 鼻づらの比 (側面、耳の付け根の後ろ y -0.523 → 目の中心 → 鼻先。基準画は 475 → 547 → 610 px で目 → 鼻先が 0.47):
# 3 回目 0.220 / 0.349 = 0.63、上の断面 0.154 / 0.329 = 0.47、この断面は実測 (目の中心 -0.713・鼻先 -0.857) で 0.144 / 0.334 = 0.43 (目を前へ出した分だけ短い側、先を尖らせる)
HEAD2_KEYS = HEAD2_KEYS[:4] + [
    (-0.650, [(0, 0.752), (0.044, 0.750), (0.073, 0.740), (0.094, 0.716), (0.100, 0.680), (0.114, 0.622), (0.096, 0.578), (0.075, 0.556), (0.039, 0.545), (0, 0.542)]),
    (-0.688, [(0, 0.730), (0.036, 0.727), (0.062, 0.718), (0.083, 0.702), (0.093, 0.674), (0.100, 0.620), (0.084, 0.582), (0.070, 0.559), (0.037, 0.551), (0, 0.549)]),
    (-0.722, [(0, 0.703), (0.013, 0.701), (0.024, 0.696), (0.033, 0.688), (0.043, 0.664), (0.056, 0.624), (0.062, 0.592), (0.062, 0.561), (0.034, 0.553), (0, 0.551)]),
    (-0.760, [(0, 0.670), (0.011, 0.668), (0.021, 0.664), (0.029, 0.657), (0.037, 0.637), (0.048, 0.605), (0.054, 0.580), (0.054, 0.561), (0.030, 0.554), (0, 0.552)]),
    (-0.798, [(0, 0.638), (0.010, 0.636), (0.018, 0.633), (0.025, 0.627), (0.032, 0.611), (0.041, 0.589), (0.046, 0.572), (0.046, 0.562), (0.026, 0.556), (0, 0.555)]),
    (-0.832, [(0, 0.610), (0.009, 0.608), (0.016, 0.605), (0.022, 0.600), (0.028, 0.590), (0.034, 0.578), (0.037, 0.569), (0.036, 0.563), (0.020, 0.559), (0, 0.558)]),
]
HEAD2_TIP = Vector((0, -0.840, 0.586))
LIP2 = [(y, pts[7]) for y, pts in HEAD2_KEYS]


def lip_at(y):
    """上唇の角の (x, z)"""
    return interp([(k, p[0]) for k, p in LIP2], y), interp([(k, p[1]) for k, p in LIP2], y)


def head2_sections(lod):
    """断面を Catmull-Rom で補間し、口の縁のすぐ上に唇の帯の点を足した輪郭の列 (右半分 11 点) を返す"""
    flat = [(y,) + tuple(c for p in pts for c in p) for y, pts in HEAD2_KEYS]
    out = []
    for s in resample(flat, lod["head2"]):
        pts = [Vector((s[1 + 2 * i], s[2 + 2 * i])) for i in range(10)]
        k5, k6 = pts[6], pts[7]
        lipb = k6 + (k5 - k6).normalized() * 0.005
        out.append((s[0], pts[:7] + [lipb] + pts[7:]))
    return out


def head2_ring(bm, y, half, keep):
    """右半分の輪郭 half (11 点、上の中心 → 下の中心) から一周のリングを作る。keep は使う点の番号 (群れ LOD は間引く)"""
    pts = [half[i] for i in keep]
    right = [bm.verts.new((p.x, y, p.y)) for p in pts]
    left = [bm.verts.new((-p.x, y, p.y)) for p in pts[1:-1]]
    return right + list(reversed(left)), len(pts)


def build_head2(bm, lod):
    secs = head2_sections(lod)
    keep = list(range(11)) if lod["name"] == "hero" else [0, 3, 4, 5, 8, 10]
    rings = [head2_ring(bm, y, half, keep)[0] for y, half in secs]
    back = bm.verts.new((0, secs[0][0] + 0.012, (secs[0][1][0].y + secs[0][1][-1].y) / 2))
    tip = bm.verts.new(HEAD2_TIP)
    faces = loft(bm, [back] + rings + [tip])
    # 口の縁から下 (口蓋) は口の中の暗い色 (顎を開くと見える)。群れ LOD は口の縁の点を持たないので塗らない
    if 8 in keep:
        for f in faces:
            c = f.calc_center_median()
            if c.y < MOUTH_Y - 0.01 and c.z < lip_at(c.y)[1] - 0.001 and abs(c.x) < lip_at(c.y)[0] - 0.004:
                f.material_index = NOSE
    uv_faces(bm, faces, [(0, -0.90, 0.56), (0, -0.70, 0.60), (0, -0.55, 0.64), (0, -0.45, 0.63)], 0.08)
    return faces


# ---- 下顎: (y, 下唇の角の x, 上の高さ, 横の中の x, 横の中の z, 下の角の x, 下の高さ)。上唇の角のすぐ内・下に置く
# 下唇の角 (x, 上の高さ) は上唇の角のすぐ内・下 (口を閉じると唇の線 1 本に見える)。表は (y, 横の中の x, 横の中の z, 下の角の x, 下の高さ)
JAW2_KEYS = [
    (-0.605, 0.060, 0.534, 0.044, 0.514),
    (-0.640, 0.059, 0.531, 0.041, 0.508),
    (-0.695, 0.056, 0.525, 0.036, 0.503),
    (-0.760, 0.050, 0.516, 0.030, 0.500),
    (-0.815, 0.043, 0.510, 0.025, 0.499),
    (-0.843, 0.034, 0.510, 0.017, 0.501),
]
JAW2_TIP = Vector((0, -0.853, 0.512))
# (灰狼の 4 回目で追加) 鼻づらを短くしたので下顎も短く (先 -0.853 → -0.831)
JAW2_KEYS = [
    (-0.605, 0.060, 0.538, 0.044, 0.520),
    (-0.640, 0.059, 0.536, 0.041, 0.516),
    (-0.690, 0.056, 0.534, 0.036, 0.514),
    (-0.748, 0.051, 0.531, 0.030, 0.514),
    (-0.798, 0.043, 0.530, 0.024, 0.516),
    (-0.822, 0.035, 0.530, 0.016, 0.519),
]
JAW2_TIP = Vector((0, -0.829, 0.528))
# (灰狼の 4 回目の見直しで追加) 上の顎の先を低く細い楔にしたので、下顎も先へ細く薄く (先の厚さ 2.5 cm)、先の点を唇の高さへ上げて
# 正面の口の先の V の切れ目 (門歯が覗いた) を閉じる
JAW2_KEYS = [
    (-0.605, 0.066, 0.540, 0.046, 0.520),
    (-0.640, 0.068, 0.541, 0.044, 0.517),
    (-0.690, 0.064, 0.542, 0.039, 0.517),
    (-0.748, 0.054, 0.544, 0.031, 0.522),
    (-0.795, 0.044, 0.548, 0.023, 0.530),
    (-0.822, 0.034, 0.555, 0.015, 0.540),
]
JAW2_TIP = Vector((0, -0.836, 0.557))
# 下顎の横の中 (表の 2 つ目) は上唇の角の 3〜7 mm 内に沿わせる (唇の下のくびれから下の臼歯が覗かない)


def jaw_at(y):
    """下唇の角の (x, z)"""
    x, z = lip_at(max(y, MOUTH_Y - 0.03) if y > MOUTH_Y else y)
    return x - 0.003, z - 0.0015


def build_jaw2(bm, lod):
    hero = lod["name"] == "hero"
    secs = resample(JAW2_KEYS, lod["jaw2"])
    faces = []
    rings = []
    for y, xs, zs, xb, zb in secs:
        xl, zt = jaw_at(y)
        # 口の床の中心・下唇の内・下唇の角・横の中・下の角・下の中心
        half = [(0, zt - 0.008), (xl - 0.009, zt - 0.001), (xl, zt), (xs, zs), (xb, zb + 0.006), (0, zb)]
        if not hero:
            half = [half[0], half[2], half[4], half[5]]
        right = [bm.verts.new((x, y, z)) for x, z in half]
        left = [bm.verts.new((-x, y, z)) for x, z in half[1:-1]]
        rings.append(right + list(reversed(left)))
    back = bm.verts.new((0, secs[0][0] + 0.01, (jaw_at(secs[0][0])[1] + secs[0][4]) / 2))
    tip = bm.verts.new(JAW2_TIP)
    faces += loft(bm, [back] + rings + [tip])
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        c = f.calc_center_median()
        if f.normal.z > 0.6 and abs(c.x) < jaw_at(c.y)[0] - 0.006:
            f.material_index = NOSE  # 口の床
    uv_faces(bm, faces, [(0, -0.89, 0.51), (0, -0.60, 0.535)], 0.04)
    return faces


def cone(bm, base, d, length, r, n=4, flat=1.0, mat=TEETH, side=None):
    """歯・爪: base から d の向きへ伸びる n 角の錐。flat で横 (side) に潰す"""
    d = d.normalized()
    side = (side or (d.cross(Z) if abs(d.z) < 0.9 else d.cross(Y))).normalized()
    up = side.cross(d).normalized()
    ring_ = [bm.verts.new(base + side * (r * flat * math.cos(2 * math.pi * i / n)) + up * (r * math.sin(2 * math.pi * i / n))) for i in range(n)]
    tip = bm.verts.new(base + d * length)
    out = []
    for i in range(n):
        f = bm.faces.new((ring_[i], ring_[(i + 1) % n], tip))
        f.material_index = mat
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - (base + d * length * 0.3)) < 0:
            f.normal_flip()
        out.append(f)
    return out


TEETH_UP = 0.010  # (灰狼の 4 回目で追加) 門歯・臼歯の付け根を唇から奥へ入れる量 (口を閉じた rest で歯の先を見せない)


def build_teeth2(bm, lod, upper):
    """歯 (近 LOD のみ)。上: 牙・門歯 3 本・臼歯 3 本 (上唇の縁から下へ)。下: 牙・門歯・臼歯 (下唇から上へ)。
    上の牙は下唇の外に 1 cm ほど掛かり、口を閉じていても先が見える。下の牙は上唇の内に隠れ、口を開くと見える"""
    ty = HEAD2_KEYS[-1][0]  # 鼻づらの先の断面
    for sx in (-1, 1):
        if upper:
            y = ty + 0.036
            x, z = lip_at(y)
            # (灰狼の 3 回目で変更: 口を閉じたときに牙を見せない。下顎の内へ 4 → 9 mm 寄せ、長さ 22 → 15 mm。元は x - 0.004・0.022)
            cone(bm, Vector((sx * (x - 0.009), y, z + 0.006)), Vector((sx * 0.02, 0.14, -1)), 0.015, 0.0062, n=5, flat=0.8)
            for xi in (0.006, 0.0135, 0.021):
                x0, z0 = lip_at(ty + 0.006)
                cone(bm, Vector((sx * xi, ty + 0.007 + xi * 0.25, z0 + TEETH_UP)), Vector((0, 0.1, -1)), 0.008, 0.0032, n=4)  # (灰狼の 4 回目で変更: 元は z0 + 0.003)
            for y2 in (-0.700, -0.735, -0.770):
                x2, z2 = lip_at(y2)
                cone(bm, Vector((sx * (x2 - 0.008), y2, z2 + TEETH_UP)), Vector((0, 0, -1)), 0.011, 0.0065, n=4, flat=0.45, side=Y)  # (灰狼の 4 回目で変更: 付け根を TEETH_UP だけ上げて rest で先を唇に隠す。元は z2 + 0.004)
        else:
            y = ty + 0.020
            x, z = jaw_at(y)
            cone(bm, Vector((sx * (x - 0.011), y, z - 0.006)), Vector((sx * 0.02, -0.12, 1)), 0.014, 0.0056, n=5, flat=0.8)  # (灰狼の 3 回目で変更: 元は x - 0.009・0.020)
            for xi in (0.006, 0.012, 0.018):
                x0, z0 = jaw_at(ty + 0.010)
                cone(bm, Vector((sx * xi, ty + 0.011 + xi * 0.25, z0 - TEETH_LOW)), Vector((0, -0.1, 1)), 0.007, 0.003, n=4)  # (灰狼の 4 回目で変更: 元は z0 - 0.003) (見直しで TEETH_UP → TEETH_LOW)
            for y2 in (-0.710, -0.745, -0.780):
                x2, z2 = jaw_at(y2)
                cone(bm, Vector((sx * (x2 - 0.009), y2, z2 - TEETH_LOW)), Vector((0, 0, 1)), 0.010, 0.006, n=4, flat=0.45, side=Y)  # (灰狼の 4 回目で変更: 元は z2 - 0.003) (見直しで TEETH_UP → TEETH_LOW)


# (灰狼の 4 回目の見直しで追加) 鼻の幅の半分と下へのすぼまり。基準画の正面は鼻の幅が頬の幅の 0.18 で、下へ尖る丸い三角 (元は 0.030 と 0.30。幅は頬の 0.24)
NOSE_W, NOSE_TAPER = 0.023, 0.42


def build_nose2(bm, lod):
    """鼻: 鼻づらの先の上に載せた角ばった大きな塊 (幅 5.4 cm・高さ 3.4 cm、先へ 1.6 cm 出す)。下へ細い台形で、正面の下の中ほどを割る"""
    hero = lod["name"] == "hero"
    n = 12 if hero else 6
    ty, half = HEAD2_KEYS[-1]
    c = Vector((0, ty - 0.001, half[0][1] - 0.013))
    rings = []
    for dy, s, sz in ((0.018, 0.70, 0.75), (0.004, 1.0, 1.0), (-0.012, 0.97, 0.95), (-0.020, 0.72, 0.72)):
        vs = []
        for i in range(n):
            a = 2 * math.pi * i / n + math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            cx = math.copysign(abs(ca) ** 0.55, ca)
            sy = math.copysign(abs(sa) ** 0.55, sa)
            w = NOSE_W * s * (1 - NOSE_TAPER * max(0.0, -sy))  # (灰狼の 4 回目の見直しで変更: 元は 0.030 * s * (1 - 0.30 * max(0.0, -sy)))
            vs.append(bm.verts.new(c + Vector((w * cx, dy, 0.017 * sz * sy))))
        rings.append(vs)
    tip = bm.verts.new(c + Vector((0, -0.024, 0.003)))
    loft(bm, rings + [tip], mat=NOSE)
    cap(bm, list(reversed(rings[0])), NOSE)


ALMOND_P, ALMOND_TOP = 0.85, 0.85  # (灰狼の 3 回目で追加) 瞼を丸く、上瞼を平らにしすぎない (元は 1.0, 0.7)


def almond(k, L, H, tail=1.3):
    """アーモンドの輪郭 (u, v)。u > 0 が目頭 (前、丸め)、u < 0 が目尻 (後ろ、尖らせて tail 倍に伸ばす)。上瞼は平ら、下瞼は丸い"""
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k
        ca, sa = math.cos(a), math.sin(a)
        p = (1.9 if ca < 0 else 1.25) * ALMOND_P  # (灰狼の 3 回目で変更: 瞼の丸み。元は ALMOND_P を掛けない)
        h = H * math.copysign(abs(sa) ** p, sa) * (ALMOND_TOP if sa > 0 else 1.0)
        out.append((L * ca * (tail if ca < 0 else 1.0), h))
    return out


EYE2 = Vector((0.077, -0.650, 0.651))  # 眼窩の中ほど (+X 側)
# (灰狼の 3 回目で追加) 穏やかな顔: 目の周りの隈 (0.85 → 0.3 倍)・涙の線 (0.7 → 0.15 倍) を薄く、唇の黒い帯を 8.5 → 5.5 mm に細く。
# 目は吊り上がりを 29° → 12° に、目尻の伸びを 1.55 → 1.2 倍に、大きさを 1.25 倍に (EYE_*)
MASK_K, TEAR_K, LIP_W = 0.3, 0.15, 0.0055
MASK_K, TEAR_K = 0.0, 0.45  # (灰狼の 4 回目で変更: 赤い隈はやめて灰の隈 (patch) に替え、涙の線を基準画の強さへ)
LIP_W = 0.004  # (灰狼の 4 回目で変更: 唇の黒い帯を 5.5 → 4 mm)
EYE_UP, EYE_TAIL, EYE_S = 0.21, 1.25, 1.2


def build_eye2(bm, bvh_head, lod, side):
    """眼窩に沈めた吊り上がったアーモンドの目: 暗い縁 (近 LOD)・光る虹彩・暗い瞳 (近 LOD)。目頭は前下、目尻は後ろ上 (約 22°)"""
    hero = lod["name"] == "hero"
    E = Vector((side * EYE2.x, EYE2.y, EYE2.z))
    facing = Vector((side * 0.70, -0.68, 0.10)).normalized()
    loc, n, _, _ = bvh_head.ray_cast(E + facing * 0.3, -facing)
    if loc is None:
        loc, n = E, facing
    n = (n + facing).normalized()
    u = Vector((0, -1, -EYE_UP))  # (灰狼の 3 回目で変更: 目頭の下がりを -0.55 → -EYE_UP)
    u = (u - n * u.dot(n)).normalized()  # 目頭の向き
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v
    k = 16 if hero else 6

    def fan(L, H, off, bulge, mat, tail):
        c = bm.verts.new(loc + n * (off + bulge))
        vs = []
        for x, h in almond(k, L, H, tail):
            p = loc + u * x + v * h
            q = bvh_head.find_nearest(p)[0]
            vs.append(bm.verts.new((q if q is not None else p) + n * off))
        for i in range(k):
            f = bm.faces.new((vs[i], vs[(i + 1) % k], c))
            f.material_index = mat
            f.normal_update()
            if f.normal.dot(n) < 0:
                f.normal_flip()

    if hero:
        fan(0.029 * EYE_S, 0.0125 * EYE_S * 1.1, 0.003, 0.003, NOSE, EYE_TAIL + 0.1)  # (灰狼の 3 回目で変更: 元は 0.029, 0.0125, …, 1.55)
    fan(0.022 * EYE_S, 0.0080 * EYE_S * 1.1, 0.0050, 0.0055, GLOW, EYE_TAIL)  # (灰狼の 3 回目で変更: 元は 0.022, 0.0080, …, 1.35)


def lens(k, L, H, tail_in=1.0, tail_out=1.0, lid=1.0, p_up=0.9, p_low=0.9):
    """(灰狼の 4 回目で追加) 両端の尖ったレンズの輪郭 (u, v)。u > 0 が目頭。上瞼 (v > 0) は lid 倍の高さ。
    上下の弧は (1 - (u/L)^2) の放物線で、両端で尖る"""
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k
        ca, sa = math.cos(a), math.sin(a)
        x = L * ca * (tail_in if ca > 0 else tail_out)
        h = H * (1 - ca * ca) ** (p_up if sa > 0 else p_low) * (lid if sa > 0 else 1.0) * (1 if sa >= 0 else -1)  # (灰狼の 4 回目の見直しで変更: 上下の瞼の丸みを p_up・p_low に分けた。元は ** 0.9)
        out.append((x, h))
    return out


def build_eye3(bm, bvh_head, lod, side):
    """(灰狼の 4 回目で追加) 基準画の目: 灰の隈の中の、尖ったレンズの光る目と細い暗い縁 (上瞼を太く、目頭を涙の線へ伸ばす)。
    目の面は前・外へ向ける (EYE3_FACING)。近 LOD は 24 点、群れ LOD は 6 点"""
    hero = lod["name"] == "hero"
    E = Vector((side * EYE2.x, EYE2.y, EYE2.z))
    facing = Vector((side * EYE3_FACING.x, EYE3_FACING.y, EYE3_FACING.z)).normalized()
    loc, n, _, _ = bvh_head.ray_cast(E + facing * 0.3, -facing)
    if loc is None:
        loc, n = E, facing
    n = (n * 0.4 + facing * 0.6).normalized()
    u = Vector((0, -1, -0.33))
    u = Vector((side * EYE3_U.x, EYE3_U.y, EYE3_U.z))  # (灰狼の 4 回目の見直しで追加) 目頭の向きを面の横の向きから決める (EYE3_U)
    u = (u - n * u.dot(n)).normalized()
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v
    k = 24 if hero else 6

    def fan(pts, off, bulge, mat):
        c = bm.verts.new(loc + n * (off + bulge))
        vs = []
        for x, h in pts:
            p = loc + u * x + v * h
            q = bvh_head.find_nearest(p)[0]
            if EYE3_RAY:  # (灰狼の 4 回目の見直しで追加) 目の向き n に沿って面へ落とす (最寄りの点だと目の前で折れる面に引かれ、虹彩の目頭の下が縁の下へ潜って切れ込みに見えた)
                hit = bvh_head.ray_cast(p + n * 0.03, -n)[0]
                q = hit if hit is not None and (hit - p).length < 0.03 else q
            vs.append(bm.verts.new((q if q is not None else p) + n * off))
        for i in range(len(vs)):
            f = bm.faces.new((vs[i], vs[(i + 1) % len(vs)], c))
            f.material_index = mat
            f.normal_update()
            if f.normal.dot(n) < 0:
                f.normal_flip()

    if hero and EYE3_SHAPE is None:
        fan(lens(k, 0.034, 0.0165, tail_in=1.18, tail_out=1.08, lid=1.25), 0.003, 0.002, NOSE)
    if EYE3_SHAPE is None:
        fan(lens(k, 0.029, 0.0122), 0.0052, 0.0045, GLOW)
    else:  # (灰狼の 4 回目の見直しで追加) EYE3_SHAPE の縁と虹彩
        rim, iris = EYE3_SHAPE
        if hero:
            fan(lens(k, *rim), EYE3_OFF[0], 0.002, NOSE)
        fan(lens(k, *iris), EYE3_OFF[1], 0.0045, GLOW)


# 光る線 (+X 側、-X は鏡映): 眉 (目頭の上から眉の稜に沿って耳の側へ) と頬 (目尻の下から頬骨に沿って後ろへ)
BROW2 = [(0.058, -0.668, 0.688), (0.080, -0.646, 0.699), (0.093, -0.612, 0.716)]
BROW2 = [(0.056, -0.666, 0.703), (0.079, -0.645, 0.708), (0.092, -0.614, 0.709)]  # (灰狼の 3 回目で追加) 眉の光を寝かせる (上がりを 2.8 → 1.4 cm、しかめ面にしない)
CHEEK2 = [(0.090, -0.640, 0.618), (0.112, -0.605, 0.628), (0.108, -0.565, 0.652)]
# (灰狼の 4 回目で追加) 基準画の目のまわり (側面・正面・斜め前の拡大で読んだ形):
#  - 目は両端の尖ったレンズ (目頭は前下、目尻は後ろ上へ約 18°)。光る虹彩を細い暗い縁が囲み、縁は上瞼で太く、目頭から下へ短い涙の線が伸びる
#  - 目は灰がかった暗い菱形の隈 (patch) の中にある。隈は目の 2 倍ほどで、目頭の前下と目尻の後ろへ尖る
#  - 光る眉は目頭の上から後ろ上・外へ上がる短い太い筆 (正面では左右が外へ開く)。目には触れない
#  - 下瞼に沿って、目頭の下から目尻の後ろへ少し上がる光る線 (隈の下の縁)
#  - 正面から目と眉が見えるよう、目は鼻筋の両脇の前を向く面 (ストップの上) に置き、目の面を前へ向ける
EYE2 = Vector((0.074, -0.698, 0.676))
EYE3_FACING = Vector((0.60, -0.78, 0.14))
BROW2 = [(0.062, -0.712, 0.702), (0.071, -0.697, 0.718), (0.081, -0.678, 0.734)]
CHEEK2 = [(0.058, -0.724, 0.656), (0.082, -0.700, 0.652), (0.100, -0.664, 0.662)]
# 側面・斜め前の、目尻の上から頭の上の縁に沿って耳の付け根へ行く光る線 (眉の筆と目尻の後ろで「く」の字を作る)
TEMPLE2 = [(0.086, -0.668, 0.708), (0.092, -0.622, 0.726), (0.090, -0.572, 0.748)]
PAL["patch"] = lin("#8A7362")
PATCH_K = 0.65
# (灰狼の 4 回目の見直しで追加) 目・眉・目尻の線を、絞った鼻づらの付け根の前・外を向く面へ (HEAD2_KEYS の -0.688 → -0.722)。
#  - 目の中心は x 0.058 (頬の幅 0.124 の 0.47、基準画の正面 0.39〜0.46)。目頭の向き EYE3_U は面の横の向き (前・内) から約 24° 下げ、
#    正面で目頭が下・目尻が上に約 24° 傾く (基準画の正面 20〜25°)
#  - 形 EYE3_SHAPE (lens の L, H, 目頭の伸び, 目尻の伸び, 上瞼の倍率, 上瞼の丸み, 下瞼の丸み): 縁は上瞼を太く (虹彩との差 8 mm、下は 4 mm)、
#    目頭を 1.1 cm 暗く伸ばして涙の線へつなぐ。上瞼はほぼ真っ直ぐ、下瞼は丸い (基準画の斜め前の目)
#  - 眉は目頭の上から額を外上へ急に上がる短い太い筆 (正面で水平から約 67°、左右で「\ /」)。目尻の線は目尻から後ろ上へ耳の前まで。下瞼の線はやめる
EYE2 = Vector((0.058, -0.706, 0.684))
EYE3_U = Vector((-0.74, -0.52, -0.42))
EYE3_SHAPE = ((0.036, 0.0136, 1.22, 1.12, 1.35, 1.05, 0.85), (0.030, 0.0099, 1.0, 1.0, 1.0, 1.10, 0.85))  # 基準画の正面の目の長さ (頬の幅の 0.15) へ
BROW2 = [(0.045, -0.713, 0.707), (0.052, -0.699, 0.725), (0.061, -0.682, 0.743)]
BROW2_W = 0.016
TEMPLE2 = [(0.086, -0.687, 0.691), (0.102, -0.655, 0.698), (0.105, -0.615, 0.720)]
CHEEK2_ON = False
EYE3_RAY = True
EYE3_OFF = (0.0055, 0.0090)  # 縁と虹彩を面から浮かせる量 (0.003・0.0052 では目の前の折れ目の稜が虹彩を突き抜けて目頭の下に暗い切れ込み)
EAR_TUFTS = False  # 耳の付け根の内の淡い毛の房 (白い棘に見えた) をやめる
HACKLE_Y0 = -0.20  # 背の逆立つ毛は肩から (首の上の -0.33・-0.26 の房は正面で頭の上に光る塊として立った)
TEETH_UP = 0.017  # 上の門歯・臼歯の付け根を唇から奥へ入れる量 (0.010 では rest で先が唇の線に白い点として見えた)
TEETH_LOW = 0.012  # 下の門歯・臼歯は薄くした下顎の中に収める (0.017 では付け根が顎の外へ出た、0.009 では門歯の先が口の先の隙間に覗いた)
TEAR_K = 0.0  # 涙の線は目の縁の目頭の伸びと、下の TEAR2 (目頭から鼻づらの脇を前下へ) に替える
TEAR2 = (Vector((-0.024, -0.018, -0.012)), Vector((-0.020, -0.040, -0.040)), 0.006, 0.55)  # (目からの始まり, 終わり, 幅, 濃さ)


def build_line2(bm, bvh, lod, side, path, width):
    """頭の表面に吸わせた光る細い帯 (始まりを太く、先へ細る)"""
    nseg = max(2, lod["ribbon_seg"] - 2)
    dense = resample_path([Vector((side * x, y, z)) for x, y, z in path], nseg + 1)
    hits = []
    for p in dense:
        loc, n, _, _ = bvh.find_nearest(p)
        if n.dot(loc - Vector((0, loc.y, 0.62))) < 0:
            n = -n
        hits.append((loc, n))
    prev = None
    for i, (loc, n) in enumerate(hits):
        d = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        wi = width * (1.0 - 0.6 * i / (len(hits) - 1))
        sv = n.cross(d).normalized() * (wi / 2)
        cur = [bm.verts.new(loc - sv + n * 0.0025), bm.verts.new(loc + n * 0.005), bm.verts.new(loc + sv + n * 0.0025)]
        if prev:
            for j in range(2):
                f = bm.faces.new((prev[j], prev[j + 1], cur[j + 1], cur[j]))
                f.material_index = GLOW
                f.normal_update()
                if f.normal.dot(n) < 0:
                    f.normal_flip()
        prev = cur


def build_ears2(bm, lod, side):
    """角ばった三角の耳: 幅の広い付け根、縁の立った殻。前 (内側) はくぼんで暗く、付け根の内に淡い毛の房。外へ開いて立てる"""
    hero = lod["name"] == "hero"
    cl = bm_colors(bm)
    h, t = BONES["ear_L" if side < 0 else "ear_R"][:2]
    axis = (t - h).normalized()
    Hh = (t - h).length + 0.006
    front = Vector((side * 0.50, -1, 0.05))
    front = (front - axis * front.dot(axis)).normalized()
    w = axis.cross(front).normalized()
    nsec = 5 if hero else 2
    rings, kinds = [], []
    for i in range(nsec):
        a = Hh * i / nsec
        f = 1 - a / Hh
        wd = 0.054 * f ** 0.7 + 0.011
        th = 0.016 * f + 0.003
        cup = 0.013 * f
        c = h + axis * a - front * 0.004
        if hero:
            pts = [(-w * wd, "rim"), (-w * wd * 0.55 - front * th, "out"), (-front * th * 1.15, "out"), (w * wd * 0.55 - front * th, "out"),
                   (w * wd, "rim"), (w * wd * 0.6 + front * (0.003 - cup), "in"), (front * (0.002 - cup * 1.25), "in"), (-w * wd * 0.6 + front * (0.003 - cup), "in")]
        else:
            pts = [(-w * wd, "rim"), (-front * th, "out"), (w * wd, "rim"), (front * (0.002 - cup), "in")]
        rings.append([bm.verts.new(c + p) for p, _ in pts])
        kinds = [k for _, k in pts]
    tip = bm.verts.new(h + axis * Hh)
    faces = loft(bm, rings + [tip])
    faces.append(cap(bm, list(reversed(rings[0]))))
    col = {"rim": PAL["fur_top"], "out": PAL["fur"], "in": PAL["ear_in"]}
    for r in rings:
        for vv, kd in zip(r, kinds):
            vv[cl] = (*fur_gain(col[kd]), 1.0)
    tip[cl] = (*fur_gain(mix(PAL["fur"], PAL["dark"], 0.5)), 1.0)
    uv_faces(bm, faces, [h, h + axis * Hh], 0.03)
    if hero and EAR_TUFTS:  # (灰狼の 4 回目の見直しで変更: EAR_TUFTS で切る。元は if hero:)
        # 付け根の内の淡い毛の房 (上と外へ)
        uvl = bm.loops.layers.uv.get("UVMap")
        for k in (-0.5, 0.1, 0.6):
            root = h + w * (0.03 * k) + front * 0.004 + axis * 0.012
            tuft(bm, cl, uvl, root, axis * 0.8 + front * 0.6 + w * (0.4 * k), 0.045, 0.011, 0.004, -front * 0.15, PAL["pale"], mix(PAL["pale"], WHITE, 0.3), n=3)
    return front


# ---- 毛の房: 曲がった尖った塊。断面は菱形 (n=4) か五角形 (n=5)。根元の色から先の色へ
def tuft(bm, cl, uvl, root, d, L, W, T, bend, c0, c1, n=4, glow_front=False, lighten=True, normal=None):
    d = d.normalized()
    if normal is not None:  # 幅を面に沿わせる (厚さが法線の向き)
        side = d.cross(normal)
        side = side.normalized() if side.length > 1e-4 else (d.cross(Z) if abs(d.z) < 0.95 else d.cross(X)).normalized()
    else:
        side = (d.cross(Z) if abs(d.z) < 0.95 else d.cross(X)).normalized()
    up = side.cross(d).normalized()
    bend = Vector(bend)

    def at(t):
        return root + d * (L * t) + bend * (L * t * t)

    rings = []
    for t, s in ((0.0, 1.0), (0.5, 0.62)):
        c = at(t)
        rs = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rs.append(bm.verts.new(c + side * (W * s * math.cos(a)) + up * (T * s * math.sin(a))))
        rings.append(rs)
    tip = bm.verts.new(at(1.0))
    faces = loft(bm, rings + [tip])
    for f in faces:
        f.normal_update()
        m = f.calc_center_median()
        tt = max(0.0, min(1.0, (m - root).dot(d) / L))
        if f.normal.dot(m - at(tt)) < 0:
            f.normal_flip()
        if glow_front and tip in f.verts and f.normal.dot(Vector((0, -0.5, 1)).normalized()) > 0.2:
            f.material_index = GLOW
    ct = mix(c1, WHITE, 0.05) if lighten else c1
    ct = mix(c0, ct, 0.7)  # (灰狼の 3 回目で追加) 先の明るさを根元の色へ寄せる (淡い破片に見せない)
    for vv in rings[0]:
        vv[cl] = (*fur_gain(c0), 1.0)
    for vv in rings[1]:
        vv[cl] = (*fur_gain(mix(c0, c1, 0.6)), 1.0)
    tip[cl] = (*fur_gain(ct), 1.0)
    # (灰狼の 3 回目で追加) 房の法線を根元の面の法線に寄せる (TUFT_NRM)。房が面と同じ明暗で塗られ、光る破片でなく毛の筆の跡に見える
    if normal is not None and TUFT_NRM > 0:
        nl = bm.verts.layers.float_vector.get("tnrm") or bm.verts.layers.float_vector.new("tnrm")
        for vv in rings[0] + rings[1] + [tip]:
            vv[nl] = Vector(normal).normalized()
    if uvl is not None:
        for f in faces:
            for lp in f.loops:
                p = lp.vert.co
                tt = max(0.0, min(1.0, (p - root).dot(d) / L))
                q = p - at(tt)
                ang_ = math.atan2(q.dot(up), q.dot(side)) / (2 * math.pi)
                lp[uvl].uv = (ang_ * 0.5, tt * L / FUR_TILE)
    return faces


TUFT_NRM = 0.8  # (灰狼の 3 回目で追加) 房の法線を根元の面の法線へ寄せる割合


def surface_point(bvh, p):
    loc, n, _, _ = bvh.find_nearest(p)
    return (loc, n) if loc is not None else (p, Z)


def tufts_region(bm, bvh, lod, region):
    """部位ごとの毛の房を bm に足す。bvh は房の根元を吸わせる面。房は面に沿って寝かせ (外への向きは小さく)、根元を面の中へ沈めて
    先の半分だけを出す (棘の山にしない)。群れ LOD は大きな房を少しだけ"""
    hero = lod["name"] == "hero"
    cl = bm_colors(bm)
    uvl = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    bm.verts.layers.float_vector.get("tnrm") or bm.verts.layers.float_vector.new("tnrm")  # (灰狼の 3 回目で追加) 頂点を作る前に層を作る
    n = 5 if hero else 3
    pale, fur, top = PAL["pale"], PAL["fur"], PAL["fur_top"]
    items = []  # (根元の目安, 向き, 長さ, 幅, 厚さ, 曲がり, 根元の色, 先の色, 先を光らせる)
    for sx in (-1, 1):
        if region == "cheek":
            # 頬の飾り毛: 耳の下から喉へ下りる弧の上に、後ろ・下へ寝かせて 2 列 (外の列が長い)
            m = 6 if hero else 3
            for row, (dy, s) in enumerate(((0.0, 1.0), (0.030, 1.2))):
                if not hero and row:
                    continue
                for i in range(m):
                    t = i / (m - 1)
                    p = Vector((sx * (0.104 + 0.018 * math.sin(math.pi * t)), -0.575 + 0.030 * t + dy, 0.650 - 0.140 * t))
                    d = Vector((sx * 0.30, 0.80, -0.30 - 0.60 * t))
                    items.append((p, d, (0.055 + 0.016 * math.sin(math.pi * t)) * s, 0.034 * s, 0.007, Vector((sx * 0.05, 0.05, -0.2)),
                                  mix(fur, pale, 0.3 + 0.7 * t), mix(pale, WHITE, 0.2), False))
        elif region == "mane":
            # 首の飾り毛: 首の周りに 3 列、項は毛の色、喉は淡い色。後ろへ寝かせる
            rows = ((-0.48, 0.0), (-0.43, 0.5), (-0.38, 1.0)) if hero else ((-0.44, 0.3),)
            for y, rk in rows:
                angs = (50, 18, -15, -48, -78) if hero else (35, -20, -70)
                for deg in angs:
                    a = math.radians(deg + 10 * rk)
                    zc = interp([(-0.52, 0.61), (-0.45, 0.63), (-0.36, 0.645), (-0.27, 0.62)], y)
                    p = Vector((sx * 0.20 * math.cos(a), y, zc + 0.22 * math.sin(a)))
                    low = smoothstep(10, -60, deg)
                    d = Vector((sx * 0.22 * math.cos(a), 0.9, 0.12 * math.sin(a) - 0.45 * low))
                    items.append((p, d, 0.070 + 0.015 * rk, 0.040, 0.008, Vector((0, 0.05, -0.15)),
                                  mix(fur, pale, low), mix(mix(fur, top, 0.3), pale, low), False))  # (灰狼の 3 回目で変更: 先の色を抑える。元は mix(mix(top, pale, low), WHITE, 0.12))
        elif region == "hackle":
            # 背の逆立つ毛 (首の上から肩): 中心線の両脇に後ろへ寝かせ、先 (上・前を向く面) が光る
            spikes = SPIKES_HERO if hero else SPIKES_LOD1
            for y, h, ln in spikes:
                if y < HACKLE_Y0:  # (灰狼の 4 回目の見直しで追加)
                    continue
                p = Vector((sx * 0.026, y, 1.2))
                items.append((p, Vector((sx * 0.15, 0.85, 0.50)), h * 1.05, 0.034, 0.008, Vector((0, 0.3, -0.1)), fur, mix(fur, top, 0.35), True))  # (灰狼の 3 回目で変更: 先の色 top → mix(fur, top, 0.35)。観察画面で白い鋸の歯に見えた)
        elif region == "chest":
            # 胸の飾り毛 (淡い、下へ寝かせる)
            if sx > 0:
                pts = [(-0.06, -0.455, 0.52), (0.0, -0.465, 0.53), (0.06, -0.455, 0.52), (-0.035, -0.445, 0.45), (0.035, -0.445, 0.45),
                       (-0.07, -0.44, 0.60), (0.07, -0.44, 0.60), (0.0, -0.455, 0.60)] if hero else [(-0.04, -0.455, 0.50), (0.04, -0.455, 0.50)]
                for x, y, z in pts:
                    items.append((Vector((x, y, z)), Vector((x * 1.5, 0.35, -1)), 0.065, 0.040, 0.008, Vector((0, 0.15, 0)), pale,
                                  mix(pale, WHITE, 0.25), False))
        elif region == "elbow":
            if hero:
                e = joint(f"fl_{'L' if sx < 0 else 'R'}", 1)
                for dz in (0.03, -0.01):
                    items.append((e + Vector((sx * 0.012, 0.045, dz)), Vector((sx * 0.15, 1, -0.8)), 0.050, 0.032, 0.007, Vector((0, 0, -0.2)),
                                  fur, mix(fur, pale, 0.4), False))
        elif region == "thigh":
            k = joint(f"hl_{'L' if sx < 0 else 'R'}", 0)
            for dz in ((0.0, -0.06, -0.12) if hero else (-0.05,)):
                items.append((k + Vector((sx * 0.05, 0.10, dz - 0.02)), Vector((sx * 0.15, 0.8, -0.7)), 0.065, 0.040, 0.008, Vector((0, 0, -0.2)),
                              fur, mix(fur, top, 0.4), False))
        elif region == "belly":
            for y in ((0.06, -0.04, -0.14, -0.24) if hero else (-0.10,)):
                zb = interp([(k[0], k[2]) for k in BODY_KEYS], y)
                items.append((Vector((sx * 0.07, y, zb + 0.03)), Vector((sx * 0.15, 0.55, -1)), 0.050, 0.036, 0.008, Vector((0, 0.2, 0)),
                              mix(fur, pale, 0.6), mix(pale, WHITE, 0.2), False))
        elif region == "tail":
            path = resample_path(TAIL2_PATH, 21)
            ts = (0.22, 0.38, 0.54, 0.70, 0.86) if hero else (0.45, 0.75)
            for t in ts:
                p0 = path[int(t * 20)]
                d = (path[min(20, int(t * 20) + 1)] - p0).normalized()
                sd = Vector((sx, 0, 0))
                dark = smoothstep(0.62, 0.85, t)
                c0 = mix(fur, PAL["dark"], dark * 0.7)
                items.append((p0 + sd * 0.05, d + sd * 0.25 + Vector((0, 0, -0.1)), 0.075, 0.042, 0.009, d * 0.15, c0,
                              mix(mix(mix(fur, top, 0.35), PAL["dark"], dark * 0.8), WHITE, 0.05), False))  # (灰狼の 3 回目で変更: 先の色 top → mix(fur, top, 0.35))
                if sx > 0:
                    under = Vector((0, -0.3, -1))
                    items.append((p0 + Vector((0, 0, -0.04)), d + under * 0.35, 0.075, 0.042, 0.009, d * 0.15, mix(c0, pale, 0.3 * (1 - dark)),
                                  mix(mix(pale, PAL["dark"], dark * 0.8), WHITE, 0.05), False))
    for p, d, L, W, T, bend, c0, c1, glow in items:
        if region == "hackle":
            loc, nrm, _, _ = bvh.ray_cast(p, Vector((0, 0, -1)))
            if loc is None:
                continue
        else:
            loc, nrm = surface_point(bvh, p)
        # 向きを面に沿わせる (外への成分は 0.3 まで、背の逆立つ毛は 0.6 まで)。幅の向きは面に沿い、厚さの向きが面の法線 (平たい房が重なる鱗の並び)
        d = d.normalized()
        dt = d - nrm * d.dot(nrm)
        d = (dt.normalized() if dt.length > 1e-3 else d) + nrm * min(0.6 if region == "hackle" else 0.3, max(0.12, d.dot(nrm)))
        root = loc - d.normalized() * (L * 0.18) - nrm * 0.006
        tuft(bm, cl, uvl, root, d, L, W, T, bend, c0, c1, n=n, glow_front=glow, normal=nrm)


# ---- 首・胴・脚・尾の形 (元の値を上書き)
# 首を太く (基準画の首は胸とほぼ同じ太さで頭へつながる)。(y, z, 横半径, 喉側, 項側)
NECK_KEYS = [(-0.27, 0.62, 0.155, 0.22, 0.19), (-0.36, 0.605 + HEAD_DZ * 0.4, 0.165, 0.235, 0.185), (-0.45, 0.575 + HEAD_DZ * 0.8, 0.150, 0.21, 0.155),
             (-0.52, 0.56 + HEAD_DZ, 0.125, 0.17, 0.13), (-0.56, 0.555 + HEAD_DZ, 0.10, 0.12, 0.10)]
# 胴: 胸をもう少し深く (肘の高さへ)、腹をもっと巻き上げ、肩 (き甲) を高く
BODY_KEYS = [
    (0.37, 0.55, 0.43, 0.05, 0.0),
    (0.33, 0.59, 0.385, 0.11, 0.10),
    (0.25, 0.645, 0.375, 0.135, 0.18),
    (0.14, 0.705, 0.44, 0.118, 0.26),
    (0.02, 0.77, 0.435, 0.132, 0.30),
    (-0.10, 0.84, 0.375, 0.168, 0.36),
    (-0.21, 0.868, 0.318, 0.200, 0.42),
    (-0.31, 0.832, 0.305, 0.198, 0.44),
    (-0.39, 0.755, 0.338, 0.165, 0.42),
    (-0.445, 0.665, 0.42, 0.09, 0.30),
]
# 脚を太く (肩・上腕・腿は幅を 1 割、前腕・中足も 1 割太く、手首・飛節の節を立てる)
FRONT_LEG = [(0.05, 0.086, 0.155), (0.45, 0.072, 0.108), (0.85, 0.056, 0.074), (1.05, 0.049, 0.062), (1.5, 0.041, 0.049),
             (1.9, 0.036, 0.043), (2.05, 0.040, 0.047), (2.5, 0.034, 0.039), (3.0, 0.033, 0.037)]
HIND_LEG = [(0.05, 0.094, 0.160), (0.4, 0.080, 0.130), (0.8, 0.058, 0.090), (1.0, 0.050, 0.068), (1.4, 0.043, 0.052),
            (1.85, 0.036, 0.045), (2.05, 0.041, 0.051), (2.5, 0.033, 0.039), (3.0, 0.033, 0.037)]
# (灰狼の 4 回目の見直しで追加) 肩の板 (前脚の付け根) と首の後ろの端が胴の脇から出て、交わる線が肩の前・首の付け根でぎざぎざの明るい面
# (鋸の歯) に見えた (筆の跡・塗りを消しても残る形の交わり)。前脚の付け根の断面を横 0.086 → 0.078・前後 0.155 → 0.125 m に、
# 首の後ろの端 (-0.27) を横 0.155 → 0.145・喉 0.22 → 0.205・項 0.19 → 0.18 m に細くして、交わりを胴の中へ入れる
FRONT_LEG = [(0.05, 0.078, 0.125), (0.45, 0.068, 0.100)] + FRONT_LEG[2:]
NECK_KEYS = [(-0.27, 0.62, 0.145, 0.205, 0.18)] + NECK_KEYS[1:]
# 尾: 付け根は細く、中ほどは房で太らせる (芯は細め)、真下寄りに垂らす
TAIL2_PATH = [(0, 0.30, 0.575), (0, 0.395, 0.52), (0, 0.48, 0.43), (0, 0.555, 0.32), (0, 0.61, 0.215)]
TAIL2_RADII = [0.042, 0.066, 0.074, 0.058, 0.0]


TAIL2_RADII = [0.046, 0.078, 0.088, 0.068, 0.0]  # (灰狼の 4 回目で追加) 尾の房をやめたので芯を太く (元は 0.042 / 0.066 / 0.074 / 0.058)


RUFF_JAG = 0.4  # (灰狼の 4 回目の見直しで追加) 首の殻の後ろの縁のぎざぎざと後ろへの流れの倍率 (喉の下だけ)


def build_ruff(bm, lod):
    """(灰狼の 4 回目で追加) 首の飾り毛: 首を包む殻 (頬の後ろから肩の前へ)。基準画の首の周りは、立った房ではなく、体の輪郭そのものが
    後ろ下へ流れる大きな面になり、喉と胸の下の縁がぎざぎざに切れる。前の縁は頭の後ろの中に隠し、後ろへ行くほど首から離して流し、
    後ろの縁は周りを交互に伸ばしてぎざぎざ (下ほど長く) にする。断面は首と同じ楕円を面の立った多角形に"""
    hero = lod["name"] == "hero"
    n = 10 if hero else 8
    secs = resample(NECK_KEYS, 9)
    ts = [0.0, 0.25, 0.5, 0.75, 1.0] if hero else [0.0, 0.5, 1.0]
    rings = []
    for k, t in enumerate(ts):
        y = -0.555 + 0.19 * t
        # 首の断面をこの y で補間
        i = min(len(secs) - 2, max(0, int((secs[0][0] - y) / (secs[0][0] - secs[-1][0]) * (len(secs) - 1))))
        a_, b_ = secs[i], secs[i + 1]
        w = max(0.0, min(1.0, (a_[0] - y) / (a_[0] - b_[0]))) if a_[0] != b_[0] else 0.0
        _, zc, rx, rf, rb = [a_[j] + (b_[j] - a_[j]) * w for j in range(5)]
        off = 0.004 + 0.022 * smoothstep(0.0, 0.8, t)  # 首から離す
        vs = []
        for j in range(n):
            ang_ = 2 * math.pi * j / n + math.pi / 2
            ca, sa = math.cos(ang_), math.sin(ang_)
            low = max(0.0, -sa)  # 喉の側ほど 1
            jag = 0.0
            yy = y
            if t >= 0.99:
                jag = (0.018 + 0.026 * low) * (1 if j % 2 == 0 else -0.25)
                yy = y + (0.05 + 0.05 * low) * (1 if j % 2 == 0 else 0.3)  # 後ろへ流す
            # (灰狼の 4 回目の見直しで追加) 後ろの縁のぎざぎざが肩の上で破れた紙の縁 (新しい鋸の歯) に見えたので、
            # 項と横 (上半分) は後ろで首へ沈めて縁を見せず、ぎざぎざは喉の下だけ小さく (RUFF_JAG 倍) 残す。喉の側は後ろへ流さない
            upper = smoothstep(-0.35, 0.25, sa)  # 項の側ほど 1
            off_j = off * (1 - upper * smoothstep(0.45, 1.0, t)) - 0.010 * upper * smoothstep(0.8, 1.0, t)
            jag *= RUFF_JAG * (1 - upper)
            yy = y + (yy - y) * RUFF_JAG * (1 - upper)
            rxx = rx + off_j * (0.5 + 0.5 * low) + jag * abs(ca)  # (灰狼の 4 回目の見直しで変更: off → off_j)
            ry = (rb if sa > 0 else rf) + off_j * (0.5 + 1.2 * low) + jag * abs(sa)  # (灰狼の 4 回目の見直しで変更: off → off_j)
            vs.append(bm.verts.new((rxx * ca, yy, zc + ry * sa - 0.02 * low * t)))
        rings.append(vs)
    faces = loft(bm, rings)
    return faces


# ================================================================ 灰狼の 5 回目 (2026-09-25 08:07 手元の審査台 w4-wolf への判断)
# 判断「よくなった。あとは頬や胸元などのの立て髪のような広がりを含めた毛並み。デフォルメの仕方など既存のデフォルメ造形の箱庭ゲームを参考に」。
# 3 回目の細い房の林は「首まわりの毛並みの立ち方がかえって不自然」と言われたので、頬と胸元の広がりは、ローポリのデフォルメ造形の
# 毛の塊のまとめ方 (スタイライズドの髪・毛の房を数本の太い塊にまとめる) で作る (CHUNKS):
#  - 1 本の塊は、根元を頭・首の皮の下へ沈め、面に沿って毛の流れの向きへ寝かせ、外へ持ち上げて先を尖らせる太い房 (幅 8〜12 cm・長さ 10〜16 cm・
#    厚さ 3.4〜4.6 cm)。断面は上の稜と平たい下の菱形で、稜を境に光の面と陰の面の 2 枚に塗り分ける (胴の面の立て方と同じ)
#  - 頬は片側 2 本 (群れ LOD は 1 本)。顎の角から外・後ろ下へ張り、正面で顔の下半分が頭蓋より外へ広がり、側面で顎の線の後ろに尖りの段
#  - 胸元は喉の列 3 本 (中心が長い) と胸の列 2 本 (群れ LOD は喉の 3 本)。正面で V の尖り、側面で喉の線の下に段
#  - 色は根元が地の毛・喉の灰茶、先ほど明るい灰茶 (筆の跡やテクスチャで毛を描かない)。顔 (目・眉・鼻づら) には触れない
# 試した形の記録: 体の面に当てた光線で起こした平たい板 (縁に尖りの段) は、Blender の寄りで紙を切って貼ったように見えた (2 回目の判断「折り紙」)。
# 細い塊 (幅 4〜5 cm) は角のように突き出た。6 点のなめらかな断面は丸いソーセージの塊に見えた
# 塊: (根元の目安 (x, y, z) (+X 側。x が None なら横から当てた光線で面を探す)、流れの向き、長さ、根元の幅、厚さ、外への反り、近 LOD だけか)
CHUNKS = {
    "cheek": [
        # 後ろ: 顎の角の後ろ上から後ろ・外・下へ (首の横へ流れる)
        ((None, -0.540, 0.595), (0.40, 1.0, -0.45), 0.125, 0.085, 0.038, 0.25, True),
        # 前: 顎の角から外・後ろ下へ (正面で頬を頭蓋より外へ張り出す本体)
        ((None, -0.590, 0.572), (0.55, 0.85, -0.45), 0.160, 0.105, 0.046, 0.30, False),
    ],
    "chest": [
        # 胸の列 (下に回る): 胸の前から前脚の間へ垂れる
        ((0.060, None, 0.400), (0.40, -0.30, -1.0), 0.100, 0.075, 0.034, 0.25, True),
        # 喉の列 (上に重なる): 喉から胸へ。両脇は外下へ、中心が長い (正面で V の 3 つの尖り)
        ((0.090, None, 0.480), (0.70, -0.25, -1.0), 0.130, 0.090, 0.040, 0.25, False),
        ((0.0, None, 0.460), (0.0, -0.30, -1.0), 0.160, 0.120, 0.046, 0.25, False),
    ],
}
CHUNK_SINK = 0.012  # 根元を皮の下へ沈める量
# 断面は 4 点 (両の縁・上の稜・平たい下) の菱形。硬い辺 (CHUNK_SHARP) で、上の稜を境に光の面と陰の面の 2 枚に分けて塗る
# (6 点のなめらかな断面は丸いソーセージの塊に見え、基準画の面の立った筆の塗りとそろわなかった)
CHUNK_N = 4
CHUNK_GAP = 0.003  # 塊の下の面を体の面から浮かせる最小の量
CHUNK_CONFORM = {"cheek": True, "chest": True}  # 体の面の外へ押し出すか
CHUNK_RINGS = ((0.0, 1.0, 1.0), (0.45, 0.92, 0.9), (0.78, 0.52, 0.6))
CHUNK_SHARP = 35
CHUNK_OUT = {"cheek": 0.42, "chest": 0.35}  # 流れの向きに足す外 (面の法線) への成分


def chunk(bm, cl, root, nrm, d, L, W, T, curl, c_root, c_tip, n=6, rings=((0.0, 1.0, 1.0), (0.32, 1.0, 1.0), (0.64, 0.74, 0.82), (0.86, 0.42, 0.55)),
          bvh=None):
    """(灰狼の 5 回目で追加) 太い毛の塊 1 本。rings は (位置 t, 幅の倍率, 厚さの倍率)。断面は外 (nrm の側) が丸く、内が平たい三日月。
    bvh を渡すと、根元の輪より先の頂点を体の面の外へ押し出す (面に沿わせる。凸の胸で塊が体の中と外を行き来して、細かい破片に見えた)"""
    side = d.cross(nrm)
    side = side.normalized() if side.length > 1e-4 else d.orthogonal().normalized()
    up = side.cross(d).normalized()
    if up.dot(nrm) < 0:
        up, side = -up, -side

    def at(t):
        return root + d * (L * t) + up * (curl * L * t * t)

    rs = []
    for t, ws, ts in rings:
        c = at(t)
        ring_ = []
        for i in range(n):
            a = 2 * math.pi * i / n
            s_, h_ = math.cos(a), math.sin(a)
            h_ = h_ if h_ > 0 else h_ * 0.30  # 内 (体の側) は平たく
            q = c + side * (W * ws * 0.5 * s_) + up * (T * ts * h_)
            if bvh is not None and t > 0:
                loc, nn, _, _ = bvh.find_nearest(q)
                if loc is not None:
                    nn = nn if nn.dot(nrm) >= 0 else -nn
                    need = CHUNK_GAP + T * ts * max(0.0, h_) * 0.8
                    dq = (q - loc).dot(nn)
                    if dq < need:
                        q = q + nn * (need - dq)
            v = bm.verts.new(q)
            k = t / rings[-1][0]
            v[cl] = (*mix(c_root, c_tip, smoothstep(0.1, 1.0, k) * (0.55 + 0.45 * max(0.0, h_))), 1.0)
            ring_.append(v)
        rs.append(ring_)
    tip = bm.verts.new(at(1.0))
    tip[cl] = (*c_tip, 1.0)
    return loft(bm, rs + [tip])


def build_chunks(bm, bvh, lod, region):
    """(灰狼の 5 回目で追加) 頬・胸元の太い毛の塊 (CHUNKS) を bm に足す。bvh は体の外側の面 (胴・首・首の殻・頭)。左右に鏡映する"""
    hero = lod["name"] == "hero"
    cl = bm_colors(bm)
    n = CHUNK_N if hero else 4
    rings = CHUNK_RINGS if hero else ((0.0, 1.0, 1.0), (0.5, 0.8, 0.85))
    pale, fur = PAL["pale"], PAL["fur"]
    light = mix(pale, PAL["tip"], 0.6)
    for (x, y, z), d, L, W, T, curl, hero_only in CHUNKS[region]:
        if hero_only and not hero:
            continue
        for sx in (-1, 1):
            if region == "chest" and x == 0 and sx < 0:
                continue
            ray = Vector((-sx, 0, 0)) if x is None else Vector((0, 1, 0))
            if x is None:
                loc, nrm, _, _ = bvh.ray_cast(Vector((sx * 0.6, y, z)), ray)
            else:
                loc, nrm, _, _ = bvh.ray_cast(Vector((sx * x, -1.5, z)), ray)
            if loc is None:
                continue
            if nrm.dot(ray) > 0:  # 部品の面の向きはそろっていないので、光線の来た側 (外) へ向ける
                nrm = -nrm
            dd = Vector((sx * d[0], d[1], d[2])).normalized()
            dt = dd - nrm * dd.dot(nrm)
            dd = ((dt.normalized() if dt.length > 1e-3 else dd) + nrm * CHUNK_OUT[region]).normalized()
            root = loc - nrm * CHUNK_SINK
            # 根元の色は付く面の色 (頬の上は地の毛、下は灰茶)、先は明るい灰茶
            c0 = mix(fur, pale, smoothstep(0.64, 0.58, loc.z)) if region == "cheek" else pale
            kw = {} if rings is None else {"rings": rings}
            chunk(bm, cl, root, nrm, dd, L, W, T, curl * 0.35, c0, light, n=n, bvh=bvh if CHUNK_CONFORM[region] else None, **kw)


CHUNK_WEIGHTS = {
    "cheek": lambda co: weights_for(co, [("head", 1.0), ("neck2", 0.9)]),
    "chest": lambda co: weights_for(co, [("neck2", 0.7), ("neck1", 1.0), ("chest", 0.9)]),
}
CHUNK_REGIONS = ("cheek", "chest")  # 空にすると 4 回目の形に戻る


def build_body2(bm, lod):
    nsec, n = lod["body"]
    secs = resample(BODY_KEYS, nsec)
    rings = [facet_ring(bm, Vector((0, y, (top + bot) / 2)), hw, (top - bot) / 2, (top - bot) / 2, pinch, n, bevel=0.08)
             for y, top, bot, hw, pinch in secs]
    rear = bm.verts.new((0, secs[0][0] + 0.02, (secs[0][1] + secs[0][2]) / 2))
    front = bm.verts.new((0, secs[-1][0] - 0.02, (secs[-1][1] + secs[-1][2]) / 2))
    faces = loft(bm, [rear] + rings + [front])
    uv_faces(bm, faces, [(0, y, body_zc(y)) for y in (-0.50, -0.30, -0.10, 0.10, 0.30, 0.42)], 0.17)


def build_tail2(bm, lod):
    nsec, n = lod["tail"]
    pts = resample_path(TAIL2_PATH, nsec)
    radii = [r for (r,) in resample([(r,) for r in TAIL2_RADII], nsec)]
    faces = tube(bm, pts, radii, n, mat=BODY, flat=0.75)  # (灰狼の 4 回目で変更: 横の潰しを 0.85 → 0.75。房の代わりに平たい筆の尾に)
    uv_faces(bm, faces, TAIL2_PATH, 0.06)


def build_paw2(bm, lod, name):
    """足: 掌の塊 + 指 4 本 (前へ出た小さな塊) + 爪 (暗い錐)。底は地面 (z = 0)"""
    hero = lod["name"] == "hero"
    base = joint(name, 3)
    x = base.x
    n = 8 if hero else 5
    keys = [(0.045, 0.028, 0.024, 0.034), (0.018, 0.046, 0.038, 0.038), (-0.025, 0.050, 0.030, 0.030), (-0.052, 0.044, 0.020, 0.022)]
    rings = [ring(bm, Vector((x, base.y + dy, zc)), X, Z, rx, rt, zc, n, sq=2.6, phase=math.pi / 2) for dy, rx, rt, zc in keys]
    back = bm.verts.new((x, base.y + 0.058, 0.03))
    toe_c = bm.verts.new((x, base.y - 0.066, 0.02))
    faces = loft(bm, [back] + rings + [toe_c], mat=BODY)
    if hero:
        for dx, dy, s in ((-0.031, -0.066, 0.9), (-0.011, -0.080, 1.0), (0.011, -0.080, 1.0), (0.031, -0.066, 0.9)):
            c = Vector((x + dx, base.y + dy, 0.0165 * s))
            tr = []
            for zz, sc in ((-0.0165 * s, 0.6), (-0.006, 1.0), (0.008 * s, 0.75)):
                tr.append([bm.verts.new(c + Vector((0.0125 * s * sc * math.cos(2 * math.pi * i / 6), 0.018 * s * sc * math.sin(2 * math.pi * i / 6), zz)))
                           for i in range(6)])
            top_v = bm.verts.new(c + Vector((0, 0.002, 0.0165 * s)))
            faces += loft(bm, tr + [top_v], mat=BODY)
            faces.append(cap(bm, list(reversed(tr[0])), BODY))
            cone(bm, c + Vector((0, -0.014 * s, -0.004)), Vector((0, -1, -0.55)), 0.016 * s, 0.0045, n=4, mat=NOSE)
    uv_faces(bm, faces, [(x, base.y + 0.06, 0.03), (x, base.y - 0.09, 0.02)], 0.04)


# ---- 頂点色 (make_part の color_for2 が部品の名前の頭で選ぶ)。テクスチャで暗くなった分は fur_gain で戻す
# (灰狼の 4 回目の見直しで追加) 淡い灰茶の上の境 (y, z)。基準画の正面は目尻の下の頬から鼻の脇へ下がる V (元は -0.63 で 0.606、鼻先で 0.557)
PALE_Z = [(-0.46, 0.555), (-0.56, 0.600), (-0.66, 0.640), (-0.72, 0.622), (-0.84, 0.572)]


def col_head2(part, co, n):
    y, z = co.y, co.z
    c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.35, 0.85, n.z) * 0.85)
    c = mix(c, PAL["fur_shade"], smoothstep(-0.1, -0.6, n.z) * 0.4)
    # 淡い灰茶: 鼻づらの下半分・頬・喉 (目の下から鼻先へ下がる境、基準画)
    zm = interp([(-0.46, 0.555), (-0.56, 0.590), (-0.63, 0.606), (-0.88, 0.557)], y)
    zm = interp(PALE_Z, y)  # (灰狼の 4 回目の見直しで追加) 目の下の頬まで灰茶に (PALE_Z)
    c = mix(c, PAL["pale"], smoothstep(zm + 0.010, zm - 0.012, z))
    # 目の周りの暗い隈と、目頭から前下への涙の線
    e = Vector((math.copysign(EYE2.x, co.x), EYE2.y, EYE2.z))
    c = mix(c, PAL["mask"], smoothstep(0.042, 0.020, (co - e).length) * 0.85 * MASK_K)
    a, b = e + Vector((0, -0.018, -0.008)), e + Vector((-math.copysign(0.012, co.x), -0.048, -0.040))
    c = mix(c, PAL["mask"], smoothstep(0.010, 0.004, seg_dist(co, a, b)) * 0.7 * TEAR_K)
    # (灰狼の 4 回目で追加) 灰の隈: 目の長軸 (目頭の前下と目尻の後ろ上) に長い菱形。目頭の前下と目尻の後ろへ尖らせる
    du_ = Vector((0, -1, -0.33)).normalized()
    du_ = Vector((math.copysign(EYE3_U.x, co.x), EYE3_U.y, EYE3_U.z)).normalized()  # (灰狼の 4 回目の見直しで追加) 目の長軸に合わせる
    q = co - e
    a_ = q.dot(du_)
    b_ = q.z - du_.z * a_
    dd = abs(a_) / 0.050 + abs(b_) / 0.024  # 菱形 (L1) の距離
    dd = abs(a_) / 0.046 + (q - du_ * a_).length / 0.022  # (灰狼の 4 回目の見直しで追加) 長軸からの距離を 3 次元で (前を向く面でも幅が潰れない)
    c = mix(c, PAL["patch"], smoothstep(1.0, 0.7, dd) * PATCH_K)
    # 鼻筋の稜は明るく、両脇の面は陰 (正面で鼻筋が通って見える)
    if y < -0.70 and n.z > 0.2:
        ridge = smoothstep(0.012, 0.0, abs(co.x))
        c = mix(c, PAL["fur_top"], ridge * 0.6)
        c = mix(c, PAL["fur_shade"], smoothstep(0.015, 0.035, abs(co.x)) * smoothstep(0.3, 0.8, abs(n.x)) * 0.35)
    # (灰狼の 4 回目の見直しで追加) 基準画の正面の貌: 額から鼻先へ中心の幅 3〜4 cm を明るく通し (鼻筋)、鼻づらの外を向く斜めの脇の面と
    # 目の下の頬を灰茶へ (正面で鼻筋の両脇から頬へ V の灰)。目頭から鼻づらの脇を前下へ細い暗い涙の線
    c = mix(c, PAL["fur_top"], smoothstep(0.022, 0.010, abs(co.x)) * smoothstep(-0.62, -0.68, y) * smoothstep(-0.1, 0.4, n.z) * 0.6)
    c = mix(c, PAL["pale"], smoothstep(0.25, 0.7, abs(n.x)) * smoothstep(-0.705, -0.735, y) * smoothstep(0.0, 0.3, n.z + 0.3) * 0.75)
    ta, tb = e + Vector((math.copysign(TEAR2[0].x, co.x), TEAR2[0].y, TEAR2[0].z)), e + Vector((math.copysign(TEAR2[1].x, co.x), TEAR2[1].y, TEAR2[1].z))
    c = mix(c, PAL["patch"], smoothstep(TEAR2[2], TEAR2[2] * 0.4, seg_dist(co, ta, tb)) * TEAR2[3])
    # 唇 (口の縁の黒) と口の中
    if y < MOUTH_Y + 0.004:
        xl, zl = lip_at(y)
        c = mix(c, PAL["lip"], smoothstep(LIP_W, 0.0035, z - zl))
    return c


def col_jaw2(part, co, n):
    xl, zl = jaw_at(co.y)
    c = mix(PAL["pale"], PAL["fur"], smoothstep(-0.6, 0.3, n.z) * 0.35)
    c = mix(c, PAL["lip"], smoothstep(0.005, 0.002, zl - co.z))  # (灰狼の 4 回目で変更: 下唇の黒い帯を 9 → 5 mm。元は smoothstep(0.009, 0.003, zl - co.z))
    if n.z > 0.5 and abs(co.x) < xl - 0.004:
        c = PAL["mouth"]
    return c


def col_leg2(part, co, n):
    side = 1 if co.x > 0 else -1
    c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.2, 0.8, n.z) * 0.7)
    c = mix(c, PAL["fur_shade"], smoothstep(0.3, 0.9, n.y) * smoothstep(0.35, 0.6, co.z) * 0.6)
    c = mix(c, PAL["pale"], smoothstep(0.2, 0.8, -n.x * side) * smoothstep(0.3, 0.5, co.z) * 0.5)
    zd = LEG_DARK_Z["fl" if "fl_" in part else "hl"]
    c = mix(c, PAL["dark"], smoothstep(zd + 0.10, zd - 0.03, co.z))
    return mix(c, mix(PAL["dark"], PAL["fur"], 0.25), smoothstep(0.5, 0.95, n.z) * smoothstep(zd, zd - 0.1, co.z) * 0.5)


def col_paw2(part, co, n):
    return mix(PAL["dark"], mix(PAL["dark"], PAL["fur"], 0.3), smoothstep(0.3, 0.9, n.z) * 0.6)


def col_tail2(part, co, n):
    c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.3, 0.9, n.z) * 0.6)
    c = mix(c, PAL["fur_shade"], smoothstep(0.1, -0.4, n.z) * 0.5)
    c = mix(c, PAL["pale"], smoothstep(-0.2, -0.8, n.z) * 0.45)
    return mix(c, PAL["dark"], smoothstep(0.50, 0.60, co.y) * 0.75)  # 尾の先は焦げ茶 (狼。狐の白い先にしない)


def col_ruff(part, co, n):
    """(灰狼の 4 回目で追加) 首の飾り毛: 項と肩の上は毛の色、横は明るい面、喉と胸は淡い灰茶。面の向きで明暗"""
    c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.2, 0.8, n.z) * 0.8)
    c = mix(c, PAL["fur_shade"], smoothstep(0.0, -0.5, n.z) * 0.4)
    return mix(c, PAL["pale"], smoothstep(0.62, 0.50, co.z) * 0.9)


COLOR2 = {"ruff": col_ruff, "head2": col_head2, "jaw2": col_jaw2, "leg2": col_leg2, "paw2": col_paw2, "tail2": col_tail2}


def col_neck2(part, co, n):
    """(灰狼の 4 回目の見直しで追加) 首を胴と同じ面の向きの明暗で塗る (背の黄み・脇の陰)。元の首の塗り (color_for の "neck") は明暗が無く、
    首が胴から出る肩の前で胴の明暗と食い違い、交わる線がぎざぎざの境 (鋸の歯) に見えた。喉の淡い色は元のまま"""
    c = mix(PAL["fur"], PAL["fur_top"], smoothstep(0.3, 0.8, n.z) * 0.9)
    c = mix(c, PAL["fur_shade"], smoothstep(0.05, -0.4, n.z) * 0.8)
    return mix(c, PAL["pale"], smoothstep(0.2, -0.3, n.z) * smoothstep(0.66, 0.56, co.z))


def col_neck3(part, co, n):
    """(灰狼の 4 回目の見直しで追加) col_neck2 でも肩の前に喉の淡い色がぎざぎざに残った (首の横の下側が胴の外へ出る所)。
    首は胴と全く同じ式 (color_for の "body": 面の向きの明暗、腹の面と胸の前だけ淡い) で塗り、交わる線で色をそろえる"""
    return color_for("body", co, n)


COLOR2["neck"] = col_neck3


def col_leg3(part, co, n):
    """(灰狼の 4 回目の見直しで追加) 脚の付け根 (肩・腿の板の上、z 0.42 より上) は胴と同じ式へ移す。元の脚の塗りは後ろを向く面を陰にし
    内を向く面を淡くするので、胴から出る肩の前で色が食い違い、交わる線がぎざぎざの明るい面 (鋸の歯) に見えた"""
    return mix(col_leg2(part, co, n), color_for("body", co, n), smoothstep(0.40, 0.52, co.z))


COLOR2["leg2"] = col_leg3


def col_jaw3(part, co, n):
    """(灰狼の 4 回目の見直しで追加) 下顎の先を唇の高さへ上げたので、先 (y < -0.812) の口の床が正面から覗き、鼻の下に赤い点に見えた。
    先の口の床は唇の黒にする"""
    c = col_jaw2(part, co, n)
    return PAL["lip"] if co.y < -0.812 and c == PAL["mouth"] else c


COLOR2["jaw2"] = col_jaw3


def make_strokes():
    """(灰狼の 3 回目で追加) 絵の筆の塗り: 体の横から見た (y, z) の太い筆の跡。毛並みの向き (後ろ下へ、脚は下へ) に長く、幅 5〜9 cm。
    明るい跡 (背の面の色・房の先の色へ) と暗い跡 (陰の赤みへ) を交互に。乱数の種は固定"""
    import random
    rng = random.Random(11)
    out = []
    for side in (-1, 1):
        # 胴・首: 肩から尻へ、背から腹へ 3 段
        for i in range(STROKE_N):
            y = rng.uniform(-0.50, 0.36)
            top = interp([(k[0], k[1]) for k in BODY_KEYS], max(-0.44, min(0.36, y)))
            bot = interp([(k[0], k[2]) for k in BODY_KEYS], max(-0.44, min(0.36, y)))
            z = rng.uniform(bot + 0.06, top + 0.02)
            ang_ = math.radians(rng.uniform(-38, -12))  # 後ろ (+y) へ下る
            L = rng.uniform(*STROKE_L)
            W = rng.uniform(*STROKE_W)
            out.append((side, "body", Vector((0, y, z)), Vector((0, math.cos(ang_), math.sin(ang_))), L, W, 1 if i % 2 == 0 else -1))
        # 脚: 腿・肩から下へ 2 本ずつ
        for pre in ("fl", "hl"):
            top = joint(f"{pre}_{'L' if side < 0 else 'R'}", 0)
            for k in range(2):
                y = top.y + rng.uniform(-0.05, 0.05)
                out.append((side, "leg", Vector((0, y, top.z - 0.02)), Vector((0, rng.uniform(-0.25, 0.25), -1)).normalized(),
                            rng.uniform(0.18, 0.28), rng.uniform(0.035, 0.05), 1 if k == 0 else -1))
        # 尾: 付け根から先へ 2 本
        for k in range(2):
            out.append((side, "tail", Vector((0, 0.33, 0.55 - 0.04 * k)), Vector((0, 0.62, -0.78)), 0.30, 0.04, 1 if k == 0 else -1))
    return out


STROKES = []
# (灰狼の 4 回目で追加) 3 回目の筆の跡は細く多く、頂点の三角形の並びが見えて鋸の歯のように見えた。基準画の柔らかい大きな筆の塗りへ、
# 数を 40 → 16 本、幅 7〜12 → 14〜24 cm、長さ 16〜30 → 26〜46 cm にし、跡の縁を広くぼかし (STROKE_SOFT)、濃さを抑える (STROKE_K)
STROKE_N, STROKE_L, STROKE_W, STROKE_SOFT = 16, (0.26, 0.46), (0.14, 0.24), 0.0
STROKE_K = (0.42, 0.30)


def paint(part, co, n, c):
    """(灰狼の 3 回目で追加) 頂点色 c に STROKES の筆の跡を重ねる。顔の前 (目・鼻づら) には塗らない (穏やかな顔を保つ)"""
    if not STROKES:
        STROKES.extend(make_strokes())
    kind = "leg" if part.startswith("leg") else "tail" if part.startswith("tail") else "body"
    if part.startswith("head") and co.y < -0.60:
        return c
    side = 1 if co.x > 0 else -1
    p = Vector((0, co.y, co.z))
    for sd, k, a, d, L, W, tone in STROKES:
        if sd != side or (k != kind and not (kind == "body" and k == "body")):
            continue
        t = (p - a).dot(d) / L
        if t < -0.1 or t > 1.1:
            continue
        dist = (p - (a + d * (L * max(0.0, min(1.0, t))))).length
        w = W * (0.55 + 0.45 * math.sin(math.pi * max(0.0, min(1.0, t))))  # 筆の入りと抜きを細く
        k_ = smoothstep(w, w * STROKE_SOFT, dist) * (1 - smoothstep(0.75, 1.1, t)) * smoothstep(-0.1, 0.25, t)  # (灰狼の 4 回目で変更: 縁のぼかし 0.45 → STROKE_SOFT、入りと抜きを長く)
        if k_ <= 0:
            continue
        if tone > 0:
            c = mix(c, mix(PAL["fur_top"], PAL["tip"], 0.5), k_ * STROKE_K[0])  # (灰狼の 4 回目で変更: 0.8 → STROKE_K)
        else:
            c = mix(c, mix(PAL["fur_shade"], PAL["mask"], 0.3), k_ * STROKE_K[1])  # (灰狼の 4 回目で変更: 0.5 → STROKE_K)
    return c


def color_for2(part, co, n):
    """(灰狼の作り直しで追加) 新しい部品の頂点色。元の部品の名前は color_for へ。毛の色 (白でないもの) は fur_gain で明るく戻す"""
    fn = COLOR2.get(part.split("_")[0])
    c = fn(part, co, n) if fn else color_for(part, co, n)
    # (灰狼の 3 回目で追加) 毛の部品 (胴・首・頭・脚・尾) には筆の塗りを重ねる
    if c != WHITE and part.split("_")[0] in ("body", "neck", "head2", "leg2", "tail2", "ruff"):
        c = paint(part, co, n, c)
    return c if c == WHITE else fur_gain(c)


def head2_weights(co):
    wn = smoothstep(-0.53, -0.47, co.y) * 0.5  # 後頭部は首へ少し
    out = [("head", 1.0 - wn)]
    if wn > 0.02:
        out.append(("neck2", wn))
    s = sum(w for _, w in out)
    return [(b, w / s) for b, w in out]


def make_part(name, bm, part, cands, mats, recalc=True, smooth=True, sharp=None):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if smooth:
        for f in bm.faces:
            f.smooth = True
    # (灰狼の作り直しで追加) どの部品も UV の層 UVMap を持たせる (join で層がそろう。UV の無い部品 (光・歯) は 0)
    bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    # (灰狼の 3 回目で追加) 房の法線 (tnrm) があれば、頂点の法線と TUFT_NRM の割合で混ぜて自前の法線にする
    tl = bm.verts.layers.float_vector.get("tnrm")
    custom = None
    if tl is not None:
        bm.verts.index_update()
        custom = [(v.normal.lerp(Vector(v[tl]), TUFT_NRM) if Vector(v[tl]).length > 0.5 else v.normal).normalized() for v in bm.verts]
    bm.to_mesh(me)
    bm.free()
    if custom is not None:
        me.normals_split_custom_set_from_vertices([tuple(c) for c in custom])
    if not FUR_TEXTURE:  # (灰狼の 3 回目で追加) テクスチャを使わないので UV は書き出さない
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
    # (灰狼の作り直しで追加) sharp (度) より折れた辺を硬い辺にする (眉の稜・口の縁・耳の縁を立てる。曲面はなめらかなまま)
    if sharp is not None:
        me.set_sharp_from_angle(angle=math.radians(sharp))
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # (灰狼の作り直しで変更: 部品が頂点色の層を持って来たら (毛の房・耳) それを使い、塗り直さない。色は color_for2 (新しい部品と fur_gain) で塗る。
    #  元は col = me.color_attributes.new(...) と c = color_for(part, v.co, v.normal) を毎回)
    preset = me.color_attributes.get("Col")
    col = preset or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    groups = {}
    for v in me.vertices:
        if not preset:
            c = color_for2(part, v.co, v.normal)
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


# (灰狼の作り直しで追加) 作り直した部品で組む LOD。build_lod と同じ並び (胴・首・頭・尾・耳・目・脚・足 → 継ぎ目・稜線・毛の房) で、
# 頭は上の顎 (build_head2)・下顎 (build_jaw2)・歯・鼻・目・眉と頬の光に、背の棘は前の面が光る毛の房に、飾り毛は部位ごとの毛の房にした
HERO.update(head2=22, jaw2=10, body=(15, 18))
def densify(bm, lod):
    """(灰狼の 3 回目で追加) 近 LOD の胴と首の辺を 1 回ずつ割る (形は変えない)。筆の塗り (STROKES) を頂点色で細かく受けるため
    (脚・尾も割ると近 LOD が 10,255 三角形になり予算を超えるので、胴・首だけ)"""
    if lod["name"] == "hero":
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)


HERO.update(body=(12, 18))  # (灰狼の 3 回目で追加) 胴は densify で割るので、断面を 15 → 12 に減らして三角形を返す
FACET = 28  # (灰狼の 3 回目で追加) 胴・脚の面を立てる角 (度)。基準画の絵の大きな面 (背・脇・腹、肩・腿の板) を硬い辺で区切る
LOD1.update(head2=8, jaw2=4)


def leg_tuft_weights(pre):
    def f(co):
        bones = LEG_BONES[f"{pre}_{'L' if co.x < 0 else 'R'}"]
        return weights_for(co, [(bones[0], 1.0), (bones[1], 1.0), ("chest" if pre == "fl" else "pelvis", 0.4)])
    return f


TUFT_WEIGHTS = {
    "cheek": lambda co: weights_for(co, [("head", 1.0), ("neck2", 0.9)]),
    "mane": lambda co: weights_for(co, neck_cands(co)),
    "hackle": crest_weights,
    "chest": lambda co: weights_for(co, [("chest", 1.0), ("neck1", 0.6)]),
    "elbow": leg_tuft_weights("fl"),
    "thigh": leg_tuft_weights("hl"),
    "belly": lambda co: weights_for(co, body_cands(co)),
    "tail": lambda co: weights_for(co, [("tail1", 1), ("tail2", 1), ("tail3", 1), ("pelvis", 0.3)]),
}


def build_lod2(lod, obj_name, mats):
    hero = lod["name"] == "hero"
    parts = []
    shell_v, shell_f = [], []  # 継ぎ目の投影先 (胴・首・脚の付け根)
    top_v, top_f = [], []      # 稜線・背の毛の投影先 (胴・首・頭・尾)
    skin_v, skin_f = [], []    # 毛の房の根元を吸わせる面 (毛の部品すべて)

    def add(bm, *targets):
        bm.verts.index_update()
        for vv, ff in targets:
            o = len(vv)
            vv.extend(v.co.copy() for v in bm.verts)
            ff.extend([o + v.index for v in f.verts] for f in bm.faces)

    rigid_head = lambda co: [("head", 1.0)]  # noqa: E731
    bm = bmesh.new()
    build_body2(bm, lod)
    densify(bm, lod)
    add(bm, (shell_v, shell_f), (top_v, top_f), (skin_v, skin_f))
    parts.append(make_part(obj_name + "_body", bm, "body", lambda co: weights_for(co, body_cands(co)), mats, sharp=FACET))
    bm = bmesh.new()
    build_neck(bm, lod)
    densify(bm, lod)
    uv_faces(bm, bm.faces, [(0, -0.56, 0.60), (0, -0.45, 0.62), (0, -0.36, 0.645), (0, -0.27, 0.62)], 0.14)
    add(bm, (shell_v, shell_f), (top_v, top_f), (skin_v, skin_f))
    parts.append(make_part(obj_name + "_neck", bm, "neck", neck_cands(None), mats, sharp=FACET))  # (灰狼の 4 回目の見直しで変更: 胴と同じ角で面を立てる。元は sharp なし)
    bm = bmesh.new()  # (灰狼の 4 回目で追加) 首の飾り毛の殻
    build_ruff(bm, lod)
    add(bm, (skin_v, skin_f))  # (灰狼の 5 回目で追加) 頬・胸元の毛の塊を首の殻の外へ当てる
    parts.append(make_part(obj_name + "_ruff", bm, "ruff", lambda co: weights_for(co, neck_cands(co) + [("head", 0.6)]), mats, sharp=FACET))
    bm = bmesh.new()
    build_head2(bm, lod)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bvh_head = BVHTree.FromBMesh(bm)
    add(bm, (top_v, top_f), (skin_v, skin_f))
    parts.append(make_part(obj_name + "_head", bm, "head2", head2_weights, mats, sharp=34 if hero else None))
    bm = bmesh.new()
    build_jaw2(bm, lod)
    parts.append(make_part(obj_name + "_jaw", bm, "jaw2", lambda co: [("jaw", 1.0)], mats, sharp=50 if hero else None))
    bm = bmesh.new()
    build_nose2(bm, lod)
    parts.append(make_part(obj_name + "_nose", bm, "rigid", rigid_head, mats, sharp=60))
    if hero:
        bm = bmesh.new()
        build_teeth2(bm, lod, True)
        parts.append(make_part(obj_name + "_teeth_up", bm, "rigid", rigid_head, mats, recalc=False, smooth=False))
        bm = bmesh.new()
        build_teeth2(bm, lod, False)
        parts.append(make_part(obj_name + "_teeth_low", bm, "rigid", lambda co: [("jaw", 1.0)], mats, recalc=False, smooth=False))
    bm = bmesh.new()
    build_tail2(bm, lod)
    add(bm, (top_v, top_f), (skin_v, skin_f))
    parts.append(make_part(obj_name + "_tail", bm, "tail2", [("tail1", 1), ("tail2", 1), ("tail3", 1), ("pelvis", 0.3)], mats))
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        EAR_FRONT[f"ear_{s}"] = build_ears2(bm, lod, side)
        parts.append(make_part(f"{obj_name}_ear_{s}", bm, f"ear_{s}", [(f"ear_{s}", 1.0), ("head", 0.25)], mats, sharp=40 if hero else None))
        bm = bmesh.new()
        build_eye3(bm, bvh_head, lod, side)  # (灰狼の 4 回目で変更: 元は build_eye2)
        parts.append(make_part(f"{obj_name}_eye_{s}", bm, "rigid", rigid_head, mats, recalc=False))
        bm = bmesh.new()
        build_line2(bm, bvh_head, lod, side, BROW2, BROW2_W)  # (灰狼の 4 回目で変更: 幅 0.011 → 0.013) (灰狼の 4 回目の見直しで変更: 0.013 → BROW2_W)
        if hero:
            if CHEEK2_ON:  # (灰狼の 4 回目の見直しで追加)
                build_line2(bm, bvh_head, lod, side, CHEEK2, 0.007)  # (灰狼の 4 回目で変更: 幅 0.008 → 0.007。下瞼の線)
            build_line2(bm, bvh_head, lod, side, TEMPLE2, 0.008)  # (灰狼の 4 回目で追加) 目尻の上から耳へ
        parts.append(make_part(f"{obj_name}_brow_{s}", bm, "rigid", rigid_head, mats, recalc=False))
        for pre in ("fl", "hl"):
            name = f"{pre}_{s}"
            bones = LEG_BONES[name]
            parent = "chest" if pre == "fl" else "pelvis"
            bm = bmesh.new()
            build_leg(bm, lod, name)
            uv_faces(bm, bm.faces, [joint(name, i) for i in range(5)] + ([joint(name, 4) + Vector((0, -0.05, 0))] if not lod["paw"] else []), 0.05)
            add(bm, (shell_v, shell_f), (skin_v, skin_f))
            parts.append(make_part(f"{obj_name}_leg_{name}", bm, f"leg2_{name}", [(b, 1.0) for b in bones] + [(parent, 0.5)], mats, sharp=FACET))
            if lod["paw"]:
                bm = bmesh.new()
                build_paw2(bm, lod, name)
                parts.append(make_part(f"{obj_name}_paw_{name}", bm, "paw2", lambda co, b=bones[3]: [(b, 1.0)], mats, sharp=55))
    bvh = BVHTree.FromPolygons(shell_v, shell_f)
    bvh_top = BVHTree.FromPolygons(top_v, top_f)
    bvh_skin = BVHTree.FromPolygons(skin_v, skin_f)
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        for path in SEAMS:
            build_ribbon(bm, bvh, lod, path, side)
        parts.append(make_part(f"{obj_name}_seams_{s}", bm, "rigid", lambda co: weights_for(co, body_cands(co) + [("neck1", 0.5)]), mats,
                               recalc=False))
    bm = bmesh.new()
    build_crest(bm, bvh_top, lod)
    parts.append(make_part(obj_name + "_crest", bm, "rigid", crest_weights, mats, recalc=False))
    regions = ["cheek", "mane", "hackle", "chest", "thigh", "belly", "tail"] + (["elbow"] if hero else [])
    # (灰狼の 4 回目で変更: 首・頬・胸・尾ほかの立った房をやめ、背の逆立つ毛 (光る) だけ残す。首の飾り毛は胴の輪郭の一部 (build_ruff) で作る)
    regions = ["hackle"]
    # (灰狼の 5 回目で追加) 頬・胸元の太い毛の塊 (CHUNKS)
    for region in CHUNK_REGIONS:
        bm = bmesh.new()
        build_chunks(bm, bvh_skin, lod, region)
        parts.append(make_part(f"{obj_name}_chunk_{region}", bm, "chunk", CHUNK_WEIGHTS[region], mats, sharp=CHUNK_SHARP))
    for region in regions:
        bm = bmesh.new()
        tufts_region(bm, bvh_top if region == "hackle" else bvh_skin, lod, region)
        if not bm.faces:
            bm.free()
            continue
        parts.append(make_part(f"{obj_name}_tuft_{region}", bm, "tuft", TUFT_WEIGHTS[region], mats, recalc=False))

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
# (灰狼の作り直しで追加) 足を指と爪のある形 (build_paw2) にしたので、指の底と爪の先を足した目安の点に替える
PAW_PTS = [(0.058, -0.005), (0.045, -0.035), (-0.035, -0.035), (-0.090, -0.035), (-0.110, -0.031), (-0.100, -0.020)]


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
    b["jaw"] = rot_basis(D(7) + D(1.5) * math.sin(ph))  # (灰狼の作り直しで追加) 忍び寄りは口を少し開けて牙と歯を見せる
    b["jaw"] = rot_basis(D(2) + D(0.8) * math.sin(ph))  # (灰狼の 3 回目で変更: 忍び寄りは口をわずかに開けるだけ (歯を剥かない))
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
    b["jaw"] = rot_basis(D(10) + D(3) * math.sin(2 * ph))  # (灰狼の作り直しで追加) 走るときは口を開けて息をする
    b["jaw"] = rot_basis(D(7) + D(2) * math.sin(2 * ph))  # (灰狼の 3 回目で変更: 息の口を 10° → 7°)
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
    b["jaw"] = rot_basis(D(32) * ease(0.4, 0.55, t) * (1 - ease(0.62, 0.8, t)) + D(6) * crouch)  # (灰狼の作り直しで変更: 顎を 26° → 32°、溜めで少し開く)
    b["jaw"] = rot_basis(D(22) * ease(0.4, 0.55, t) * (1 - ease(0.62, 0.8, t)))  # (灰狼の 3 回目で変更: 飛びかかりの顎を 32° → 22°、溜めでは開かない)
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
    # (灰狼の作り直しで変更: 作り直した部品で組む build_lod2 に。元は build_lod(HERO, "wolf", mats), build_lod(LOD1, "wolf_lod1", mats))
    meshes = [build_lod2(HERO, "wolf", mats), build_lod2(LOD1, "wolf_lod1", mats)]
    for ob in meshes:
        # アーマチュアの子にしない (glTF ではスキンのメッシュをルートに置く。親の変換はスキンに効かないため)
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f"mesh {ob.name}: {len(ob.data.vertices)} verts / {tris} tris, groups {len(ob.vertex_groups)}")
    if os.environ.get("WOLF_FAST"):  # (灰狼の作り直しで追加) 形の確かめ: アニメ・遠い段・GLB を飛ばして .blend だけ書く
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT_DIR, "wolf.blend")))
        return
    bake_actions(rig, meshes[0])  # (M22-05 残りの手直しで変更: 接地を合わせるため近 LOD を渡す。元は bake_actions(rig))
    build_far(meshes[1], "wolf_far", rig, far_ratio)  # (M23-08) 遠い段
    scene.frame_set(0)
    for o in scene.objects:
        o.select_set(True)
    blend = os.path.abspath(os.path.join(OUT_DIR, "wolf.blend"))
    glb = os.path.abspath(os.path.join(OUT_DIR, "wolf.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_animation_mode="ACTIONS",
                              export_force_sampling=True, export_frame_step=1, export_skins=True, export_influence_nb=4,
                              export_vertex_color="ACTIVE", export_yup=True, export_apply=False, export_def_bones=False,
                              export_optimize_animation_size=True, export_anim_slide_to_zero=True, export_rest_position_armature=True,
                              export_image_format="JPEG", export_jpeg_quality=88)  # (灰狼の作り直しで追加) 毛皮のテクスチャは JPEG で埋め込む
    print("saved", blend)
    print("saved", glb)


main()
