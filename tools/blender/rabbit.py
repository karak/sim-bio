"""土兎 (rabbit) のローポリ 3D モデルを assets/textures/concept/rabbit-angular.png を参照に組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/rabbit.py -- assets/models
出力: <out_dir>/rabbit.blend (git 管理外) と <out_dir>/rabbit.glb

方針 (発注書 §1 + 採用スタイル "angular"):
  - 丸い体・長い耳、鹿の半分の大きさ。座り姿勢。
  - 角ばったジオメトリック: 低分割の球/錐、shade_flat、単色マテリアル。
  - 主色 #D6C27A、耳内側は濃い茶、目と胸/腰の六角模様はシアン (#9FF5E8) の発光。
  - 単位 m、Z up、正面 -Y、原点は足元。全高 (耳含む) ≈ 0.6 m。
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = argv[0] if argv else "assets/models"
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


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
    return m


MAT_FUR = solid("rabbit_fur", "#D6C27A")
MAT_EAR = solid("rabbit_ear_inner", "#5A3A2A")
MAT_DARK = solid("rabbit_dark", "#3A2418")
MAT_GLOW = solid("rabbit_glow", "#9FF5E8", emission=0.8)

parts = []


# ---------- パーツ生成ヘルパ ----------
def add_part(kind, name, loc, scale=(1, 1, 1), rot=(0, 0, 0), mat=MAT_FUR, **kw):
    """kind: 'ico' | 'uv' | 'cone' | 'cube' | 'cyl'。rot は度。"""
    if kind == "ico":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kw.get("subdiv", 1), radius=1)
    elif kind == "uv":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get("seg", 8), ring_count=kw.get("rings", 5), radius=1)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=kw.get("verts", 4), radius1=kw.get("r1", 1), radius2=kw.get("r2", 0), depth=1)
    elif kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get("verts", 6), radius=1, depth=1)
    else:
        raise ValueError(kind)
    o = bpy.context.active_object
    o.name = name
    o.location = loc
    o.scale = scale
    o.rotation_euler = tuple(math.radians(a) for a in rot)
    o.data.materials.append(mat)
    parts.append(o)
    return o


def mirror(fn, name, x, *a, **kw):
    """左右対称パーツ。x>0 を右 (+X)、負を左に置く。"""
    fn(f"{name}_R", x, *a, **kw)
    fn(f"{name}_L", -x, *a, **kw)


# ---------- 体 ----------
# 胴 (前傾した卵形) と後ろの大きな腰で「丸い体」を作る
add_part("uv", "body", (0, 0.02, 0.21), scale=(0.19, 0.24, 0.19), rot=(-12, 0, 0), seg=8, rings=5)
add_part("uv", "haunch", (0, 0.11, 0.17), scale=(0.21, 0.19, 0.17), seg=8, rings=5)
add_part("ico", "chest", (0, -0.13, 0.24), scale=(0.15, 0.12, 0.15))

# ---------- 頭 ----------
add_part("ico", "head", (0, -0.17, 0.41), scale=(0.165, 0.16, 0.15))
add_part("ico", "muzzle", (0, -0.29, 0.375), scale=(0.085, 0.075, 0.07))
add_part("cone", "nose", (0, -0.36, 0.38), scale=(0.028, 0.02, 0.022), rot=(-90, 0, 0), mat=MAT_DARK, verts=3)


# 目: 頭の左右にシアン発光の扁平菱形
def eye(name, x):
    add_part("ico", name, (x, -0.26, 0.44), scale=(0.014, 0.045, 0.035), rot=(0, 0, 0), mat=MAT_GLOW)


mirror(eye, "eye", 0.118)


# 耳: 四角錐を細長く。外側にやや開き、少し後ろに倒す
def ear(name, x):
    sgn = 1 if x > 0 else -1
    add_part("cone", f"{name}_outer", (x, -0.15, 0.70), scale=(0.08, 0.045, 0.34), rot=(-10, sgn * 10, 0), verts=4, r1=1, r2=0.45)
    # 内側の濃い面: 少し前へずらした薄い錐
    add_part("cone", f"{name}_inner", (x, -0.175, 0.70), scale=(0.05, 0.015, 0.28), rot=(-10, sgn * 10, 0), mat=MAT_EAR, verts=4, r1=1, r2=0.4)


mirror(ear, "ear", 0.075)


# ---------- 脚・足・尾 ----------
def foreleg(name, x):
    add_part("cube", name, (x, -0.16, 0.08), scale=(0.06, 0.07, 0.16), rot=(-6, 0, 0))
    add_part("cube", f"{name}_paw", (x, -0.19, 0.02), scale=(0.065, 0.11, 0.04), mat=MAT_DARK)


mirror(foreleg, "foreleg", 0.085)


def hindfoot(name, x):
    add_part("cube", name, (x, 0.02, 0.03), scale=(0.075, 0.24, 0.06))


mirror(hindfoot, "hindfoot", 0.15)

add_part("ico", "tail", (0, 0.30, 0.20), scale=(0.055, 0.05, 0.05))


# ---------- 六角の発光模様 (胸と腰) ----------
def hexpatch(name, loc, rot, s):
    add_part("cyl", name, loc, scale=(s, s, 0.008), rot=rot, mat=MAT_GLOW, verts=6)


# 胸: 正面やや左右に 3 枚
hexpatch("hex_chest_c", (0, -0.235, 0.27), (90, 0, 0), 0.028)
hexpatch("hex_chest_r", (0.05, -0.225, 0.235), (90, 0, 20), 0.024)
hexpatch("hex_chest_l", (-0.05, -0.225, 0.235), (90, 0, -20), 0.024)
# 腰: 右側面に 4 枚 (参照画像は右側面が見えている)、左側面にも対称に
for sgn in (1, -1):
    tag = "R" if sgn > 0 else "L"
    hexpatch(f"hex_haunch_{tag}_1", (sgn * 0.205, 0.08, 0.24), (0, 90, 0), 0.03)
    hexpatch(f"hex_haunch_{tag}_2", (sgn * 0.208, 0.14, 0.20), (0, 90, 0), 0.026)
    hexpatch(f"hex_haunch_{tag}_3", (sgn * 0.20, 0.05, 0.17), (0, 90, 0), 0.024)
    hexpatch(f"hex_haunch_{tag}_4", (sgn * 0.195, 0.16, 0.13), (0, 90, 0), 0.022)

# ---------- 仕上げ: 結合・フラットシェード・原点を足元に ----------
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
rabbit = bpy.context.active_object
rabbit.name = "rabbit"
rabbit.data.name = "rabbit"
bpy.ops.object.shade_flat()

# 最下点を z=0 に揃え、原点を (0,0,0) に置く
zmin = min((rabbit.matrix_world @ Vector(v.co)).z for v in rabbit.data.vertices)
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
