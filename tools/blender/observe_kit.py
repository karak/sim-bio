"""観察画面 (M22) の環境アセットの共通部品。observe_belltree.py / observe_settlement.py / observe_flora.py が使う。

- 単位はメートル、Blender では Z 上 (glTF 書き出しで Y 上になる)。各ノードの原点は地面の中心 (0, 0, 0)
- 1 ノード = 1 メッシュ。部品は一時 bmesh で作ってノードの bmesh に流し込み (Node.add)、面に材質・平滑・頂点色を付ける
- 材質は <asset>_<part> の名前で、平らな基本色 (baseColorFactor) + 頂点色 COLOR_0 (陰り・石ごとのばらつきの乗数、0〜1)。
  Three.js 側は vertexColors: true で baseColorFactor × COLOR_0 になる (glTF の規約どおり)
- 葉の塊は「柔らかい法線」(塊の法線と樹冠の中心からの向きを混ぜたカスタム法線) で一つの柔らかい量感として陰る
- 書き出し: export_glb が全ノードを 1 つの .glb に入れる (Y 上、法線・頂点色つき)
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lowpoly_kit import hex_rgb  # noqa: E402

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
MU_CYAN = "#8FF5E6"      # ムーの遺産の光 (動物の継ぎ目と同じ)
BELL_AMBER = "#FFC46B"   # 鐘樹の鐘の灯り

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(REPO, "assets", "models", "observe")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def material(name, color, rough=0.85, emit=None, strength=0.0, double=False):
    """平らな基本色の材質。emit を渡すと発光 (glTF の emissive + KHR_materials_emissive_strength)。double=True で両面"""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nodes = m.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None) or nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    rgb = hex_rgb(color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Specular IOR Level"].default_value = 0.0  # 白い反射は色補正で消せない加算項なので切る (lowpoly_kit と同じ)
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*hex_rgb(emit), 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*rgb, 1)
    m.use_backface_culling = not double
    return m


# ---------------------------------------------------------------- 一時 bmesh の部品 (Node.add に渡す)

def _rng(seed):
    return random.Random(seed)


def ico(radii=(1, 1, 1), subdiv=1, jitter=0.0, seed=0, flat_bottom=0.0):
    """ゆがめた icosphere。subdiv 0/1/2 = 20/80/320 三角形。flat_bottom>0 で下半分を押しつぶす (葉の塊・苔)"""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv + 1, radius=1.0)  # bmesh の 1 は正二十面体そのもの
    r = _rng(seed)
    for v in bm.verts:
        k = 1 + jitter * r.uniform(-1, 1)
        c = v.co * k
        if flat_bottom and c.z < 0:
            c.z *= 1 - flat_bottom
        v.co = Vector((c.x * radii[0], c.y * radii[1], c.z * radii[2]))
    return bm


def box(size=(1, 1, 1), bevel=0.0, segments=1, jitter=0.0, seed=0, taper=1.0, base_z=False, shear=0.0):
    """角を落とした箱 (石・板)。bevel は角の落とし幅 (m)、taper は上面の縮み、base_z=True で底が z=0、
    shear で上面を X 方向に傾ける (斜めに割れた頭)"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        c = v.co
        t = taper if c.z > 0 else 1.0
        dz = shear * c.x * size[0] if c.z > 0 else 0.0
        v.co = Vector((c.x * size[0] * t, c.y * size[1] * t, c.z * size[2] + (size[2] / 2 if base_z else 0) + dz))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
    if jitter:
        r = _rng(seed)
        for v in bm.verts:
            v.co += Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))) * jitter
    return bm


def lathe(profile, n=6, phase=0.0, cap_top=True, cap_bottom=True, wobble=0.0, seed=0):
    """(r, z) の列を Z 軸まわりに回した回転体。r=0 の点は 1 頂点に収束。wobble で輪ごとに半径を揺らす"""
    bm = bmesh.new()
    r_ = _rng(seed)
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append(bm.verts.new((0, 0, z)))
        else:
            ring = []
            for i in range(n):
                a = phase + 2 * math.pi * i / n
                rr = r * (1 + wobble * r_.uniform(-1, 1))
                ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
            rings.append(ring)
    _bridge(bm, rings, cap_top, cap_bottom)
    return bm


