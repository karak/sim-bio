"""土兎 (rabbit) のローポリ 3D モデルを参照画像 assets/textures/concept/rabbit-angular.png から組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/rabbit.py -- assets/models
出力: <out_dir>/rabbit.blend (git 管理外) と <out_dir>/rabbit.glb
検証: tools/blender/compare_ref.py で参照画像と同アングル撮影し、パーツ別に色と配置を定量比較する

作り方 (プリミティブの寄せ集めではなく、断面リングのロフトで面構成を作る):
  - 各パーツは「背骨に沿った断面リング (7〜12 頂点)」を順に bridge した閉じたメッシュ。
    リング数を絞ることで参照画像のような大きな平面ファセットが出る。
  - 目: 頭の側面に「塗られた」前下がりのアーモンド形。表面にレイキャストして平面デカールとして貼る。
  - 鼻: 口先を平らに切り (点に収束させない)、その前面に逆三角の暗いデカールを貼る。
  - 耳: 7 頂点リングで前面中央を 1 枚の広いファセットにし、その列を先端まで濃い色にする (縁に地色が残る)。
  - 六角模様: 盛り上がった宝石ではなく、暗いティールの縁取り + 明るいシアンの面の 2 層デカール。
    パネル線 (ティールの細い帯) でつなぐ。
  - 前脚の足先は濃い色。

色は参照画像の量子化代表色から: fur #D4AC54 / 耳内側・足先・鼻 #5C3C34 / 発光 #8CFCEC / 縁取り #5C847C
寸法は参照画像の比率から: 耳含む全高 ≈ 0.9 m、頭高/胴高 ≈ 0.45、耳長 ≈ 0.38 m。
単位 m、Z up、正面 -Y、原点は足元。
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = argv[0] if argv else "assets/models"
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


# ---------- マテリアル ----------
def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str):
    """#RRGGBB (sRGB) → Blender/glTF が期待するリニア RGB"""
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def solid(name: str, color: str, emission: float = 0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    rgb = hex_rgb(color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
        bsdf.inputs["Emission Strength"].default_value = emission
    m.diffuse_color = (*rgb, 1)  # Workbench / ソリッド表示用
    return m


MATS = [
    solid("rabbit_fur", "#D4AC54"),
    solid("rabbit_ear_inner", "#5C3C34"),
    solid("rabbit_dark", "#5C3C34"),
    solid("rabbit_glow", "#8CFCEC", emission=0.6),
    solid("rabbit_teal", "#5C847C"),
]
FUR, EAR, DARK, GLOW, TEAL = range(5)


# ---------- ロフト用ヘルパ ----------
def ring(bm, center, ux, uy, rx, ry, n=8, phase=0.0, angles=None):
    """center を中心に ux/uy 平面上へ楕円リングを置く。angles (度) を渡すと頂点の角度を直接指定できる"""
    if angles is None:
        angles = [math.degrees(phase) + 360 * i / n for i in range(n)]
    return [
        bm.verts.new(center + ux * (rx * math.cos(math.radians(a))) + uy * (ry * math.sin(math.radians(a))))
        for a in angles
    ]


def loft(bm, rings, cap_start=True, cap_end=True):
    """隣り合うリングを四角面で bridge する。要素が BMVert 単体なら扇状に収束させる"""
    faces = []
    for a, b in zip(rings, rings[1:]):
        if isinstance(a, list) and isinstance(b, list):
            n = len(a)
            for i in range(n):
                faces.append(bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])))
        elif isinstance(a, list):  # b は点
            n = len(a)
            for i in range(n):
                faces.append(bm.faces.new((a[i], a[(i + 1) % n], b)))
        else:  # a は点
            n = len(b)
            for i in range(n):
                faces.append(bm.faces.new((a, b[(i + 1) % n], b[i])))
    if cap_start and isinstance(rings[0], list):
        faces.append(bm.faces.new(list(reversed(rings[0]))))
    if cap_end and isinstance(rings[-1], list):
        faces.append(bm.faces.new(rings[-1]))
    return faces


def densify(sections, bulge=1.035):
    """隣り合う断面の中間にもう 1 断面を挿入する。半径をわずかに膨らませ、丸みのある多面体にする"""
    out = []
    for a, b in zip(sections, sections[1:]):
        out.append(a)
        mid = tuple((x + y) / 2 for x, y in zip(a, b))
        out.append(mid[:2] + tuple(r * bulge for r in mid[2:]))
    out.append(sections[-1])
    return out


def finish(bm, name):
    """bmesh をオブジェクト化。法線を外向きに揃え、全マテリアルスロットを持たせる"""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in MATS:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


