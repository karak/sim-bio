"""観察画面の灰狼 (assets/models/observe/wolf.blend) を基準画と同じ向きで撮る (observe_deer_render.py と同じ光と背景)。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf_render.py -- assets/models/observe/wolf.blend <raw_dir>
  python3 tools/blender/observe_wolf_sheet.py <raw_dir> docs/design/qa/observe   (基準画との比較・アニメの抜き出しを並べる)
撮るもの (<raw_dir>/*.png):
  - view-{side,front,q34,rear34}: 近 LOD の rest。基準画 creatures/wolf.png 上段の 3 体 (側面・正面・斜め前) の向きと斜め後ろ
  - pose-{stalk,run}: 基準画 下段の忍び寄り・疾走と同じ向き (側面) で、stalk と run の見せ場のフレーム
  - lod1-{side,q34}: 群れ LOD
  - anim-{idle,walk,stalk,run,pounce,fall}: 各アクションの見せ場のフレーム (斜め前)
  - seq-{walk,stalk,run,pounce,fall}-NNN: 側面の連続 (脚の順序・飛びかかり・倒れ方)
光: 左上前からの柔らかい太陽 + 反対側の弱い補助光 + 明るい灰色の空 (基準画の紙の色)。EEVEE、色は Standard (AgX を掛けない)。
発光は撮影のときだけ強さ 0.45 にし、グレアで滲ませる (Three.js 側の bloom の代わり)。
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
blend, out = argv[0], argv[1]
RES = int(argv[2]) if len(argv) > 2 else 720
# (M22-05 残りの手直しで追加) 4 つ目の引数 views で、比較画に使う向き (view-* と pose-*) だけ撮る (作り直しの途中の確認用)
ONLY = argv[3] if len(argv) > 3 else "all"
os.makedirs(out, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
rig = bpy.data.objects["wolf_rig"]
MESHES = ["wolf", "wolf_lod1"]

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

glow = bpy.data.materials["wolf_glow"]
glow.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.45

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


VIEWS = {"side": (6, 5), "front": (90, 5), "q34": (36, 8), "rear34": (218, 10)}
show("wolf")
set_action(None, 0)
for k, (az, el) in VIEWS.items():
    shoot(f"view-{k}.png", az, el)
# 基準画 下段: 忍び寄り (左下) と疾走 (右下) は側面から
POSES = [("stalk", 12), ("run", 12)]
for name, f in POSES:
    set_action(name, f)
    shoot(f"pose-{name}.png", 6, 5)
if ONLY == "views":
    sys.exit(0)
set_action(None, 0)
show("wolf_lod1")
shoot("lod1-side.png", *VIEWS["side"])
shoot("lod1-q34.png", *VIEWS["q34"])
show("wolf")
ANIM = [("idle", 33), ("walk", 8), ("stalk", 12), ("run", 12), ("pounce", 17), ("fall", 60)]
for name, f in ANIM:
    set_action(name, f)
    shoot(f"anim-{name}.png", 20, 12, pad=1.1)
# 側面の連続 (脚の順序、飛びかかり、倒れ方)
for name, frames in (("walk", range(0, 33, 6)), ("stalk", range(0, 48, 8)), ("run", range(0, 15, 3)), ("pounce", range(0, 37, 6)),
                     ("fall", range(0, 61, 12))):
    for f in frames:
        set_action(name, f)
        shoot(f"seq-{name}-{f:03d}.png", 0, 4, pad=1.08)