def _bridge(bm, rings, cap_start, cap_end):
    for a, b in zip(rings, rings[1:]):
        if isinstance(a, list) and isinstance(b, list):
            k = len(a)
            for i in range(k):
                bm.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i]))
        elif isinstance(a, list):
            k = len(a)
            for i in range(k):
                bm.faces.new((a[i], a[(i + 1) % k], b))
        elif isinstance(b, list):
            k = len(b)
            for i in range(k):
                bm.faces.new((a, b[(i + 1) % k], b[i]))
    if cap_start and isinstance(rings[0], list):
        bm.faces.new(list(reversed(rings[0])))
    if cap_end and isinstance(rings[-1], list):
        bm.faces.new(rings[-1])


def tube(pts, radii, n=6, tip=False, cap_start=True, cap_end=True, phase=0.0):
    """折れ線に沿った管 (幹・枝・根・蔓)。輪の向きは平行移動で捻れを抑える。tip=True で先端を 1 点に収束"""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    prev_u = None
    for i, (p, r) in enumerate(zip(pts, radii)):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_u is None:
            u = (Z.cross(d) if abs(d.z) < 0.9 else X.cross(d)).normalized()
        else:
            u = (prev_u - d * prev_u.dot(d)).normalized()
        v = d.cross(u).normalized()
        prev_u = u
        if tip and i == len(pts) - 1:
            rings.append(bm.verts.new(p))
            continue
        rings.append([bm.verts.new(p + (u * math.cos(phase + 2 * math.pi * k / n) + v * math.sin(phase + 2 * math.pi * k / n)) * r)
                      for k in range(n)])
    _bridge(bm, rings, cap_start, cap_end and not tip)
    return bm


def leaf(length, width, thick, bend=0.0, k=3):
    """厚みのあるレンズ形の葉。+X 方向に伸び、面の法線は +Z。bend で先を下へ反らす"""
    bm = bmesh.new()
    outline_r, outline_l = [], []
    for j in range(1, k + 1):
        t = j / (k + 1)
        w = width * 0.5 * math.sin(math.pi * t) ** 0.7 * (1.15 - 0.3 * t)
        zc = -bend * length * t * t
        outline_r.append(bm.verts.new((length * t, -w, zc)))
        outline_l.append(bm.verts.new((length * t, w, zc)))
    base = bm.verts.new((0, 0, 0))
    tipv = bm.verts.new((length, 0, -bend * length))
    loop = [base] + outline_r + [tipv] + list(reversed(outline_l))
    zmid = -bend * length * 0.2
    top = bm.verts.new((length * 0.45, 0, zmid + thick))
    bot = bm.verts.new((length * 0.45, 0, zmid - thick * 0.6))
    m = len(loop)
    for i in range(m):
        bm.faces.new((loop[i], loop[(i + 1) % m], top))
        bm.faces.new((loop[(i + 1) % m], loop[i], bot))
    return bm


def blade(base, direction, length, width, bend, segs=2, twist=0.0):
    """草の葉 1 枚 (両面の細い帯)。base から direction (水平) へ倒れながら伸びる。先は 1 点"""
    bm = bmesh.new()
    d = Vector(direction).normalized()
    side = Z.cross(d).normalized() if d.length > 0 else X
    side = (side * math.cos(twist) + Z * math.sin(twist) * 0.2).normalized()
    rows = []
    for s in range(segs + 1):
        t = s / (segs + 1)
        c = Vector(base) + Z * (length * t * (1 - 0.35 * bend * t)) + d * (bend * length * t * t)
        w = width * (1 - t) ** 0.8 * 0.5
        rows.append((bm.verts.new(c - side * w), bm.verts.new(c + side * w)))
    tipc = Vector(base) + Z * (length * (1 - 0.35 * bend)) + d * (bend * length)
    tipv = bm.verts.new(tipc)
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, a1, b1, b0))
    a0, a1 = rows[-1]
    bm.faces.new((a0, a1, tipv))
    return bm


def aim(direction, up=Z):
    """+X を direction へ向ける回転行列 (4x4)"""
    d = Vector(direction).normalized()
    s = up.cross(d)
    if s.length < 1e-6:
        s = Y.copy()
    s.normalize()
    u = d.cross(s).normalized()
    return Matrix(((d.x, s.x, u.x, 0), (d.y, s.y, u.y, 0), (d.z, s.z, u.z, 0), (0, 0, 0, 1)))


def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """位置・オイラー回転 (度)・拡大の 4x4 行列"""
    from mathutils import Euler
    m = Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
    if not isinstance(scale, (int, float)):
        m = m @ Matrix.Diagonal((*scale, 1))
    else:
        m = m @ Matrix.Scale(scale, 4)
    m.translation = Vector(loc)
    return m