parts = []

# ---------- 胴 (尻尾側 → 胸): 12 頂点リング、側面と上下に平らなファセット ----------
bm = bmesh.new()
# (y, z中心, 半幅x, 半高z)
body_sections = densify([
    (0.25, 0.13, 0.05, 0.05),
    (0.215, 0.16, 0.13, 0.12),
    (0.15, 0.19, 0.185, 0.185),
    (0.08, 0.22, 0.20, 0.22),  # 腰の最大部
    (0.0, 0.25, 0.19, 0.235),
    (-0.09, 0.27, 0.17, 0.215),
    (-0.17, 0.27, 0.15, 0.20),  # 胸〜首 (参照では頭の下に胸が大きく張り出す)
    (-0.24, 0.29, 0.11, 0.15),
    (-0.275, 0.31, 0.06, 0.09),
])
rings = [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 12, math.pi / 12) for y, zc, rx, rz in body_sections]
loft(bm, rings)
body = finish(bm, "body")
parts.append(body)

# ---------- 頭 (後頭部 → 口先): 12 頂点リング。口先は平らに切る ----------
bm = bmesh.new()
head_sections = densify([
    (-0.08, 0.45, 0.08, 0.08),
    (-0.12, 0.47, 0.135, 0.13),
    (-0.17, 0.475, 0.155, 0.14),  # 最大幅
    (-0.22, 0.47, 0.15, 0.135),
    (-0.27, 0.45, 0.125, 0.115),
    (-0.31, 0.43, 0.10, 0.095),
    (-0.345, 0.41, 0.065, 0.06),  # 口先 (平らなキャップ。ここに鼻のデカールを貼る)
])
rings = [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 12, math.pi / 12) for y, zc, rx, rz in head_sections]
loft(bm, rings)
head = finish(bm, "head")
parts.append(head)


# ---------- 耳: 幅広の刃状。前面中央を広い 1 ファセットにし、その列を先端まで濃い色に ----------
# (ux, uy) 平面での頂点角度。270° が前面中央。195°→345° の 1 面が広い前面、その両脇 15° が縁
EAR_ANGLES = [0, 25, 90, 155, 180, 200, 340]


def make_ear(sgn):
    bm = bmesh.new()
    axis = Vector((sgn * 0.24, 0.20, 0.95)).normalized()  # 外へ 14°、後ろへ 12° 傾く
    ux = Y.cross(axis).normalized()  # 幅方向 (≈X)
    uy = axis.cross(ux).normalized()  # 厚み方向 (≈Y、前が -uy)
    base = Vector((sgn * 0.08, -0.165, 0.555))
    # (軸方向距離, 半幅, 半厚)
    ear_sections = [(0.0, 0.04, 0.024), (0.09, 0.062, 0.03), (0.20, 0.075, 0.028), (0.29, 0.058, 0.02), (0.35, 0.03, 0.012)]
    rings = [ring(bm, base + axis * t, ux, uy, w, th, angles=EAR_ANGLES) for t, w, th in ear_sections]
    tip = bm.verts.new(base + axis * 0.38)
    faces = loft(bm, rings + [tip])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # 前面中央の列 (法線がほぼ -uy) を、付け根の 1 段を除いて濃い色に
    for f in faces:
        c = f.calc_center_median()
        if f.normal.dot(-uy) > 0.9 and (c - base).dot(axis) > 0.05:
            f.material_index = EAR
    return finish(bm, f"ear_{'R' if sgn > 0 else 'L'}")


parts += [make_ear(1), make_ear(-1)]


# ---------- 前脚: 上 (胴の中) → 足先。足先は濃い色 ----------
def make_foreleg(sgn):
    bm = bmesh.new()
    sx = sgn * 0.075
    # (z, y中心, 半幅x, 半奥行y)
    leg_sections = [(0.28, -0.235, 0.04, 0.05), (0.20, -0.245, 0.037, 0.045), (0.12, -0.255, 0.036, 0.045), (0.045, -0.265, 0.04, 0.058), (0.0, -0.275, 0.042, 0.065)]
    rings = [ring(bm, Vector((sx, y, z)), X, Y, rx, ry, 8, math.pi / 8) for z, y, rx, ry in leg_sections]
    faces = loft(bm, rings)
    for f in faces:
        if f.calc_center_median().z < 0.045:
            f.material_index = DARK
    return finish(bm, f"foreleg_{'R' if sgn > 0 else 'L'}")


parts += [make_foreleg(1), make_foreleg(-1)]


