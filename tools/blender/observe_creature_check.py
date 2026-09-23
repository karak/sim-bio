"""assets/models/observe/<species>.glb を Blender に読み戻して中身を数える (書き出しの検証)。observe_deer_check.py を種ごとに一般化したもの。

使い方: ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/observe_creature_check.py -- assets/models/observe/rabbit.glb
種はファイル名 (rabbit.glb → rabbit) で決まる。
出すもの: ノード (メッシュ) ごとの三角形数 (材質別)、頂点色の有無、骨の数、アクションの長さ (30 fps)、材質と発光色、
寸法 (種ごとの高さの目安・全高・向き)、1 頂点あたりの影響数、アクション中の root と骨盤の水平移動 (その場であること)、
アクション中の一番低い頂点 (地面へのめり込み)、ループの最初と最後の姿勢の差。
"""
import json
import os
import struct
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = argv[0] if argv else "assets/models/observe/rabbit.glb"
species = os.path.splitext(os.path.basename(path))[0]


# 高さの目安: (名前, 材質, 頂点を選ぶ条件)。Blender に読み戻した座標 (Z 上、正面 -Y)
def probe_deer(p):
    return -0.5 < p.y < -0.3 and abs(p.x) < 0.06 and p.z < 1.6  # 毛の背の線 (き甲)


def probe_rabbit(p):
    return -0.2 < p.y < -0.1 and abs(p.x) < 0.004 and p.z < 0.4  # 頭頂 (耳を除く)


PROBE = {"deer": ("withers", probe_deer), "rabbit": ("head top", probe_rabbit)}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=path)
scene = bpy.context.scene
fps = scene.render.fps

arm = next(o for o in scene.objects if o.type == "ARMATURE")
print(f"armature {arm.name}: {len(arm.data.bones)} bones")
meshes = sorted((o for o in scene.objects if o.type == "MESH" and o.name.startswith(species)), key=lambda o: o.name)
pname, probe = PROBE.get(species, ("-", lambda p: False))
for o in meshes:
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
    fur = {v for p in me.polygons if me.materials[p.material_index].name == f"{species}_body" for v in p.vertices}
    h = max((pts[i].z for i in fur if probe(pts[i])), default=0)
    print(f"mesh {o.name}: {tris} tris / {len(me.vertices)} verts, colors={[c.name for c in me.color_attributes]}, "
          f"max influences={infl}, unnormalized={ws_bad}, skin={any(m.type == 'ARMATURE' for m in o.modifiers)}")
    print(f"  by material: {dict(sorted(by_mat.items()))}")
    print(f"  bbox x {lo.x:.3f}..{hi.x:.3f}  y {lo.y:.3f}..{hi.y:.3f}  z {lo.z:.3f}..{hi.z:.3f}  {pname} z {h:.3f}")
# 材質は GLB の JSON から直接読む (読み込み側は頂点色を掛けるノードを挟むので Base Color の既定値が 0.8 に見える)
with open(path, "rb") as f:
    raw = f.read()
gj = json.loads(raw[20:20 + struct.unpack("<I", raw[12:16])[0]])
for m in gj["materials"]:
    pbr = m.get("pbrMetallicRoughness", {})
    print(f"material {m['name']}: baseColorFactor {[round(c, 3) for c in pbr.get('baseColorFactor', [1, 1, 1, 1])]} "
          f"emissive {[round(c, 3) for c in m.get('emissiveFactor', [0, 0, 0])]} roughness {pbr.get('roughnessFactor')}")
print("nodes:", [n.get("name") for n in gj["nodes"] if "mesh" in n], "skins:", len(gj.get("skins", [])),
      "joints:", [len(s["joints"]) for s in gj.get("skins", [])])

hero = meshes[0] if meshes else None
ad = arm.animation_data
acts = sorted(bpy.data.actions, key=lambda a: a.name)
for act in acts:
    f0, f1 = act.frame_range
    ad.action = act
    root_move, pel, minz = 0.0, [], 1e9
    first = last = None
    for f in range(int(f0), int(f1) + 1):
        scene.frame_set(f)
        rb = arm.pose.bones.get("root")
        if rb:
            root_move = max(root_move, (rb.matrix.translation - rb.bone.head_local).length)
        pb = arm.pose.bones.get("pelvis")
        if pb:
            pel.append((arm.matrix_world @ pb.head).copy())
        mats = [b.matrix.copy() for b in arm.pose.bones]
        first = first or mats
        last = mats
        if hero:
            dg = bpy.context.evaluated_depsgraph_get()
            ev = hero.evaluated_get(dg)
            me = ev.to_mesh()
            minz = min(minz, min((ev.matrix_world @ v.co).z for v in me.vertices))
            ev.to_mesh_clear()
    dy = max(p.y for p in pel) - min(p.y for p in pel) if pel else 0
    seam = max(max(abs(a[i][j] - b[i][j]) for i in range(4) for j in range(4)) for a, b in zip(first, last))
    print(f"action {act.name}: frames {f0:.0f}..{f1:.0f} = {(f1 - f0) / fps:.2f} s @ {fps} fps, root moved {root_move:.4f} m, "
          f"pelvis y-range {dy:.3f} m, lowest vertex z {minz:+.3f}, first/last pose diff {seam:.4f}")
