"""光角鹿 (deer) のローポリ 3D モデルを参照画像 assets/textures/concept/deer-angular.png から組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/deer.py -- assets/models
出力: <out_dir>/deer.blend と <out_dir>/deer.glb
検証: compare_ref.py で参照と同アングル (方位 135°、仰角 10°、平行投影 proj=ortho) で撮影しパーツ別に比較する。
  参照は左側面 (-X 側) が手前で頭が画面右なので、rabbit (方位 45°) と逆側から撮る。
  参照は 4 本の蹄を同じ地面線に描いているので wolf と同じく平行投影で評価する (透視 0.49 → 平行投影 0.52)

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
REF_AZ, REF_EL, REF_ORTHO = 135.0, 10.0, True

# ---------- 胴 (尻 → 胸): 16 頂点リングを密に並べる (パネルを面単位で塗り分けるため)。背は水平、腹はやや丸い ----------
bm = bmesh.new()
# 参照の背は き甲 (fy 0.55) から尻 (fy 0.60) へ 0.08 m 下がる。胸の前面は狭い (参照の胸の前縁 fx 0.14-0.15)
body_sections = densify(densify([
    (0.60, 0.53, 0.06, 0.07),
    (0.55, 0.545, 0.115, 0.10),
    (0.40, 0.56, 0.13, 0.135),
    (0.18, 0.585, 0.13, 0.16),
    (-0.02, 0.595, 0.13, 0.16),
    (-0.13, 0.61, 0.09, 0.15),
    (-0.19, 0.63, 0.045, 0.10),  # 胸の前面
], bulge=1.0), bulge=1.0)
loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 16, math.pi / 16) for y, zc, rx, rz in body_sections])
body = kit.finish(bm, "body")

# ---------- 首: 胸の上から頭の後ろへ斜めに立つ。断面は首の軸に直交 ----------
bm = bmesh.new()
n0, n1 = Vector((0, -0.12, 0.64)), Vector((0, -0.07, 0.98))
axis = (n1 - n0).normalized()
uy = axis.cross(X).normalized()  # 首の前後方向 (軸に直交)
neck_sections = [(0.0, 0.10, 0.13), (0.3, 0.09, 0.14), (0.6, 0.08, 0.125), (0.85, 0.075, 0.11), (1.0, 0.07, 0.10)]
loft(bm, [ring(bm, n0 + (n1 - n0) * t, X, uy, rx, ry, 8, math.pi / 8) for t, rx, ry in neck_sections])
neck = kit.finish(bm, "neck")

# ---------- 頭 (後頭部 → 鼻先): 頬の平面が背高な 8 頂点リング。鼻先へ絞る ----------
HEAD_ANGLES = [45, 80, 100, 135, 225, 260, 280, 315]
bm = bmesh.new()
# 参照の頭は fy 0.37-0.47 に fx 0.03-0.195 の大きなブロック: 頭頂は平らで鼻梁は高く、鼻先まで太い
head_sections = densify([
    (-0.02, 1.00, 0.07, 0.10),
    (-0.08, 1.00, 0.09, 0.125),
    (-0.15, 0.995, 0.09, 0.12),
    (-0.22, 1.005, 0.08, 0.11),
    (-0.29, 1.0, 0.065, 0.09),
    (-0.36, 0.96, 0.04, 0.05),  # 鼻先 (平らな小キャップ)
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
    """根元 (深緑) は頭頂の脇から外へ。主幹 (発光) は外へ開きながら後ろ上へ掃き、上で前へ戻って先端が上を向く三日月。
    前向きの枝 2 本 (内側 C・外側 B) が根元近くから前上へ出る。座標は参照クラス図の左右の角の対応点から
    fx = 0.425(x − y) + 0.044、fy = 0.99 − 0.593 z − 0.073 x (平行投影 az135 el10、全高 1.63) で復元した値"""
    bm = bmesh.new()
    o = sgn
    # 根元 (深緑) は短く上へ。発光する主幹は根元の上からまず外へほぼ水平に出て (参照 fy≈0.28 の横長の帯)、後ろ上へ掃く
    # 参照では根元 (dark) は頭頂から外へほぼ水平に 0.2 m 伸びる帯 (fy 0.30-0.35、fx -0.05..0.04) で、その上に発光の主幹が乗る
    root = [Vector((o * 0.07, -0.06, 1.12)), Vector((o * 0.15, -0.055, 1.16)), Vector((o * 0.24, -0.03, 1.20))]
    beam = [Vector((o * 0.10, -0.06, 1.22)), Vector((o * 0.18, -0.045, 1.245)), Vector((o * 0.25, -0.02, 1.265)), Vector((o * 0.28, 0.05, 1.29)),
            Vector((o * 0.305, 0.11, 1.30)), Vector((o * 0.325, 0.15, 1.35)), Vector((o * 0.34, 0.18, 1.41)), Vector((o * 0.35, 0.185, 1.47)),
            Vector((o * 0.355, 0.165, 1.53)), Vector((o * 0.35, 0.13, 1.58)), Vector((o * 0.35, 0.10, 1.62)), Vector((o * 0.335, 0.08, 1.65)), Vector((o * 0.30, 0.065, 1.68))]
    # 全高が 1.63 m に収まるよう z を 0.92 倍 (基準 1.08)、外側への開きを 1.06 倍
    fit = lambda v: Vector((v.x * 1.06, v.y, 1.12 + (v.z - 1.12) * 0.90))  # noqa: E731
    root, beam = [fit(v) for v in root], [fit(v) for v in beam]
    tube(bm, root, [0.04, 0.04, 0.04], n=6, tip=False)
    tube(bm, beam, [0.04, 0.042, 0.042, 0.04, 0.038, 0.036, 0.034, 0.032, 0.03, 0.026, 0.022, 0.015, 0.0], n=6)
    # 枝 A (内側・後ろ向き): 主幹の付け根から内側後ろ上へ (参照では左右の角の間に見える細い枝)
    tube(bm, [fit(Vector((o * 0.14, -0.04, 1.20))), fit(Vector((o * 0.115, 0.02, 1.28))), fit(Vector((o * 0.10, 0.07, 1.36)))], [0.022, 0.017, 0.0], n=6)
    # 枝 C (内側・前向き): 主幹の付け根から前上へ
    tube(bm, [fit(Vector((o * 0.26, 0.02, 1.24))), fit(Vector((o * 0.28, -0.03, 1.29))), fit(Vector((o * 0.285, -0.07, 1.33))), fit(Vector((o * 0.28, -0.10, 1.37)))], [0.024, 0.022, 0.016, 0.0], n=6)
    # 枝 B (外側・前向き): 根元と主幹の境から前上へ、少し外へ張る
    tube(bm, [fit(Vector((o * 0.25, -0.03, 1.19))), fit(Vector((o * 0.31, -0.08, 1.24))), fit(Vector((o * 0.345, -0.12, 1.31))), fit(Vector((o * 0.33, -0.15, 1.39)))], [0.03, 0.028, 0.02, 0.0], n=6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = TEAL if c.z < 1.205 else GLOW
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


# 参照では前脚は胸の前面より 0.28 m 後ろ (y≈+0.05) に真っすぐ下り、後脚は腿から飛節へ後ろに傾く。脚の幅は 0.05 m
FRONT = [(0.50, 0.05, 0.05, 0.09), (0.32, 0.05, 0.03, 0.04), (0.16, 0.05, 0.026, 0.033), (0.06, 0.05, 0.026, 0.035), (0.0, 0.045, 0.03, 0.042)]
HIND = [(0.52, 0.45, 0.06, 0.11), (0.36, 0.56, 0.036, 0.055), (0.20, 0.57, 0.03, 0.038), (0.06, 0.55, 0.028, 0.038), (0.0, 0.53, 0.032, 0.046)]
legs = {}
for sgn in (1, -1):
    legs[f"F{'R' if sgn > 0 else 'L'}"] = make_leg(f"foreleg_{'R' if sgn > 0 else 'L'}", sgn * 0.085, FRONT)
    legs[f"H{'R' if sgn > 0 else 'L'}"] = make_leg(f"hindleg_{'R' if sgn > 0 else 'L'}", sgn * 0.10, HIND)

# ---------- 尾: 尻の上から後ろ上へ立つ小さな楔 ----------
bm = bmesh.new()
tube(bm, [Vector((0, 0.60, 0.57)), Vector((0, 0.65, 0.64)), Vector((0, 0.68, 0.70))], [0.035, 0.028, 0.0], n=6)
kit.finish(bm, "tail")

# ---------- デカール: 参照画像の実測座標 (docs/design/qa/deer-ref-components.json) から投影 ----------
kit.setup_ref_camera(REF_AZ, REF_EL, ortho=REF_ORTHO)

if os.environ.get("DEER_DEBUG"):
    for name, p in [("nose", (0, -0.36, 0.945)), ("head_top", (0, -0.08, 1.10)), ("chest_front", (0, -0.23, 0.63)), ("rump", (0, 0.62, 0.60)), ("head_bridge", (0, -0.29, 1.07)),
                    ("back_top", (0, 0.12, 0.755)), ("belly", (0, 0.12, 0.425)), ("antler_tip_L", (-0.29, 0.065, 1.68)), ("antler_tip_R", (0.29, 0.065, 1.68)), ("antler_out_L", (-0.345, 0.185, 1.47)), ("antler_out_R", (0.345, 0.185, 1.47)),
                    ("antler_start_L", (-0.24, -0.02, 1.21)), ("tineB_tip_L", (-0.33, -0.15, 1.39)), ("tineB_tip_R", (0.33, -0.15, 1.39)), ("tineC_tip_R", (0.28, -0.10, 1.37)),
                    ("hoof_front_L", (-0.085, 0.045, 0)), ("hoof_hind_L", (-0.10, 0.53, 0)), ("hoof_front_R", (0.085, 0.045, 0)), ("hoof_hind_R", (0.10, 0.53, 0))]:
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
# 参照クラス図の dark 画素を fy 0.02 刻みで読んだ輪郭 (肩: fx -0.06..0.044 / fy 0.52..0.73、腰: -0.255..-0.143 / 0.56..0.73、
# き甲: -0.073..0.008 / 0.51..0.58、胸の前縁: 幅 0.006 の斜めの筋)
PANELS = [
    [(-0.031, 0.515), (-0.003, 0.515), (0.005, 0.58), (0.031, 0.62), (0.044, 0.64), (0.031, 0.66), (0.005, 0.70), (-0.01, 0.725), (-0.055, 0.725), (-0.06, 0.66), (-0.068, 0.56)],
    [(-0.18, 0.555), (-0.143, 0.555), (-0.182, 0.58), (-0.185, 0.62), (-0.18, 0.66), (-0.198, 0.70), (-0.206, 0.725), (-0.24, 0.725), (-0.247, 0.68), (-0.255, 0.62), (-0.237, 0.60), (-0.214, 0.58)],
    [(-0.073, 0.508), (0.008, 0.512), (0.008, 0.576), (-0.073, 0.576)],
]
# 参照の胸の前縁に見える幅 0.006 の深緑の筋は奥側の胸パネルの端が覗いたもの。手前に胸パネルは見えないので作らない
# (左右対称に塗ると奥側の胸パネルが fx 0.11-0.17 に大きく見えて参照より濃色が増える)
# 境界を直線にするため、多角形の辺で胴・首・後脚の面を切ってから塗る (T4)
# 腰パネルは手前の後脚の腿にもかかる。奥の後脚は参照では地色なので塗らない (左右非対称だが、奥脚の腿は手前からしか見えない位置)
print("panel cuts:", kit.cut_along(body, PANELS), kit.cut_along(neck, PANELS[2:3]), kit.cut_along(legs["HL"], PANELS[1:2]))
print("panel faces:", paint_faces(body, PANELS, TEAL), "+ neck", paint_faces(neck, PANELS[2:3], TEAL), "+ hind leg L", paint_faces(legs["HL"], PANELS[1:2], TEAL))

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