# ---------------------------------------------------------------- 陰りの関数 (頂点色の乗数)

def shade_height(z0, z1, lo=0.7, hi=1.0, mul=1.0):
    """高さ z0→z1 で lo→hi に明るくなる (根元の陰り)"""
    def f(co, n):
        t = min(1.0, max(0.0, (co.z - z0) / max(1e-6, z1 - z0)))
        v = (lo + (hi - lo) * t) * mul
        return (v, v, v)
    return f


def shade_const(v):
    return lambda co, n: (v, v, v) if isinstance(v, (int, float)) else tuple(v)


def shade_canopy(center, radius, lo=0.62, hi=1.0, warm=0.0):
    """樹冠の陰り: 下・内側ほど暗く、上ほど明るく少し黄味 (warm)"""
    c = Vector(center)

    def f(co, n):
        dz = (co.z - c.z) / radius
        t = min(1.0, max(0.0, 0.5 + 0.6 * dz))
        v = lo + (hi - lo) * t
        return (v, v, max(0.0, v - warm * t))
    return f


# ---------------------------------------------------------------- ノード

class Node:
    """1 つのトップレベルノード (1 メッシュ、複数材質)"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.mats = []
        self.soft = {}  # BMVert -> (樹冠の中心, 混ぜる量)

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, src, mat, matrix=None, smooth=False, shade=None, recalc=True, soft=None, per_face_mat=None):
        """一時 bmesh src を matrix で置いて流し込む。shade(co, normal)->rgb は頂点色の乗数。
        soft=(center, amount) で柔らかい法線。per_face_mat(face_center, normal)->材質 で面ごとに材質を替える (石の上の苔など)"""
        if recalc:
            bmesh.ops.recalc_face_normals(src, faces=list(src.faces))
        mtx = matrix if matrix is not None else Matrix.Identity(4)
        vmap = {v: self.bm.verts.new(mtx @ v.co) for v in src.verts}
        faces = []
        for f in src.faces:
            try:
                faces.append(self.bm.faces.new([vmap[v] for v in f.verts]))
            except ValueError:
                pass
        src.free()
        for f in faces:
            f.normal_update()
            f.smooth = smooth
            m = mat
            if per_face_mat is not None:
                m = per_face_mat(f.calc_center_median(), f.normal) or mat
            f.material_index = self._mi(m)
            for lp in f.loops:
                c = shade(lp.vert.co, f.normal) if shade else (1.0, 1.0, 1.0)
                lp[self.col] = (min(1.0, c[0]), min(1.0, c[1]), min(1.0, c[2]), 1.0)
        if soft is not None:
            for f in faces:
                for v in f.verts:
                    self.soft[v] = soft
        return faces

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def build(self, collection=None):
        """メッシュオブジェクトにする。柔らかい法線はカスタム法線で入れる"""
        bm = self.bm
        bm.verts.index_update()
        soft_idx = {v.index: s for v, s in self.soft.items()}
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        if soft_idx:
            corner = [Vector(n.vector) for n in me.corner_normals]
            custom = []
            for poly in me.polygons:
                for li in poly.loop_indices:
                    vi = me.loops[li].vertex_index
                    if vi in soft_idx and poly.use_smooth:
                        center, amt = soft_idx[vi]
                        out = (me.vertices[vi].co - Vector(center)).normalized()
                        custom.append((corner[li] * (1 - amt) + out * amt).normalized())
                    elif poly.use_smooth:
                        custom.append(corner[li])
                    else:
                        custom.append(Vector(poly.normal))
            me.normals_split_custom_set(custom)
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        o = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(o)
        return o


def export_glb(objs, path):
    """objs をトップレベルノードとして 1 つの .glb に書き出す (Y 上、法線・頂点色つき)"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False,  # 既定では同じ "Col" が COLOR_1 として二重に出る
                              export_texcoords=False, export_materials="EXPORT")
    for o in objs:
        me = o.data
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        d = o.dimensions
        print(f"  {o.name}: {tris} tris, size x={d.x:.2f} y={d.y:.2f} z={d.z:.2f} m, mats={[m.name for m in me.materials]}")
    print(f"saved {path}")


def ground_center(o):
    """原点が地面の中心にあることの確認用: bbox の最小 z と xy の中心"""
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return min(p.z for p in bb), (sum(p.x for p in bb) / 8, sum(p.y for p in bb) / 8)
