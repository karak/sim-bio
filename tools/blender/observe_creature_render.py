"""観察画面の動物 (assets/models/observe/<species>.blend) を基準画と同じ向きで撮る。observe_deer_render.py を種ごとの設定で一般化したもの。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_creature_render.py -- assets/models/observe/rabbit.blend <raw_dir> [解像度] [all|views|anim|seq]
  python3 tools/blender/observe_creature_sheet.py rabbit <raw_dir> docs/design/qa/observe   (基準画との比較・アニメの抜き出しを並べる)
種はファイル名 (rabbit.blend → rabbit) で決まる。設定は下の SPECIES (deer は observe_deer_render.py と同じ撮り方)。
撮るもの (<raw_dir>/*.png):
  - view-<名前>: 近 LOD の rest (または指定のアクションのフレーム)。基準画の各体と同じ向き
  - extra: 群れ LOD など
  - anim-<アクション>: 各アクションの見せ場のフレーム (斜め前)
  - seq-<アクション>-<フレーム>: 側面の連続
光: 左上前からの柔らかい太陽 + 反対側の弱い補助光 + 明るい灰色の空 (基準画の紙の色)。EEVEE、色は Standard (AgX を掛けない)。
発光は撮影のときだけ強さ 0.45 にし、グレアで滲ませる (Three.js 側の bloom の代わり)。
カメラの方位 az (度): 0 = -X 側から +X を見る (正面 -Y が画面の右)、90 = 正面から、180 = +X 側から (正面が画面の左)。
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
blend, out = argv[0], argv[1]
RES = int(argv[2]) if len(argv) > 2 else 720
ONLY = argv[3] if len(argv) > 3 else "all"  # views / anim / seq で一部だけ撮る (作り直しの途中の確認用)
species = os.path.splitext(os.path.basename(blend))[0]

# views: 名前 → (メッシュ, 方位, 仰角, アクション, フレーム)。extra も同じ形。anim: (アクション, フレーム)。seq: (アクション, フレームの列)
SPECIES = {
    "deer": dict(
        meshes=["deer", "deer_lod1", "deer_doe"],
        views={"side": ("deer", 8, 6, None, 0), "front": ("deer", 90, 6, None, 0), "q34": ("deer", 38, 10, None, 0),
               "rear34": ("deer", 218, 10, None, 0)},
        extra={"lod1-side": ("deer_lod1", 8, 6, None, 0), "lod1-q34": ("deer_lod1", 38, 10, None, 0), "doe-q34": ("deer_doe", 38, 10, None, 0)},
        # (M22-05 残りの手直しで変更: graze は 10 s (300 f) になったので 30 f ごと、見せ場は 3.3 s の食むところ。fall は 10 f ごと)
        anim=[("idle", 33), ("walk", 9), ("run", 4), ("graze", 100), ("fall", 60)], anim_az=(20, 14), seq_az=(0, 4),
        seq=[("walk", range(0, 36, 6)), ("run", range(0, 18, 3)), ("graze", range(0, 300, 30)), ("fall", range(0, 61, 10))]),
    # 土兎の基準画 (creatures/rabbit.png) は顔が左向き: 側面・斜め前・立ち上がりは +X 側から、採食だけ右向き (-X 側から)
    "rabbit": dict(
        meshes=["rabbit", "rabbit_lod1"],
        views={"side": ("rabbit", 172, 8, None, 0), "front": ("rabbit", 90, 6, None, 0), "q34": ("rabbit", 128, 10, None, 0),
               "alert": ("rabbit", 125, 6, "alert", 24), "graze": ("rabbit", 12, 8, "graze", 45)},
        extra={"lod1-side": ("rabbit_lod1", 172, 8, None, 0), "lod1-q34": ("rabbit_lod1", 128, 10, None, 0),
               "rear34": ("rabbit", 230, 12, None, 0)},
        anim=[("idle", 40), ("hop", 5), ("run", 3), ("graze", 60), ("alert", 38), ("fall", 45)], anim_az=(140, 12), seq_az=(180, 4),
        seq=[("hop", range(0, 15, 2)), ("run", range(0, 10, 1)), ("graze", range(0, 120, 20)), ("alert", range(0, 90, 15)),
             ("fall", range(0, 46, 9)), ("idle", range(0, 120, 20))]),
}
CFG = SPECIES[species]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
rig = bpy.data.objects[f"{species}_rig"]
MESHES = CFG["meshes"]

BG = (0.74, 0.72, 0.68)  # 基準画の紙色 #DEDBD5 のリニア値
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
try:
    scene.eevee.use_shadows = True
    scene.eevee.taa_render_samples = 32
except AttributeError:
    pass

world = bpy.data.worlds.new("paper")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (*BG, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9

for name, energy, rot, ang in (("key", 2.8, (50, 0, -35), 25), ("fill", 0.6, (65, 0, 150), 60)):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = energy
    ld.angle = math.radians(ang)
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.rotation_euler = [math.radians(a) for a in rot]

# 地面: 紙色に近い拡散面 (接地の影を見るため)
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.60, 0.57, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
ground.data.materials.append(gm)

glow = bpy.data.materials[f"{species}_glow"]
glow.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.45
if f"{species}_glow_hi" in bpy.data.materials:  # (月鹿の手直しで追加) 角の稜の光も同じ強さで撮る
    bpy.data.materials[f"{species}_glow_hi"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.45

# グレア (発光の滲み)。コンポジタの API が無い版では飛ばす
try:
    tree = bpy.data.node_groups.new("comp", "CompositorNodeTree")
    scene.compositing_node_group = tree
    rl = tree.nodes.new("CompositorNodeRLayers")
    gl = tree.nodes.new("CompositorNodeGlare")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    go = tree.nodes.new("NodeGroupOutput")
    for k, v in (("Type", "Bloom"), ("Quality", "High")):
        if k in gl.inputs:
            try:
                gl.inputs[k].default_value = v
            except TypeError:
                pass
    for k, v in (("Threshold", 0.8), ("Strength", 0.3), ("Size", 0.4)):
        if k in gl.inputs:
            gl.inputs[k].default_value = v
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
    tree.links.new(gl.outputs["Image"], go.inputs[0])
    print("glare: on")
except Exception as e:  # noqa: BLE001
    print("glare: skipped", e)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.clip_end = 1000
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def show(name):
    for m in MESHES:
        o = bpy.data.objects[m]
        o.hide_render = o.hide_viewport = m != name


def set_action(name, frame):
    ad = rig.animation_data
    for tr in ad.nla_tracks:
        tr.mute = True
    ad.action = bpy.data.actions[name] if name else None
    if not name:
        for pb in rig.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
    scene.frame_set(frame)


def shoot(path, az, el, pad=1.12):
    a, e = math.radians(az), math.radians(el)
    fwd = -Vector((-math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e)))
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd).normalized()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for m in MESHES:
        o = bpy.data.objects[m]
        if o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ v.co for v in me.vertices]
        ev.to_mesh_clear()
    xs = [p.dot(right) for p in pts]
    ys = [p.dot(up) for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    span = max(max(xs) - min(xs), max(ys) - min(ys)) * pad
    center = right * cx + up * cy
    cam.location = center - fwd * 20
    cam.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()
    cam_data.ortho_scale = span
    scene.render.filepath = os.path.abspath(os.path.join(out, path))
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


for prefix, table in (("view-", CFG["views"]), ("", CFG["extra"])):
    if ONLY not in ("all", "views"):
        break
    for k, (mesh, az, el, act, frame) in table.items():
        show(mesh)
        set_action(act, frame)
        shoot(f"{prefix}{k}.png", az, el)
show(MESHES[0])
for name, f in CFG["anim"] if ONLY in ("all", "anim") else []:
    set_action(name, f)
    shoot(f"anim-{name}.png", *CFG["anim_az"], pad=1.1)
# 側面の連続 (脚の順序・頭の上げ下げ・倒れ方を見る)
for name, frames in CFG["seq"] if ONLY in ("all", "seq") else []:
    for f in frames:
        set_action(name, f)
        shoot(f"seq-{name}-{f:03d}.png", *CFG["seq_az"], pad=1.08)
