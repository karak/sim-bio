"""ローポリ生物モデルの共通部品 (rabbit.py で確立した作り方を deer.py / wolf.py で再利用する)。

- 材質: <creature>_<key> の名前で作る (compare_ref.py の creature_parts に合わせる)。sRGB→リニア、マット (スペキュラ 0)。
  tools/blender/<creature>-colors.json があれば色を上書きする (tune_colors.py が書く)
- 形状: 断面リングを bridge するロフト (ring / loft / densify)。finish で bmesh をオブジェクト化
- デカール: 参照画像の正規化座標 (fx, fy) を compare_ref.py と同じカメラ越しにモデル表面へ投影して貼る
  (setup_ref_camera → at_ref → decal_at / ribbon)。デカールは頂点ごとに表面へ落として扇状に三角形化する
- 仕上げ: finalize で結合・フラットシェード・原点を足元・.blend と .glb を保存
"""
import json
import math
import os

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str):
    """#RRGGBB (sRGB) → Blender/glTF が期待するリニア RGB"""
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def ring(bm, center, ux, uy, rx, ry, n=8, phase=0.0, angles=None):
    """center を中心に ux/uy 平面上へ楕円リングを置く。angles (度) を渡すと頂点の角度を直接指定できる"""
    if angles is None:
        angles = [math.degrees(phase) + 360 * i / n for i in range(n)]
    return [bm.verts.new(center + ux * (rx * math.cos(math.radians(a))) + uy * (ry * math.sin(math.radians(a)))) for a in angles]


def loft(bm, rings, cap_start=True, cap_end=True):
    """隣り合うリングを四角面で bridge する。要素が BMVert 単体なら扇状に収束させる"""
    faces = []
    for a, b in zip(rings, rings[1:]):
        if isinstance(a, list) and isinstance(b, list):
            n = len(a)
            for i in range(n):
                faces.append(bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])))
        elif isinstance(a, list):
            n = len(a)
            for i in range(n):
                faces.append(bm.faces.new((a[i], a[(i + 1) % n], b)))
        else:
            n = len(b)
            for i in range(n):
                faces.append(bm.faces.new((a, b[(i + 1) % n], b[i])))
    if cap_start and isinstance(rings[0], list):
        faces.append(bm.faces.new(list(reversed(rings[0]))))
    if cap_end and isinstance(rings[-1], list):
        faces.append(bm.faces.new(rings[-1]))
    return faces


def densify(sections, bulge=1.035):
    """隣り合う断面の中間にもう 1 断面を挿入する。bulge>1 で丸み、1.0 で角を保つ"""
    out = []
    for a, b in zip(sections, sections[1:]):
        out.append(a)
        mid = tuple((x + y) / 2 for x, y in zip(a, b))
        out.append(mid[:2] + tuple(r * bulge for r in mid[2:]))
    out.append(sections[-1])
    return out


def tube(bm, pts, radii, n=6, phase=0.0, tip=True):
    """折れ線 pts に沿って半径 radii のリングを置きロフトする (角・脚・尾など)。tip=True で最後を点に収束"""
    rings = []
    for i, (p, r) in enumerate(zip(pts, radii)):
        if tip and i == len(pts) - 1:
            rings.append(bm.verts.new(p))  # 先端は 1 点 (リングを作ってから置き換えると孤立頂点が残る)
            continue
        d = ((pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])).normalized()
        u = (Z.cross(d) if abs(d.z) < 0.9 else X.cross(d)).normalized()
        v = d.cross(u).normalized()
        rings.append(ring(bm, p, u, v, r, r, n, phase))
    return loft(bm, rings, cap_start=True, cap_end=not tip)


def almond(L, H, k=4):
    """両端が尖ったアーモンド形 (レンズ形) の頂点列"""
    step = 180 // (k + 1)
    top = [(L * math.cos(math.radians(a)), H * math.sin(math.radians(a))) for a in range(180 - step, 0, -step)]
    return [(-L, 0.0)] + top + [(L, 0.0)] + [(x, -y) for x, y in reversed(top)]


