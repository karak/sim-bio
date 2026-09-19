"""土兎 (rabbit) のローポリ 3D モデルを参照画像 assets/textures/concept/rabbit-angular.png から組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/rabbit.py -- assets/models
出力: <out_dir>/rabbit.blend (git 管理外) と <out_dir>/rabbit.glb
検証: tools/blender/compare_ref.py で参照画像と同アングル撮影し定量比較する

作り方 (プリミティブの寄せ集めではなく、断面リングのロフトで面構成を作る):
  - 各パーツは「背骨に沿った断面リング (6〜8 頂点)」を順に bridge した閉じたメッシュ。
    リング数を絞ることで参照画像のような大きな平面ファセットが出る。
  - 目: 頭の側面ファセット 1 枚を inset してシアン発光にする (参照画像の菱形の目)。
  - 耳の内側: 耳の前向きファセットを inset region して濃い茶にする (縁に地色が残る)。
  - 六角模様: 胴体にレイキャストして表面点と法線を取り、六角柱の薄板を法線向きに貼る。
  - 前脚の下部 (z<0.06) と鼻先は濃い色。

寸法は参照画像の比率から: 耳含む全高 ≈ 0.9 m、頭高/胴高 ≈ 0.45、耳長 ≈ 0.36 m。
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
    solid("rabbit_fur", "#D6C27A"),
    solid("rabbit_ear_inner", "#5A3A2A"),
    solid("rabbit_dark", "#3A2418"),
    solid("rabbit_glow", "#9FF5E8", emission=0.8),
]
FUR, EAR, DARK, GLOW = range(4)


# ---------- ロフト用ヘルパ ----------
def ring(bm, center, ux, uy, rx, ry, n, phase=0.0):
    """center を中心に ux/uy 平面上へ n 頂点の楕円リングを置く。phase で面の向きを合わせる"""
    return [
        bm.verts.new(center + ux * (rx * math.cos(t)) + uy * (ry * math.sin(t)))
        for t in (phase + 2 * math.pi * i / n for i in range(n))
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
    """bmesh をオブジェクト化。法線を外向きに揃え、4 マテリアルスロットを持たせる"""
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

# ---------- 胴 (尻尾側 → 胸): 8 頂点リング、側面と上下に平らなファセット ----------
bm = bmesh.new()
# (y, z中心, 半幅x, 半高z)
body_sections = densify([
    (0.25, 0.13, 0.05, 0.05),
    (0.215, 0.16, 0.13, 0.12),
    (0.15, 0.19, 0.185, 0.185),
    (0.08, 0.22, 0.20, 0.22),  # 腰の最大部
    (0.0, 0.25, 0.19, 0.235),
    (-0.09, 0.27, 0.17, 0.215),
    (-0.15, 0.29, 0.14, 0.18),  # 胸〜首
    (-0.20, 0.32, 0.10, 0.13),
    (-0.235, 0.34, 0.055, 0.075),
])
rings = [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 12, math.pi / 12) for y, zc, rx, rz in body_sections]
loft(bm, rings)
body = finish(bm, "body")
parts.append(body)

# ---------- 頭 (後頭部 → 鼻先): 8 頂点リング。最後は点に収束させて鼻にする ----------
bm = bmesh.new()
head_sections = densify([
    (-0.08, 0.45, 0.08, 0.08),
    (-0.12, 0.47, 0.135, 0.13),
    (-0.17, 0.475, 0.155, 0.14),  # 最大幅
    (-0.22, 0.47, 0.15, 0.135),
    (-0.27, 0.45, 0.125, 0.115),
    (-0.31, 0.43, 0.095, 0.09),
    (-0.34, 0.415, 0.06, 0.06),  # 口先
    (-0.362, 0.405, 0.03, 0.028),  # 鼻のつけ根 (ここから先だけ濃い色)
])
rings = [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 12, math.pi / 12) for y, zc, rx, rz in head_sections]
nose_tip = bm.verts.new(Vector((0, -0.378, 0.40)))
faces = loft(bm, rings + [nose_tip])
# 鼻: 先端に収束する三角面を濃い色に
for f in faces:
    if nose_tip in f.verts:
        f.material_index = DARK
head = finish(bm, "head")
parts.append(head)


# ---------- 耳: 幅広の刃状。6 頂点リングで前後に平らなファセット ----------
def make_ear(sgn):
    bm = bmesh.new()
    axis = Vector((sgn * 0.24, 0.20, 0.95)).normalized()  # 外へ 14°、後ろへ 12° 傾く
    ux = Y.cross(axis).normalized()  # 幅方向 (≈X)
    uy = axis.cross(ux).normalized()  # 厚み方向 (≈Y、前が -uy)
    base = Vector((sgn * 0.08, -0.165, 0.555))
    # (軸方向距離, 半幅, 半厚)
    ear_sections = [(0.0, 0.05, 0.026), (0.08, 0.07, 0.03), (0.17, 0.076, 0.028), (0.26, 0.062, 0.022), (0.33, 0.034, 0.014)]
    rings = [ring(bm, base + axis * t, ux, uy, w, th, 8, math.pi / 8) for t, w, th in ear_sections]
    tip = bm.verts.new(base + axis * 0.37)
    loft(bm, rings + [tip])
    # 内側: 前を向くファセット (法線が -Y 寄り) を inset region して濃い茶に
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    front = [f for f in bm.faces if f.normal.dot(-uy) > 0.6 and f.calc_center_median().z > base.z + 0.02]
    bmesh.ops.inset_region(bm, faces=front, thickness=0.012, depth=-0.004, use_even_offset=True)
    for f in front:
        f.material_index = EAR
    return finish(bm, f"ear_{'R' if sgn > 0 else 'L'}")


parts += [make_ear(1), make_ear(-1)]


# ---------- 前脚: 上 (胴の中) → 足先。下部は濃い色のブーツ ----------
def make_foreleg(sgn):
    bm = bmesh.new()
    sx = sgn * 0.085
    # (z, y中心, 半幅x, 半奥行y)
    leg_sections = [(0.28, -0.17, 0.05, 0.055), (0.20, -0.18, 0.047, 0.052), (0.12, -0.192, 0.045, 0.05), (0.045, -0.205, 0.05, 0.065), (0.0, -0.215, 0.05, 0.072)]
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
    loft(bm, rings)
    return finish(bm, f"hindfoot_{'R' if sgn > 0 else 'L'}")


parts += [make_hindfoot(1), make_hindfoot(-1)]

# ---------- 尻尾 ----------
bm = bmesh.new()
rings = [ring(bm, Vector((0, 0.22, 0.20)), X, Z, 0.04, 0.05, 8, math.pi / 8), ring(bm, Vector((0, 0.28, 0.195)), X, Z, 0.05, 0.055, 8, math.pi / 8)]
tail_tip = bm.verts.new(Vector((0, 0.325, 0.185)))
loft(bm, rings + [tail_tip])
parts.append(finish(bm, "tail"))


# ---------- 表面に貼る板 (目・六角模様): レイキャストで表面点と法線を取り法線向きに置く ----------
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()


def surface_frame(obj, target, inner):
    """target 付近の obj 表面点と、その接平面の正規直交基底 (u: 水平寄り, v: 上寄り) を返す"""
    origin = target + (target - inner) * 3
    direction = (inner - origin).normalized()
    hit, loc, normal, _ = obj.ray_cast(origin, direction, depsgraph=depsgraph)
    if not hit:
        raise RuntimeError(f"表面が見つかりません {target}")
    n = normal.normalized()
    u = (Z.cross(n) if abs(n.z) < 0.9 else X.cross(n)).normalized()
    v = n.cross(u).normalized()
    return loc, n, u, v


def surface_plate(name, loc, n, u, v, nverts, rx, ry, tilt_deg=0.0, thick=0.006):
    """接平面上に nverts 角形の薄板を置く。tilt で接平面内で回転"""
    t = math.radians(tilt_deg)
    du = u * math.cos(t) + v * math.sin(t)
    dv = -u * math.sin(t) + v * math.cos(t)
    bm = bmesh.new()
    top = ring(bm, loc + n * thick, du, dv, rx, ry, nverts, 0.0)
    bottom = ring(bm, loc - n * 0.004, du, dv, rx, ry, nverts, 0.0)
    for f in loft(bm, [bottom, top]):
        f.material_index = GLOW
    parts.append(finish(bm, name))


def honeycomb(name, obj, target, inner, size, cells):
    """target の表面点を中心に、ハニカム格子上のセル (col,row,scale) へ六角板を並べる"""
    loc, n, u, v = surface_frame(obj, target, inner)
    pitch = size * 2.15
    for i, (col, row, sc) in enumerate(cells):
        off = u * (pitch * (col + 0.5 * (row % 2))) + v * (pitch * 0.866 * row)
        p = loc + off
        # 各セルを改めて表面へ投影し、曲面に沿わせる
        loc_i, n_i, u_i, v_i = surface_frame(obj, p + n * 0.05, inner)
        surface_plate(f"{name}_{i}", loc_i, n_i, u_i, v_i, 6, size * sc, size * sc, 30)


HEAD_INNER = Vector((0, -0.20, 0.46))
BODY_INNER = Vector((0, 0.0, 0.26))
for sgn in (1, -1):
    tag = "R" if sgn > 0 else "L"
    # 目: 頭の側面前寄りに、前下がりに傾いた菱形 (参照画像の目)
    loc, n, u, v = surface_frame(head, Vector((sgn * 0.2, -0.285, 0.49)), HEAD_INNER)
    surface_plate(f"eye_{tag}", loc, n, u, v, 4, 0.05, 0.03, tilt_deg=-25 * sgn, thick=0.005)
    # 胸: 前脚の付け根の外側にひとかたまり (参照画像の手前側の模様)
    honeycomb(f"hex_chest_{tag}", body, Vector((sgn * 0.19, -0.15, 0.18)), BODY_INNER, 0.027,
              [(0, 0, 1.0), (1, 0, 0.8), (-1, 0, 0.8), (0, 1, 0.85), (-1, 1, 0.7), (0, -1, 0.8)])
    # 腰: もも周りにひとかたまり
    honeycomb(f"hex_haunch_{tag}", body, Vector((sgn * 0.26, 0.07, 0.26)), BODY_INNER, 0.029,
              [(0, 0, 1.0), (1, 0, 0.85), (0, 1, 0.9), (-1, 1, 0.7), (0, -1, 0.8), (1, -1, 0.65)])

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
