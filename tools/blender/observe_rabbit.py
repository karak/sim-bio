"""観察画面 (M22) の土兎: 月鹿 (observe_deer.py) と同じ作り方で、Switch 世代の 3D ポケモン程度の密度の兎を組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_rabbit.py -- assets/models/observe
  (末尾に --parts を付けると、部品ごとの三角形数を出す)
出力: <out_dir>/rabbit.glb と rabbit.blend
  - メッシュ `rabbit` (近 LOD、~1,500 三角形)、`rabbit_lod1` (群れ LOD、~500)。どちらも同じアーマチュア `rabbit_rig` (骨 24) にスキン
  - (M23-08) メッシュ `rabbit_far` (遠い段、~80 三角形): 群れ LOD を島ごとに削った形 (creature_far.py)。耳は多く残し、光る紋は除く。描画は切ってある (hide_render)
  - アクション idle (4 s)・hop (0.5 s)・run (0.35 s)・graze (4 s)・alert (3 s)・fall (1.5 s、ループしない)。30 fps、その場 (root は動かさない)
  - 材質 rabbit_body (頂点色で地・腹の影・鼻づら・六角の縁取りの暗い青緑) / rabbit_ear (耳の内側と先の焦げ茶) / rabbit_nose / rabbit_glow (発光 #8FF5E6: 目・六角の紋・継ぎ目)
基準画: assets/textures/board/creatures/rabbit.png (承認済み: 四方図・採食・立ち上がり)。造形の元は assets/textures/concept/rabbit-angular.png。
検証: tools/blender/observe_creature_render.py で基準画と同じ向きを撮り、observe_creature_sheet.py で docs/design/qa/observe/ に並べる。

寸法: 単位 m、Blender では Z up・正面 -Y (glTF では Y up・正面 +Z)。座った頭頂 0.35 m、耳の先 ~0.55 m、鼻先から尾の先 ~0.47 m。
原点は前足と後ろ足の間の地面。基準画の側面 (creatures/rabbit.png 左上) を 0.00141 m/px で測った。
作り方 (月鹿と同じ):
  - 胴・首・頭・脚・腿・耳は断面リングのロフト (Catmull-Rom で断面を補間して丸める)。スムーズシェード。LOD は断面数と周方向の頂点数だけを変える
  - 六角の紋・継ぎ目・首輪は胴の殻 (胴・首・腿) の表面に貼るデカール。近 LOD は暗い青緑の縁取り (rabbit_body の頂点色) の上に発光を重ね、群れ LOD は発光だけ
  - スキンの重みは部品ごとに候補の骨を決め、骨の線分までの距離の逆 4 乗で配る (上位 3 本)。デカールは貼った先の面の部品の重みをそのまま使う
  - 脚のアニメは 2D の解析 IK (肩・股関節から手首・踵まで)。足先は立脚中は地面に固定する
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc  # (土兎の手直しで追加) 付け根の継ぎ目を消す Blend

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


# 基準画 (creatures/rabbit.png) の塗りから拾った代表色 (sRGB)
PAL = {k: lin(v) for k, v in {
    "fur": "#CBA468",       # 砂色の地
    "fur_dark": "#A98452",  # 腹の下・脚の内側のわずかに濃い面
    # (M22-05 残りの手直しで追加) 面ごとの明暗の幅 (基準画の明るい面 #DFBE80・陰 #977651 から)。上を向く面は明るく、下・奥を向く面と
    # 腿の前の縁・頬の下の境は陰にして、平たく見えた陰影に幅を持たせる
    "fur_lit": "#DDBB7A",
    "fur_shade": "#8E7049",
    "light": "#E0C38C",     # 鼻づら・顎の下・耳の背・尾
    "teal": "#3F7C73",      # 六角の縁取り・首輪・継ぎ目の下地 (暗い青緑)
    "ear": "#5E3D2D",       # 耳の内側と先 (焦げ茶)
    "nose": "#4A3027",
    "glow": "#8FF5E6",
}.items()}
WHITE = (1.0, 1.0, 1.0)
PAL["lid"] = lin("#6A4A32")  # (土兎の手直し 4 で追加) 瞼の線: 基準画の目の上の眉の陰 (地の陰 #8E7049 と耳の焦げ茶 #5E3D2D のあいだ)

BODY, EAR, NOSE, GLOW = range(4)
MAT_NAMES = ["rabbit_body", "rabbit_ear", "rabbit_nose", "rabbit_glow"]


def make_materials():
    mats = []
    for name in MAT_NAMES:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
        key = {"rabbit_body": "fur", "rabbit_ear": "ear", "rabbit_nose": "nose", "rabbit_glow": "glow"}[name]
        rgb = PAL[key]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        m.diffuse_color = (*rgb, 1)
        if name == "rabbit_body":
            # 地の濃淡と六角の縁取りの暗い青緑は頂点色 (COLOR_0) で持つ。Three.js 側は vertexColors で掛ける
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        if name == "rabbit_glow":
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = 1.0
        mats.append(m)
    return mats


# ---------------------------------------------------------------- 骨 (24 本)。rest の位置は形の寸法と共有する
EAR_BASE_X, EAR_BASE = 0.030, (-0.122, 0.330)
EAR_TIP_X, EAR_TIP = 0.090, (-0.058, 0.556)
EAR_MID = 0.46  # 耳の 1 本目の骨の長さ (付け根からの割合)
# (土兎の手直し 4 で追加) 審査台 r3-rabbit「前足を折ったときに胸にめりこむがもっと肩にあたるパーツが横に出るはず」。
# 前脚の付け根に肩 (肩甲・上腕) の塊 (build_shoulder) を胸の脇へ張り出させ、前脚をその下へ外へ出す (FL_X4)。折るときは肘を外へ開く (FL_SPLAY4)
SHOULDER4 = True
FL_X4 = 0.052  # 前脚の骨の横の位置 (元は 0.040)
# (土兎の手直し 5 で追加) 審査台 r4-rabbit「目の縁の茶色はいらない。また正面から見た時の顔の形が左右に膨らんで見える。
# 鼻部分を今の半分くらいまで削ってその分顔を水平に潰す方向で」。頭を組んだあと (目・鼻・口を載せる前) に頭の頂点を face5 で動かす:
# 鼻づら (FACE5_Y0 より前) の前への出を FACE5_K 倍に縮め、顔の横幅を後頭部 (FACE5_WY[0]) から顔 (FACE5_WY[1]) へ FACE5_W 倍まで詰める。
# 頭の色と重みの y のしきい値は元の頭の座標で読む (face5_y_inv)。瞼の線 (build_eye_lid) は付けない (LID5_OFF)
FACE5 = True
FACE5_Y0 = -0.10
FACE5_K = 0.6
FACE5_W = 0.85
FACE5_WY = (-0.095, -0.135)
FACE5_TIP_W, FACE5_TIP_Y = 0.65, (-0.165, -0.255)  # 鼻づらの横幅をさらに詰める割合 (元の y の範囲で 1 → FACE5_TIP_W)
FACE5_CHIN_W, FACE5_CHIN_Z = 0.80, (0.27, 0.235)  # 顔の下 (口と顎) の横幅をさらに詰める割合 (z の範囲で 1 → FACE5_CHIN_W)
LID5_OFF = True
EYE5_DIR = (0.86, -0.50, 0.10)  # 近 LOD の目を載せる向き (EYE4 の dir は (0.67, -0.73, 0.10))
EYE5_AXIS = (0, -1, -0.60)  # 目の長軸 (EYE4 の axis は (0, -1, -0.50))
EYE5_SCALE = 0.85  # 目の大きさ (EYE4 の形に対して。形の比と尖りはそのまま)


def face5_ramp(x, a, b):
    """(土兎の手直し 5 で追加) a → b で 0 → 1 のなめらかな段 (smoothstep と同じ。smoothstep より前に定義が要るため)"""
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def face5_y(y):
    """(土兎の手直し 5 で追加) 鼻づらの前後を縮める (FACE5_Y0 より後ろは動かさない)"""
    return FACE5_Y0 + (y - FACE5_Y0) * FACE5_K if FACE5 and y < FACE5_Y0 else y


def face5_y_inv(y):
    """(土兎の手直し 5 で追加) face5_y の逆 (動かした頭の頂点の y から元の y へ)"""
    return FACE5_Y0 + (y - FACE5_Y0) / FACE5_K if FACE5 and y < FACE5_Y0 else y


def face5(co):
    """(土兎の手直し 5 で追加) 頭の頂点を動かす: 鼻づらの前後を縮め、顔の横幅を詰める (元の y で詰める割合を決める)"""
    if not FACE5:
        return co
    t = face5_ramp(co[1], *FACE5_WY)
    m = min(1.0, max(0.0, (co[1] - FACE5_TIP_Y[0]) / (FACE5_TIP_Y[1] - FACE5_TIP_Y[0])))  # 鼻づらの先ほど細く (正面で顔の下半分が V に絞れる)
    c = face5_ramp(co[2], *FACE5_CHIN_Z) * t
    chin_w = 1.0 if FACE6 else FACE5_CHIN_W  # (土兎の手直し 6 で変更: 口と顎を詰めるのをやめる)
    w = (1.0 + (FACE5_W - 1.0) * t) * (1.0 + (FACE5_TIP_W - 1.0) * m) * (1.0 + (chin_w - 1.0) * c)
    return (co[0] * w, face5_y(co[1]), co[2])


# (土兎の手直し 6 で追加) 審査台 r5-rabbit「正面からのシルエットについて、間違った修正をしている。顔の上半分はよくなっている。
# 顔の下半分は、悪くなっている。頬がなくなり、首の中にめり込んでいるレベル。頬を膨らませて丸みを。」
# 手直し 5 の口と顎の詰め (FACE5_CHIN_W) をやめ、face5 のあとに頭の頂点を face6 で横へ膨らませる: 目の下 (FACE6_Z[0]) から
# 顎 (FACE6_Z[1]) へ横幅を 1 → 1 + FACE6_A 倍へなめらかに増やす (目より上の顔の上半分は動かさない)。後頭部 (FACE6_Y[0] より後ろ) も動かさない
FACE6 = True
FACE6_A = 0.65
FACE6_Z = (0.287, 0.240)
FACE6_Y = (-0.095, -0.120)


def face6(co):
    """(土兎の手直し 6 で追加) 頭の頂点の顔の下半分 (頬・口・顎) を横へ膨らませる (face5 のあとの座標で)"""
    if not FACE6:
        return co
    k = face5_ramp(co[2], *FACE6_Z) * face5_ramp(co[1], *FACE6_Y)
    return (co[0] * (1.0 + FACE6_A * k), co[1], co[2])


# (土兎の手直し 7 で追加) 審査台 r6-rabbit「はりすぎではない。むしろまだ頬と首が一部めり込んでいる。頬の頂点、顎、鼻頭のいちそのものは
# 違和感がないので、頬を丸くふくらませる and 口鼻全体を前方に伸ばし、そのうえで形を３方位からみたシルエットを整える」。
# (1) 頬を丸く: 近 LOD の頭の断面の顎の縁の角 (頬の張り → 顎の下の間) を外へ出して (FACE7_JAW)、頬の張りの下の面を内へ切れ込む斜面から
#     外へふくらむ面にする。頬の張りの 2 本の硬いエッジはなめらかにする (眉・鼻筋の角は硬いまま)。群れ LOD の断面も同じ向きへ (FACE7_JAW_LOD1)
# (2) 口鼻を前へ: face6 のあと、頬の頂点より前 (FACE7_Y0 より前) の頭の頂点の前への出を FACE7_K 倍に伸ばす (face7)。正面から見た
#     x・z は動かさないので、正面の頬の頂点・顎・鼻頭の位置はそのまま。伸ばし始めはなめらかに (FACE7_W の幅で傾きを 1 → FACE7_K)
# (1) で頬の下 (z 0.235〜0.26) の横幅が首の上の側面より片側 1.4〜2.2 cm 外へ出て、(2) で顎が首の前より前へ張り出す (首は変えていない)
FACE7 = True
FACE7_JAW = (0.70, 0.80, 0.30)  # 顎の縁の角 (横の割合、下の割合、下側の絞りの効き)。元は (0.64, 0.80, 0.5)
FACE7_JAW_LOD1 = (0.84, 0.72, 0.15)  # 群れ LOD の顎の縁の角。元は (0.66, 0.78, 0.5)
FACE7_FAR = 0.18  # 遠い段で頭の島を削る割合 (ほかは 0.2)
GRAZE7_NECK, GRAZE7_HEAD = 55, -42  # 採食の首の下げと頭の起こし (GRAZE5 の neck / head)
FACE7_SMOOTH = (5, 6, 10, 11)  # 硬いエッジから外す頬の張りの角 (HEAD_SHARP_EDGES の並び)
FACE7_Y0 = -0.140
FACE7_W = 0.020
FACE7_K = 1.45


def face7_dy(y):
    """(土兎の手直し 7 で追加) 頬の頂点より前の y を前へ伸ばす量 (傾きを FACE7_W の幅で 1 → FACE7_K へなめらかに上げる)"""
    s = FACE7_Y0 - y
    if not FACE7 or s <= 0:
        return 0.0
    k = FACE7_K - 1.0
    if s < FACE7_W:
        t = s / FACE7_W
        return -k * FACE7_W * (t ** 3 - t ** 4 / 2)
    return -k * (FACE7_W / 2 + (s - FACE7_W))


def face7_y(y):
    """(土兎の手直し 7 で追加)"""
    return y + face7_dy(y)


def face7_y_inv(y):
    """(土兎の手直し 7 で追加) face7_y の逆 (二分法。face7_y は単調に増える)"""
    if not FACE7 or y >= FACE7_Y0:
        return y
    lo, hi = y - 0.2, FACE7_Y0
    for _ in range(60):
        mid = (lo + hi) / 2
        if face7_y(mid) < y:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def face7(co):
    """(土兎の手直し 7 で追加) 口鼻を前へ伸ばす (face6 のあとの座標で。x・z は動かさない)"""
    if not FACE7:
        return co
    return (co[0], face7_y(co[1]), co[2])


def face_y_inv(y):
    """(土兎の手直し 7 で追加) 動かした頭の y から元の頭の y へ (face7 → face5 の順に戻す)"""
    return face5_y_inv(face7_y_inv(y))


BONES = {
    "root": ((0, 0, 0), (0, -0.1, 0), None),
    "pelvis": ((0, 0.11, 0.14), (0, 0.02, 0.17), "root"),
    "spine": ((0, 0.02, 0.17), (0, -0.07, 0.18), "pelvis"),
    "chest": ((0, -0.07, 0.18), (0, -0.13, 0.19), "spine"),
    "neck": ((0, -0.125, 0.20), (0, -0.14, 0.265), "chest"),
    "head": ((0, -0.14, 0.285), (0, -0.235, 0.262), "neck"),
    "nose": ((0, -0.225, 0.254), (0, -0.262, 0.252), "head"),
    "tail": ((0, 0.165, 0.11), (0, 0.20, 0.16), "pelvis"),
}
for s, sx in (("L", -1), ("R", 1)):
    base = Vector((sx * EAR_BASE_X, *EAR_BASE))
    tip = Vector((sx * EAR_TIP_X, *EAR_TIP))
    mid = base + (tip - base) * EAR_MID
    BONES[f"ear1_{s}"] = (tuple(base), tuple(mid), "head")
    BONES[f"ear2_{s}"] = (tuple(mid), tuple(tip), f"ear1_{s}")
    fx, hx = sx * 0.040, sx * 0.072
    if SHOULDER4:  # (土兎の手直し 4 で追加) 前脚を肩の塊の下へ外へ出す
        fx = sx * FL_X4
    # 前脚: 肩 → 肘 → 手首 → 指先
    fl = [(fx, -0.115, 0.165), (fx, -0.105, 0.085), (fx, -0.125, 0.022), (fx, -0.172, 0.010)]
    # 後脚: 股関節 → 膝 (前下) → 踵 (後ろ下) → 指先 (前、足裏は地面)
    hl = [(hx, 0.085, 0.135), (hx, 0.030, 0.075), (hx, 0.135, 0.022), (hx, 0.000, 0.010)]
    for pre, pts, par, names in (("fl", fl, "chest", ("upper", "fore", "paw")), ("hl", hl, "pelvis", ("thigh", "shin", "foot"))):
        prev = par
        for i, nm in enumerate(names):
            bn = f"{pre}_{nm}_{s}"
            BONES[bn] = (pts[i], pts[i + 1], prev)
            prev = bn
if FACE5:  # (土兎の手直し 5 で追加) 頭の骨の先と鼻の骨を縮めた鼻づらへ
    for k in ("head", "nose"):
        h, t, p = BONES[k]
        BONES[k] = (face5(h) if k == "nose" else h, face5(t), p)
if FACE7:  # (土兎の手直し 7 で追加) 頭の骨の先と鼻の骨を伸ばした鼻づらへ
    for k in ("head", "nose"):
        h, t, p = BONES[k]
        BONES[k] = (face7(h) if k == "nose" else h, face7(t), p)
BONES = {k: (Vector(h), Vector(t), p) for k, (h, t, p) in BONES.items()}
LEG_BONES = {f"{pre}_{s}": [f"{pre}_{nm}_{s}" for nm in names]
             for s in "LR" for pre, names in (("fl", ("upper", "fore", "paw")), ("hl", ("thigh", "shin", "foot")))}


def joint(name, i):
    """脚の関節 i (0 = 肩/股、3 = 指先) の rest 位置"""
    bones = LEG_BONES[name]
    return BONES[bones[i]][0] if i < 3 else BONES[bones[2]][1]


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
    """ux/uy 平面の超楕円リング。+uy 側の半径 ry_top、-uy 側 ry_bot、pinch で -uy 側の幅を絞る (胸・顎)"""
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


def facet_ring(bm, center, ux, uy, corners, pairs, bevel=0.2):
    """(M22-05 残りの手直しで追加) 面の立った断面のリング。corners は右半分 (ux >= 0) の角を上 (+uy) から下 (-uy) へ並べた (x, y)。
    pairs[i] が真の角は 2 点 (両隣の辺へ bevel の割合だけ寄せる) にして、スムーズシェードでも面の中ほどを平らに、角を丸く読ませる。
    並びは ring() (phase = π/2) と同じ (上 → -ux の側 → 下 → +ux の側)"""
    pts = [corners[0]]
    for i in range(1, len(corners) - 1):
        c = Vector(corners[i])
        if pairs[i]:
            a, b = Vector(corners[i - 1]), Vector(corners[i + 1])
            pts += [tuple(c + (a - c) * bevel), tuple(c + (b - c) * bevel)]
        else:
            pts.append(tuple(c))
    pts.append(corners[-1])
    loop = [(-x, y) for x, y in pts] + [(x, y) for x, y in reversed(pts[1:-1])]
    return [bm.verts.new(center + ux * x + uy * y) for x, y in loop]


def loft(bm, rings, mat=BODY):
    """リング (または先端の 1 点) の列を面で繋ぐ"""
    faces = []
    for a, b in zip(rings, rings[1:]):
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
            f.material_index = mat
        faces += new
    return faces


def cap(bm, rng, mat=BODY):
    f = bm.faces.new(rng)
    f.material_index = mat
    return f


def frame_of(d):
    """進行方向 d に直交する (u, v)。u はなるべく水平 (X 寄り)"""
    u = (Z.cross(d) if abs(d.z) < 0.9 else X.cross(d)).normalized()
    if u.x < 0:
        u = -u
    v = d.cross(u).normalized()
    return u, v


# ---------------------------------------------------------------- LOD の密度
# hexes: 六角の紋のうち使うもの (None = 全部)。seams: 横の継ぎ目のうち使うもの
# (M22-05 残りの手直しで変更: 頭の周を 10 → 12 (面の立った断面)、胴の断面を 10 → 9。背の六角は蜂の巣 (comb) に置き換え、
#  comb_net で網目の暗い線を持つか、comb_glow で光る六角を入れる蜂の巣の目 (None = 全部) を選ぶ)
HERO = dict(name="hero", body=(9, 12), neck=(2, 10), head=(8, 12), ear=(6, 8), fleg=(6, 6), hleg=(5, 6), thigh=(5, 8),
            tail=(3, 6), eye=8, hex_ring=True, ribbon_seg=6, sq=2.15, hexes=None, seams=("back", "thigh", "shoulder"),
            comb_net=True, comb_glow=None)
def far_ratio(c, mats, n):
    """(M23-08) 遠い段で群れ LOD の島を削る割合 (creature_far.build_far)。光る紋と継ぎ目 (6 三角形ほどの小さな島) は除き、耳は 4 割、ほかは 2 割"""
    if "rabbit_glow" in mats:
        return 0.0
    if "rabbit_ear" in mats:
        return 0.4
    if FACE7 and c.y < -0.12 and c.z > 0.2:  # (土兎の手直し 7 で追加) 頭の形を変えて削った後の三角形が 2 つ増えたので、頭の島だけ少し多く削る
        return FACE7_FAR
    return 0.2


LOD1 = dict(name="lod1", body=(6, 8), neck=(2, 6), head=(5, 8), ear=(3, 4), fleg=(3, 4), hleg=(3, 4), thigh=(3, 6),
            tail=(2, 4), eye=4, hex_ring=False, ribbon_seg=3, sq=2.1, hexes={"chest": [0], "back": [0, 2], "top": [0]},
            seams=("back", "thigh"), comb_net=False, comb_glow=None)
HERO["mouth"] = True  # (土兎の手直しで追加) 鼻の下の口の線 (build_mouth) は近 LOD だけ
LOD1.update(mouth=True, mouth_w=0.0095)  # (土兎の手直し 3 で追加) 群れ LOD にも口 (2〜10 m で読めるよう太い線)
HERO["shoulder"], LOD1["shoulder"] = (5, 8), (3, 6)  # (土兎の手直し 4 で追加) 肩の塊 (build_shoulder) の断面数・周の頂点数
# (土兎の手直し 8 で追加) 群れ LOD の首が正面・斜めから柱に見えた (審査台 r7-rabbit「首の左右（扁桃腺あたり）に2本、首輪より外側に柱上の部位がある」)。
# 首の断面が 6 角 (左右が平らな面) で、首輪の帯 (8 区間) の弦が首の前の角の中へ潜って、首輪の端より外の首の平らな面が縦の柱に読めていた。
# 首の周を 6 → 8 頂点にして丸め、首輪を 8 → 12 区間にして首を回り込ませる (三角形 +8 / +8)。近 LOD (周 10・首輪 12 区間) は変えない
LOD1.update(neck=(2, 8), collar_seg=12)

# 胴 (尻 → 胸): (y, 背の高さ, 腹の高さ, 半幅, 腹側の絞り)。基準画の側面から (座った姿勢: 尻は地面すれすれ)
BODY_KEYS = [
    (0.182, 0.200, 0.080, 0.040, 0.0),
    (0.165, 0.228, 0.040, 0.078, 0.05),
    (0.130, 0.252, 0.028, 0.096, 0.10),
    (0.080, 0.266, 0.034, 0.102, 0.14),
    (0.020, 0.270, 0.046, 0.100, 0.20),
    (-0.040, 0.262, 0.060, 0.094, 0.26),
    # (M22-05 残りの手直しで変更: 立ち上がりで胴が細く見えたので、胸の前を広げた (半幅 0.086 / 0.076 / 0.062 / 0.040 →
    #  0.090 / 0.084 / 0.072 / 0.050))
    (-0.090, 0.250, 0.072, 0.090, 0.30),
    (-0.130, 0.238, 0.084, 0.084, 0.30),
    (-0.162, 0.222, 0.098, 0.072, 0.25),
    (-0.182, 0.205, 0.118, 0.050, 0.15),
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
    rear = bm.verts.new((0, secs[0][0] + 0.008, (secs[0][1] + secs[0][2]) / 2))
    front = bm.verts.new((0, secs[-1][0] - 0.008, (secs[-1][1] + secs[-1][2]) / 2))
    loft(bm, [rear] + rings + [front])


# 首: 胸の中から頭の下へ。(y, z, 横半径, 喉側, 背側)
NECK_KEYS = [(-0.105, 0.175, 0.066, 0.060, 0.060), (-0.128, 0.225, 0.064, 0.060, 0.056), (-0.142, 0.272, 0.058, 0.052, 0.050)]


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


# 頭 (後頭部 → 鼻先): (y, 中心 z, 横半径, 上, 下, 下側の絞り)。頭頂 0.35、顎の下 0.22、頬の幅 0.15
HEAD_KEYS = [
    (-0.078, 0.292, 0.030, 0.030, 0.030, 0.0),
    (-0.092, 0.292, 0.056, 0.052, 0.050, 0.10),
    (-0.118, 0.292, 0.070, 0.058, 0.062, 0.20),
    (-0.152, 0.288, 0.075, 0.060, 0.066, 0.30),
    # (M22-05 残りの手直しで変更: 頭が丸かったので、鼻づらを楔に (上の線を早く下げ、顎の線を鼻先へ上げる)。元は
    #  (-0.188, 0.278, 0.068, 0.056, 0.058, 0.38), (-0.218, 0.267, 0.052, 0.044, 0.046, 0.38), (-0.240, 0.259, 0.040, 0.034, 0.034, 0.30),
    #  (-0.255, 0.254, 0.027, 0.025, 0.024, 0.15))
    (-0.188, 0.279, 0.066, 0.059, 0.055, 0.40),
    (-0.218, 0.271, 0.050, 0.045, 0.043, 0.40),
    (-0.240, 0.265, 0.038, 0.031, 0.029, 0.32),
    (-0.255, 0.261, 0.026, 0.019, 0.019, 0.15),
]


def face7_jaw(jaw, spec, rx, rb, pinch, y):
    """(土兎の手直し 7 で追加) 顎の縁の角を spec (横の割合、下の割合、絞りの効き) の位置へ、頭の前 (元の y) ほど強く寄せる"""
    fx, fz, fp = spec
    w = smoothstep(-0.100, -0.140, y)
    new = (fx * rx * (1 - fp * pinch), -fz * rb)
    return (jaw[0] + (new[0] - jaw[0]) * w, jaw[1] + (new[1] - jaw[1]) * w)


def head_corners(rx, rt, rb, pinch, y=None):
    """(M22-05 残りの手直しで追加) 頭の断面の角 (右半分、上から下): 頭頂の平ら・額と頬の境・頬の張り (最も広い、目の下)・顎の縁・顎の下"""
    jaw = (0.66 * rx * (1 - 0.5 * pinch), -0.78 * rb)
    if FACE7 and y is not None:  # (土兎の手直し 7 で追加) 群れ LOD も顎の縁の角を外へ
        jaw = face7_jaw(jaw, FACE7_JAW_LOD1, rx, rb, pinch, y)
    return [(0.0, rt), (0.62 * rx, 0.86 * rt), (rx, -0.08 * rb), jaw, (0.0, -rb)]


# (土兎の手直し 3 で追加) 顔つきをシャープに (審査台 r2-rabbit「顔つきと目はもっとシャープなので、正面を見比べて忠実度をあげて」)。
# 基準画の正面・斜め前の顔は、平らな額の面が目のすぐ上の眉の角で横の面へ折れ、目は眉の下の横の面に収まる。頬は目の下で最も張り、
# 顎の縁で下の面へ折れる。鼻筋は額から鼻先へ細い平らな面で通る。断面の角: 鼻筋の縁・眉 (目の上)・頬の張り (目の下)・顎の縁
HEAD_SHARP = True
HEAD_SHARP_PAIRS = [False, True, True, True, False, False]
# 硬いエッジにする断面の頂点 (facet_ring の並び: 0 頭頂、1-2 / 15-14 鼻筋の縁、3-4 / 13-12 眉、5-6 / 11-10 頬の張り、7 / 9 顎の縁、8 顎の下)
HEAD_SHARP_EDGES = (1, 2, 14, 15, 3, 4, 12, 13, 5, 6, 10, 11)
HEAD_SHARP_Y = -0.105  # これより前 (鼻先の側) の断面のあいだだけ
HEAD_SHARP_MUZZLE = 0.5  # 鼻先の断面の下の半径を増やす割合。鼻の下を顎の下へ逃がさず前を向く面にし、上から見下ろしても口の線が見えるように


def head_corners_sharp(rx, rt, rb, pinch, y):
    """(土兎の手直し 3 で追加) 頭の断面の角 (右半分、上から下): 頭頂・鼻筋の縁 (額の面の縁)・眉・頬の張り・顎の縁・顎の下。
    鼻づら (y < -0.2) では鼻筋の縁を内へ寄せて細い鼻筋にする"""
    bridge = 0.50 - 0.16 * smoothstep(-0.17, -0.235, y)
    rb *= 1.0 + HEAD_SHARP_MUZZLE * smoothstep(-0.215, -0.25, y)  # 鼻の下の面 (口の載る面) を前へ立てる
    jaw = (0.64 * rx * (1 - 0.5 * pinch), -0.80 * rb)
    if FACE7:  # (土兎の手直し 7 で追加) 顎の縁の角を外へ出して、頬の張りの下を外へふくらむ面に (後頭部はそのまま)
        jaw = face7_jaw(jaw, FACE7_JAW, rx, rb, pinch, y)
    return [(0.0, rt), (bridge * rx, 0.97 * rt), (0.90 * rx, 0.56 * rt), (rx, -0.22 * rb),
            jaw, (0.0, -rb)]


def build_head(bm, lod):
    nsec, n = lod["head"]
    secs = resample(HEAD_KEYS, nsec)
    # (M22-05 残りの手直しで変更: 頭が丸く、頬の面が分かれていなかったので、超楕円 (sq=2.45) から面の立った断面 (head_corners) へ。
    #  近 LOD は額の縁と頬の張りの角を 2 点にして面を立てる (周 10 → 12)。元は
    #  ring(bm, Vector((0, y, zc)), X, Z, rx * 1.06, rt, rb, n, pinch, sq=2.45, phase=math.pi / 2))
    pairs = [False, True, True, False, False] if lod["name"] == "hero" else [False] * 5
    if lod["name"] == "hero" and HEAD_SHARP:
        # (土兎の手直し 3 で追加) 近 LOD は目の上の眉の角を足した断面 (head_corners_sharp)
        rings = [facet_ring(bm, Vector((0, y, zc)), X, Z, head_corners_sharp(rx * 1.08, rt, rb, pinch, y), HEAD_SHARP_PAIRS, bevel=0.16)
                 for y, zc, rx, rt, rb, pinch in secs]
    else:
        rings = [facet_ring(bm, Vector((0, y, zc)), X, Z, head_corners(rx * 1.08, rt, rb, pinch, y if FACE7 else None), pairs)
                 for y, zc, rx, rt, rb, pinch in secs]  # (土兎の手直し 7 で変更: 元の頭の y を渡す)
    back = bm.verts.new((0, secs[0][0] + 0.006, secs[0][1]))
    tip = bm.verts.new((0, secs[-1][0] - 0.007, secs[-1][1]))
    loft(bm, [back] + rings + [tip])
    if lod["name"] == "hero" and HEAD_SHARP:
        # (土兎の手直し 3 で追加) 顔 (耳の付け根より前) の眉と頬の張りの角は硬いエッジ (面の立った顔。後頭部はなめらかなまま)
        for (ya, ra), (yb, rb_) in zip(zip([s_[0] for s_ in secs], rings), zip([s_[0] for s_ in secs[1:]], rings[1:])):
            if max(ya, yb) > HEAD_SHARP_Y:
                continue
            for j in HEAD_SHARP_EDGES:
                if FACE7 and j in FACE7_SMOOTH:  # (土兎の手直し 7 で追加) 頬の張りの角はなめらかに (丸い頬)
                    continue
                e = bm.edges.get((ra[j], rb_[j]))
                if e is not None:
                    e.smooth = False


def ear_frame(side):
    base = Vector((side * EAR_BASE_X, *EAR_BASE))
    tip = Vector((side * EAR_TIP_X, *EAR_TIP))
    axis = (tip - base).normalized()
    front = Vector((side * 0.6, -1, 0.0))
    front = (front - axis * front.dot(axis)).normalized()  # 耳の内側 (正面やや外) の向き
    w = axis.cross(front).normalized()
    return base, tip, axis, front, w


EAR_FRONT = {}


def build_ear(bm, lod, side):
    """耳: 付け根から先へ幅の広い木の葉形。前面 (内側) を浅くくぼませる。
    内側は付け根の少し上から先まで焦げ茶 (rabbit_ear)、背は先の 3 割だけ焦げ茶"""
    nsec, n = lod["ear"]
    base, tip, axis, front, w = ear_frame(side)
    L = (tip - base).length
    base = base - axis * 0.02  # 付け根を頭へ埋める
    L += 0.02
    # (長さの割合, 半幅, 厚さ)
    keys = [(0.0, 0.022, 0.016), (0.15, 0.036, 0.014), (0.40, 0.048, 0.012), (0.64, 0.046, 0.010), (0.83, 0.034, 0.008),
            (0.95, 0.017, 0.005)]
    secs = resample(keys, nsec)
    # 近 LOD は縁のすぐ内側に頂点を寄せる (内側の焦げ茶の面を広く、地色の縁を細く)
    angs = [0, 40, 90, 140, 180, 204, 270, 336] if n == 8 else [360 * i / n for i in range(n)]
    if EAR_RIM:
        # (土兎の手直しで追加) 0° を外寄りの縁にそろえ、外寄りの細い地色の縁の境 (35°) に頂点を置く。内寄りの幅の広い楔は ear_pattern で切る
        if w.x * side < 0:
            w = -w
        if n == 8:
            angs = [0, 35, 90, 150, 180, 205, 270, 335]
        if EAR_FOLD and n == 8:  # (土兎の手直し 3 で追加) 近 LOD は内寄りの楔を折り返しの段 (形) にする
            build_ear_fold(bm, base, axis, front, w, L, keys, side)
            return front
    rings = []
    for t, wd, th in secs:
        c = base + axis * (L * t)
        vs = []
        for i in range(n):
            a = math.radians(angs[i])
            ca, sa = math.cos(a), math.sin(a)
            dz = th * sa * (0.25 if sa > 0 else 1.0)  # 前面 (sa > 0) を平らに近く、背を厚く
            dz -= th * 0.8 * max(0.0, sa) * (1 - abs(ca))  # 前面の中央をくぼませる
            vs.append(bm.verts.new(c + w * (wd * ca) + front * dz))
        rings.append(vs)
    tipv = bm.verts.new(base + axis * L)
    faces = loft(bm, rings + [tipv])
    cap(bm, list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if EAR_RIM:
        # (土兎の手直しで追加) 耳の模様を基準画の縁の出方へ: 下の inner_k の割り当ての代わりに ear_pattern で塗り分ける
        ear_pattern(bm, base, axis, front, w, L, secs, side, cut_back=n == 8)
        return front
    inner_k = {1, 2} if n == 8 else {0, 1}  # 前面の面 (近 LOD は縁の細い面を地色に残す)
    for idx, f in enumerate(faces):
        c = f.calc_center_median()
        t = (c - base).dot(axis) / L
        if (idx % n in inner_k and t > 0.2) or t > 0.76:
            f.material_index = EAR
    return front


# (土兎の手直しで追加) 耳の模様 (基準画 creatures/rabbit.png の正面・斜め前・側面、concept/rabbit-angular.png の寄りから):
# 前面 (内側) は焦げ茶だが、内寄り (顔の側) の縁に地色の幅の広い楔が付け根から立ち上がり、長さの 2/3 ほどで斜めに切れて尖る。
# その上は先まで縁いっぱいに焦げ茶。外寄りの縁は細い地色の縁 (幅の 1 割)。背は地色で、先の 1/4 ほどが焦げ茶、その境は内寄りほど低い斜め。
# 塗り分けの境は面の中心で選ぶと階段になるので、境の線を含む平面で耳を切って (bmesh.ops.bisect_plane) 真っ直ぐな縁にする
EAR_RIM = True
EAR_WEDGE = ((-1.0, 0.70), (0.42, 0.07))  # 楔の縁の線: 内寄りの縁の t = 0.66 から、外寄りへ 3 割の所の t = 0.07 へ ((横の位置 -1 = 内寄りの縁, t))
EAR_LAT_RIM = 0.80                        # 外寄りの縁の地色: 横の位置がこれより外の面 (前面の外寄りの角の頂点 35° の外側)
EAR_BACK_TIP = ((1.0, 0.79), (-1.0, 0.69))  # 背の先の焦げ茶の境: 外寄りの縁の t = 0.79 から内寄りの縁の t = 0.69 へ
EAR_TIP_ALL = 0.93                        # これより先は表裏とも焦げ茶


def ear_pattern(bm, base, axis, front, w, L, secs, side, cut_back=True):
    """(土兎の手直しで追加) 耳の塗り分け。w は外寄り (頭の外側) を向く横の向き、secs は (t, 半幅, 厚さ) の断面。
    cut_back=False (群れ LOD) は背の先の斜めの境で切らず、面の中心で選ぶ (三角形を節約。遠目には楔だけが読める)"""
    if w.x * side < 0:
        w = -w  # 横の位置 +1 を外寄りの縁にそろえる

    def half(t):
        for (t0, w0, _), (t1, w1, _) in zip(secs, secs[1:]):
            if t0 <= t <= t1:
                return w0 + (w1 - w0) * (t - t0) / (t1 - t0)
        return secs[0][1] if t < secs[0][0] else secs[-1][1]

    def pt(s, t):
        return base + axis * (L * t) + w * (half(t) * s)

    def cut(line):
        a, b = pt(*line[0]), pt(*line[1])
        no = (b - a).cross(front).normalized()  # 前後 (厚さ) の向きを含む平面で切る
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=a, plane_no=no, dist=1e-6)
        return a, no

    wa, wn = cut(EAR_WEDGE)
    ba, bn = cut(EAR_BACK_TIP) if cut_back else (pt(*EAR_BACK_TIP[0]), (pt(*EAR_BACK_TIP[0]) - pt(*EAR_BACK_TIP[1])).cross(front).normalized())
    tip_side = pt(0.0, 0.98)
    wsign = 1 if (tip_side - wa).dot(wn) > 0 else -1  # 楔の線の焦げ茶の側 (先と外寄りの側)
    bsign = 1 if (tip_side - ba).dot(bn) > 0 else -1
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        t = (c - base).dot(axis) / L
        s = (c - base).dot(w) / max(1e-4, half(min(max(t, 0.0), 0.95)))
        is_front = f.normal.dot(front) > 0.0
        if t > EAR_TIP_ALL:
            dark = True
        elif is_front:
            dark = (c - wa).dot(wn) * wsign > 0 and s < EAR_LAT_RIM
        else:
            dark = (c - ba).dot(bn) * bsign > 0
        f.material_index = EAR if dark else BODY


# (土兎の手直し 3 で追加) 耳の折り返しの段 (審査台 r2-rabbit「耳の模様」、基準画 creatures/rabbit.png の正面・斜め前、concept/rabbit-angular.png)。
# 基準画の内寄り (顔の側) の地色の楔は塗り分けではなく、耳の縁が前へ折り返した厚みの段に見える: 楔の面は前へ張り出して平らで、
# 楔の縁の線 (EAR_WEDGE) で焦げ茶のくぼんだ面へ段になって落ちる。近 LOD は耳の断面をこの段の形で組む (楔の縁の線に断面の頂点を置くので、
# 塗り分けの境と段の角が一致し、面の中心で選んでも階段にならない)。段の角 (楔の上の縁と段の下) は硬いエッジ。群れ LOD は前のまま (塗り分け)
EAR_FOLD = True
EAR_FOLD_H = 0.006  # 楔の面が前へ張り出す量 (m、耳の厚みの中心から)。段の高さはこれとくぼみの深さの和 (~1 cm)
EAR_FOLD_T = [0.0, 0.12, 0.25, 0.38, 0.51, 0.63, 0.70, 0.82, 0.95]  # 断面の位置 (長さの割合)。0.70 は楔の先 (EAR_WEDGE の内寄りの縁の t)
EAR_FOLD_EPS = 0.08  # 段の上の縁と下の縁の横の間 (横の位置の単位)。段の壁が少し斜めに立ち、地色の陰の細い帯に見える
EAR_WALL_SHADE = 0.85  # 段の壁の陰の濃さ (fur → fur_shade)


def build_ear_fold(bm, base, axis, front, w, L, keys, side):
    """(土兎の手直し 3 で追加) 近 LOD の耳: 断面は前面 7 点 (外寄りの縁・外寄りの細い地色の縁・くぼみ・段の下・段の上・楔の面・内寄りの縁) と
    背 3 点。w は外寄りを向く横の向き (横の位置 +1 = 外寄りの縁、-1 = 内寄りの縁)。材質は作るときに帯ごとに決め、背の先の斜めの境だけ
    ear_pattern と同じく平面で切って塗り分ける"""
    dense = resample(keys, 41)

    def prof(t):
        for (t0, w0, h0), (t1, w1, h1) in zip(dense, dense[1:]):
            if t0 <= t <= t1:
                k = (t - t0) / max(1e-9, t1 - t0)
                return w0 + (w1 - w0) * k, h0 + (h1 - h0) * k
        return dense[-1][1], dense[-1][2]

    (s0, t0), (s1, t1) = EAR_WEDGE
    t_end = t0 if s0 < s1 else t1  # 楔の先 (内寄りの縁に届く t)

    def edge_s(t):
        """楔の縁の線の横の位置 (t で線形)。付け根では外寄りのくぼみの幅を残して止める"""
        return min(0.55, s0 + (s1 - s0) * (t - t0) / (t1 - t0))

    zone = bm.faces.layers.int.new("ear_zone")  # 1 = 前面 (作るときの材質のまま)、0 = 背 (先の斜めの境で塗り分ける)
    wall = bm.faces.layers.int.new("ear_wall")  # 1 = 段の壁 (make_part が地色の陰で塗り、属性を消す)
    rings, folded = [], []
    for t in EAR_FOLD_T:
        wd, th = prof(t)
        if t < t_end - 1e-6:
            sb = edge_s(t)
            hf = EAR_FOLD_H * smoothstep(0.0, 0.25, sb + 1.0)
            s4 = sb - EAR_FOLD_EPS
            s5 = s4 - 0.45 * (s4 + 1.0)
            front_pts = [(1.0, 0.0), (0.80, 0.10 * th), ((0.80 + sb) / 2, -0.55 * th), (sb, -0.45 * th),
                         (s4, hf), (s5, hf), (-1.0, 0.6 * hf)]
            folded.append(True)
        else:  # 楔の先より上: 段は無く、縁いっぱいまで焦げ茶のくぼみ (段の頂点は内寄りの縁へ寄せて細く残す)
            front_pts = [(1.0, 0.0), (0.80, 0.10 * th), (-0.10, -0.55 * th), (-0.88, -0.25 * th), (-0.92, -0.12 * th),
                         (-0.96, -0.04 * th), (-1.0, 0.0)]
            folded.append(False)
        back_pts = [(math.cos(math.radians(a)), th * math.sin(math.radians(a))) for a in (205, 270, 335)]
        c = base + axis * (L * t)
        rings.append([bm.verts.new(c + w * (wd * s) + front * dz) for s, dz in front_pts + back_pts])
    tipv = bm.verts.new(base + axis * L)
    faces = loft(bm, rings + [tipv])
    n = len(rings[0])
    for idx, f in enumerate(faces):
        r, j = divmod(idx, n)
        if r == len(rings) - 1:
            dark = True  # 先 (最後の断面から先の扇)
        elif j == 0:
            dark = False  # 外寄りの細い地色の縁
        elif j in (1, 2):
            dark = True  # くぼみ
        elif j == 3:
            dark = not folded[r]  # 段の壁 (地色の陰)。楔の先より上は焦げ茶
            f[wall] = 1 if folded[r] else 0
        elif j in (4, 5):
            dark = not folded[r]  # 楔の面 (楔の先より上は焦げ茶)
        else:
            dark = False  # 背 (下で先の斜めの境を切る)
        f.material_index = EAR if dark else BODY
        f[zone] = 1 if j < 6 else 0
    cap(bm, list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # 段の角は硬いエッジ: 段の下 (前面 3) と楔の上の縁 (前面 4) を断面から断面へ繋ぐ辺
    for r in range(len(rings) - 1):
        if not (folded[r] and folded[r + 1]):
            continue
        for j in (3, 4):
            e = bm.edges.get((rings[r][j], rings[r + 1][j]))
            if e is not None:
                e.smooth = False
    # 背の先の焦げ茶の斜めの境 (ear_pattern と同じ平面で切る)
    half = lambda t: prof(min(max(t, 0.0), 0.95))[0]  # noqa: E731
    pa = base + axis * (L * EAR_BACK_TIP[0][1]) + w * (half(EAR_BACK_TIP[0][1]) * EAR_BACK_TIP[0][0])
    pb = base + axis * (L * EAR_BACK_TIP[1][1]) + w * (half(EAR_BACK_TIP[1][1]) * EAR_BACK_TIP[1][0])
    bn = (pb - pa).cross(front).normalized()
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=pa, plane_no=bn, dist=1e-6)
    tip_side = base + axis * (L * 0.98)
    bsign = 1 if (tip_side - pa).dot(bn) > 0 else -1
    for f in bm.faces:
        if f[zone] == 0:
            c = f.calc_center_median()
            t = (c - base).dot(axis) / L
            f.material_index = EAR if (t > EAR_TIP_ALL or (c - pa).dot(bn) * bsign > 0) else BODY
    bm.faces.layers.int.remove(zone)


# 脚の断面: (関節 i から i+1 への位置 t, 横半径, 前後半径)
FRONT_LEG = [(0.0, 0.034, 0.040), (0.45, 0.030, 0.034), (1.0, 0.023, 0.025), (1.6, 0.019, 0.021), (2.0, 0.021, 0.019),
             (2.45, 0.023, 0.013), (2.85, 0.017, 0.010), (3.0, 0.007, 0.005)]
HIND_LEG = [(0.9, 0.024, 0.026), (1.4, 0.021, 0.021), (1.9, 0.019, 0.017), (2.15, 0.024, 0.014), (2.6, 0.022, 0.012),
            (2.9, 0.016, 0.009), (3.0, 0.006, 0.004)]


def leg_point(name, t):
    i = min(int(t), 2)
    a, b = joint(name, i), joint(name, i + 1)
    return a + (b - a) * (t - i)


def build_leg(bm, lod, name):
    front = name.startswith("fl")
    nsec, n = lod["fleg" if front else "hleg"]
    keys = FRONT_LEG if front else HIND_LEG
    secs = resample(keys, nsec)
    pts = [leg_point(name, t) for t, _, _ in secs]
    rings = []
    for i, (t, rx, ry) in enumerate(secs):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        uy = X.cross(d).normalized()
        if t > 2.0:
            uy = Z if uy.z > 0 else -Z  # 足先の断面は水平に (足裏を地面に平らに)
            ux = X
            rings.append(ring(bm, pts[i], ux, uy, rx, ry, ry, n, phase=math.pi / 2, sq=2.4))
        else:
            rings.append(ring(bm, pts[i], X, uy, rx, ry, ry, n, phase=math.pi / 2))
    loft(bm, rings)
    cap(bm, list(reversed(rings[0])))
    cap(bm, rings[-1])


def build_thigh(bm, lod, side):
    """後脚の腿: 胴の脇に張り出した卵形 (基準画の尻の丸い塊)"""
    nsec, n = lod["thigh"]
    # (M22-05 残りの手直しで変更: 基準画の腿は大きな塊 (立ち上がりで胴が細く見えた) なので 1 割大きく、外の面を平らに (sq 2.1 → 2.7)。
    #  元は c = (side * 0.072, 0.088, 0.104)、ry, rx, rz = 0.080, 0.046, 0.078)
    c = Vector((side * 0.076, 0.090, 0.106))
    ry, rx, rz = 0.088, 0.052, 0.086
    rings = []
    for i in range(nsec):
        t = -1 + 2 * (i + 1) / (nsec + 1)
        k = math.sqrt(max(0.0, 1 - t * t))
        k = k ** 0.85
        yy = c.y + ry * t
        zz = c.z - 0.012 * t  # 前ほどわずかに高く
        rings.append(ring(bm, Vector((c.x, yy, zz)), X, Z, rx * k, rz * k, rz * k * 0.92, n, phase=math.pi / 2, sq=2.7))
    a = bm.verts.new((c.x, c.y - ry, c.z + 0.012))
    b = bm.verts.new((c.x, c.y + ry, c.z - 0.012))
    loft(bm, [a] + rings + [b])


# (土兎の手直し 4 で追加) 肩の塊: 基準画の採食・立ち上がりと concept/rabbit-angular.png の前脚の付け根の面の立った板。胸の脇の低いところに
# 肩の関節から肘へ向かう平たい卵形 (外の面を平らに、sq 2.7) を置き、胸の脇から 1〜2 cm、胸の下では上腕として 3 cm ほど外へ出す。
# 重みは上腕 (fl_upper) が主なので、前脚を折ると塊ごと肘へ振れ、肘を外へ開く (FL_SPLAY4) と胸の外へ出る。
# (上の中心 (x, y, z), 下の中心, 横の半径, 前後の半径)。x は +側 (右) の値
SH_TOP4, SH_BOT4 = (0.064, -0.124, 0.168), (0.063, -0.104, 0.076)
SH_RX4, SH_RY4 = 0.029, 0.042


def build_shoulder(bm, lod, side):
    """(土兎の手直し 4 で追加) 肩の塊 (build_thigh と同じ作り: 両端を尖らせた断面のロフト)"""
    nsec, n = lod["shoulder"]
    a = Vector((side * SH_TOP4[0], *SH_TOP4[1:]))
    b = Vector((side * SH_BOT4[0], *SH_BOT4[1:]))
    axis = (b - a).normalized()
    uy = X.cross(axis).normalized()  # 前後 (+ は後ろ)
    rings = []
    for i in range(nsec):
        t = -1 + 2 * (i + 1) / (nsec + 1)
        k = math.sqrt(max(0.0, 1 - t * t)) ** 0.6  # 箱に近い塊 (腿より角ばる)
        c = (a + b) / 2 + (b - a) / 2 * t
        rings.append(ring(bm, c, X, uy, SH_RX4 * k, SH_RY4 * k, SH_RY4 * k * 0.9, n, phase=math.pi / 2, sq=2.7))
    ends = [bm.verts.new(a - axis * 0.004), bm.verts.new(b + axis * 0.004)]
    loft(bm, [ends[0]] + rings + [ends[1]])


def shoulder_weights(co):
    """(土兎の手直し 4 で追加) 肩の塊: 上腕が主、上の端は胸へ"""
    side = "L" if co.x < 0 else "R"
    return weights_for(co, [(f"fl_upper_{side}", 1.0), ("chest", 0.9), (f"fl_fore_{side}", 0.1)])


def build_tail(bm, lod):
    nsec, n = lod["tail"]
    pts = resample_path([(0, 0.160, 0.105), (0, 0.186, 0.128), (0, 0.204, 0.158), (0, 0.212, 0.182)], nsec + 1)
    radii = [r for (r,) in resample([(0.022,), (0.030,), (0.026,), (0.0,)], nsec + 1)]
    rings = []
    for i, (p, r) in enumerate(zip(pts, radii)):
        if i == len(pts) - 1:
            rings.append(bm.verts.new(p))
            continue
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u, v = frame_of(d)
        rings.append(ring(bm, p, u, v, r * 0.85, r, r, n))
    loft(bm, rings)
    cap(bm, list(reversed(rings[0])))


# ---------------------------------------------------------------- 殻の表面に貼るデカール (六角の紋・継ぎ目・首輪)
class Shell:
    """胴・首・腿を合わせた殻。面の番号 → その部品の重み関数を覚えておき、デカールの頂点は貼った先の重みを使う"""

    def __init__(self):
        self.v, self.f, self.owner = [], [], []
        self.bvh = None

    def add(self, bm, weight_fn):
        bm.verts.index_update()
        o = len(self.v)
        self.v.extend(v.co.copy() for v in bm.verts)
        for f in bm.faces:
            self.f.append([o + v.index for v in f.verts])
            self.owner.append(weight_fn)

    def build(self):
        self.bvh = BVHTree.FromPolygons(self.v, self.f)

    def nearest(self, p):
        loc, nrm, idx, _ = self.bvh.find_nearest(p)
        return loc, nrm, idx

    def outward(self, loc, nrm):
        # 殻の法線は向きが揃っていないことがあるので、体の軸から外へ向ける
        c = Vector((0, loc.y, body_zc(loc.y))) if loc.y > -0.1 else Vector((0, -0.12, 0.2))
        if abs(loc.x) > 0.045 and 0.0 < loc.y < 0.17 and loc.z < 0.19:
            c = Vector((math.copysign(0.036, loc.x), 0.088, 0.104))  # 腿の上 (M22-05 残りの手直しで腿を大きくしたが、外向きの判定の中心はこのまま)
        return nrm if nrm.dot(loc - c) >= 0 else -nrm

    def snap(self, p, off):
        loc, nrm, idx = self.nearest(p)
        nrm = self.outward(loc, nrm)
        return loc + nrm * off, nrm, idx

    def weights(self, p):
        loc, _, idx = self.nearest(p)
        return self.owner[idx](loc)

    def project(self, view, a, b, side=1):
        """view: 'side' (a=y, b=z、side 側の横から)、'front' (a=x, b=z、正面から)、'top' (a=x, b=y、上から)。表面の点と外向きの法線"""
        if view == "side":
            for k in range(30):
                zc = body_zc(a)
                zz = b + (zc - b) * k / 30
                d = Vector((side, 0, max(-1.0, min(1.0, (zz - zc) / 0.12)) * 0.8)).normalized()
                q = Vector((0, a, zz))
                loc, nrm, _, _ = self.bvh.ray_cast(q + d * 1.0, -d)
                if loc is not None:
                    break
        elif view == "front":
            loc, nrm, _, _ = self.bvh.ray_cast(Vector((a, -1.0, b)), Y)
        else:
            loc, nrm, _, _ = self.bvh.ray_cast(Vector((a, b, 1.0)), -Z)
        if loc is None:
            raise RuntimeError(f"surface miss {view} {a} {b}")
        return loc, self.outward(loc, nrm)


def tangent_frame(nrm, ref=Z):
    up = ref - nrm * ref.dot(nrm)
    if up.length < 1e-3:
        up = -Y - nrm * (-Y).dot(nrm)
    up.normalize()
    right = up.cross(nrm).normalized()
    return right, up


def build_hex(bm_glow, bm_teal, shell, loc, nrm, r, lod, rot=0.0, ref=Z):
    """六角の紋: 発光の面 (中心 + 6 角) と、近 LOD では外側の暗い青緑の縁取りの輪"""
    right, up = tangent_frame(nrm, ref)

    def corner(k, rr):
        a = math.radians(90 + 60 * k + rot)
        return loc + right * (rr * math.cos(a)) + up * (rr * math.sin(a))

    c = bm_glow.verts.new(loc + nrm * 0.0045)
    vs = [bm_glow.verts.new(shell.snap(corner(k, r), 0.0045)[0]) for k in range(6)]
    for k in range(6):
        f = bm_glow.faces.new((vs[k], vs[(k + 1) % 6], c))
        f.material_index = GLOW
        f.normal_update()
        if f.normal.dot(nrm) < 0:
            f.normal_flip()
    if lod["hex_ring"]:
        inner = [bm_teal.verts.new(shell.snap(corner(k, r * 0.92), 0.003)[0]) for k in range(6)]
        outer = [bm_teal.verts.new(shell.snap(corner(k, r * 1.24), 0.003)[0]) for k in range(6)]
        for k in range(6):
            f = bm_teal.faces.new((inner[k], outer[k], outer[(k + 1) % 6], inner[(k + 1) % 6]))
            f.material_index = BODY
            f.normal_update()
            if f.normal.dot(nrm) < 0:
                f.normal_flip()


def build_ribbon(bm, shell, pts, lod, width, off, mat, closed=False, seg=None):
    """殻の表面に沿う帯。pts は表面近くの 3D 点の列 (Catmull-Rom で補間して毎点を表面に落とす)"""
    nseg = seg or lod["ribbon_seg"]
    if closed:
        keys = [tuple(p) for p in pts] + [tuple(pts[0])]
        dense = [Vector(p) for p in resample(keys, nseg + 1)][:-1]
    else:
        dense = resample_path(pts, nseg + 1)
    hits = [shell.snap(p, off) for p in dense]
    m = len(hits)
    rows = []
    for i, (loc, n, _) in enumerate(hits):
        if closed:
            d = (hits[(i + 1) % m][0] - hits[(i - 1) % m][0]).normalized()
        else:
            d = (hits[min(i + 1, m - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
        sv = n.cross(d).normalized() * (width / 2)
        rows.append((bm.verts.new(loc - sv), bm.verts.new(loc + sv), n))
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        a, b = rows[i], rows[(i + 1) % m]
        f = bm.faces.new((a[0], a[1], b[1], b[0]))
        f.material_index = mat
        f.normal_update()
        if f.normal.dot(a[2]) < 0:
            f.normal_flip()


# 六角の紋 (基準画の正面・側面の画素から)。胸: 正面から見た (x, z, 半径)
CHEST_HEX = [(0.0, 0.146, 0.019), (-0.031, 0.168, 0.011), (0.031, 0.168, 0.011), (-0.025, 0.119, 0.011), (0.025, 0.119, 0.011),
             (0.0, 0.100, 0.010)]
# 背: 横から見た (y, z, 半径)。左右に同じものを置く
BACK_HEX = [(0.005, 0.248, 0.023), (0.078, 0.238, 0.023), (0.040, 0.210, 0.018), (0.120, 0.198, 0.019)]
# 背骨の上: 上から見た (x, y, 半径)
TOP_HEX = [(0.0, -0.005, 0.017), (0.0, 0.080, 0.017)]
# 継ぎ目 (横から見た (y, z))。背の紋の区画の下の線、腿の前と上の線、肩から胸の脇へ下りる線
SEAM_BACK = [(-0.100, 0.236), (-0.050, 0.220), (0.000, 0.198), (0.060, 0.180), (0.120, 0.166), (0.165, 0.145)]
# (M22-05 残りの手直しで変更: 腿を大きくしたので、腿の線を前へ 8 mm・上へ 8 mm 出した (腿の中へ潜って途切れていた)。
#  元は [(0.016, 0.060), (0.020, 0.100), (0.030, 0.136), (0.062, 0.166), (0.104, 0.170), (0.150, 0.158)])
SEAM_THIGH = [(0.008, 0.058), (0.011, 0.100), (0.021, 0.140), (0.058, 0.175), (0.104, 0.180), (0.152, 0.167)]
SEAM_SHOULDER = [(-0.140, 0.214), (-0.150, 0.175), (-0.140, 0.135), (-0.115, 0.108)]
SEAMS = {"back": SEAM_BACK, "thigh": SEAM_THIGH, "shoulder": SEAM_SHOULDER}
# 胸の盾形の輪郭 (正面から見た (x, z)、左右対称)
SEAM_CHEST = [(0.050, 0.196), (0.054, 0.160), (0.048, 0.120), (0.030, 0.090), (0.0, 0.080)]


# (M22-05 残りの手直しで追加) 背の蜂の巣: 胴の軸の周りの角度で背を開いた (y, v) の平面 (v = 角度 × 0.1 m、背骨の上が v = 0) に
# 平らな頂の六角 (外接円の半径 COMB_R) を敷き詰め、各目の中心を胴の軸から外へ撃って殻に貼る。
# 基準画の背は六角が隣り合い、区画の縁を暗い青緑の線が縁取る (網目)。光る六角はその目の中に一回り小さく入る
COMB_R = 0.040
COMB_REFF = 0.10
COMB_INSET = 0.52


def seam_z(path, y):
    """横から見た継ぎ目の線 (y, z) の y での高さ (両端の外は端の値)"""
    if y <= path[0][0]:
        return path[0][1]
    for (y0, z0), (y1, z1) in zip(path, path[1:]):
        if y0 <= y <= y1:
            return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return path[-1][1]


def comb_cells(shell):
    """蜂の巣の目の中心 (y, v) の列。前 (首の側) の列から後ろへ、各列は v の小さい順。
    基準画の背の区画は背の継ぎ目 (SEAM_BACK) の上にあるので、角が継ぎ目より下へ出る目と首輪の前へ出る目は除く"""
    cells = []
    dy, dv = 1.5 * COMB_R, math.sqrt(3) * COMB_R
    for j in range(4):
        y = -0.068 + dy * j
        vs = [0.0, -dv, dv] if j % 2 == 0 else [-dv * 0.5, dv * 0.5]
        for v in sorted(vs):
            ok = True
            for k in range(6):
                cy, cv = comb_corner(y, v, k, COMB_R)
                if cy < -0.105 or cy > 0.175:
                    ok = False
                    break
                p, _ = comb_point(shell, cy, cv, 0.0)
                if p.z < seam_z(SEAM_BACK, cy) + 0.004:
                    ok = False
                    break
            if ok:
                cells.append((y, v))
    return cells


def comb_corner(y, v, k, r):
    a = math.radians(60 * k)
    return y + r * math.cos(a), v + r * math.sin(a)


def comb_point(shell, y, v, off):
    """(y, v) を殻の表面へ: 胴の軸 (0, y, 胴の中心の高さ) から角度 v / COMB_REFF の向き (0 = 真上、+ = +X) へ外から撃つ"""
    th = v / COMB_REFF
    d = Vector((math.sin(th), 0.0, math.cos(th)))
    a = Vector((0.0, y, body_zc(y)))
    loc, nrm, _, _ = shell.bvh.ray_cast(a + d * 0.5, -d)
    if loc is None:
        raise RuntimeError(f"comb miss y={y} v={v}")
    nrm = shell.outward(loc, nrm)
    return loc + nrm * off, nrm


def build_honeycomb(bm_glow, bm_teal, shell, lod):
    cells = comb_cells(shell)
    print(lod["name"], "comb cells", len(cells), [(round(y, 3), round(v, 3)) for y, v in cells])
    pick = lod["comb_glow"]
    for i, (y, v) in enumerate(cells):
        if pick is not None and i not in pick:
            continue
        c, n = comb_point(shell, y, v, 0.0045)
        vs = [bm_glow.verts.new(comb_point(shell, *comb_corner(y, v, k, COMB_R * COMB_INSET), 0.0045)[0]) for k in range(6)]
        cv = bm_glow.verts.new(c)
        for k in range(6):
            f = bm_glow.faces.new((vs[k], vs[(k + 1) % 6], cv))
            f.material_index = GLOW
            f.normal_update()
            if f.normal.dot(n) < 0:
                f.normal_flip()
    if not lod["comb_net"]:
        return
    # 網目: 全部の目の辺を重複なく集め、1 辺ずつ細い帯にする (隣り合う目は辺を共有する)
    edges = {}
    for y, v in cells:
        pts = [comb_corner(y, v, k, COMB_R) for k in range(6)]
        for k in range(6):
            a, b = pts[k], pts[(k + 1) % 6]
            key = tuple(sorted((tuple(round(q, 4) for q in a), tuple(round(q, 4) for q in b))))
            edges[key] = (a, b)
    w = 0.0036
    for a, b in edges.values():
        pa, na = comb_point(shell, *a, 0.0028)
        pb, nb = comb_point(shell, *b, 0.0028)
        d = (pb - pa).normalized()
        sa, sb = na.cross(d).normalized() * w, nb.cross(d).normalized() * w
        # 角で隣の辺と重なるよう、両端を半幅だけ延ばす
        ea, eb = pa - d * w, pb + d * w
        q = [bm_teal.verts.new(ea - sa), bm_teal.verts.new(ea + sa), bm_teal.verts.new(eb + sb), bm_teal.verts.new(eb - sb)]
        f = bm_teal.faces.new(q)
        f.material_index = BODY
        f.normal_update()
        if f.normal.dot(na) < 0:
            f.normal_flip()


def collar_points(shell):
    """首輪: 首の付け根を一周する輪 (首の軸に直交する面。軸の上の点から外へ向けた線を殻の外から撃って表面の点を取る)"""
    c = Vector((0, -0.135, 0.228))
    ax = Vector((0, -0.45, 1.0)).normalized()
    u = X
    v = ax.cross(u).normalized()
    pts = []
    for i in range(16):
        a = 2 * math.pi * i / 16
        d = u * math.cos(a) + v * math.sin(a)
        loc, _, _, _ = shell.bvh.ray_cast(c + d * 0.3, -d)
        pts.append(loc if loc is not None else c + d * 0.06)
    return pts


def build_decals(shell, lod, mats, obj_name):
    bm_glow, bm_teal = bmesh.new(), bmesh.new()

    def pick(key, table):
        sub = lod["hexes"]
        return table if sub is None else [table[i] for i in sub[key]]

    for x, z, r in pick("chest", CHEST_HEX):
        loc, nrm = shell.project("front", x, z)
        build_hex(bm_glow, bm_teal, shell, loc, nrm, r, lod)
    # (M22-05 残りの手直しで変更: 背の左右の六角 (BACK_HEX) と背骨の上の六角 (TOP_HEX) を 1 つずつ離して貼っていたのを、
    #  網目の暗い線で繋がった蜂の巣 (build_honeycomb) に置き換えた。BACK_HEX / TOP_HEX の表は使わない)
    build_honeycomb(bm_glow, bm_teal, shell, lod)
    wide = 0.007 if lod["hex_ring"] else 0.0
    for side in (-1, 1):
        for path in (SEAMS[k] for k in lod["seams"]):
            pts = [shell.project("side", y, z, side)[0] for y, z in path]
            # (M22-05 残りの手直しで変更: 帯が胴と腿の境のくぼみで面の下へ潜って途切れて見えたので、浮かせる量を
            #  下地 0.0025 → 0.0032、光 0.0040 → 0.0050 に)
            if wide:
                build_ribbon(bm_teal, shell, pts, lod, wide, 0.0032, BODY)
            build_ribbon(bm_glow, shell, pts, lod, 0.0042, 0.0050, GLOW)
        pts = [shell.project("front", side * x, z)[0] for x, z in SEAM_CHEST]
        if wide:
            build_ribbon(bm_teal, shell, pts, lod, wide, 0.0025, BODY, seg=max(2, lod["ribbon_seg"] // 2 + 1))
        build_ribbon(bm_glow, shell, pts, lod, 0.0042, 0.0040, GLOW, seg=max(2, lod["ribbon_seg"] // 2 + 1))
    # 首輪: 暗い青緑の帯 (群れ LOD も持つ。遠目にも頭と胴の境が読める)
    # (M22-05 残りの手直しで変更: 首輪が首と胴の境で途切れて見えたので、浮かせる量を 0.003 → 0.0045 に)
    # (土兎の手直し 8 で変更: 群れ LOD の区間数を LOD1["collar_seg"] (8 → 12) に。元は seg=12 if lod["hex_ring"] else 8)
    build_ribbon(bm_teal, shell, collar_points(shell), lod, 0.013, 0.0045, BODY, closed=True,
                 seg=12 if lod["hex_ring"] else lod.get("collar_seg", 8))
    parts = []
    for bm, part in ((bm_glow, "glow"), (bm_teal, "teal")):
        if not bm.faces:
            bm.free()
            continue
        parts.append(make_part(f"{obj_name}_decal_{part}", bm, part, shell.weights, mats, recalc=False))
    return parts


# (土兎の手直し 3 で追加) 目をシャープに (審査台 r2-rabbit)。基準画の目は両端の尖った大きなアーモンド: 目頭は前下へ尖り、目尻は後ろ上へ尖る。
# 近 LOD は八角形の代わりに eye_lens の形 (k 頂点)。axis は目の長軸 (前下がり)、shape は (目頭までの長さ, 目尻までの長さ, 上まぶたの高さ, 下まぶたの高さ)
EYE_SHARP = dict(k=20, axis=(0, -1, -0.62), shape=(0.034, 0.032, 0.0165, 0.0150), pf=1.1, pb=1.1, lift=0.10, dir=(0.72, -0.68, 0.08))


# (土兎の手直し 4 で追加) 目をより鋭く (審査台 r3-rabbit「目は一歩進んだが道半ば。より鋭さを」)。基準画の正面・斜め前の目は、
# 手直し 3 の目より細く (高さ/長さ 0.48 → 0.36)、両端が針のように尖り、目尻が上へ切れ上がる。目の縁は暗い瞼の線で締まり、
# 上瞼の線は目尻へ太くなって目尻の先へ少し払う (眉の陰)。下瞼の線は細い。形は eye_lens に EYE4 の値を渡し、瞼の線は build_eye_lid
EYE4 = dict(k=24, axis=(0, -1, -0.50), shape=(0.031, 0.035, 0.0128, 0.0104), pf=1.8, pb=2.6, lift=0.40, dir=(0.67, -0.73, 0.10))
LID4 = dict(top=(0.0010, 0.0040, 0.0054), bottom=0.0012, flick=0.0090, off=0.0034, overlap=0.0007)


def eye_lens(k, lf, lb, ht, hb, pf=0.2, pb=1.2, lift=0.0):
    """(土兎の手直し 3 で追加) 目の形 (observe_deer.py の lens と同じ)。(前 (目頭) へ +, 上へ +) の 2D 点を k 個、i = 0 が目頭、k/2 が目尻。
    pf / pb は目頭 / 目尻の尖り (0 で楕円、1 で放物線の尖った角)、lift は目尻を上まぶたの高さに対して持ち上げる割合"""
    out = []
    for i in range(k):
        a = 2 * math.pi * i / k
        ca, sa = math.cos(a), math.sin(a)
        x = ca * (lf if ca > 0 else lb)
        y = sa * (ht if sa > 0 else hb) * abs(sa) ** (pf if ca > 0 else pb)
        y += lift * ht * max(0.0, -ca) ** 2
        out.append((x, y))
    return out


def build_eye(bm, bvh_head, lod, side):
    """光る目: 頭の横やや前向きのアーモンド形 (目頭が前・下、目尻が後ろ・上)"""
    aim = Vector((0, -0.155, 0.292))
    d = Vector((side * 0.84, -0.52, 0.06)).normalized()
    if lod["name"] == "hero" and EYE_SHARP:  # (土兎の手直し 3 で追加) 目を前へ回して、正面から頬の内に収まって見えるように
        d = Vector((side * EYE_SHARP["dir"][0], *EYE_SHARP["dir"][1:])).normalized()
    es4 = EYE4 if lod["name"] == "hero" and EYE4 else None  # (土兎の手直し 4 で追加) 近 LOD はより鋭い目 (EYE4)
    if es4:
        d = Vector((side * es4["dir"][0], *es4["dir"][1:])).normalized()
    if FACE5:  # (土兎の手直し 5 で追加) 狙う点も縮めた頭の上の同じ所へ
        aim = Vector(face5(aim))
    if es4 and FACE5:  # (土兎の手直し 5 で追加) 鼻づらを縮めた頭では目を横寄りへ向け、頬の脇 (正面で顔の縁の内) に載せる
        d = Vector((side * EYE5_DIR[0], *EYE5_DIR[1:])).normalized()
    loc, n, _, _ = bvh_head.ray_cast(aim + d * 1.0, -d)
    if n.dot(d) < 0:
        n = -n
    u = Vector((0, -1, -0.28))
    u = (u - n * u.dot(n)).normalized()  # 目の長軸
    v = n.cross(u).normalized()
    if v.z < 0:
        v = -v
    k = lod["eye"]
    L, H = 0.028, 0.0175
    shape = None
    if lod["name"] == "hero" and EYE_SHARP:  # (土兎の手直し 3 で追加) 近 LOD は両端の尖ったレンズ (eye_lens)
        es = EYE_SHARP
        u = Vector(es["axis"])
        u = (u - n * u.dot(n)).normalized()
        v = n.cross(u).normalized()
        if v.z < 0:
            v = -v
        k = es["k"]
        shape = eye_lens(k, *es["shape"], pf=es["pf"], pb=es["pb"], lift=es["lift"])
    if es4:  # (土兎の手直し 4 で追加)
        u = Vector(es4["axis"])
        u = (u - n * u.dot(n)).normalized()
        v = n.cross(u).normalized()
        if v.z < 0:
            v = -v
        k = es4["k"]
        shape = eye_lens(k, *es4["shape"], pf=es4["pf"], pb=es4["pb"], lift=es4["lift"])
        if FACE5:  # (土兎の手直し 5 で追加) 短くした頭に合わせて同じレンズの形のまま縮め、長軸を正面で「\ /」に傾ける
            u = Vector(EYE5_AXIS)
            u = (u - n * u.dot(n)).normalized()
            v = n.cross(u).normalized()
            if v.z < 0:
                v = -v
            shape = [(x * EYE5_SCALE, y * EYE5_SCALE) for x, y in shape]
    c = bm.verts.new(loc + n * 0.006)
    vs = []
    for i in range(k):
        a = 2 * math.pi * i / k
        ca, sa = math.cos(a), math.sin(a)
        sharp = 1.0 - 0.35 * max(0.0, -ca)  # 目尻 (後ろ) を尖らせる
        p = loc + u * (L * ca) + v * (H * sa * sharp)
        if shape:  # (土兎の手直し 3 で追加)
            p = loc + u * shape[i][0] + v * shape[i][1]
        best = bvh_head.find_nearest(p)
        p = best[0] + n * 0.0025 if best[0] is not None else p
        vs.append(bm.verts.new(p))
    for i in range(k):
        f = bm.faces.new((vs[i], vs[(i + 1) % k], c))
        f.material_index = GLOW
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()
    # (土兎の手直し 4 で追加) 瞼の線 (build_eye_lid) のために、目の縁の点と向きを返す
    return dict(pts=[x.co.copy() for x in vs], c=loc.copy(), n=n.copy(), u=u.copy(), v=v.copy(), k=k)


def build_eye_lid(bm, bvh_head, eye):
    """(土兎の手直し 4 で追加) 目の縁を回る暗い瞼の線。上瞼は目頭で細く目尻へ太く (LID4["top"])、目尻の先で後ろ上へ払う (LID4["flick"])。
    下瞼は細い線。目の縁の少し内から外へ張る帯を頭の面に落として、目の発光の縁の上に重ねる"""
    pts, c, n, u, v, k = eye["pts"], eye["c"], eye["n"], eye["u"], eye["v"], eye["k"]

    def on_head(p, off):
        q = bvh_head.find_nearest(p)
        return q[0] + n * off if q[0] is not None else p

    def width(i):
        a = 2 * math.pi * i / k
        ca, sa = math.cos(a), math.sin(a)
        s = (1 - ca) / 2  # 0 = 目頭、1 = 目尻
        t0, t1, t2 = LID4["top"]
        w = t0 + (t1 - t0) * smoothstep(0.0, 0.5, s) + (t2 - t1) * smoothstep(0.5, 1.0, s)
        if sa < 0:  # 下瞼は細く、目尻のそばだけ上瞼の太さからつなぐ
            return LID4["bottom"] + (w - LID4["bottom"]) * smoothstep(0.8, 1.0, s) * (1 - smoothstep(0.0, 0.4, -sa))
        if ca > 0:  # 目頭の側は下瞼の細さからつなぐ
            return LID4["bottom"] + (w - LID4["bottom"]) * smoothstep(0.0, 0.35, sa)
        return w

    rows = []
    for i, p in enumerate(pts):
        # 縁の線に直交する向き (目の中心から放射状に張ると、尖った目頭・目尻で帯が先へ伸びて細い筋になる)
        d = (pts[(i + 1) % k] - pts[i - 1]).cross(n)
        d = (d - n * d.dot(n)).normalized()
        if d.dot(p - c) < 0:
            d = -d
        rows.append((bm.verts.new(on_head(p - d * LID4["overlap"], LID4["off"])), bm.verts.new(on_head(p + d * width(i), LID4["off"]))))
    faces = []
    for i in range(k):
        a, b = rows[i], rows[(i + 1) % k]
        faces.append(bm.faces.new((a[0], a[1], b[1], b[0])))
    # 目尻 (i = k/2) の先の払い: 目の長軸の延長へ細る三角 (上瞼の線の続き)
    m = k // 2
    pm = pts[m]
    e = pm - c
    e = (e - n * e.dot(n)).normalized()
    w2 = LID4["top"][2]
    tip = bm.verts.new(on_head(pm + e * LID4["flick"] + v * (w2 * 0.35), LID4["off"]))
    faces.append(bm.faces.new((rows[m][1], tip, rows[m - 1][1])))
    for f in faces:
        f.material_index = BODY
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()


def build_nose(bm, bvh_head):
    """小さな暗い鼻: 鼻先の前面に逆三角の低い山"""
    pts = []
    for x, z in ((-0.015, 0.265), (0.015, 0.265), (0.0, 0.246)):
        loc, n, _, _ = bvh_head.ray_cast(Vector((x, -1.0, z)), Y)
        pts.append(loc + n * 0.0 - Y * 0.002 if loc is not None else Vector((x, -0.258, z)))
    c = sum(pts, Vector()) / 3 - Y * 0.006
    vs = [bm.verts.new(p) for p in pts]
    cv = bm.verts.new(c)
    for i in range(3):
        f = bm.faces.new((vs[i], vs[(i + 1) % 3], cv))
        f.material_index = NOSE
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    f = bm.faces.new(list(reversed(vs)))
    f.material_index = NOSE


# (土兎の手直しで追加) 鼻の下の口: 基準画の正面・斜め前・立ち上がりの顔は、鼻の逆三角の下の角から短い縦の線が下り、
# 左右へ分かれて外・下へゆるく流れる「人」の形。穏やかな顔にしたいので、分かれた線は下げすぎず短く止める。
# 正面から見た (x, z)。鼻の下の角 (0, 0.246) から。線は鼻と同じ焦げ茶 (rabbit_nose)、頭の表面から少し浮かせた細い帯
MOUTH_STEM = [(0.0, 0.2465), (0.0, 0.2405)]
MOUTH_BRANCH = [(0.0, 0.2410), (0.0042, 0.2380), (0.0085, 0.2364), (0.0118, 0.2362)]
MOUTH_W = 0.0032
# (土兎の手直し 3 で変更: 審査台 r2-rabbit「口元の線が見えない」。観察画面の 2〜10 m で読めるよう、線を太く (3.2 → 7.5 mm)、縦の線を長く、
#  分かれた線を鼻の幅まで伸ばして外・下へ流す。群れ LOD にも太い線 (9.5 mm、LOD1 の mouth_w) で入れる。元の線は上の MOUTH_STEM / MOUTH_BRANCH / MOUTH_W)
MOUTH3 = True
MOUTH3_STEM = [(0.0, 0.2465), (0.0, 0.2395)]
MOUTH3_BRANCH = [(0.0, 0.2405), (0.0045, 0.2362), (0.0100, 0.2336), (0.0162, 0.2324)]
MOUTH3_W = 0.0075


def build_mouth(bm, bvh_head, width=None):
    """(土兎の手直しで追加) 口の線を正面から頭へ投影した細い帯にする"""
    stem, branch = (MOUTH3_STEM, MOUTH3_BRANCH) if MOUTH3 else (MOUTH_STEM, MOUTH_BRANCH)  # (土兎の手直し 3 で追加)
    width = width or (MOUTH3_W if MOUTH3 else MOUTH_W)

    def hit(x, z):
        loc, n, _, _ = bvh_head.ray_cast(Vector((x, -1.0, z)), Y)
        if loc is None:
            raise RuntimeError(f"mouth miss {x} {z}")
        if n.y > 0:
            n = -n
        return loc, n

    def strip(path):
        pts = resample_path([Vector((x, 0, z)) for x, z in path], max(3, len(path) * 2 - 1))
        hits = [hit(p.x, p.z) for p in pts]
        rows = []
        for i, (loc, n) in enumerate(hits):
            d = (hits[min(i + 1, len(hits) - 1)][0] - hits[max(i - 1, 0)][0]).normalized()
            sv = n.cross(d).normalized() * (width / 2)  # (土兎の手直し 3 で変更: MOUTH_W → width)
            rows.append((bm.verts.new(loc - sv + n * 0.0012), bm.verts.new(loc + sv + n * 0.0012), n))
        for a, b in zip(rows, rows[1:]):
            f = bm.faces.new((a[0], a[1], b[1], b[0]))
            f.material_index = NOSE
            f.normal_update()
            if f.normal.dot(a[2]) < 0:
                f.normal_flip()

    strip(stem)  # (土兎の手直し 3 で変更: MOUTH_STEM → stem、MOUTH_BRANCH → branch)
    for sx in (-1, 1):
        strip([(sx * x, z) for x, z in branch])


# ---------------------------------------------------------------- 頂点色と重み
def color_for(part, co, n):
    if part == "teal":
        return PAL["teal"]
    if part == "lid":  # (土兎の手直し 4 で追加) 瞼の線 (眉の陰の焦げ茶)
        return PAL["lid"]
    if part in ("glow", "rigid"):
        return WHITE
    # (M22-05 残りの手直しで変更: 陰影が平たかったので、上を向く面を fur_lit へ、下・奥を向く面を fur_shade へ寄せて明暗の幅を広げた。
    #  胴は腿の前の縁と前脚の付け根の後ろを陰にして、腿と胴の面を分ける。頭は頬の下の縁と顎の下を陰にして頬の面を立てる)
    if part == "body":
        c = mix(PAL["fur"], PAL["fur_dark"], smoothstep(-0.2, -0.8, n.z) * 0.8)
        c = mix(c, PAL["light"], smoothstep(0.55, 1.0, n.z) * 0.25)
        c = mix(c, PAL["fur_lit"], smoothstep(0.35, 0.9, n.z) * 0.7)
        c = mix(c, PAL["fur_shade"], smoothstep(-0.1, -0.7, n.z) * 0.75)
        # 腿の前の縁 (腿の前、胴の脇の低いところ) の陰
        th = smoothstep(0.05, -0.03, co.y) * smoothstep(-0.07, -0.01, co.y) * smoothstep(0.16, 0.10, co.z) * smoothstep(0.03, 0.07, abs(co.x))
        return mix(c, PAL["fur_shade"], th * 0.6)
    if part == "neck":
        c = mix(PAL["fur"], PAL["light"], smoothstep(-0.1, -0.7, n.y) * 0.3)
        return mix(c, PAL["fur_shade"], smoothstep(0.0, -0.6, n.z) * 0.5)  # (M22-05 残りの手直しで追加) 顎の下の陰
    if part == "head":
        co = Vector((co.x, face5_y_inv(co.y), co.z))  # (土兎の手直し 5 で追加) 縮めた鼻づらの頂点も元の頭の座標で塗る
        if FACE7:  # (土兎の手直し 7 で追加) 伸ばした鼻づらも元の頭の座標で (face7 → face5 の順に戻す)
            co = Vector((co.x, face_y_inv(face5_y(co.y)), co.z))
        c = mix(PAL["fur"], PAL["fur_lit"], smoothstep(0.4, 0.9, n.z) * 0.8)  # (M22-05 残りの手直しで追加) 頭頂・額の面は明るく
        c = mix(c, PAL["light"], smoothstep(-0.205, -0.245, co.y) * 0.7)
        c = mix(c, PAL["light"], smoothstep(-0.2, -0.7, n.z) * 0.6)
        # (M22-05 残りの手直しで追加) 頬の張りの下 (顎の縁、横を向きつつ下へ傾く面) は陰にして頬の面を分ける
        c = mix(c, PAL["fur_shade"], smoothstep(-0.05, -0.45, n.z) * smoothstep(0.3, 0.7, abs(n.x)) * smoothstep(-0.2, -0.13, co.y) * 0.7)
        # (M22-05 残りの手直しで変更: 上の 2 行を足したので、元の 2 行の mix の起点 PAL["fur"] を c に)
        return c
    if part.startswith("ear"):
        if EAR_RIM and n.dot(EAR_FRONT[part]) > 0.3:
            return mix(PAL["fur"], PAL["fur_lit"], 0.8)  # (土兎の手直しで追加) 前面の地色の楔と縁は光を受けて明るい (基準画)
        return mix(PAL["fur"], PAL["light"], 0.35 if n.dot(EAR_FRONT[part]) < -0.3 else 0.0)
    if part.startswith("shoulder"):  # (土兎の手直し 4 で追加) 肩の塊は腿と同じく、上の面を明るく前と下を陰にして塊を立てる
        return color_for("thigh" + part[len("shoulder"):], co, n)
    if part.startswith("thigh"):
        # (M22-05 残りの手直しで変更: 腿の上の面は明るく、前の面と下は陰にして腿の塊を立てる。元は下への fur_dark の 1 段だけ)
        c = mix(PAL["fur"], PAL["fur_dark"], smoothstep(0.0, -0.8, n.z) * 0.7)
        c = mix(c, PAL["fur_lit"], smoothstep(0.3, 0.85, n.z) * 0.75)
        c = mix(c, PAL["fur_shade"], smoothstep(-0.3, -0.8, n.y) * 0.55)
        return mix(c, PAL["fur_shade"], smoothstep(-0.2, -0.8, n.z) * 0.5)
    if part.startswith("leg"):
        side = 1 if co.x > 0 else -1
        c = mix(PAL["fur"], PAL["fur_dark"], smoothstep(0.2, 0.8, -n.x * side) * 0.6)
        c = mix(c, PAL["fur_shade"], smoothstep(0.2, 0.8, -n.x * side) * 0.4)  # (M22-05 残りの手直しで追加) 脚の内側をもう一段暗く
        return mix(c, PAL["light"], smoothstep(0.03, 0.0, co.z) * 0.35)
    if part == "tail":
        return PAL["light"]
    return WHITE


# (土兎の手直し 4 で追加) 体毛の毛羽立ち (審査台 r3-rabbit「体毛の毛羽だった感じをリアルよりすぎないテクスチャで乗るとよい」)。
# 灰狼への判断 (「テクスチャが細かすぎる。もとの絵画的ないい意味で荒い毛並み」) を踏まえ、細かいノイズではなく基準画の荒い筆の跡にする。
# 観察画面は材質を焼いて 1 体 1 draw call にするので、絵 (テクスチャ) は使わず頂点色で塗る。近 LOD の胴・首・腿は辺を 1 回ずつ割って
# (densify4、形は変えず、法線は割る前のなめらかな値) 筆の跡を受ける。筆は胴の軸の周りに開いた (前後 y, 背から測った弧の長さ s) の平面に置き、
# 毛並みの向き (後ろ下へ) に長い明るい跡と暗い跡を交互に。顔 (頭) には塗らない (穏やかな顔を保つ)
FUR4 = True
FUR4_PARTS = ("body", "neck", "thigh", "shoulder")
FUR4_R = 0.09          # 弧の長さに直す半径 (胴の半幅ほど)
FUR4_N = 22            # 片側の本数
FUR4_L = (0.10, 0.18)  # 長さ (m)
FUR4_W = (0.024, 0.040)  # 幅 (m)
FUR4_K = (0.75, 0.60)  # 明るい跡・暗い跡の濃さ
SMOOTH_N4 = {}         # 割った部品のなめらかな法線 (メッシュ名 → 頂点ごと)。Blend が親の法線に使う
FUR4_STROKES = []


def densify4(bm, lod):
    """(土兎の手直し 4 で追加) 近 LOD の部品の辺を 1 回ずつ割る (形は変えない)。割る前の頂点の法線を面の上で補間する関数を返す"""
    if not (FUR4 and lod["name"] == "hero"):
        return None
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.verts.index_update()
    vs = [v.co.copy() for v in bm.verts]
    ns = [v.normal.copy() for v in bm.verts]
    tris = [[lp.vert.index for lp in lt] for lt in bm.calc_loop_triangles()]
    bvh = BVHTree.FromPolygons(vs, tris)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)

    def nfn(co):
        loc, _, idx, _ = bvh.find_nearest(co)
        tri = tris[idx]
        ws = poly_3d_calc([vs[i] for i in tri], loc)
        return sum((ns[i] * w for i, w in zip(tri, ws)), Vector()).normalized()
    return nfn


def make_fur4():
    """(土兎の手直し 4 で追加) 筆の跡の列 (乱数の種は固定)。(y, s) は跡の始点、d は毛並みの向き (後ろ (+y) と下 (|s| が増す向き))"""
    import random
    rng = random.Random(23)
    out = []
    for side in (-1, 1):
        for i in range(FUR4_N):
            y = rng.uniform(-0.20, 0.13)
            s = side * rng.uniform(0.0, 0.20)
            a = math.radians(rng.uniform(12, 48))
            d = Vector((math.cos(a), side * math.sin(a)))
            out.append((Vector((y, s)), d, rng.uniform(*FUR4_L), rng.uniform(*FUR4_W), 1 if i % 2 == 0 else -1))
    return out


def fur4_paint(part, co, c):
    """(土兎の手直し 4 で追加) 頂点色 c に筆の跡を重ねる (FUR4_PARTS の部品だけ)"""
    if not part.startswith(FUR4_PARTS):
        return c
    if not FUR4_STROKES:
        FUR4_STROKES.extend(make_fur4())
    zc = body_zc(co.y)
    p = Vector((co.y, math.atan2(co.x, co.z - zc) * FUR4_R))
    for a, d, L, W, tone in FUR4_STROKES:
        t = (p - a).dot(d) / L
        if t < -0.1 or t > 1.1:
            continue
        dist = (p - (a + d * (L * max(0.0, min(1.0, t))))).length
        w = W * (0.55 + 0.45 * math.sin(math.pi * max(0.0, min(1.0, t))))  # 筆の入りと抜きを細く
        k = smoothstep(w, 0.0, dist) * (1 - smoothstep(0.75, 1.1, t)) * smoothstep(-0.1, 0.25, t)
        if k <= 0:
            continue
        if tone > 0:
            c = mix(c, mix(PAL["fur_lit"], PAL["light"], 0.6), k * FUR4_K[0])
        else:
            c = mix(c, mix(PAL["fur_shade"], PAL["fur_dark"], 0.3), k * FUR4_K[1])
    return c


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def weights_for(co, cands):
    ws = []
    for bone, fac in cands:
        h, t, _ = BONES[bone]
        ws.append((bone, fac / (seg_dist(co, h, t) + 0.012) ** 4))
    ws.sort(key=lambda x: -x[1])
    ws = ws[:3]
    s = sum(w for _, w in ws)
    ws = [(b, w / s) for b, w in ws if w / s > 0.03]
    s = sum(w for _, w in ws)
    return [(b, w / s) for b, w in ws]


def body_cands(co):
    c = [("pelvis", 1.0), ("spine", 1.0), ("chest", 1.0), ("neck", 0.4), ("tail", 0.1)]
    side = "L" if co.x < 0 else "R"
    if abs(co.x) > 0.02 and co.z < 0.13:
        c += [(f"fl_upper_{side}", 0.25), (f"hl_thigh_{side}", 0.25)]
    return c


def body_weights(co):
    return weights_for(co, body_cands(co))


def neck_weights(co):
    return weights_for(co, [("chest", 0.8), ("neck", 1.0), ("head", 0.5)])


def thigh_weights(co):
    side = "L" if co.x < 0 else "R"
    return weights_for(co, [(f"hl_thigh_{side}", 1.0), ("pelvis", 0.8), (f"hl_shin_{side}", 0.25)])


def head_weights(co):
    co = Vector((co.x, face5_y_inv(co.y), co.z))  # (土兎の手直し 5 で追加) 縮めた鼻づらの頂点も元の頭の座標で重みを決める
    if FACE7:  # (土兎の手直し 7 で追加) 伸ばした鼻づらも元の頭の座標で
        co = Vector((co.x, face_y_inv(face5_y(co.y)), co.z))
    wn = smoothstep(-0.215, -0.245, co.y)  # 鼻先は nose の骨
    out = [("head", 1.0 - wn)]
    if wn > 0.02:
        out.append(("nose", wn))
    wk = smoothstep(-0.105, -0.085, co.y) * 0.4  # 後頭部は首へ少し
    if wk > 0.02:
        out = [(b, w * (1 - wk)) for b, w in out] + [("neck", wk)]
    s = sum(w for _, w in out)
    return [(b, w / s) for b, w in out if w > 0]


def ear_weights(s):
    def fn(co):
        base, tip, axis, _, _ = ear_frame(-1 if s == "L" else 1)
        t = (co - base).dot(axis) / (tip - base).length
        w2 = smoothstep(EAR_MID - 0.18, EAR_MID + 0.18, t)
        wh = smoothstep(0.08, -0.05, t)
        out = [(f"ear1_{s}", max(0.0, 1 - w2 - wh)), (f"ear2_{s}", w2), ("head", wh)]
        out = [(b, w) for b, w in out if w > 0.02]
        tot = sum(w for _, w in out)
        return [(b, w / tot) for b, w in out]
    return fn


# ---------------------------------------------------------------- メッシュの組み立て
# (土兎の手直しで追加) 付け根をなじませる幅 (m): 前脚 → 胴、後脚 → 腿、腿 → 胴 (腿は基準画でも塊として立つので狭く)。空にすると前と同じ
JOIN_R = dict(fleg=0.045, hleg=0.035, thigh=0.02)
# (土兎の手直しで追加) 付け根の裾を広げる量 (m)。交わる線のところで子の面を外へ押し出し、筒が胴へ差し込まれた角をなだらかな裾にする
JOIN_FLARE = dict(fleg=0.011, hleg=0.008, thigh=0.0)
# (土兎の手直しで追加) 付け根の頂点のスキンの重みを親の面の重みへ寄せる割合 (なじませる割合に掛ける)。跳ね・走りで脚を振っても裾が胴に付いたまま
JOIN_SKIN = 0.85


class Blend:
    """(土兎の手直しで追加) 付け根の継ぎ目を消す: 子の部品 (脚・腿) の頂点のうち親の面 (胴・腿) に近いものは、
    法線と頂点色を親の面の最も近い点の値へ寄せる (距離 0 で親と同じ、radius で子のまま)。親の中に埋まった頂点は親と同じにする。
    差し込んだだけの筒は、交わる線で陰影と色が折れて継ぎ目に見える。形はそのままで、交わる線の両側の塗りをそろえて線を消す"""

    def __init__(self, parents, radius, flare=0.0):
        self.radius = radius
        self.flare = flare
        vs, tris, self.src = [], [], []
        for ob, part in parents:
            me = ob.data
            me.calc_loop_triangles()
            o = len(vs)
            vs += [v.co.copy() for v in me.vertices]
            for lt in me.loop_triangles:
                tris.append([o + i for i in lt.vertices])
                self.src.append((me, part, tuple(lt.vertices)))
        self.bvh = BVHTree.FromPolygons(vs, tris)

    def at(self, co):
        """co に最も近い親の面の点: (点, 頂点の法線を補間した法線, 親の頂点色, 距離の符号つき (外が正))"""
        loc, _, idx, dist = self.bvh.find_nearest(co)
        me, part, tri = self.src[idx]
        ps = [me.vertices[i].co for i in tri]
        ws = poly_3d_calc(ps, loc)
        n = sum((me.vertices[i].normal * w for i, w in zip(tri, ws)), Vector()).normalized()
        if me.name in SMOOTH_N4:  # (土兎の手直し 4 で追加) 割った親はなめらかな法線 (カスタム法線) で
            n = sum((SMOOTH_N4[me.name][i] * w for i, w in zip(tri, ws)), Vector()).normalized()
        pc = color_for(part, loc, n)
        if FUR4:  # (土兎の手直し 4 で追加) 親の筆の跡の色へなじませる
            pc = fur4_paint(part, loc, pc)
        return loc, n, pc, dist if (co - loc).dot(n) >= 0 else -dist  # (土兎の手直し 4 で変更: color_for(part, loc, n) → pc)

    def weights(self, co):
        """co に最も近い親の面の点のスキンの重み (付け根を親と一緒に動かす)"""
        loc, _, idx, _ = self.bvh.find_nearest(co)
        part = self.src[idx][1]
        if part.startswith("shoulder"):  # (土兎の手直し 4 で追加) 前脚は肩の塊へなじませる
            return shoulder_weights(loc)
        fn = body_weights if part == "body" else neck_weights if part == "neck" else thigh_weights
        return fn(loc)

    def factor(self, sd):
        return 1.0 if sd <= 0 else 1.0 - smoothstep(0.0, self.radius, sd)


def make_part(name, bm, part, cands, mats, recalc=True, blend=None, nrm_fn=None):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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
    # (土兎の手直しで追加) blend (Blend) を渡した部品は、付け根の頂点の法線 (カスタム法線) と頂点色を親の面へ寄せる
    nrm = [v.normal.copy() for v in me.vertices]
    if nrm_fn is not None:  # (土兎の手直し 4 で追加) 割った部品 (densify4) は割る前のなめらかな法線 (カスタム法線) を使う
        nrm = [nrm_fn(v.co) for v in me.vertices]
        SMOOTH_N4[me.name] = nrm
    tint = {}
    wmix = {}
    if blend is not None:
        for v in me.vertices:
            _, pn, pc, sd = blend.at(v.co)
            f = blend.factor(sd)
            if f <= 1e-3:
                continue
            if blend.flare:  # 交わる線 (sd = 0) で最も外へ、内外とも radius で 0 に
                v.co += v.normal * (blend.flare * (1.0 - smoothstep(0.0, blend.radius, abs(sd))))
            nrm[v.index] = (nrm[v.index] * (1 - f) + pn * f).normalized()  # (土兎の手直し 4 で変更: v.normal → nrm[v.index]。割った部品のなめらかな法線から寄せる)
            tint[v.index] = (pc, f)
            wmix[v.index] = (blend.weights(v.co), f * JOIN_SKIN)
        me.normals_split_custom_set_from_vertices(nrm)
    elif nrm_fn is not None:  # (土兎の手直し 4 で追加)
        me.normals_split_custom_set_from_vertices(nrm)
    # 頂点色は面の角ごと (耳の焦げ茶の面などは白、毛の面だけ色を持つ)。Three.js は COLOR_0 を全材質に掛けるため
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    wall = me.attributes.get("ear_wall")  # (土兎の手直し 3 で追加) 耳の折り返しの段の壁 (build_ear_fold)
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            v = me.vertices[vi]
            c = color_for(part, v.co, v.normal) if p.material_index == BODY else WHITE
            if p.material_index == BODY and vi in tint:  # (土兎の手直しで追加) 寄せた法線で塗り、親の色へ混ぜる
                c = mix(color_for(part, v.co, nrm[vi]), tint[vi][0], tint[vi][1])
            elif nrm_fn is not None and p.material_index == BODY:  # (土兎の手直し 4 で追加) 割った部品はなめらかな法線で塗る
                c = color_for(part, v.co, nrm[vi])
            if FUR4 and p.material_index == BODY and wall is None:  # (土兎の手直し 4 で追加) 毛の部品に筆の跡 (fur4_paint)
                c = fur4_paint(part, v.co, c)
            if wall is not None and p.material_index == BODY and wall.data[p.index].value:  # (土兎の手直し 3 で追加) 段の壁は地色の陰
                c = mix(PAL["fur"], PAL["fur_shade"], EAR_WALL_SHADE)
            col.data[li].color = (*c, 1.0)
    if wall is not None:
        me.attributes.remove(wall)
    groups = {}
    for v in me.vertices:
        ws = cands(v.co) if callable(cands) else weights_for(v.co, cands)
        if v.index in wmix:  # (土兎の手直しで追加) 付け根の頂点は親の面の重みへ寄せる (上位 3 本に絞って足して 1)
            pw, f = wmix[v.index]
            acc = {}
            for b, w in ws:
                acc[b] = acc.get(b, 0.0) + w * (1 - f)
            for b, w in pw:
                acc[b] = acc.get(b, 0.0) + w * f
            top = sorted(acc.items(), key=lambda x: (-x[1], x[0]))[:3]
            tot = sum(w for _, w in top)
            ws = [(b, w / tot) for b, w in top]
        for b, w in ws:
            if b not in groups:
                groups[b] = ob.vertex_groups.new(name=b)
            groups[b].add([v.index], w, "REPLACE")
    return ob


def build_lod(lod, obj_name, mats):
    parts = []
    shell = Shell()

    bm = bmesh.new()
    build_body(bm, lod)
    nf = densify4(bm, lod)  # (土兎の手直し 4 で追加) 筆の跡を受けるため近 LOD の胴を割る
    shell.add(bm, body_weights)
    parts.append(make_part(obj_name + "_body", bm, "body", body_weights, mats, nrm_fn=nf))  # (土兎の手直し 4 で変更: nrm_fn)
    bm = bmesh.new()
    build_neck(bm, lod)
    nf = densify4(bm, lod)  # (土兎の手直し 4 で追加)
    shell.add(bm, neck_weights)
    parts.append(make_part(obj_name + "_neck", bm, "neck", neck_weights, mats, nrm_fn=nf))  # (土兎の手直し 4 で変更: nrm_fn)
    # (土兎の手直しで追加) 付け根の継ぎ目を消す先: 前脚と腿は胴 (と首) へ、後脚はその側の腿へ
    blend_body = Blend([(parts[0], "body"), (parts[1], "neck")], JOIN_R["thigh"]) if JOIN_R else None
    thighs = {}
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        build_thigh(bm, lod, side)
        nf = densify4(bm, lod)  # (土兎の手直し 4 で追加)
        shell.add(bm, thigh_weights)
        parts.append(make_part(f"{obj_name}_thigh_{s}", bm, f"thigh_{s}", thigh_weights, mats, blend=blend_body, nrm_fn=nf))  # (土兎の手直し 4 で変更: nrm_fn)
        thighs[s] = parts[-1]
    shoulders = {}
    if SHOULDER4:  # (土兎の手直し 4 で追加) 肩の塊 (胴へなじませる。継ぎ目の帯も載るよう殻に入れる)
        for side, s in ((-1, "L"), (1, "R")):
            bm = bmesh.new()
            build_shoulder(bm, lod, side)
            shell.add(bm, shoulder_weights)
            parts.append(make_part(f"{obj_name}_shoulder_{s}", bm, f"shoulder_{s}", shoulder_weights, mats, blend=blend_body))
            shoulders[s] = parts[-1]
    shell.build()

    bm = bmesh.new()
    build_head(bm, lod)
    if FACE5:  # (土兎の手直し 5 で追加) 鼻づらを縮め、顔の横幅を詰める (目・鼻・口はこの頭へ載せる)
        for v in bm.verts:
            v.co = face5(v.co)
    if FACE6:  # (土兎の手直し 6 で追加) 頬・口・顎を横へ膨らませる (目・鼻・口はこの頭へ載せる)
        for v in bm.verts:
            v.co = face6(v.co)
    if FACE7:  # (土兎の手直し 7 で追加) 口鼻を前へ伸ばす (目・鼻・口はこの頭へ載せる)
        for v in bm.verts:
            v.co = face7(v.co)
    bm.normal_update()
    bvh_head = BVHTree.FromBMesh(bm)
    parts.append(make_part(obj_name + "_head", bm, "head", head_weights, mats))
    bm = bmesh.new()
    build_nose(bm, bvh_head)
    parts.append(make_part(obj_name + "_nose", bm, "rigid", lambda co: [("nose", 1.0)], mats, recalc=False))
    if lod.get("mouth"):  # (土兎の手直しで追加) 鼻の下の口 (近 LOD だけ)
        bm = bmesh.new()
        build_mouth(bm, bvh_head, lod.get("mouth_w"))  # (土兎の手直し 3 で変更: 群れ LOD にも太い線で入れる (mouth_w))
        parts.append(make_part(obj_name + "_mouth", bm, "rigid", head_weights, mats, recalc=False))
    for side, s in ((-1, "L"), (1, "R")):
        bm = bmesh.new()
        EAR_FRONT[f"ear_{s}"] = build_ear(bm, lod, side)
        parts.append(make_part(f"{obj_name}_ear_{s}", bm, f"ear_{s}", ear_weights(s), mats, recalc=False))
        bm = bmesh.new()
        eye = build_eye(bm, bvh_head, lod, side)  # (土兎の手直し 4 で変更: 目の縁の点を受け取る)
        parts.append(make_part(f"{obj_name}_eye_{s}", bm, "glow", lambda co: [("head", 1.0)], mats, recalc=False))
        if lod["name"] == "hero" and EYE4 and not LID5_OFF:  # (土兎の手直し 4 で追加) 瞼の線 (土兎の手直し 5 で変更: LID5_OFF で付けない)
            bm = bmesh.new()
            build_eye_lid(bm, bvh_head, eye)
            parts.append(make_part(f"{obj_name}_lid_{s}", bm, "lid", lambda co: [("head", 1.0)], mats, recalc=False))
        for pre in ("fl", "hl"):
            name = f"{pre}_{s}"
            bones = LEG_BONES[name]
            parent = "chest" if pre == "fl" else "pelvis"
            bm = bmesh.new()
            build_leg(bm, lod, name)
            # (土兎の手直しで追加) 付け根の継ぎ目を消す (前脚は胴へ、後脚は腿へ)
            bl = None
            if JOIN_R:
                bl = Blend([(parts[0], "body"), (parts[1], "neck")], JOIN_R["fleg"], JOIN_FLARE["fleg"]) if pre == "fl" else \
                    Blend([(thighs[s], f"thigh_{s}")], JOIN_R["hleg"], JOIN_FLARE["hleg"])
                if pre == "fl" and shoulders:  # (土兎の手直し 4 で追加) 前脚は肩の塊 (と胴・首) へ
                    bl = Blend([(shoulders[s], f"shoulder_{s}"), (parts[0], "body"), (parts[1], "neck")], JOIN_R["fleg"], JOIN_FLARE["fleg"])
            parts.append(make_part(f"{obj_name}_leg_{name}", bm, f"leg_{name}", [(b, 1.0) for b in bones] + [(parent, 0.4)], mats, blend=bl))
    bm = bmesh.new()
    build_tail(bm, lod)
    parts.append(make_part(obj_name + "_tail", bm, "tail", [("tail", 1.0), ("pelvis", 0.3)], mats))
    parts += build_decals(shell, lod, mats, obj_name)

    if "--parts" in sys.argv:
        print(lod["name"], {o.name[len(obj_name) + 1:]: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in parts})
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
    arm = bpy.data.armatures.new("rabbit_rig")
    rig = bpy.data.objects.new("rabbit_rig", arm)
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


def solve_leg(rig, basis, leg, W, dth_f):
    """脚 1 本の 2D IK (3 本の骨)。W: 手首・踵 (関節 2) の目標 (アーマチュア空間)。dth_f: 足先の骨の rest からの角度差 (ワールド)"""
    bones = LEG_BONES[leg]
    parent = rig.data.bones[bones[0]].parent.name
    P = posed(rig, basis)
    T = P[parent] @ rest(rig, parent).inverted()
    Wr = T.inverted() @ W
    rot_par = ang(yz(T.to_3x3() @ Vector((0, 1, 0))))  # 親の回り込み (ピッチ)
    j = [yz(joint(leg, i)) for i in range(4)]
    th0 = [ang(j[i + 1] - j[i]) for i in range(3)]
    L = [(j[i + 1] - j[i]).length for i in range(3)]
    A = j[0]
    AC = yz(Wr) - A
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
    th = [ang(best - A), ang(Cn - best), th0[2] + dth_f - rot_par]
    acc = 0.0
    for i, bn in enumerate(bones):
        delta = th[i] - th0[i] - acc
        acc += delta
        basis[bn] = Matrix.Rotation(delta, 4, "X")


# (土兎の手直し 4 で追加) 前脚を折ったときに肘を外へ開く: 肩と手首を結ぶ線の回りに脚の面を回す (IK の膝の向き)。
# 肩と手首は動かないので立脚の足は地面に残り、足先の骨は回した分を戻して向きを保つ。開く角は肘の曲がり (rest からの増え) に比例
FL_SPLAY4 = math.radians(34)  # 肘を 60° 余分に曲げたときの開きの角
FL_SPLAY4_FOLD = math.radians(60)


def splay_front(rig, basis):
    """(土兎の手直し 4 で追加) 前脚 2 本の脚の面を肩 → 手首の線の回りに外へ回す (basis を書き換えて返す)"""
    for s, sx in (("L", -1), ("R", 1)):
        up, fore, paw = LEG_BONES[f"fl_{s}"]
        P = posed(rig, basis)
        sh = P[up].translation
        el = P[fore].translation
        wr = P[paw].translation
        v1, v2 = (el - sh), (wr - el)
        r1, r2 = BONES[up][1] - BONES[up][0], BONES[fore][1] - BONES[fore][0]
        bend = v1.angle(v2, 0.0) - r1.angle(r2, 0.0)
        phi = FL_SPLAY4 * smoothstep(0.0, FL_SPLAY4_FOLD, bend)
        ax = wr - sh
        if phi < 1e-4 or ax.length < 1e-4:
            continue
        ax.normalize()
        perp = (el - sh) - ax * (el - sh).dot(ax)
        if ax.cross(perp).x * sx < 0:
            phi = -phi
        Rw = Matrix.Rotation(phi, 3, ax)
        par = rig.data.bones[up].parent
        Q = (P[par.name] @ (par.matrix_local.inverted() @ rig.data.bones[up].matrix_local)).to_3x3().normalized()
        basis[up] = (Q.inverted() @ Rw @ Q).to_4x4() @ basis.get(up, Matrix.Identity(4))
        P2 = posed(rig, basis)
        bpaw = rig.data.bones[paw]
        off = bpaw.parent.matrix_local.inverted() @ bpaw.matrix_local
        M = (P2[fore] @ off).inverted() @ P[paw]
        basis[paw] = Matrix.LocRotScale(None, M.to_quaternion(), None)
    return basis


def foot_target(leg, toe, dth_f):
    """指先を toe に置き、足先の骨をワールドで dth_f 回したときの手首・踵の位置"""
    j2, j3 = joint(leg, 2), joint(leg, 3)
    v = yz(j2 - j3)
    a = ang(v) + dth_f
    Lf = v.length
    return Vector((toe.x, toe.y + Lf * math.cos(a), toe.z + Lf * math.sin(a)))


# 符号: どの骨もローカル X = ワールド X なので、ex > 0 は「骨の向きを前・下へ倒す」。
# 首・耳 (上向きの骨) は前へ倒れ、頭・背骨 (前向きの骨) は先が下がる。ey は骨の軸回りのひねり、ez は横へ振る
def rot_basis(ex=0.0, ey=0.0, ez=0.0):
    return Euler((ex, ey, ez), "XYZ").to_matrix().to_4x4()


def pelvis_basis(rig, dloc=None, wrot=None, local=None, pivot=None):
    """骨盤をワールドで dloc 動かし、wrot (ワールドの回転、pivot が中心。既定は骨盤の頭) と local (ローカル回転) を掛ける"""
    R = rest(rig, "pelvis")
    h = R.translation
    dl = dloc.copy() if dloc is not None else Vector()
    Rm = wrot.to_matrix() if wrot else Matrix.Identity(3)
    if pivot is not None:
        dl += pivot - h + Rm @ (h - pivot)
    W = Matrix.Translation(h + dl) @ Rm.to_4x4() @ Matrix.Translation(-h)
    return R.inverted() @ W @ R @ (local or Matrix.Identity(4))


D = math.radians


def ease(a, b, t):
    return smoothstep(a, b, t)


def pulse(t, t0, dur):
    x = (t - t0) / dur
    return math.sin(math.pi * x) ** 2 if 0 <= x <= 1 else 0.0


def planted(rig, b, leg):
    solve_leg(rig, b, leg, joint(leg, 2).copy(), 0.0)


def pose_idle(rig, t):
    T = 4.0
    ph = 2 * math.pi * t / T
    b = {}
    breath = math.sin(3 * ph)
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, 0.0015 * breath)))
    b["spine"] = rot_basis(-D(0.8) * breath)
    b["chest"] = rot_basis(D(0.6) * breath)
    look = math.sin(ph)
    b["neck"] = rot_basis(D(1.0) * math.sin(2 * ph), D(4) * look)
    b["head"] = rot_basis(D(2) * math.sin(ph + 1.0), 0, D(-5) * look)
    # 鼻をひくつかせる (0.4 s の間に 8 回/秒)。3 回
    tw = 0.0
    for t0 in (0.4, 1.9, 3.1):
        x = (t - t0) / 0.45
        if 0 <= x <= 1:
            tw += math.sin(math.pi * x) * math.sin(2 * math.pi * 8 * (t - t0))
    b["nose"] = rot_basis(D(9) * tw)
    b["head"] = b["head"] @ rot_basis(D(1.2) * tw)
    # 耳を回す: 1.0 s に左耳を外へ向け、2.5 s に右耳。耳の先は少し遅れてなびく
    tl = pulse(t, 0.9, 1.3)
    tr = pulse(t, 2.4, 1.3)
    b["ear1_L"] = rot_basis(-D(8) * tl, D(-50) * tl, D(10) * tl)
    b["ear2_L"] = rot_basis(D(6) * pulse(t, 1.0, 1.3))
    b["ear1_R"] = rot_basis(-D(8) * tr, D(50) * tr, D(-10) * tr)
    b["ear2_R"] = rot_basis(D(6) * pulse(t, 2.5, 1.3))
    b["tail"] = rot_basis(D(6) * pulse(t, 2.0, 0.4))
    for leg in LEG_BONES:
        planted(rig, b, leg)
    return b


def pose_bound(rig, t, T, stride_h, stride_f, lift, pitch_amp, flex_amp, duty_h, duty_f, off_f, ears):
    """跳ね (hop) と走り (run) の共通: 後脚で蹴って宙に浮き、前足が着いてから後脚が前へ来て着く。その場で繰り返す。
    u = 0 は後脚が着いて縮んだところ。後脚の立脚は [0.8, 0.8 + duty_h)、前脚は [off_f, off_f + duty_f)"""
    u = t / T
    b = {}
    # 体の高さ: 蹴り出しから前足の着地まで浮く
    up = math.sin(math.pi * max(0.0, min(1.0, (u - 0.05) / 0.55)))
    pitch = D(pitch_amp) * math.sin(2 * math.pi * (u - 0.3))  # 蹴り出しで鼻先が上、前足の着地で下
    flex = D(flex_amp) * math.cos(2 * math.pi * (u - 0.9))    # 縮んだところで背を丸め、伸びたところで反らす
    b["pelvis"] = pelvis_basis(rig, Vector((0, 0, 0.012 + lift * up)), wrot=Quaternion(X, pitch), pivot=Vector((0, -0.02, 0.17)),
                               local=rot_basis(flex * 0.6))
    b["spine"] = rot_basis(-flex * 0.3)
    b["chest"] = rot_basis(-flex * 0.3)
    b["neck"] = rot_basis(-pitch * 0.5 + D(4))
    b["head"] = rot_basis(-pitch * 0.4 - D(4))
    lag = math.sin(2 * math.pi * (u - 0.45))
    b["ear1_L"] = rot_basis(D(ears) + D(6) * lag, 0, D(4))
    b["ear1_R"] = rot_basis(D(ears) + D(6) * lag, 0, D(-4))
    b["ear2_L"] = b["ear2_R"] = rot_basis(D(10) * lag - D(4))
    b["tail"] = rot_basis(-D(10) * up)
    for leg in LEG_BONES:
        front = leg.startswith("fl")
        stride, duty, off = (stride_f, duty_f, off_f) if front else (stride_h, duty_h, 0.8)
        toe0 = joint(leg, 3)
        uu = (u - off) % 1.0
        if uu < duty:
            s = uu / duty
            y = toe0.y - stride / 2 + stride * s
            z = toe0.z
            dth = 0.0
            if not front:
                dth = D(55) * smoothstep(0.55, 1.0, s)  # 蹴り出し: 踵が上がり指先で蹴る
        else:
            s = (uu - duty) / (1 - duty)
            e = s * s * (3 - 2 * s)
            y = toe0.y + stride / 2 - stride * e
            z = toe0.z + (0.05 if front else 0.035) * math.sin(math.pi * s) + (0.015 if front else 0.0) * math.sin(math.pi * s) ** 2
            if SHOULDER4 and front:  # (土兎の手直し 4 で追加) 振り出しの前足を胸の下へたたみ込みすぎて胸に潜っていたので、持ち上げを 2 割下げる
                z -= 0.2 * (z - toe0.z)
            dth = (D(45) if front else D(55) * (1 - s) + D(-15) * math.sin(math.pi * s))
        W = foot_target(leg, Vector((toe0.x, y, z)), dth)
        solve_leg(rig, b, leg, W, dth)
    return b


def pose_hop(rig, t):
    return pose_bound(rig, t, 0.5, 0.20, 0.14, 0.045, 8, 7, 0.45, 0.32, 0.42, -12)


def pose_run(rig, t):
    return pose_bound(rig, t, 0.35, 0.30, 0.22, 0.035, 11, 13, 0.36, 0.26, 0.40, -38)


GRAZE4 = dict(lift=0.036, pelvis=18, spine=8, chest=2, neck=52, head=-34)  # (土兎の手直し 4 で追加) 採食の姿勢 (元は 0.030 / 18 / 14 / 8 / 24 / -25)
GRAZE5 = dict(lift=0.036, pelvis=22, spine=8, chest=2, neck=60, head=-40, paw=0.075, paw_z=0.012)  # (土兎の手直し 5 で追加) 短い鼻づらで鼻先を地面へ届かせる採食の姿勢 (GRAZE4 の代わり)
if FACE7:  # (土兎の手直し 7 で追加) 口鼻を前へ伸ばしたので鼻先が地面と前足へ届きすぎる。首の下げを浅くする (元は neck=60, head=-40)
    GRAZE5 = dict(GRAZE5, neck=GRAZE7_NECK, head=GRAZE7_HEAD)


def pose_graze(rig, t):
    # 0-0.7 s 頭を地面へ、0.7-3.3 s 食む (鼻と頭を小刻みに)、3.3-4 s 上げる
    down = ease(0.0, 0.7, t) * (1 - ease(3.3, 4.0, t))
    chew = ease(0.7, 0.9, t) * (1 - ease(3.1, 3.3, t))
    b = {}
    # 腰を少し上げて背を丸め (基準画の採食)、胸を前へ下げ、首と頭で鼻先を地面へ (鼻先の高さ ~0.03 m)
    # (M22-05 残りの手直しで変更: 背の丸みが弱かったので、腰を 14° → 18° 起こして 0.014 → 0.03 m 上げ、背骨を 8° → 14° 丸めた。
    #  胸は 12° → 8°、首は 34° → 24°、頭は -18° → -25° にして鼻先と胸の高さを保つ (地面へ潜らない))
    b["pelvis"] = pelvis_basis(rig, Vector((0, -0.004 * down, 0.030 * down)), wrot=Quaternion(X, D(18) * down), pivot=Vector((0, 0.12, 0.03)))
    b["spine"] = rot_basis(D(14) * down)
    b["chest"] = rot_basis(D(8) * down)
    nib = math.sin(2 * math.pi * 4 * t) * chew
    b["neck"] = rot_basis(D(24) * down + D(1.5) * nib)
    b["head"] = rot_basis(-D(25) * down + D(2.5) * nib, 0, D(4) * math.sin(2 * math.pi * t / 2) * chew)
    if SHOULDER4:
        # (土兎の手直し 4 で追加) 胸が地面すれすれ (+7 mm) まで下がって前脚が胸に埋まっていた。基準画の採食は胸の下が地面から離れ、
        # 前脚が肘を後ろへ折って見える。胸を上げ (背骨・胸の曲げを弱め、腰を高く)、首と頭を深く下げて鼻先を地面へ届かせる
        b["pelvis"] = pelvis_basis(rig, Vector((0, -0.004 * down, GRAZE4["lift"] * down)), wrot=Quaternion(X, D(GRAZE4["pelvis"]) * down),
                                   pivot=Vector((0, 0.12, 0.03)))
        b["spine"] = rot_basis(D(GRAZE4["spine"]) * down)
        b["chest"] = rot_basis(D(GRAZE4["chest"]) * down)
        b["neck"] = rot_basis(D(GRAZE4["neck"]) * down + D(1.5) * nib)
        b["head"] = rot_basis(D(GRAZE4["head"]) * down + D(2.5) * nib, 0, D(4) * math.sin(2 * math.pi * t / 2) * chew)
    if FACE5:
        # (土兎の手直し 5 で追加) 鼻づらを縮めたので鼻先が地面から 1.5 → 6.6 cm に浮いた。首をもう少し下げ、頭の起こしを弱めて鼻先を地面へ
        b["pelvis"] = pelvis_basis(rig, Vector((0, -0.004 * down, GRAZE5["lift"] * down)), wrot=Quaternion(X, D(GRAZE5["pelvis"]) * down),
                                   pivot=Vector((0, 0.12, 0.03)))
        b["spine"] = rot_basis(D(GRAZE5["spine"]) * down)
        b["chest"] = rot_basis(D(GRAZE5["chest"]) * down)
        b["neck"] = rot_basis(D(GRAZE5["neck"]) * down + D(1.5) * nib)
        b["head"] = rot_basis(D(GRAZE5["head"]) * down + D(2.5) * nib, 0, D(4) * math.sin(2 * math.pi * t / 2) * chew)
    b["nose"] = rot_basis(D(10) * math.sin(2 * math.pi * 7 * t) * chew)
    # 耳は頭が下がった分だけ後ろへ寝かせ、上へ立てたままにする (基準画の採食)
    b["ear1_L"] = rot_basis(-D(40) * down, 0, D(8) * down)
    b["ear1_R"] = rot_basis(-D(40) * down + D(10) * pulse(t, 1.8, 0.4), 0, -D(8) * down)
    b["ear2_L"] = b["ear2_R"] = rot_basis(-D(8) * down)
    b["tail"] = rot_basis(D(5) * math.sin(2 * math.pi * t / 2))
    for leg in LEG_BONES:
        planted(rig, b, leg)
    if FACE5:  # (土兎の手直し 5 で追加) 胸を下げる分、前足を前へ置き直して上腕を胸から離す
        for leg in LEG_BONES:
            if leg.startswith("fl"):
                solve_leg(rig, b, leg, joint(leg, 2) + Vector((0, -GRAZE5["paw"] * down, GRAZE5["paw_z"] * down)), 0.0)
    return b


ALERT4 = (20, 32, 28)  # (土兎の手直し 4 で追加) 立ち上がりの前脚の曲げ (上腕・前腕・前足、元は 38 / 30 / 35)


def pose_alert(rig, t):
    # 0-0.7 s 後ろ足で立ち上がり耳を立てる、0.8-2.2 s 左右を見る、2.3-3 s 座り直す (最初と最後は rest)
    k = ease(0.0, 0.7, t) * (1 - ease(2.3, 3.0, t))
    b = {}
    # 腰の後ろ下 (踵の上) を中心に体を 58° 起こし、少し持ち上げる
    # (M22-05 残りの手直しで変更: 立ち上がりで胴が細長い柱に見えたので、体の起こしを 64° → 58° にし、背骨と胸を前へ丸めて
    #  (spine -6° → +3°、chest 4° → 8°) 胴を詰め、腹を前へ張らせる。首と頭はその分を戻す (neck 34° → 28°、head 18° → 15°)。
    #  元は wrot=Quaternion(X, -D(64) * k)、spine rot_basis(-D(6) * k)、chest rot_basis(D(4) * k))
    b["pelvis"] = pelvis_basis(rig, Vector((0, -0.035 * k, 0.062 * k)), wrot=Quaternion(X, -D(58) * k), pivot=Vector((0, 0.12, 0.05)))
    b["spine"] = rot_basis(D(3) * k)
    b["chest"] = rot_basis(D(8) * k)
    look = -ease(0.8, 1.1, t) * (1 - ease(1.4, 1.7, t)) + ease(1.5, 1.8, t) * (1 - ease(1.95, 2.25, t))
    b["neck"] = rot_basis(D(28) * k, D(18) * look)
    b["head"] = rot_basis(D(15) * k, 0, D(-28) * look)
    b["nose"] = rot_basis(D(9) * math.sin(2 * math.pi * 8 * t) * pulse(t, 1.35, 0.3))
    # 耳を立てて前へ開く
    b["ear1_L"] = rot_basis(D(12) * k, D(-18) * k, D(-8) * k)
    b["ear1_R"] = rot_basis(D(12) * k, D(18) * k, D(8) * k)
    b["ear2_L"] = b["ear2_R"] = rot_basis(-D(4) * k)
    # 前足は胸の前に垂らす
    for s in "LR":
        b[f"fl_upper_{s}"] = rot_basis(D(38) * k)
        b[f"fl_fore_{s}"] = rot_basis(D(30) * k)
        b[f"fl_paw_{s}"] = rot_basis(D(35) * k)
        if SHOULDER4:
            # (土兎の手直し 4 で追加) 前足の先が腹へ 11 mm 潜っていた。基準画の立ち上がりは上腕を前下へ出して肘を胸の前に置き、
            # 前腕を下へ垂らす。上腕の倒しを弱め (38° → ALERT4)、前腕・前足の曲げで先を丸める
            b[f"fl_upper_{s}"] = rot_basis(D(ALERT4[0]) * k)
            b[f"fl_fore_{s}"] = rot_basis(D(ALERT4[1]) * k)
            b[f"fl_paw_{s}"] = rot_basis(D(ALERT4[2]) * k)
    b["tail"] = rot_basis(-D(15) * k)
    for leg in ("hl_L", "hl_R"):
        planted(rig, b, leg)
    return b


def pose_fall(rig, t):
    # 0-0.4 s 脚が折れて沈む、0.25-1.0 s 右側を下に横倒し、0.8-1.5 s 頭と耳が地に落ちて静まる
    k1 = ease(0.0, 0.4, t)
    k2 = ease(0.25, 1.0, t)
    k3 = ease(0.8, 1.5, t)
    b = {}
    roll = Quaternion(Vector((0, 1, 0)), D(84) * k2)  # +Y 軸回り (体の右側を下に)。接地の高さは bake_actions が地面に合わせる
    drop = Vector((0.05 * k2, 0.0, -0.03 * k1))
    b["pelvis"] = pelvis_basis(rig, drop, wrot=roll, pivot=Vector((0.0, 0.05, 0.14)), local=rot_basis(D(6) * k1 * (1 - k2)))
    b["spine"] = rot_basis(D(3) * k1)
    b["chest"] = rot_basis(D(5) * k1 * (1 - k2))
    b["neck"] = rot_basis(D(18) * k1 - D(10) * k2, 0, -D(20) * k3)
    b["head"] = rot_basis(-D(8) * k1 + D(10) * k3, D(25) * k3, 0)
    b["ear1_L"] = rot_basis(-D(35) * k3, 0, D(10) * k3)
    b["ear1_R"] = rot_basis(-D(35) * k3, 0, -D(10) * k3)
    b["ear2_L"] = b["ear2_R"] = rot_basis(-D(20) * k3)
    b["tail"] = rot_basis(D(10) * k3)
    # 倒れ始めるまでは足を地面に残したまま (IK) 脚が折れ、横倒しにつれて投げ出した形 (FK) へ移る
    relax_f = [-D(25), D(10), D(20)]  # 横倒し後: 前へ投げ出す
    relax_h = [D(40), -D(40), D(25)]  # 後ろへ伸ばす
    ik = dict(b)
    for leg in LEG_BONES:
        planted(rig, ik, leg)
    for leg, bones in LEG_BONES.items():
        relax = relax_f if leg.startswith("fl") else relax_h
        for i, bn in enumerate(bones):
            q = ik[bn].to_quaternion().slerp(Quaternion(X, relax[i]), k2)
            b[bn] = q.to_matrix().to_4x4()
    return b


ACTIONS = [("idle", 4.0, pose_idle, True), ("hop", 0.5, pose_hop, True), ("run", 0.35, pose_run, True),
           ("graze", 4.0, pose_graze, True), ("alert", 3.0, pose_alert, True), ("fall", 1.5, pose_fall, False)]
GROUND = {"fall"}  # 近 LOD の一番低い頂点を rest と同じ高さ (地面 +2 mm) に合わせるアクション (横倒しで地面へめり込まない・浮かない)


def apply_pose(rig, basis):
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
    """骨盤をワールドの上下に動かして、メッシュの一番低い点を z0 に合わせる"""
    apply_pose(rig, basis)
    dz = z0 - min_z(ob)
    R = rest(rig, "pelvis")
    basis["pelvis"] = R.inverted() @ Matrix.Translation((0, 0, dz)) @ R @ basis.get("pelvis", Matrix.Identity(4))
    return basis


def bake_actions(rig, hero):
    global ORDER
    ORDER = bone_order(rig)
    apply_pose(rig, {})
    z_rest = min_z(hero)
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
            basis = fn(rig, t if (f < nf or not loop) else 0.0)  # ループは最後のフレームを最初と同じにする
            if SHOULDER4:  # (土兎の手直し 4 で追加) 前脚を折ったときに肘を外へ開く (splay_front)
                basis = splay_front(rig, basis)
            if name in GROUND:
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
    meshes = [build_lod(HERO, "rabbit", mats), build_lod(LOD1, "rabbit_lod1", mats)]
    for ob in meshes:
        # アーマチュアの子にしない (glTF ではスキンのメッシュをルートに置く。親の変換はスキンに効かないため)
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f"mesh {ob.name}: {len(ob.data.vertices)} verts / {tris} tris, groups {len(ob.vertex_groups)}")
    bake_actions(rig, meshes[0])
    build_far(meshes[1], "rabbit_far", rig, far_ratio)  # (M23-08) 遠い段
    scene.frame_set(0)
    for o in scene.objects:
        o.select_set(True)
    blend = os.path.abspath(os.path.join(OUT_DIR, "rabbit.blend"))
    glb = os.path.abspath(os.path.join(OUT_DIR, "rabbit.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_animation_mode="ACTIONS",
                              export_force_sampling=True, export_frame_step=1, export_skins=True, export_influence_nb=4,
                              export_vertex_color="ACTIVE", export_yup=True, export_apply=False, export_def_bones=False,
                              export_optimize_animation_size=True, export_anim_slide_to_zero=True, export_rest_position_armature=True)
    print("saved", blend)
    print("saved", glb)


main()