# ---------- 後ろ足: かかと → つま先の平たい足 ----------
def make_hindfoot(sgn):
    bm = bmesh.new()
    sx = sgn * 0.14
    # (y, 半幅x, 半高z)
    foot_sections = [(0.19, 0.05, 0.032), (0.10, 0.06, 0.045), (0.0, 0.06, 0.042), (-0.10, 0.05, 0.03)]
    rings = [ring(bm, Vector((sx, y, rz + 0.002)), X, Z, rx, rz, 8, math.pi / 8) for y, rx, rz in foot_sections]
    faces = loft(bm, rings)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in faces:  # かかと側 (後ろ半分) の側面と底を濃い色に
        if f.normal.z < 0.5 and f.calc_center_median().y > 0.04:
            f.material_index = DARK
    return finish(bm, f"hindfoot_{'R' if sgn > 0 else 'L'}")


parts += [make_hindfoot(1), make_hindfoot(-1)]

# ---------- 尻尾 ----------
bm = bmesh.new()
rings = [ring(bm, Vector((0, 0.22, 0.20)), X, Z, 0.04, 0.05, 8, math.pi / 8), ring(bm, Vector((0, 0.28, 0.195)), X, Z, 0.05, 0.055, 8, math.pi / 8)]
tail_tip = bm.verts.new(Vector((0, 0.325, 0.185)))
loft(bm, rings + [tail_tip])
parts.append(finish(bm, "tail"))


# ---------- 表面に貼るデカール (目・鼻・六角模様・パネル線) ----------
# 配置は参照画像の実測値で指定する。compare_ref.py と同じカメラ (方位 45°、仰角 10°) を組み、
# 参照画像のシルエット bbox 正規化座標 (fx: 中心 0、fy: 上 0、高さ 1) を、モデルの投影 bbox に当てはめて
# レイキャストし表面点を得る。参照は右側面 (+X 側) が手前なので、左側は x を反転して貼る。
# 数値の出所: compare_ref.py が出力する ref_components.json (cyan_core / teal / dark)
from bpy_extras.object_utils import world_to_camera_view

bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
base_parts = list(parts)