def hexagon(r, rot=30):
    return [(r * math.cos(math.radians(rot + 60 * i)), r * math.sin(math.radians(rot + 60 * i))) for i in range(6)]


def tangent_frame(n):
    u = (Z.cross(n) if abs(n.z) < 0.9 else X.cross(n)).normalized()
    return u, n.cross(u).normalized()


class Kit:
    def __init__(self, creature, out_dir, base_colors, mat_keys, emission=None):
        """creature: 個体名。mat_keys: 材質キーの順 (インデックスがマテリアルスロット)。emission: {key: strength}"""
        self.creature, self.out_dir = creature, out_dir
        os.makedirs(out_dir, exist_ok=True)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        colors = dict(base_colors)
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{creature}-colors.json")
        if os.path.exists(path):
            with open(path) as f:
                colors.update(json.load(f))
        self.colors = colors
        self.mat_keys = list(mat_keys)
        self.mats = [self._solid(f"{creature}_{k}", colors[k], (emission or {}).get(k, 0.0)) for k in self.mat_keys]
        self.parts = []
        self.base_parts = []
        self.ref_cam = None

    def _solid(self, name, color, emission):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        rgb = hex_rgb(color)
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Specular IOR Level"].default_value = 0.0  # 白い反射は色補正で消せない加算項なので切る
        if emission:
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1)
            bsdf.inputs["Emission Strength"].default_value = emission
        m.diffuse_color = (*rgb, 1)
        return m

    def mat(self, key):
        return self.mat_keys.index(key)

    def finish(self, bm, name, base=True):
        """bmesh をオブジェクト化。法線を外向きに揃え、全マテリアルスロットを持たせる。base=True で基本パーツ (デカール投影先)"""
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        self.scene.collection.objects.link(o)
        self.parts.append(o)
        if base:
            self.base_parts.append(o)
        return o

    # ---------- 参照座標系 ----------
    def setup_ref_camera(self, az, el, lens=50, fill=0.62, ortho=False):
        """compare_ref.py と同じカメラを組み、基本パーツの投影 bbox を控える。ortho=True で平行投影 (compare_ref の proj=ortho)"""
        bpy.context.view_layer.update()
        self.depsgraph = bpy.context.evaluated_depsgraph_get()
        pts = [o.matrix_world @ Vector(c) for o in self.base_parts for c in o.bound_box]
        lo = Vector((min(p[i] for p in pts) for i in range(3)))
        hi = Vector((max(p[i] for p in pts) for i in range(3)))
        center, height = (lo + hi) / 2, hi.z - lo.z
        cam_data = bpy.data.cameras.new("ref_cam")
        cam_data.lens = lens
        cam = bpy.data.objects.new("ref_cam", cam_data)
        self.scene.collection.objects.link(cam)
        self.scene.camera = cam
        self.scene.render.resolution_x = self.scene.render.resolution_y = 1024
        fov = 2 * math.atan(cam_data.sensor_width / 2 / lens)
        fill_dim = max(height, 0.7 * ((hi.x - lo.x) + (hi.y - lo.y)))  # compare_ref.py と同じ規則 (横長の個体は幅基準)
        dist = (fill_dim / fill) / 2 / math.tan(fov / 2)
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = fill_dim / fill
        a, e = math.radians(az), math.radians(el)
        cam.location = center + Vector((math.cos(a) * math.cos(e) * dist, -math.sin(a) * math.cos(e) * dist, math.sin(e) * dist))
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        self.ortho = ortho
        proj = [world_to_camera_view(self.scene, cam, o.matrix_world @ v.co) for o in self.base_parts for v in o.data.vertices]
        self.x0, self.x1 = min(p.x for p in proj), max(p.x for p in proj)
        self.y0, self.y1 = min(p.y for p in proj), max(p.y for p in proj)
        self.h = self.y1 - self.y0
        self.frame_m = height  # 正規化枠 1 = 全高 (m)
        self.tr, self.br, self.bl, self.tl = cam_data.view_frame(scene=self.scene)
        self.ref_cam = cam

    def frame_of(self, p):
        """ワールド座標 → 正規化枠 (fx: 中心 0、fy: 上 0)"""
        v = world_to_camera_view(self.scene, self.ref_cam, Vector(p))
        return round((v.x - (self.x0 + self.x1) / 2) / self.h, 3), round((self.y1 - v.y) / self.h, 3)

    def _cast(self, objs, origin, d):
        best = None
        for o in objs:
            hit, loc, normal, _ = o.ray_cast(origin, d, depsgraph=self.depsgraph)
            if hit and (best is None or (loc - origin).length < (best[0] - origin).length):
                best = (loc, normal.normalized())
        return best

    def ray_of(self, fx, fy):
        """参照画像の正規化座標 (fx, fy) を通る視線 (origin, dir)"""
        ix = (self.x0 + self.x1) / 2 + fx * self.h
        iy = self.y1 - fy * self.h
        p_local = self.bl + (self.br - self.bl) * ix + (self.tl - self.bl) * iy
        p_world = self.ref_cam.matrix_world @ p_local
        if self.ortho:
            # 平行投影: 視線はすべてカメラの -Z 方向。原点は画枠上の点をカメラ側へ戻した位置
            d = (self.ref_cam.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
            return p_world - d * 10.0, d
        origin = self.ref_cam.matrix_world.translation
        return origin, (p_world - origin).normalized()

    def cut_along(self, obj, polys, margin=0.03):
        """参照座標の多角形の辺に沿ってオブジェクトの面を切る (面単位の塗り分けの境界を直線にする)。
        各辺を通る視線 2 本が張る平面で、その辺 (線分) から margin 以内に投影される面だけを bisect する
        (平面は無限に延びるので、線分から離れた面まで切ると三角形数が増える)。
        奥側 (+X) は x を反転した平面で切り、左右対称にする。切った後に paint で塗る前提"""
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        mw = obj.matrix_world
        cuts = 0

        def seg_dist(p, a, b):
            ax, ay = a
            bx, by = b
            vx, vy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / max(vx * vx + vy * vy, 1e-9)))
            return math.hypot(p[0] - ax - t * vx, p[1] - ay - t * vy)

        for poly in polys:
            for a, b in zip(poly, poly[1:] + poly[:1]):
                oa, da = self.ray_of(*a)
                ob, _ = self.ray_of(*b)
                no = da.cross(ob - oa).normalized()
                for sgn in (-1, 1):  # -1: 手前 (-X)、+1: 奥 (+X、鏡像の平面)
                    co = Vector((sgn * -oa.x, oa.y, oa.z)) if sgn > 0 else oa
                    n = Vector((-no.x, no.y, no.z)) if sgn > 0 else no
                    faces = []
                    for f in bm.faces:
                        c = mw @ f.calc_center_median()
                        if (c.x < 0) != (sgn < 0):
                            continue
                        fr = self.frame_of(Vector((-abs(c.x), c.y, c.z)))
                        if seg_dist(fr, a, b) <= margin:
                            faces.append(f)
                    if not faces:
                        continue
                    edges = {e for f in faces for e in f.edges}
                    verts = {v for f in faces for v in f.verts}
                    r = bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, dist=0.0005, plane_co=mw.inverted() @ co,
                                               plane_no=(mw.inverted().to_3x3() @ n).normalized(), clear_inner=False, clear_outer=False)
                    cuts += len(r["geom_cut"])
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
        return cuts

    def at_ref(self, fx, fy, objs=None, mirror=False, center=False):
        """参照画像の正規化座標 (fx, fy) をカメラ越しにモデル表面へ投影する。
        mirror=True で反対側 (x 反転) の対応点、center=True で x=0 の正中線上 (正面から後方へ撃ち直す)"""
        objs = objs or self.base_parts
        origin, d = self.ray_of(fx, fy)
        best = self._cast(objs, origin, d)
        if best is None:
            # 参照の輪郭がモデルより外側にある点: 枠の中心 (0, 0.5) へ 0.01 ずつ寄せて当たる所に置く
            dx, dy = -fx, 0.5 - fy
            L = math.hypot(dx, dy)
            if L < 0.005:
                raise RuntimeError(f"参照座標 ({fx}, {fy}) がモデルに当たりません")
            return self.at_ref(fx + 0.01 * dx / L, fy + 0.01 * dy / L, objs, mirror, center)
        loc, n = best
        if mirror:
            best = self._cast(objs, Vector((-origin.x, origin.y, origin.z)), Vector((-d.x, d.y, d.z)))
        if center:
            best = self._cast(objs, Vector((0, loc.y - 1.0, loc.z)), Y)
        if best is None:
            raise RuntimeError(f"参照座標 ({fx}, {fy}) の対応点が見つかりません")
        loc, n = best
        return (loc, n) + tangent_frame(n)

    def conform(self, p, n, offset):
        best = self._cast(self.base_parts, p + n * 0.05, -n)
        return p if best is None else best[0] + n * offset

    def decal_at(self, name, frame, pts_uv, mat, tilt_deg=0.0, offset=0.002):
        """接平面上の多角形 (pts_uv: (u,v) [m]) を表面から offset 浮かせて貼る。頂点は表面へ落とし、中心から扇状に三角形化"""
        loc, n, u, v = frame
        t = math.radians(tilt_deg)
        du = u * math.cos(t) + v * math.sin(t)
        dv = -u * math.sin(t) + v * math.cos(t)
        bm = bmesh.new()
        verts = [bm.verts.new(self.conform(loc + du * a + dv * b, n, offset)) for a, b in pts_uv]
        c = bm.verts.new(self.conform(loc, n, offset))
        faces = [bm.faces.new((c, verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]
        for f in faces:
            f.material_index = mat
            f.normal_update()
        flip = [f for f in faces if f.normal.dot(n) < 0]
        if flip:
            bmesh.ops.reverse_faces(bm, faces=flip)
        return self.finish(bm, name, base=False)

    def ribbon(self, name, pts, mat, width=0.009, offset=0.0015, mirror=False, step=0.012, objs=None):
        """参照座標の折れ線を表面に投影し、細い帯にする。面に沿うよう step 間隔で細分する"""
        dense = []
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            k = max(1, int(math.hypot(bx - ax, by - ay) / step))
            dense += [(ax + (bx - ax) * i / k, ay + (by - ay) * i / k) for i in range(k)]
        dense.append(pts[-1])
        hits = [self.at_ref(fx, fy, objs=objs, mirror=mirror) for fx, fy in dense]
        bm = bmesh.new()
        prev = None
        for i, (loc, n, _, _) in enumerate(hits):
            d = (hits[i + 1][0] - loc) if i + 1 < len(hits) else (loc - hits[i - 1][0])
            d = d.normalized()
            side = n.cross(d).normalized() * (width / 2)
            pair = (bm.verts.new(loc + n * offset - side), bm.verts.new(loc + n * offset + side))
            if prev:
                f = bm.faces.new((prev[0], prev[1], pair[1], pair[0]))
                f.material_index = mat
            prev = pair
        return self.finish(bm, name, base=False)

    def view_dir(self, p):
        """参照カメラから点 p を見る視線方向 (平行投影ならカメラの -Z)"""
        if self.ortho:
            return (self.ref_cam.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
        return (Vector(p) - self.ref_cam.matrix_world.translation).normalized()

    def fin(self, name, pts, mat, height=0.01, thickness=0.004, mirror=False, step=0.012, objs=None, screen=False):
        """参照座標の折れ線 (輪郭沿いの縁線) を表面に投影し、height だけ立てた薄い板 (鰭) にする。
        輪郭に沿う光の線は表面に貼った帯だと横から見ると潰れて見えないので、輪郭から突き出す形で表す。閉じた薄い箱にして両面から見える。
        screen=False: 表面の法線方向へ立てる (輪郭上の点用)。
        screen=True: 画面上で折れ線と直交する向き (視線 × 接線) へ立てる。参照の線が輪郭の内側 (縁から幅 w の帯) にあるとき、
        帯の内側の縁を折れ線に渡し height=w にすると、鰭の上端がちょうど輪郭に来る"""
        dense = []
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            k = max(1, int(math.hypot(bx - ax, by - ay) / step))
            dense += [(ax + (bx - ax) * i / k, ay + (by - ay) * i / k) for i in range(k)]
        dense.append(pts[-1])
        hits = [self.at_ref(fx, fy, objs=objs, mirror=mirror) for fx, fy in dense]
        bm = bmesh.new()
        prev = None
        for i, (loc, n, _, _) in enumerate(hits):
            d = (hits[i + 1][0] - loc) if i + 1 < len(hits) else (loc - hits[i - 1][0])
            d = d.normalized()
            up = n
            if screen:
                up = d.cross(self.view_dir(loc)).normalized()
                if up.dot(n) < 0:
                    up = -up
            side = up.cross(d).normalized() * (thickness / 2)
            base = loc - up * 0.002  # 根元は表面に少し埋める
            quad = (bm.verts.new(base - side), bm.verts.new(base + side), bm.verts.new(base + up * height + side), bm.verts.new(base + up * height - side))
            if prev is None:
                bm.faces.new(quad)  # 始端のキャップ
            else:
                for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
                    bm.faces.new((prev[a], prev[b], quad[b], quad[a]))
            prev = quad
        bm.faces.new(tuple(reversed(prev)))  # 終端のキャップ
        for f in bm.faces:
            f.material_index = mat
        return self.finish(bm, name, base=False)

    def panel(self, name, fx, fy, w_frame, h_frame, mat, mirror=False, objs=None, offset=0.0015, shape=None):
        """参照 bbox (中心 fx,fy、幅 w、高さ h、枠単位) に収まる角ばった多角形パネルを貼る"""
        w, h = w_frame * self.frame_m / 2, h_frame * self.frame_m / 2
        pts = shape or [(-1.0, -0.6), (-0.3, -1.0), (0.5, -0.9), (1.0, 0.1), (0.4, 1.0), (-0.6, 0.8)]
        fr = self.at_ref(fx, fy, objs=objs, mirror=mirror)
        # 接平面の u/v を画面の横/縦に揃える: u はほぼ水平 (tangent_frame の定義)、v は上向き
        return self.decal_at(name, fr, [(a * w, b * h) for a, b in pts], mat, offset=offset)

    # ---------- 仕上げ ----------
    def finalize(self):
        if self.ref_cam is not None:
            bpy.data.objects.remove(self.ref_cam)
        for o in self.parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        bpy.ops.object.join()
        obj = bpy.context.active_object
        obj.name = obj.data.name = self.creature
        bpy.ops.object.shade_flat()
        zmin = min(v.co.z for v in obj.data.vertices)
        for v in obj.data.vertices:
            v.co.z -= zmin
        self.scene.cursor.location = (0, 0, 0)
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        blend_path = os.path.abspath(os.path.join(self.out_dir, f"{self.creature}.blend"))
        glb_path = os.path.abspath(os.path.join(self.out_dir, f"{self.creature}.glb"))
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", use_selection=True, export_apply=True)
        d = obj.dimensions
        tris = sum(len(f.vertices) - 2 for f in obj.data.polygons)
        print(f"{self.creature}: {len(obj.data.polygons)} faces / {tris} tris, dims x={d.x:.3f} y={d.y:.3f} z={d.z:.3f}")
        print(f"saved {blend_path}\nsaved {glb_path}")
        return obj
