"""光角鹿 (deer) のローポリ 3D モデルを参照画像 assets/textures/concept/deer-angular.png から組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models
出力: <out_dir>/deer.blend と <out_dir>/deer.glb
検証: compare_ref.py で参照と同アングル (方位 135°、仰角 10°) で撮影しパーツ別に比較する。
  参照は左側面 (-X 側) が手前で頭が画面右なので、rabbit (方位 45°) と逆側から撮る

作り方 (共通部品は lowpoly_kit.py):
  - 胴・首・頭・脚・尾は断面リングのロフト。角は折れ線に沿ったチューブ (主幹 + 2 本の枝) で発光材質、根元だけ深緑
  - 深緑のパネル (肩・腰・き甲・胸) と蹄は平らなデカール / 面の塗り分け。シアンの縁線はリボン
  - 目は頬の平面に貼るアーモンド形の発光デカール
寸法は参照画像の比率から: 角含む全高 ≈ 1.6 m、背の高さ ≈ 0.75 m、胴長 ≈ 0.67 m。単位 m、Z up、正面 -Y、原点は足元。
"""
import math
import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creature_parts import CREATURES  # noqa: E402
from lowpoly_kit import X, Y, Z, Kit, almond, densify, loft, ring, tube  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = argv[0] if argv else "assets/models"

kit = Kit("deer", out_dir, CREATURES["deer"]["base_colors"], ["fur", "dark", "teal", "glow"], emission={"glow": 0.3})
FUR, DARK, TEAL, GLOW = range(4)
REF_AZ, REF_EL = 135.0, 10.0

# ---------- 胴 (尻 → 胸): 16 頂点リングを密に並べる (パネルを面単位で塗り分けるため)。背は水平、腹はやや丸い ----------
bm = bmesh.new()
body_sections = densify(densify([
    (0.62, 0.60, 0.07, 0.10),
    (0.55, 0.60, 0.115, 0.145),
    (0.40, 0.595, 0.13, 0.16),
    (0.18, 0.59, 0.13, 0.165),
    (-0.02, 0.595, 0.13, 0.16),
    (-0.15, 0.61, 0.12, 0.15),
    (-0.23, 0.63, 0.08, 0.11),  # 胸の前面
], bulge=1.0), bulge=1.0)
loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 16, math.pi / 16) for y, zc, rx, rz in body_sections])
body = kit.finish(bm, "body")

# ---------- 首: 胸の上から頭の後ろへ斜めに立つ。断面は首の軸に直交 ----------
bm = bmesh.new()
n0, n1 = Vector((0, -0.14, 0.64)), Vector((0, -0.07, 0.98))
axis = (n1 - n0).normalized()
uy = axis.cross(X).normalized()  # 首の前後方向 (軸に直交)
neck_sections = [(0.0, 0.10, 0.16), (0.3, 0.09, 0.145), (0.6, 0.08, 0.125), (0.85, 0.075, 0.11), (1.0, 0.07, 0.10)]
loft(bm, [ring(bm, n0 + (n1 - n0) * t, X, uy, rx, ry, 8, math.pi / 8) for t, rx, ry in neck_sections])
neck = kit.finish(bm, "neck")

# ---------- 頭 (後頭部 → 鼻先): 頬の平面が背高な 8 頂点リング。鼻先へ絞る ----------
HEAD_ANGLES = [45, 80, 100, 135, 225, 260, 280, 315]
bm = bmesh.new()
head_sections = densify([
    (-0.02, 0.99, 0.065, 0.09),
    (-0.08, 0.99, 0.085, 0.115),
    (-0.15, 0.985, 0.085, 0.11),
    (-0.22, 0.97, 0.07, 0.085),
    (-0.29, 0.955, 0.05, 0.055),
    (-0.36, 0.945, 0.03, 0.032),  # 鼻先 (平らな小キャップ)
], bulge=1.0)
loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, angles=HEAD_ANGLES) for y, zc, rx, rz in head_sections])
head = kit.finish(bm, "head")