REF_AZ, REF_EL = 45.0, 10.0
_pts = [o.matrix_world @ Vector(c) for o in base_parts for c in o.bound_box]
_lo = Vector((min(p[i] for p in _pts) for i in range(3)))
_hi = Vector((max(p[i] for p in _pts) for i in range(3)))
_center, _height = (_lo + _hi) / 2, _hi.z - _lo.z
cam_data = bpy.data.cameras.new("ref_cam")
cam_data.lens = 50
ref_cam = bpy.data.objects.new("ref_cam", cam_data)
scene.collection.objects.link(ref_cam)
scene.camera = ref_cam
scene.render.resolution_x = scene.render.resolution_y = 1024
_fov = 2 * math.atan(cam_data.sensor_width / 2 / cam_data.lens)
_dist = (_height / 0.62) / 2 / math.tan(_fov / 2)
_a, _e = math.radians(REF_AZ), math.radians(REF_EL)
ref_cam.location = _center + Vector((math.cos(_a) * math.cos(_e) * _dist, -math.sin(_a) * math.cos(_e) * _dist, math.sin(_e) * _dist))
ref_cam.rotation_euler = (_center - ref_cam.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.view_layer.update()

# モデルの投影 bbox (画像座標 0..1、y は上向き)
_proj = [world_to_camera_view(scene, ref_cam, o.matrix_world @ v.co) for o in base_parts for v in o.data.vertices]
_x0, _x1 = min(p.x for p in _proj), max(p.x for p in _proj)
_y0, _y1 = min(p.y for p in _proj), max(p.y for p in _proj)
_h = _y1 - _y0
FRAME_M = _height  # 正規化枠 1 = モデルの全高 (m)。参照の寸法をメートルへ換算する係数
_tr, _br, _bl, _tl = cam_data.view_frame(scene=scene)


def tangent_frame(n):
    u = (Z.cross(n) if abs(n.z) < 0.9 else X.cross(n)).normalized()
    return u, n.cross(u).normalized()


def surface_frame(obj, target, inner):
    """target 付近の obj 表面点と接平面基底。inner へ向けて外側からレイキャストする"""
    origin = target + (target - inner) * 3
    direction = (inner - origin).normalized()
    hit, loc, normal, _ = obj.ray_cast(origin, direction, depsgraph=depsgraph)
    if not hit:
        raise RuntimeError(f"表面が見つかりません {target}")
    n = normal.normalized()
    return (loc, n) + tangent_frame(n)


def at_ref(fx, fy, objs=None, mirror=False, center=False):
    """参照画像の正規化座標 (fx, fy) をカメラ越しにモデル表面へ投影する。
    mirror=True で左側 (x 反転) の対応点、center=True で x=0 の正中線上に落とし直す"""
    objs = objs or base_parts
    ix = (_x0 + _x1) / 2 + fx * _h
    iy = _y1 - fy * _h
    p_local = _bl + (_br - _bl) * ix + (_tl - _bl) * iy
    p_world = ref_cam.matrix_world @ p_local
    origin = ref_cam.matrix_world.translation
    d = (p_world - origin).normalized()
    best = None
    for o in objs:
        hit, loc, normal, _ = o.ray_cast(origin, d, depsgraph=depsgraph)
        if hit and (best is None or (loc - origin).length < (best[0] - origin).length):
            best = (loc, normal.normalized(), o)
    if best is None:
        # 参照の輪郭がモデルより外側にある点: 中心側へ少しずつ寄せて当たる所に置く
        if abs(fx) < 0.005:
            raise RuntimeError(f"参照座標 ({fx}, {fy}) がモデルに当たりません")
        step = -0.01 if fx > 0 else 0.01
        return at_ref(fx + step, fy, objs, mirror, center)
    loc, n, o = best
    if mirror:
        # モデルは左右対称なので、カメラ位置とレイ方向を x 反転して撃てば必ず対応点に当たる
        origin2 = Vector((-origin.x, origin.y, origin.z))
        d2 = Vector((-d.x, d.y, d.z))
    if center:
        # 正中線上: 当たった点の高さで、正面から後方へ撃ち直す
        origin2 = Vector((0, loc.y - 0.5, loc.z))
        d2 = Vector((0, 1, 0))
    if mirror or center:
        best2 = None
        for o2 in objs:
            hit, loc2, normal2, _ = o2.ray_cast(origin2, d2, depsgraph=depsgraph)
            if hit and (best2 is None or (loc2 - origin2).length < (best2[0] - origin2).length):
                best2 = (loc2, normal2.normalized())
        if best2 is None:
            raise RuntimeError(f"参照座標 ({fx}, {fy}) の対応点 {target} が見つかりません")
        loc, n = best2
    return (loc, n) + tangent_frame(n)


def decal_at(name, frame, pts_uv, mat, tilt_deg=0.0, offset=0.002):
    """接平面上の多角形 (pts_uv: (u,v) 座標列 [m]) を、表面から offset だけ浮かせた 1 枚の面として貼る"""
    loc, n, u, v = frame
    t = math.radians(tilt_deg)
    du = u * math.cos(t) + v * math.sin(t)
    dv = -u * math.sin(t) + v * math.cos(t)
    bm = bmesh.new()
    verts = [bm.verts.new(loc + n * offset + du * a + dv * b) for a, b in pts_uv]
    f = bm.faces.new(verts)
    f.material_index = mat
    f.normal_update()
    if f.normal.dot(n) < 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    parts.append(finish(bm, name))


def almond(L, H, k=4):
    """両端が尖ったアーモンド形 (レンズ形) の頂点列"""
    step = 180 // (k + 1)
    top = [(L * math.cos(math.radians(a)), H * math.sin(math.radians(a))) for a in range(180 - step, 0, -step)]
    return [(-L, 0.0)] + top + [(L, 0.0)] + [(x, -y) for x, y in reversed(top)]


def hexagon(r, rot=30):
    return [(r * math.cos(math.radians(rot + 60 * i)), r * math.sin(math.radians(rot + 60 * i))) for i in range(6)]


def jewel(name, fx, fy, r_frame, mirror=False):
    """六角ジュエル: ティールの縁取り (下層) + シアンの面 (上層)。位置と半径は参照の実測値。胴体にだけ貼る"""
    r = r_frame * FRAME_M
    fr = at_ref(fx, fy, objs=[body], mirror=mirror)
    decal_at(f"{name}_rim", fr, hexagon(r + 0.006), TEAL, offset=0.0015)
    decal_at(f"{name}_core", fr, hexagon(r), GLOW, offset=0.003)


def ribbon(name, pts, mat=TEAL, width=0.009, offset=0.0015, mirror=False, step=0.012):
    """参照座標の折れ線を胴体表面に投影し、細い帯にする (パネル線)。面に沿うよう step 間隔で細分する"""
    dense = []
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(bx - ax, by - ay) / step))
        dense += [(ax + (bx - ax) * i / n, ay + (by - ay) * i / n) for i in range(n)]
    dense.append(pts[-1])
    hits = [at_ref(fx, fy, objs=[body], mirror=mirror) for fx, fy in dense]
    bm = bmesh.new()
    prev = None
    for i, (loc, n, _, _) in enumerate(hits):
        d = (hits[i + 1][0] - loc) if i + 1 < len(hits) else (loc - hits[i - 1][0])
        d = d.normalized()
        side = n.cross(d).normalized() * (width / 2)
        pair = (bm.verts.new(loc + n * offset - side), bm.verts.new(loc + n * offset + side))
        if prev:
            f = bm.faces.new((prev[0], prev[1], pair[1], pair[0]))
            f.material_index = mat
        prev = pair
    parts.append(finish(bm, name))


