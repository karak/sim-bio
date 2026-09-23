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
from mathutils import Matrix, Quaternion, Vector

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


def tube(pts, radii, n=6, tip=False, cap_start=True, cap_end=True, phase=0.0, aspect=(1.0, 1.0), ridge=None):
    """折れ線に沿った管 (幹・枝・根・蔓)。輪の向きは平行移動で捻れを抑える。tip=True で先端を 1 点に収束"""
    # (木の磨き上げで追加) aspect=(横, 縦) で断面を楕円にする (板根を縦に薄い鰭にする)。
    # ridge(i, k) -> 半径の倍率 で輪 i の k 番目の頂点を出し入れする (幹の縦の筋・裂け目)
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
        rings.append([bm.verts.new(p + (u * aspect[0] * math.cos(phase + 2 * math.pi * k / n)
                                        + v * aspect[1] * math.sin(phase + 2 * math.pi * k / n)) * r * (ridge(i, k) if ridge else 1.0))
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
        # (木の磨き上げで追加) src が UV を持てば (葉のカード) ノードの UV に写す
        src_uv = src.loops.layers.uv.active
        dst_uv = (self.bm.loops.layers.uv.get("UVMap") or self.bm.loops.layers.uv.new("UVMap")) if src_uv is not None else None
        for f in src.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            faces.append(nf)
            if dst_uv is not None:
                for ls, ld in zip(f.loops, nf.loops):
                    ld[dst_uv].uv = ls[src_uv].uv
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


def export_glb(objs, path, texcoords=False):
    """objs をトップレベルノードとして 1 つの .glb に書き出す (Y 上、法線・頂点色つき)"""
    # (木の磨き上げで追加) texcoords=True で UV も書き出す (葉のカードの絵を貼るため。UV を持たないメッシュには出ない)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False,  # 既定では同じ "Col" が COLOR_1 として二重に出る
                              export_texcoords=texcoords, export_materials="EXPORT")
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


# ---------------------------------------------------------------- 葉のカード (木の磨き上げで追加)
# 樹冠の塊の表面に、葉の房を描いた絵のカード (四角 2 三角形) を散らし、輪郭を葉の縁にする。
# 絵は下の leaf_card_image が手続きで描く (外部の素材は使わない)。2 × 2 の区画に形の違う房を 4 つ描き、カードごとに区画を選ぶ。
# 絵の色は白に近い明るさの揺らぎ (葉ごとの明暗・暖色と寒色の揺らぎ・葉脈・縁の陰り) だけで、葉の色は頂点色が持つ。

LEAF_CARD_PNG = os.path.join(REPO, "assets", "textures", "observe", "leaf_card.png")


def _leaf_cell(np, S, seed, lobes):
    """区画 1 つ (S × S) に房を描く。真ん中から外へ向いた卵形の葉の集まりで、輪郭は葉先の並ぶ丸い房になる。RGBA (0〜1) を返す"""
    r = random.Random(seed)
    rgb = np.zeros((S, S, 3), np.float32)
    a = np.zeros((S, S), np.float32)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    # 画像の座標: x 右、y 上 (0 = 下)。房の中心は (0.5, 0.5)
    yy = (S - 1 - yy) / S
    xx = xx / S
    leaves = []
    for k in range(lobes):
        # 外の (奥の) 葉から内の (手前の) 葉へ描く。奥ほど暗い
        t = k / max(1, lobes - 1)
        # 葉の真ん中を中心から rc に置き、外へ向ける (内の葉が房の真ん中を埋める)
        rc = 0.3 * math.sqrt(1.0 - t * 0.97) * r.uniform(0.7, 1.0)
        th = r.uniform(0, 2 * math.pi)
        la = math.pi / 2 - th + math.radians(r.uniform(-35, 35))  # 葉の向き (y 軸から時計回り): 外へ
        L = r.uniform(0.17, 0.25)
        bx = 0.5 + math.cos(th) * rc - math.sin(la) * L * 0.5
        by = 0.5 + math.sin(th) * rc - math.cos(la) * L * 0.5
        # 葉先が区画の縁 (中心から 0.46) を越えないように縮める
        tip = math.hypot(bx - 0.5 + math.sin(la) * L, by - 0.5 + math.cos(la) * L)
        if tip > 0.46:
            L *= 0.46 / tip
        W = L * r.uniform(0.5, 0.62)
        depth = 0.8 + 0.2 * t + r.uniform(-0.05, 0.05)
        warm = r.uniform(-1, 1)
        leaves.append((bx, by, la, L, W, depth, warm))
    for bx, by, la, L, W, depth, warm in leaves:
        dx, dy = math.sin(la), math.cos(la)
        px, py = xx - bx, yy - by
        u = (px * dx + py * dy) / L          # 葉の軸に沿って 0 (付け根) 〜 1 (先)
        w = (px * dy - py * dx) / (W * 0.5)  # 軸からの横のずれ (-1〜1 が葉の幅)
        uc = np.clip(u, 0.0, 1.0)
        half = np.maximum(0.0, np.sin(np.pi * uc)) ** 0.75 * (1.12 - 0.35 * uc)  # 付け根寄りが広く、先が尖る卵形
        inside = half - np.abs(w)
        # 縁のなめらかさ: 1 画素ぶん
        px_w = 1.0 / (W * 0.5 * S)
        cov = np.clip(inside / px_w * 0.5 + 0.5, 0.0, 1.0) * ((u > 0.0) & (u < 1.0))
        if not cov.any():
            continue
        # 明るさ: 先ほど明るい、軸の片側 (光の側) が明るい、縁と葉脈は暗い
        v = depth * (0.86 + 0.16 * uc) * (1.0 + 0.07 * np.sign(w) * np.minimum(1.0, np.abs(w) * 3))
        edge = np.clip(inside / 0.22, 0.0, 1.0)
        v = v * (0.84 + 0.16 * edge)
        vein = np.clip(1.0 - np.abs(w) / 0.06, 0.0, 1.0) * (uc < 0.92)
        v = v * (1.0 - 0.12 * vein)
        col = np.stack([v * (1.0 + 0.05 * warm), v * (1.0 + 0.015 * warm), v * (1.0 - 0.06 * warm)], axis=-1)
        rgb = rgb * (1.0 - cov[..., None]) + np.clip(col, 0.0, 1.0) * cov[..., None]
        a = np.maximum(a, cov)
    return rgb, a


def leaf_card_image(size=1024, save=True):
    """葉のカードの絵 (2 × 2 の区画、RGBA)。bpy の画像を返し、save=True で LEAF_CARD_PNG に書く。同じ引数なら同じ絵"""
    import numpy as np
    S = size // 2
    rgb = np.zeros((size, size, 3), np.float32)
    a = np.zeros((size, size), np.float32)
    for i, (seed, lobes) in enumerate(((101, 30), (202, 26), (303, 32), (404, 28))):
        cr, ca = _leaf_cell(np, S, seed, lobes)
        ox, oy = (i % 2) * S, (i // 2) * S
        rgb[oy:oy + S, ox:ox + S] = cr
        a[oy:oy + S, ox:ox + S] = ca
    # 透明な画素にも葉の平均の色を入れる (縮小したときに縁が黒ずまない)
    # (縁の画素は _leaf_cell で黒と混ざっているので、覆いで割って色を戻す)
    mean = (rgb * a[..., None]).sum(axis=(0, 1)) / max(1.0, float(a.sum()))
    rgb = np.where(a[..., None] > 0.02, rgb / np.maximum(a[..., None], 1e-3), mean)
    rgb = np.clip(rgb, 0.0, 1.0)
    img = bpy.data.images.get("leaf_card") or bpy.data.images.new("leaf_card", size, size, alpha=True)
    img.colorspace_settings.name = "sRGB"
    # 配列の行 0 が絵の上。Blender の画素は下の行から並ぶので上下を返す
    px = np.concatenate([rgb, a[..., None]], axis=-1)[::-1]
    img.pixels[:] = px.ravel()
    if save:
        os.makedirs(os.path.dirname(LEAF_CARD_PNG), exist_ok=True)
        img.filepath_raw = LEAF_CARD_PNG
        img.file_format = "PNG"
        img.save()
    img.pack()
    return img


def foliage_material(name, image):
    """葉のカードの材質: 絵の色 × 頂点色 (基本色は白)。絵のアルファを丸めて切り抜き (glTF の alphaMode MASK、閾値 0.5)、両面"""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    m.use_backface_culling = False
    try:
        m.surface_render_method = "DITHERED"
    except AttributeError:
        pass
    return m


def card(size, cell, cells=2):
    """葉のカード 1 枚 (四角、中心が原点、XY 平面、法線 +Z)。UV は絵の cells × cells の区画のうち cell 番目"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    h = size / 2
    vs = [bm.verts.new(p) for p in ((-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0))]
    f = bm.faces.new(vs)
    u0, v0 = (cell % cells) / cells, (cell // cells) / cells
    for lp, (a, b) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = (u0 + a / cells, v0 + b / cells)
    return bm


def lump_surface(c, r, d, rz=0.82, flat_bottom=0.3):
    """ico(flat_bottom) で作った葉の塊 (中心 c、半径 r、縦 r × rz) の、向き d の表面の点"""
    z = d.z * r * rz * ((1 - flat_bottom) if d.z < 0 else 1.0)
    return c + Vector((d.x * r, d.y * r, z))


def inside_lumps(p, lumps, skip=None, margin=0.9, rz=0.82):
    """p が lumps (中心, 半径, …) のどれか (skip 以外) の内側か"""
    for i, lp in enumerate(lumps):
        if i == skip:
            continue
        c, r = lp[0], lp[1]
        d = p - c
        if (d.x / r) ** 2 + (d.y / r) ** 2 + (d.z / (r * rz)) ** 2 < margin:
            return True
    return False


def scatter_cards(node, mat, lumps, per_m2, size, seed, color, shade_of, soft_of, avoid=(), avoid_r=0.3,
                  push=0.12, tilt=(5, 40), rz=0.82, flat_bottom=0.3, under=0.85, gap_clear=None):
    """葉の塊 lumps [(中心, 半径, 房の番号)] の表面に葉のカードを散らす (他の塊に埋もれる所と avoid の点の近くは除く)。
    カードは表面の外向きから tilt 度だけ傾け、表面から size × push だけ外へ出す (輪郭が葉の縁になる)。
    法線は soft_of(房の番号) = (中心, 1.0) で房の丸い量感に揃える。色は color (リニア) × shade_of(房の番号)(co, 法線) × カードごとの揺らぎ。
    under は下向きの面にカードを置く割合 (下側は少なく)。
    gap_clear=m を渡すと、カードの外の端が別の房の塊の表面から m 以内に届くカードを置かない
    (房と房の間の隙間をカードで塞がない: 試作 3 の判断の、光の筋が出る程度の隙間を残す)。返り値は置いた枚数"""
    rnd = random.Random(seed)
    placed = 0
    for li, (c, r, k) in enumerate(lumps):
        area = 4 * math.pi * r * r * (0.55 + 0.45 * rz)
        n = max(3, int(round(area * per_m2)))
        for j in range(n):
            # 球面の上の均等な点 (フィボナッチ) を塊ごとに回す
            zz = 1 - 2 * (j + 0.5) / n
            a = j * 2.39996 + li * 1.3 + rnd.uniform(-0.3, 0.3)
            h = math.sqrt(max(0.0, 1 - zz * zz))
            d = Vector((h * math.cos(a), h * math.sin(a), zz))
            if d.z < -0.2 and rnd.random() > under:
                continue
            p = lump_surface(c, r, d, rz, flat_bottom)
            nrm = Vector((d.x / r, d.y / r, d.z / (r * rz))).normalized()
            if inside_lumps(p + nrm * 0.05, lumps, skip=li, margin=0.95, rz=rz):
                continue
            if any((p - q).length < avoid_r for q in avoid):
                continue
            if gap_clear is not None:
                tip = p + nrm * size * 0.55
                if any(ok != k and (tip - oc).length < orr + gap_clear for oc, orr, ok in lumps):
                    continue
            t = nrm.cross(Z if abs(nrm.z) < 0.95 else X).normalized()
            t.rotate(Quaternion(nrm, rnd.uniform(0, 2 * math.pi)))
            th = math.radians(rnd.uniform(*tilt))
            cn = (nrm * math.cos(th) + t * math.sin(th)).normalized()
            ax = cn.cross(nrm)
            if ax.length < 1e-4:
                ax = t.cross(cn)
            ax.normalize()
            ay = cn.cross(ax).normalized()
            s = size * rnd.uniform(0.85, 1.15)
            ctr = p + nrm * s * push
            m = Matrix((
                (ax.x, ay.x, cn.x, ctr.x),
                (ax.y, ay.y, cn.y, ctr.y),
                (ax.z, ay.z, cn.z, ctr.z),
                (0, 0, 0, 1)))
            jit = (rnd.uniform(0.9, 1.08), rnd.uniform(0.92, 1.06), rnd.uniform(0.85, 1.1))

            def f(co, nrm_, jit=jit, shade=shade_of(k)):
                v = shade(co, nrm_)
                return tuple(color[i] * v[i] * jit[i] for i in range(3))
            node.add(card(s, rnd.randrange(4)), mat, matrix=m, smooth=True, recalc=False, shade=f, soft=soft_of(k))
            placed += 1
    return placed


def bark_shade(spine, radii, color, moss, lo=0.7, hi=1.0, z1=2.0, groove=0.25, moss_z=(0.1, 1.1), seed=0.0):
    """(木の磨き上げで追加) 幹と根の頂点色。材質の基本色は白にして、色ごと頂点色に載せる (茶色の幹にも緑の苔を載せられる)。
    - 高さ z1 までの根元の陰り (lo→hi)
    - 幹の芯からの距離が名目の半径より内の頂点 (tube の ridge で凹ませた裂け目) を groove だけ暗く (縦の筋)
    - 芯のまわりの角度でゆっくり揺らぐ明暗 (筋の濃淡)
    - 根元 moss_z の下ほど、上を向いた面ほど、color から moss へ寄せる (苔)"""
    sp = [Vector(p) for p in spine]

    def axis_at(z):
        for (a, ra), (b, rb) in zip(zip(sp, radii), zip(sp[1:], radii[1:])):
            if a.z <= z <= b.z:
                t = (z - a.z) / max(1e-6, b.z - a.z)
                return a.lerp(b, t), ra + (rb - ra) * t
        return (sp[0], radii[0]) if z < sp[0].z else (sp[-1], radii[-1])

    def clamp(x):
        return min(1.0, max(0.0, x))

    def f(co, n):
        p, r = axis_at(co.z)
        dx, dy = co.x - p.x, co.y - p.y
        g = math.hypot(dx, dy) / max(1e-3, r)
        gro = clamp((0.99 - g) / 0.06) if g < 1.2 else 0.0
        v = (lo + (hi - lo) * clamp(co.z / z1)) * (1 - groove * gro)
        ang = math.atan2(dy, dx)
        v *= 0.92 + 0.1 * (0.5 + 0.5 * math.sin(ang * 5 + seed + 0.8 * math.sin(co.z * 0.9 + seed)))
        m = clamp((moss_z[1] - co.z) / (moss_z[1] - moss_z[0])) * (0.75 + 0.25 * max(0.0, n.z))
        m *= 0.55 + 0.45 * math.sin(ang * 3 + co.z * 3.0 + seed) ** 2
        return tuple((color[i] * (1 - m) + moss[i] * m) * v for i in range(3))
    return f


def fissures(n, depth=(0.06, 0.13), bump=0.05, seed=0, flare=None, rings=None):
    """(木の磨き上げで追加) tube の ridge: 輪の頂点を 1 つおきに凹ませて縦の裂け目を作る (深さは頂点ごとに揺らす)。
    flare=(輪の数, 倍率) で根元の輪を 1 つおきに張り出す (板根の付け根の膨らみ)。
    rings (輪の数) を渡すと最後の輪は凹ませない (幹の先の蓋が星形のぎざぎざにならない)"""
    r = random.Random(seed)
    dk = [r.uniform(*depth) for _ in range(n)]

    def f(i, k):
        if rings is not None and i == rings - 1:
            return 1.0
        v = 1 - dk[k] if k % 2 == 0 else 1 + bump
        if flare and i < flare[0] and k % 2 == 1:
            v *= 1 + (flare[1] - 1) * (1 - i / flare[0])
        return v
    return f
