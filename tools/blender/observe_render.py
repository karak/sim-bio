"""観察画面の環境アセットの確認: 書き出した .glb を読み直して、ノード名と三角形数を出し、EEVEE で並べ図・集落の一角を描く。

陰影は Three.js 側の予定 (設計 §8: トゥーン寄りのランプ 3 段 + なめらかな境界、縁の光、発光) を EEVEE で近似する。
材質の baseColorFactor × 頂点色 COLOR_0 を地の色にし、白い拡散の明るさ (Shader to RGB) をランプに通す。

  blender -b --factory-startup --python tools/blender/observe_render.py -- verify <a.glb> [<b.glb> ...]
  blender -b --factory-startup --python tools/blender/observe_render.py -- lineup <a.glb> <out.png> [--ref <deer.glb>]
  blender -b --factory-startup --python tools/blender/observe_render.py -- corner <out.png>
  blender -b --factory-startup --python tools/blender/observe_render.py -- ship-stages|ship|shipyard <out.png>
  (lineup は --yaw <度> で各ノードを回して並べる、--el <度> でカメラの仰角)
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import observe_kit as K  # noqa: E402

BG = (0.80, 0.80, 0.78)
SUN_DIR = (math.radians(48), 0, math.radians(-35))  # 左手前の上から


# ---------------------------------------------------------------- 読み込みと確認

GLTF_MATS = {}  # 材質名 -> (baseColorFactor, emissiveFactor, emissive_strength)。読み込みで Blender の節点から読むより確か


def read_glb_json(path):
    import json
    import struct
    with open(path, "rb") as f:
        data = f.read()
    length, ctype = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + length])


def import_glb(path):
    """.glb を読み込み、トップレベルのオブジェクトを glTF の scene の順で返す"""
    js = read_glb_json(path)
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        ext = m.get("extensions", {}).get("KHR_materials_emissive_strength", {})
        GLTF_MATS[m["name"]] = (tuple(pbr.get("baseColorFactor", (1, 1, 1, 1))), tuple(m.get("emissiveFactor", (0, 0, 0))),
                                ext.get("emissiveStrength", 1.0))
    order = [js["nodes"][i]["name"] for i in js["scenes"][js.get("scene", 0)]["nodes"]]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    tops = [o for o in objs if o.parent is None]
    rank = {n: i for i, n in enumerate(order)}
    return sorted(tops, key=lambda o: rank.get(o.name, 1e9))


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == "MESH" else 0


def report(path, tops):
    print(f"== {os.path.relpath(path, K.REPO)}")
    for o in tops:
        me = o.data
        zmin, (cx, cy) = K.ground_center(o)
        d = o.dimensions
        emis = [m.name for m in me.materials if _emission(m)[1] > 0]
        print(f"  {o.name:24s} {tri_count(o):5d} tris  size {d.x:5.2f} x {d.y:5.2f} x {d.z:5.2f} m  "
              f"ground z={zmin:+.2f} center=({cx:+.2f},{cy:+.2f})  COLOR_0={'yes' if len(me.color_attributes) else 'no'}  "
              f"mats={[m.name for m in me.materials]} emissive={emis}")


def _emission(m):
    if m.name not in GLTF_MATS:
        return (0, 0, 0), 0.0
    _, c, s = GLTF_MATS[m.name]
    if max(c) <= 0:
        return (0, 0, 0), 0.0
    return tuple(c), s * max(c)


# ---------------------------------------------------------------- トゥーン寄りの材質 (Three.js の予定の近似)

def toonify(m, vcol_name):
    nt = m.node_tree
    if m.get("toon"):
        return
    if m.name in GLTF_MATS:
        base = GLTF_MATS[m.name][0]
    else:
        b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        base = tuple(b.inputs["Base Color"].default_value) if b else (0.8, 0.8, 0.8, 1)
    ecol, estr = _emission(m)
    if max(ecol) > 0:
        k = 1.0 / max(ecol)
        ecol = tuple(c * k for c in ecol)
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new
    out = N("ShaderNodeOutputMaterial")
    rgb = N("ShaderNodeRGB")
    rgb.outputs[0].default_value = base
    albedo = rgb.outputs[0]
    if vcol_name:
        vc = N("ShaderNodeVertexColor")
        vc.layer_name = vcol_name
        mul = N("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        L(rgb.outputs[0], mul.inputs[6])
        L(vc.outputs["Color"], mul.inputs[7])
        albedo = mul.outputs[2]
    dif = N("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = N("ShaderNodeShaderToRGB")
    L(dif.outputs[0], s2r.inputs[0])
    bw = N("ShaderNodeRGBToBW")
    L(s2r.outputs[0], bw.inputs[0])
    ramp = N("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    stops = [(0.0, (0.42, 0.46, 0.62)), (0.26, (0.50, 0.53, 0.66)), (0.36, (0.76, 0.76, 0.80)),
             (0.60, (0.86, 0.85, 0.84)), (0.72, (1.0, 0.97, 0.90)), (1.0, (1.08, 1.03, 0.94))]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = cr.elements.new(p)
        e.color = (*c, 1)
    L(bw.outputs[0], ramp.inputs[0])
    lit = N("ShaderNodeMix")
    lit.data_type = "RGBA"
    lit.blend_type = "MULTIPLY"
    lit.inputs["Factor"].default_value = 1.0
    L(albedo, lit.inputs[6])
    L(ramp.outputs[0], lit.inputs[7])
    # 縁の光: 視線に対して寝た面を暖色で少し持ち上げる
    lw = N("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.25
    rr = N("ShaderNodeMapRange")
    rr.inputs["From Min"].default_value = 0.55
    rr.inputs["From Max"].default_value = 0.95
    rr.inputs["To Max"].default_value = 0.22
    L(lw.outputs["Facing"], rr.inputs["Value"])
    rim = N("ShaderNodeMix")
    rim.data_type = "RGBA"
    rim.blend_type = "ADD"
    L(rr.outputs[0], rim.inputs["Factor"])
    L(lit.outputs[2], rim.inputs[6])
    rim.inputs[7].default_value = (1.0, 0.93, 0.8, 1)
    col = rim.outputs[2]
    if estr > 0:
        add = N("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        add.inputs["Factor"].default_value = min(1.0, 0.35 * estr)
        L(col, add.inputs[6])
        add.inputs[7].default_value = (*ecol, 1)
        col = add.outputs[2]
    em = N("ShaderNodeEmission")
    L(col, em.inputs["Color"])
    if base[3] < 0.999:  # 半透明 (alphaMode BLEND): 透過と混ぜる
        tr = N("ShaderNodeBsdfTransparent")
        mx = N("ShaderNodeMixShader")
        mx.inputs["Fac"].default_value = base[3]
        L(tr.outputs[0], mx.inputs[1])
        L(em.outputs[0], mx.inputs[2])
        L(mx.outputs[0], out.inputs["Surface"])
        try:
            m.surface_render_method = "BLENDED"
        except AttributeError:
            m.blend_method = "BLEND"
    else:
        L(em.outputs[0], out.inputs["Surface"])
    m["toon"] = True


def toonify_all():
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        vname = o.data.color_attributes[0].name if len(o.data.color_attributes) else None
        for m in o.data.materials:
            if m is not None:
                toonify(m, vname)


# ---------------------------------------------------------------- 場面

def setup_scene(res=(1600, 900)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.eevee.taa_render_samples = 32
    try:
        sc.eevee.use_shadows = True
    except AttributeError:
        pass
    w = bpy.data.worlds.new("bg")
    sc.world = w
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    amb = nt.nodes.new("ShaderNodeBackground")
    amb.inputs["Color"].default_value = (0.62, 0.68, 0.80, 1)
    amb.inputs["Strength"].default_value = 0.35
    cam_bg = nt.nodes.new("ShaderNodeBackground")
    cam_bg.inputs["Color"].default_value = (*BG, 1)
    cam_bg.inputs["Strength"].default_value = 1.0
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(amb.outputs[0], mix.inputs[1])
    nt.links.new(cam_bg.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.2
    sun.color = (1.0, 0.96, 0.9)
    sun.angle = math.radians(4)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = SUN_DIR
    sc.collection.objects.link(so)
    return sc


def floor(size=200, color=None):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    f = bpy.context.active_object
    f.name = "floor"
    m = K.material("render_floor", color or "#CDCDC8")
    f.data.materials.append(m)
    return f


def camera(loc, target, lens=50, ortho=None):
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.clip_end = 1000
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    c = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(c)
    c.location = loc
    d = Vector(target) - Vector(loc)
    c.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = c
    return c


def render(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.context.scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    print(f"rendered {path}")


ORDER = ["belltree_seedling", "belltree_sapling", "belltree_mature", "belltree_mature_lod1", "belltree_stump", "belltree_logs",
         "hut", "lantern_post", "slipway", "stone_wall", "megalith",
         "grass_tuft", "moongrass_tuft", "moss_clump", "rock",
         "woven_screen", "stone_wall_corner",
         "forest_tree", "forest_tree_lod1", "moongrass_tuft_seed", "fern", "flower_patch",
         "ship_keel", "ship_ribs", "ship_planks", "ship_mast", "ship_sails", "ship_flying", "timber_pile"]


def world_width(o):
    """回転を含めた X 方向の幅 (yaw を付けて並べるとき用)"""
    bpy.context.view_layer.update()
    xs = [(o.matrix_world @ Vector(c)).x for c in o.bound_box]
    return max(xs) - min(xs), (max(xs) + min(xs)) / 2 - o.location.x


def lineup(glb, out, ref=None, gap=1.0, only=None, res=(1600, 900), yaw=0.0, el_deg=14, az_deg=-18):
    """並べ図。only で描くノードを絞る (小さいものの寄りの図)"""
    # yaw (度) で各ノードを回して並べる (舟を横から見る)。el_deg / az_deg はカメラの仰角と方位
    K.reset()
    sc = setup_scene(res)
    tops = import_glb(glb)
    report(glb, tops)
    tops.sort(key=lambda o: ORDER.index(o.name) if o.name in ORDER else 99)
    if only:
        drop = [o for o in tops if o.name not in only]
        tops = [o for o in tops if o.name in only]
        for o in drop:
            bpy.data.objects.remove(o)
    if ref:
        rt = import_glb(ref)
        for o in rt:
            o.name = "ref_" + o.name
        tops = tops + [o for o in rt if o.type == "MESH"]
    x = 0.0
    for o in tops:
        if yaw and not o.name.startswith("ref_"):
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0, 0, math.radians(yaw))
        o.location = (0, 0, 0)
        w, off = world_width(o)
        o.location.x = x + w / 2 - off
        o.location.y = 0
        x += w + gap
    floor()
    toonify_all()
    width = x - gap
    height = max(o.dimensions.z if not yaw else max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in tops)
    cx = width / 2
    el, az = math.radians(el_deg), math.radians(az_deg)
    dist = 200
    loc = Vector((cx + dist * math.sin(az) * math.cos(el) * -1, -dist * math.cos(az) * math.cos(el), height * 0.45 + dist * math.sin(el)))
    aspect = sc.render.resolution_x / sc.render.resolution_y
    camera(loc, (cx, 0, height * 0.45), ortho=max(width * 1.08, height * aspect * 1.25))
    render(out)


def corner(out):
    """集落の一角: 小屋・灯り柱 2・船台・石垣・巨石・成木 3・株・草と苔と石を撒き、低い斜めから"""
    K.reset()
    sc = setup_scene((1600, 900))
    lib = {}
    for name in ("belltree", "settlement", "flora"):
        for o in import_glb(os.path.join(K.OUT_DIR, f"{name}.glb")):
            lib[o.name] = o
            o.hide_render = True
            o.location = (0, 0, -100)
    deer = import_glb(os.path.join(K.REPO, "assets", "models", "deer.glb"))
    rnd = random.Random(5)

    def place(name, loc, yaw=0.0, scale=1.0):
        src = lib[name]
        o = src.copy()
        o.hide_render = False
        sc.collection.objects.link(o)
        o.location = (loc[0], loc[1], loc[2] if len(loc) > 2 else 0.0)
        o.rotation_mode = "XYZ"  # glTF の読み込みは四元数で置くので、yaw を効かせるために切り替える
        o.rotation_euler = (0, 0, math.radians(yaw))
        o.scale = (scale, scale, scale)
        return o

    place("slipway", (10.0, 9.5), yaw=-62)
    place("hut", (-3.5, 5.0), yaw=-35)
    place("lantern_post", (0.8, 1.5), yaw=-20)
    place("lantern_post", (4.2, 4.2), yaw=160)
    place("stone_wall", (-3.2, -1.0), yaw=8)
    place("megalith", (2.3, 11.5), yaw=-15)
    place("belltree_mature", (-10.5, 13.0), yaw=0)
    place("belltree_mature", (-4.0, 19.0), yaw=110)
    place("belltree_mature", (-15.0, 9.0), yaw=230)
    place("belltree_stump", (-6.3, -0.3), yaw=40)
    place("belltree_logs", (5.4, 0.4), yaw=-60)
    place("belltree_sapling", (-7.5, 8.0), yaw=30)
    place("belltree_seedling", (-1.2, -2.6), yaw=0)
    occupied = [(9, 9, 3.5), (-3.5, 5, 2.8), (2.3, 11.5, 1.2), (-10.5, 13, 1.2), (-4, 19, 1.2), (-15, 9, 1.2)]

    def free(x, y, pad=0.0):
        return all(math.hypot(x - a, y - b) > r + pad for a, b, r in occupied)
    for i in range(700):
        x, y = rnd.uniform(-16, 18), rnd.uniform(-5, 24)
        if not free(x, y):
            continue
        kind = "moongrass_tuft" if rnd.random() < 0.3 else "grass_tuft"
        place(kind, (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.8, 1.3))
    for i in range(26):
        x, y = rnd.uniform(-15, 16), rnd.uniform(-4, 22)
        if free(x, y):
            place("moss_clump", (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.8, 1.6))
    for i in range(12):
        x, y = rnd.uniform(-14, 16), rnd.uniform(-4, 22)
        if free(x, y):
            place("rock", (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.6, 1.5))
    for o in deer:
        if o.type == "MESH":
            o.location = (1.8, -0.4, 0)
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0, 0, math.radians(-120))
    floor(400, "#7F9A4C")
    toonify_all()
    sc.world.node_tree.nodes["Background.001"].inputs["Color"].default_value = (0.78, 0.82, 0.86, 1)
    camera((-3.0, -13.5, 3.0), (2.0, 8.0, 1.8), lens=26)
    render(out)


# ---------------------------------------------------------------- 舟と造船場 (M22-06)

CRADLE_H_SHIP = 0.35  # observe_ship.py の CRADLE_H (盤木の底を地面に置く高さ)
SHIP_STAGES = ["ship_keel", "ship_ribs", "ship_planks", "ship_mast", "ship_sails", "ship_flying"]


def library(names):
    """observe/<name>.glb を読み、ノード名 -> 隠した原型。placer で複製して置く"""
    lib = {}
    for name in names:
        for o in import_glb(os.path.join(K.OUT_DIR, f"{name}.glb")):
            lib[o.name] = o
            o.hide_render = True
            o.location = (0, 0, -100)
    return lib


def placer(lib):
    sc = bpy.context.scene

    def place(name, loc, yaw=0.0, scale=1.0, pitch=0.0):
        o = lib[name].copy()
        o.hide_render = False
        sc.collection.objects.link(o)
        o.location = (loc[0], loc[1], loc[2] if len(loc) > 2 else 0.0)
        o.rotation_mode = "ZXY"  # 先に船台の傾き (X)、その後に向き (Z)
        o.rotation_euler = (math.radians(pitch), 0, math.radians(yaw))
        o.scale = (scale, scale, scale)
        return o
    return place


def ship_stages(out):
    """建造の 6 段を 2 列 × 3 で、左舷の斜め上から (船首は右)"""
    K.reset()
    setup_scene((1600, 900))
    place = placer(library(["ship"]))
    for i, name in enumerate(SHIP_STAGES):
        r, c = divmod(i, 3)
        z = 2.2 if name == "ship_flying" else CRADLE_H_SHIP
        place(name, (c * 19.0, r * 17.0, z), yaw=90)
    floor(400)
    toonify_all()
    camera((19.0 - 30.0, 9.5 - 60.0, 4.5 + 40.0), (19.0, 9.5, 4.5), ortho=62)
    render(out)


def ship_views(out):
    """完成 (帆を畳む) と飛び立ち (帆を広げる) の寄り、丸太の山と月鹿を物差しに"""
    K.reset()
    sc = setup_scene((1600, 900))
    place = placer(library(["ship"]))
    place("ship_sails", (0, 0, CRADLE_H_SHIP), yaw=62)
    place("ship_flying", (16.5, 11.0, 3.4), yaw=25)
    place("timber_pile", (-4.5, -6.0), yaw=20)
    for o in import_glb(os.path.join(K.REPO, "assets", "models", "deer.glb")):
        if o.type == "MESH":
            o.location = (-1.5, -7.5, 0)
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0, 0, math.radians(-150))
    floor(400)
    toonify_all()
    sc.world.node_tree.nodes["Background.001"].inputs["Color"].default_value = (0.78, 0.82, 0.86, 1)
    camera((-8.0, -30.0, 9.0), (7.0, 3.5, 4.8), lens=30)
    render(out)


def shipyard(out):
    """造船場: 船台の上に肋の段の舟、丸太の山、灯り柱 2、編んだ衝立、小屋、鐘樹 2、奥に森の木、手前に羊歯と花と草"""
    K.reset()
    sc = setup_scene((1600, 900))
    place = placer(library(["belltree", "settlement", "flora", "ship"]))
    rnd = random.Random(8)
    slip_yaw = -58
    slip_c = Vector((6.0, 9.0, 0))
    ang = math.degrees(math.atan2(0.9, 16.0))
    place("slipway", slip_c, yaw=slip_yaw)
    # 船台の盤木の上面 (y=0 で slip_z(0)+0.29 ≈ 0.99) に舟の盤木の底を載せる
    place("ship_ribs", (slip_c.x, slip_c.y, 0.99 + CRADLE_H_SHIP), yaw=slip_yaw, pitch=ang)
    place("timber_pile", (-0.5, 3.0), yaw=-20)
    place("lantern_post", (1.6, 0.2), yaw=-30)
    place("lantern_post", (11.8, 3.2), yaw=150)
    place("woven_screen", (-2.6, 6.2), yaw=-15)
    place("hut", (-7.5, 9.5), yaw=-30)
    place("stone_wall_corner", (-5.8, 1.2), yaw=-100)
    place("belltree_mature", (-13.0, 16.0), yaw=40)
    place("belltree_mature", (0.5, 23.0), yaw=160)
    for i, (x, y) in enumerate(((-20, 30), (-9, 33), (3, 38), (14, 33), (24, 27), (-26, 22), (30, 20), (9, 42), (-16, 40))):
        place("forest_tree" if i < 6 else "forest_tree_lod1", (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.9, 1.25))
    occupied = [(-7.5, 9.5, 3.0), (-13, 16, 1.4), (0.5, 23, 1.4), (-0.5, 3.0, 1.9),
                (1.6, 0.2, 0.6), (11.8, 3.2, 0.6), (-2.6, 6.2, 1.1)]
    along = Vector((-math.sin(math.radians(slip_yaw)), math.cos(math.radians(slip_yaw)), 0))  # 船台の長さ方向 (ローカル Y)
    across = Vector((along.y, -along.x, 0))

    def free(x, y, pad=0.0):
        d = Vector((x, y, 0)) - slip_c
        if abs(d.dot(along)) < 9.0 + pad and abs(d.dot(across)) < 3.2 + pad:
            return False
        return all(math.hypot(x - a, y - b) > r + pad for a, b, r in occupied)
    for i in range(650):
        x, y = rnd.uniform(-18, 20), rnd.uniform(-5, 30)
        if not free(x, y):
            continue
        kind = "moongrass_tuft_seed" if rnd.random() < 0.08 else ("moongrass_tuft" if rnd.random() < 0.25 else "grass_tuft")
        place(kind, (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.8, 1.3))
    for i in range(60):
        x, y = rnd.uniform(-16, 18), rnd.uniform(-5, 28)
        if free(x, y, 0.3):
            place("fern" if i % 2 else "flower_patch", (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.9, 1.5))
    for i in range(10):
        x, y = rnd.uniform(-14, 16), rnd.uniform(-4, 24)
        if free(x, y):
            place("moss_clump" if i % 2 else "rock", (x, y), yaw=rnd.uniform(0, 360), scale=rnd.uniform(0.7, 1.3))
    for o in import_glb(os.path.join(K.REPO, "assets", "models", "deer.glb")):
        if o.type == "MESH":
            o.location = (3.4, 1.2, 0)
            o.rotation_mode = "XYZ"
            o.rotation_euler = (0, 0, math.radians(-150))
    floor(400, "#7F9A4C")
    toonify_all()
    sc.world.node_tree.nodes["Background.001"].inputs["Color"].default_value = (0.78, 0.82, 0.86, 1)
    camera((-4.0, -12.5, 4.2), (3.0, 10.0, 2.2), lens=24)
    render(out)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    mode = argv[0]
    if mode == "verify":
        for p in argv[1:]:
            K.reset()
            report(p, import_glb(p))
    elif mode == "lineup":
        ref = argv[argv.index("--ref") + 1] if "--ref" in argv else None
        only = argv[argv.index("--only") + 1].split(",") if "--only" in argv else None
        gap = float(argv[argv.index("--gap") + 1]) if "--gap" in argv else 1.0
        yaw = float(argv[argv.index("--yaw") + 1]) if "--yaw" in argv else 0.0
        el = float(argv[argv.index("--el") + 1]) if "--el" in argv else 14
        lineup(argv[1], argv[2], ref, gap=gap, only=only, yaw=yaw, el_deg=el)
    elif mode == "corner":
        corner(argv[1])
    elif mode == "ship-stages":
        ship_stages(argv[1])
    elif mode == "ship":
        ship_views(argv[1])
    elif mode == "shipyard":
        shipyard(argv[1])