# 鼻: 口先の前面、正中線上に逆三角 (参照: fx -0.237, fy 0.563, r 0.022)
decal_at("nose", at_ref(-0.237, 0.563, center=True),
         [(-0.028, 0.016), (0.028, 0.016), (0.02, -0.006), (0.0, -0.03), (-0.02, -0.006)], DARK)

for mirror in (False, True):
    tag = "L" if mirror else "R"
    sgn = -1 if mirror else 1
    # 目: 頭の側面 (参照: fx -0.122, fy 0.508、面積から L 0.058 / H 0.034 m)。後ろが上がる向きに傾ける
    decal_at(f"eye_{tag}", at_ref(-0.122, 0.508, mirror=mirror), almond(0.058, 0.034), GLOW, tilt_deg=22 * sgn)
    # 胸の六角クラスタ (参照 cyan_core の実測)
    for i, (fx, fy, r) in enumerate([(-0.168, 0.738, 0.0324), (-0.123, 0.779, 0.0184), (-0.123, 0.699, 0.0174), (-0.152, 0.807, 0.0165),
                                     (-0.211, 0.694, 0.0136), (-0.194, 0.777, 0.0135), (-0.230, 0.716, 0.0088)]):
        jewel(f"hex_chest_{tag}_{i}", fx, fy, r, mirror)
    # 腰の六角クラスタ
    for i, (fx, fy, r) in enumerate([(0.077, 0.565, 0.030), (0.142, 0.650, 0.0181), (0.162, 0.618, 0.0162), (0.208, 0.687, 0.0157)]):
        jewel(f"hex_haunch_{tag}_{i}", fx, fy, r, mirror)
    # パネル線 (ティール): 襟、腰パネルの輪郭、ももの輪郭
    ribbon(f"line_collar_{tag}", [(-0.05, 0.62), (-0.12, 0.632), (-0.19, 0.655), (-0.22, 0.70)], mirror=mirror)
    ribbon(f"line_haunch_{tag}", [(0.0, 0.585), (0.06, 0.572), (0.12, 0.60), (0.19, 0.66), (0.17, 0.695), (0.10, 0.69), (0.02, 0.645)], mirror=mirror)
    ribbon(f"line_thigh_{tag}", [(0.10, 0.70), (0.16, 0.73), (0.23, 0.80), (0.20, 0.85)], mirror=mirror)
    # 明るい斜線 (参照 cyan_core の細長い成分)
    ribbon(f"line_bright1_{tag}", [(-0.078, 0.682), (-0.02, 0.76), (0.0, 0.789)], mat=GLOW, width=0.006, offset=0.003, mirror=mirror)
    ribbon(f"line_bright2_{tag}", [(0.0, 0.581), (0.068, 0.643)], mat=GLOW, width=0.006, offset=0.003, mirror=mirror)
    ribbon(f"line_bright3_{tag}", [(0.133, 0.727), (0.20, 0.77), (0.232, 0.794)], mat=GLOW, width=0.006, offset=0.003, mirror=mirror)

# 比較用カメラは書き出しに含めない
bpy.data.objects.remove(ref_cam)

# ---------- 仕上げ: 結合・フラットシェード・原点を足元に ----------
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
rabbit = bpy.context.active_object
rabbit.name = "rabbit"
rabbit.data.name = "rabbit"
bpy.ops.object.shade_flat()

zmin = min(v.co.z for v in rabbit.data.vertices)
for v in rabbit.data.vertices:
    v.co.z -= zmin
scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

# ---------- 書き出し ----------
blend_path = os.path.abspath(os.path.join(out_dir, "rabbit.blend"))
glb_path = os.path.abspath(os.path.join(out_dir, "rabbit.glb"))
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True, export_apply=True)

dims = rabbit.dimensions
print(f"rabbit: {len(rabbit.data.polygons)} faces, dims x={dims.x:.3f} y={dims.y:.3f} z={dims.z:.3f}")
print(f"saved {blend_path}\nsaved {glb_path}")
