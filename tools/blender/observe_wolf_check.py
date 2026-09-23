"""assets/models/observe/wolf.glb を Blender に読み戻して中身を数える (書き出しの検証、observe_deer_check.py と同じ中身)。

使い方: ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_wolf_check.py -- assets/models/observe/wolf.glb
出すもの: メッシュごとの三角形数 (材質別)、頂点色の有無、骨の数、アクションの長さ (30 fps)、材質と発光色、
寸法 (肩の背の高さ・全高・向き)、1 頂点あたりの影響数、アクション中の root と骨盤の水平移動 (その場であること)。
"""
import json
import struct
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = argv[0] if argv else "assets/models/observe/wolf.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=path)
scene = bpy.context.scene
fps = scene.render.fps

arm = next(o for o in scene.objects if o.type == "ARMATURE")
print(f"armature {arm.name}: {len(arm.data.bones)} bones")
for o in sorted((o for o in scene.objects if o.type == "MESH" and o.name.startswith("wolf")), key=lambda o: o.name):
    me = o.data
    by_mat = {}
    for p in me.polygons:
        m = me.materials[p.material_index].name if me.materials else "-"
        by_mat[m] = by_mat.get(m, 0) + len(p.vertices) - 2
    tris = sum(by_mat.values())
    infl = max((sum(1 for g in v.groups if g.weight > 0) for v in me.vertices), default=0)
    wsum = [sum(g.weight for g in v.groups) for v in me.vertices]
    ws_bad = sum(1 for w in wsum if abs(w - 1) > 0.01)
    pts = [o.matrix_world @ v.co for v in me.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    fur = {v for p in me.polygons if me.materials[p.material_index].name == "wolf_body" for v in p.vertices}
    withers = max((pts[i].z for i in fur if -0.3 < pts[i].y < -0.1 and abs(pts[i].x) < 0.06 and pts[i].z < 1.0), default=0)  # 毛の背の線
    print(f"mesh {o.name}: {tris} tris / {len(me.vertices)} verts, colors={[c.name for c in me.color_attributes]}, "
          f"max influences={infl}, unnormalized={ws_bad}, skin={any(m.type == 'ARMATURE' for m in o.modifiers)}")
    print(f"  by material: {dict(sorted(by_mat.items()))}")
    print(f"  bbox x {lo.x:.2f}..{hi.x:.2f}  y {lo.y:.2f}..{hi.y:.2f}  z {lo.z:.3f}..{hi.z:.2f}  shoulder z {withers:.3f}")
# 材質は GLB の JSON から直接読む (読み込み側は頂点色を掛けるノードを挟むので Base Color の既定値が 0.8 に見える)
with open(path, "rb") as f:
    raw = f.read()
gj = json.loads(raw[20:20 + struct.unpack("<I", raw[12:16])[0]])
for m in gj["materials"]:
    pbr = m.get("pbrMetallicRoughness", {})
    print(f"material {m['name']}: baseColorFactor {[round(c, 3) for c in pbr.get('baseColorFactor', [1, 1, 1, 1])]} "
          f"emissive {[round(c, 3) for c in m.get('emissiveFactor', [0, 0, 0])]} roughness {pbr.get('roughnessFactor')}")

ad = arm.animation_data
acts = sorted(bpy.data.actions, key=lambda a: a.name)
for act in acts:
    f0, f1 = act.frame_range
    ad.action = act
    root_move, pel = 0.0, []
    for f in range(int(f0), int(f1) + 1):
        scene.frame_set(f)
        rb = arm.pose.bones.get("root")
        if rb:
            root_move = max(root_move, (rb.matrix.translation - rb.bone.head_local).length)
        pb = arm.pose.bones.get("pelvis")
        if pb:
            pel.append((arm.matrix_world @ pb.head).copy())
    dy = max(p.y for p in pel) - min(p.y for p in pel) if pel else 0
    print(f"action {act.name}: frames {f0:.0f}..{f1:.0f} = {(f1 - f0) / fps:.2f} s @ {fps} fps, root moved {root_move:.4f} m, pelvis y-range {dy:.3f} m")