# ---------- 耳: 後頭部から後ろ上へ伸びる薄い刃 ----------
def make_ear(sgn):
    bm = bmesh.new()
    axis = Vector((sgn * 0.45, 0.55, 0.7)).normalized()
    ux = Y.cross(axis).normalized()
    uy = axis.cross(ux).normalized()
    base = Vector((sgn * 0.07, -0.05, 1.04))
    secs = [(0.0, 0.025, 0.014), (0.07, 0.05, 0.016), (0.14, 0.055, 0.014), (0.20, 0.038, 0.009)]
    rings = [ring(bm, base + axis * t, ux, uy, w, th, angles=[0, 25, 90, 155, 180, 200, 340]) for t, w, th in secs]
    loft(bm, rings + [bm.verts.new(base + axis * 0.24)])
    return kit.finish(bm, f"ear_{'R' if sgn > 0 else 'L'}")


make_ear(1)
make_ear(-1)


# ---------- 角: 太い三日月形。頭頂の脇から外へ深緑の根元が出て、発光する主幹が外・上へ張り出し、
# 上端で内側へ曲がって先端が上を向く。中ほどから内向きの枝が 1 本上がる。参照の枠座標を
# fx ≈ 0.42·(x − y) + 0.042、fy ≈ 0.97 − 0.59·z で 3D へ戻した値 (手前 = -X 側) ----------
def make_antler(sgn):
    bm = bmesh.new()
    o = sgn
    beam = [Vector((o * 0.05, -0.07, 1.06)), Vector((o * 0.13, -0.05, 1.12)), Vector((o * 0.29, -0.04, 1.19)), Vector((o * 0.42, -0.03, 1.30)),
            Vector((o * 0.45, -0.02, 1.42)), Vector((o * 0.39, -0.03, 1.54)), Vector((o * 0.30, -0.05, 1.63))]
    tube(bm, beam, [0.045, 0.045, 0.045, 0.04, 0.035, 0.025, 0.0], n=6)
    t0 = Vector((o * 0.24, -0.04, 1.20))
    tube(bm, [t0, Vector((o * 0.16, -0.06, 1.30)), Vector((o * 0.10, -0.08, 1.40))], [0.035, 0.025, 0.0], n=6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    up = (beam[1] - beam[0]).normalized()
    for f in bm.faces:
        f.material_index = TEAL if (f.calc_center_median() - beam[0]).dot(up) < 0.10 else GLOW
    return kit.finish(bm, f"antler_{'R' if sgn > 0 else 'L'}")


make_antler(1)
make_antler(-1)


# ---------- 脚: 細い柱。蹄は深緑 ----------
def make_leg(name, sx, sections):
    bm = bmesh.new()
    faces = loft(bm, [ring(bm, Vector((sx, y, z)), X, Y, rx, ry, 8, math.pi / 8) for z, y, rx, ry in sections])
    for f in faces:
        if f.calc_center_median().z < 0.06:
            f.material_index = TEAL
    return kit.finish(bm, name)


FRONT = [(0.50, -0.05, 0.05, 0.065), (0.32, -0.06, 0.035, 0.045), (0.16, -0.06, 0.03, 0.038), (0.06, -0.065, 0.03, 0.04), (0.0, -0.07, 0.034, 0.048)]
HIND = [(0.52, 0.52, 0.06, 0.09), (0.36, 0.50, 0.04, 0.06), (0.20, 0.49, 0.032, 0.04), (0.06, 0.48, 0.03, 0.04), (0.0, 0.48, 0.034, 0.048)]
for sgn in (1, -1):
    make_leg(f"foreleg_{'R' if sgn > 0 else 'L'}", sgn * 0.085, FRONT)
    make_leg(f"hindleg_{'R' if sgn > 0 else 'L'}", sgn * 0.10, HIND)

# ---------- 尾: 尻の上から後ろ上へ立つ小さな楔 ----------
bm = bmesh.new()
tube(bm, [Vector((0, 0.60, 0.62)), Vector((0, 0.65, 0.68)), Vector((0, 0.68, 0.75))], [0.035, 0.028, 0.0], n=6)
kit.finish(bm, "tail")

# ---------- デカール: 参照画像の実測座標 (docs/design/qa/deer-ref-components.json) から投影 ----------
kit.setup_ref_camera(REF_AZ, REF_EL)

if os.environ.get("DEER_DEBUG"):
    for name, p in [("nose", (0, -0.36, 0.945)), ("head_top", (0, -0.08, 1.10)), ("chest_front", (0, -0.23, 0.63)), ("rump", (0, 0.62, 0.60)),
                    ("back_top", (0, 0.12, 0.755)), ("belly", (0, 0.12, 0.425)), ("antler_tip_L", (-0.30, -0.05, 1.63)), ("antler_tip_R", (0.30, -0.05, 1.63)), ("antler_out_L", (-0.45, -0.02, 1.42)),
                    ("hoof_front_L", (-0.085, -0.07, 0)), ("hoof_hind_L", (-0.10, 0.48, 0)), ("hoof_front_R", (0.085, -0.07, 0)), ("hoof_hind_R", (0.10, 0.48, 0))]:
        print(f"landmark {name}: fx,fy = {kit.frame_of(p)}")

# 鼻: 鼻先の正中線上に小さな暗い三角
kit.decal_at("nose", kit.at_ref(0.205, 0.43, center=True), [(-0.014, 0.008), (0.014, 0.008), (0.0, -0.012)], DARK)


def point_in_poly(x, y, poly):
    inside = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def paint_faces(obj, polys, mat):
    """参照座標の多角形の内側に投影される面を塗る。参照の深緑パネルは面単位の塗り分けなので、
    デカールではなく胴の面そのものに材質を割り当てる。奥側 (+X) は手前 (-X) の対応点で判定して左右対称にする"""
    n = 0
    for f in obj.data.polygons:
        c = obj.matrix_world @ f.center
        fx, fy = kit.frame_of(Vector((-abs(c.x), c.y, c.z)))
        if any(point_in_poly(fx, fy, poly) for poly in polys):
            f.material_index = mat
            n += 1
    return n


# 深緑のパネル (参照 dark 成分の bbox から起こした多角形、枠座標): 肩、腰、き甲、胸
PANELS = [
    [(-0.065, 0.60), (-0.04, 0.568), (0.03, 0.575), (0.044, 0.64), (0.02, 0.72), (-0.05, 0.70)],
    [(-0.255, 0.60), (-0.22, 0.555), (-0.15, 0.57), (-0.143, 0.65), (-0.17, 0.727), (-0.24, 0.70)],
    [(-0.073, 0.508), (0.008, 0.512), (0.008, 0.576), (-0.073, 0.576)],
    [(0.075, 0.60), (0.14, 0.59), (0.16, 0.64), (0.14, 0.70), (0.08, 0.70)],
]
print("panel faces:", paint_faces(body, PANELS, TEAL), "+ neck", paint_faces(neck, PANELS[2:3], TEAL))

for mirror in (False, True):
    tag = "L" if not mirror else "R"  # 手前 (-X) が左
    # 目: 頬の平面 (参照 fx 0.103, fy 0.39)。深緑の縁 + シアンの面
    fr = kit.at_ref(0.103, 0.39, objs=[head], mirror=mirror)
    kit.decal_at(f"eye_rim_{tag}", fr, almond(0.034, 0.02), TEAL, offset=0.003)
    kit.decal_at(f"eye_{tag}", fr, almond(0.026, 0.014), GLOW, offset=0.0045)
    # シアンの縁線: 襟 (き甲 → 胸)、腹の線、腰パネルの前縁
    kit.ribbon(f"line_collar_{tag}", [(-0.02, 0.545), (0.03, 0.575), (0.08, 0.62), (0.125, 0.69)], GLOW, width=0.01, offset=0.003, mirror=mirror)
    kit.ribbon(f"line_belly_{tag}", [(-0.156, 0.70), (-0.06, 0.70)], GLOW, width=0.008, offset=0.003, mirror=mirror, objs=[body])
    kit.ribbon(f"line_hip_{tag}", [(-0.172, 0.58), (-0.19, 0.70)], GLOW, width=0.008, offset=0.003, mirror=mirror, objs=[body])

kit.finalize()
