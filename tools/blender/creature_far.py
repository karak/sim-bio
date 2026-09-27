"""観察画面の動物の遠い段 (M23-08、docs/design/2026-09-24-observe-perf.md)。

群れ LOD (lod1、月鹿 866・灰狼 690・土兎 514 三角形) を Blender の Decimate (collapse) で 1 桁少ない形に削り、
同じアーマチュアにスキンした別のメッシュ `<種>_far` にする。観察画面は lod1 と同じく VAT に焼き (render/vat.ts)、約 50 m より先の個体をこの形で描く。

- lod1 は部品 (胴・首・頭・脚・耳・角・装甲板・光る帯) が離れた島なので、丸ごと削ると小さな島から消えて脚や板が無くなる。
  島ごとに分けて削り、つなぎ直す。左右をまたぐ島 (胴・首・頭・尾) は左右対称に削る。
- 骨の重み (頂点グループ) と頂点色は Decimate が補間して引き継ぐので、焼いたアニメ (歩き・食む・倒れる) は lod1 と同じ骨で動く。
- 削る割合は島ごとに ratio(島の中心, 材質の集まり, 三角形の数) で決める (光る角・脚・装甲板など、遠目にも読みたい所は多く残す)。
  0 の島と、削って min_tris より小さくなった島 (目・細い光る帯・小さな紋など、遠目では 1 画素に満たない所) は除く。
- 作るのはアクションを焼いた後 (月鹿の bake_actions は渡したメッシュの一番低い頂点で接地を合わせるので、遠い段を混ぜると lod0・lod1 のアニメが変わる)。
- 書き出しには入るが、描画は切る (hide_render)。observe_*_render.py は自分の並べたメッシュしか隠さないので、遠い段が近 LOD の比較画に重ならない。
"""
import bmesh
import bpy


def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def _override(obs, active):
    return bpy.context.temp_override(object=active, active_object=active, selected_objects=obs, selected_editable_objects=obs)


def build_far(lod1, name, rig, ratio, min_tris=4):
    """lod1 を複製して島ごとに ratio(島の中心, 材質名の集まり, 三角形の数) の割合へ削り、rig に結んだ name のメッシュを返す。
    割合が 0 の島と、削った後に min_tris より小さくなった島は除く"""
    ob = lod1.copy()
    ob.data = lod1.data.copy()
    ob.name = ob.data.name = name
    ob.modifiers.clear()
    bpy.context.scene.collection.objects.link(ob)
    mats = [m.name for m in ob.data.materials]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.context.selected_objects]
    kept = []
    for p in parts:
        xs = [v.co.x for v in p.data.vertices]
        if not xs:
            continue
        center = sum((v.co for v in p.data.vertices), p.data.vertices[0].co * 0) / len(xs)
        used = {mats[f.material_index] for f in p.data.polygons}
        r = ratio(center, used, tris_of(p))
        if r <= 0:
            bpy.data.objects.remove(p)
            continue
        mod = p.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = r
        mod.use_collapse_triangulate = True
        # 左右をまたぐ島 (胴・首・頭・尾) は左右対称に削る
        mod.use_symmetry = min(xs) < -0.01 and max(xs) > 0.01 and abs(center.x) < 0.02
        mod.symmetry_axis = "X"
        with _override([p], p):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if tris_of(p) < min_tris:
            bpy.data.objects.remove(p)
            continue
        kept.append(p)
    with _override(kept, kept[0]):
        bpy.ops.object.join()
    ob = kept[0]
    ob.name = ob.data.name = name
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    arm = ob.modifiers.new("Armature", "ARMATURE")
    arm.object = rig
    ob.hide_render = True
    print(f"mesh {ob.name}: {len(ob.data.vertices)} verts / {tris_of(ob)} tris (lod1 {tris_of(lod1)}, {len(kept)} / {len(parts)} islands)")
    return ob
