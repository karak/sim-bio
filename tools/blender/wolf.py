"""岩狼 (wolf) のローポリ 3D モデルを参照画像 assets/textures/concept/wolf-angular.png から組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/wolf.py -- assets/models
出力: <out_dir>/wolf.blend と <out_dir>/wolf.glb
検証: compare_ref.py で参照と同アングル (方位 135°、仰角 10°) で撮影しパーツ別に比較する。
  参照は左側面 (-X 側) が手前で頭が画面右。横長なので比較枠は 2 倍幅で出る

作り方 (共通部品は lowpoly_kit.py):
  - 前傾した忍び足のポーズ: 肩が最も高く、頭は低く前へ、尾は後ろ下へ。胴・首・頭・脚・尾は断面ロフト / チューブ
  - 濃色 (赤茶) は参照では陰の側 (顎の下、腹、脚の後ろ側、耳の内側) なので、法線の向きで面を塗り分ける
  - シアンの縁線は背の稜線・耳・胸の前縁に沿うリボン (発光)
寸法: 全高 (肩) ≈ 0.85 m、鼻先〜尾先 ≈ 1.8 m。単位 m、Z up、正面 -Y、原点は足元。
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

kit = Kit("wolf", out_dir, CREATURES["wolf"]["base_colors"], ["fur", "dark", "glow", "teal"], emission={"glow": 0.5})
FUR, DARK, GLOW, TEAL = range(4)
REF_AZ, REF_EL = 135.0, 10.0


def shade_faces(faces, pred, mat=DARK):
    """法線・位置の条件で面を塗る (参照の陰側を材質で表す)"""
    for f in faces:
        if pred(f):
            f.material_index = mat


# ---------- 胴 (尻 → 胸): 肩が最も高く尻へ下がる。胸は深い ----------
bm = bmesh.new()
body_sections = densify([
    (0.36, 0.42, 0.08, 0.10),
    (0.26, 0.45, 0.12, 0.14),
    (0.10, 0.50, 0.14, 0.20),
    (-0.10, 0.54, 0.15, 0.27),
    (-0.30, 0.55, 0.15, 0.29),  # 肩 (最高点 z≈0.84)、胸は深い (下端 z≈0.26)
    (-0.45, 0.52, 0.11, 0.24),
    (-0.53, 0.50, 0.07, 0.16),  # 胸の前面
], bulge=1.0)
faces = loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 12, math.pi / 12) for y, zc, rx, rz in body_sections])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < -0.3 or (f.normal.y < -0.3 and f.calc_center_median().z < 0.5))  # 腹の下面と胸の下部 (参照では陰)
body = kit.finish(bm, "body")

# ---------- 首: 肩の前上から頭の後ろへ、前下がりに ----------
bm = bmesh.new()
n0, n1 = Vector((0, -0.40, 0.66)), Vector((0, -0.54, 0.60))
axis = (n1 - n0).normalized()
uy = axis.cross(X).normalized()
faces = loft(bm, [ring(bm, n0 + (n1 - n0) * t, X, uy, rx, ry, 8, math.pi / 8) for t, rx, ry in [(0.0, 0.125, 0.21), (0.5, 0.12, 0.20), (1.0, 0.12, 0.19)]])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < 0.0)  # 喉〜胸の下面 (参照では首の下が大きな陰)
neck = kit.finish(bm, "neck")

# ---------- 頭: 後頭部から鼻先へ下がる楔。頬の平面が背高 ----------
HEAD_ANGLES = [45, 80, 100, 135, 225, 260, 280, 315]
bm = bmesh.new()
# 参照の頭は後ろが高い楔: 顎の線はほぼ水平 (z≈0.33)、頭頂の線が耳の付け根から鼻先へ下がる
head_sections = densify([
    (-0.52, 0.58, 0.12, 0.19),
    (-0.62, 0.56, 0.12, 0.18),
    (-0.72, 0.53, 0.11, 0.155),
    (-0.80, 0.49, 0.095, 0.115),
    (-0.88, 0.45, 0.075, 0.085),
    (-0.94, 0.42, 0.055, 0.06),  # 鼻先 (鈍い平らなキャップ)
], bulge=1.0)
faces = loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, angles=HEAD_ANGLES) for y, zc, rx, rz in head_sections])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < -0.2 or f.calc_center_median().y < -0.935)  # 顎の下面と鼻先
head = kit.finish(bm, "head")


# ---------- 耳: 頭頂の後ろから上へ立つ三角。内側は濃色 ----------
def make_ear(sgn):
    bm = bmesh.new()
    axis = Vector((sgn * 0.25, 0.3, 0.9)).normalized()
    ux = Y.cross(axis).normalized()
    uy = axis.cross(ux).normalized()
    base = Vector((sgn * 0.07, -0.68, 0.66))
    secs = [(0.0, 0.04, 0.02), (0.06, 0.055, 0.02), (0.12, 0.04, 0.012)]
    rings = [ring(bm, base + axis * t, ux, uy, w, th, angles=[0, 25, 90, 155, 180, 200, 340]) for t, w, th in secs]
    faces = loft(bm, rings + [bm.verts.new(base + axis * 0.17)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shade_faces(faces, lambda f: f.normal.dot(-uy) > 0.8 and (f.calc_center_median() - base).dot(axis) > 0.03)
    return kit.finish(bm, f"ear_{'R' if sgn > 0 else 'L'}")


make_ear(1)
make_ear(-1)


# ---------- 脚: 上 (胴の中) → 足。忍び足で前後にずれる。後ろ側の面は濃色 ----------
def make_leg(name, sx, y_top, y_foot, z_top=0.40):
    bm = bmesh.new()
    secs = [(z_top, y_top, 0.07, 0.11), (0.26, y_top * 0.5 + y_foot * 0.5, 0.055, 0.075), (0.12, y_foot, 0.05, 0.06), (0.04, y_foot - 0.03, 0.05, 0.085), (0.0, y_foot - 0.04, 0.052, 0.095)]
    faces = loft(bm, [ring(bm, Vector((sx, y, z)), X, Y, rx, ry, 8, math.pi / 8) for z, y, rx, ry in secs])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shade_faces(faces, lambda f: f.normal.y > 0.0 and f.calc_center_median().z > 0.05)  # 脚の後ろ半分 (参照では陰)
    return kit.finish(bm, name)


make_leg("foreleg_L", -0.09, -0.36, -0.42)
make_leg("foreleg_R", 0.09, -0.32, -0.55)
make_leg("hindleg_L", -0.10, 0.28, 0.55, z_top=0.45)
make_leg("hindleg_R", 0.10, 0.18, 0.18, z_top=0.45)

# ---------- 尾: 尻から後ろ下へ垂れる太い楔 ----------
bm = bmesh.new()
faces = tube(bm, [Vector((0, 0.36, 0.45)), Vector((0, 0.58, 0.34)), Vector((0, 0.82, 0.22)), Vector((0, 1.05, 0.12))], [0.075, 0.07, 0.05, 0.0], n=6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < -0.5)
tail = kit.finish(bm, "tail")

# ---------- デカール: 参照座標 (docs/design/qa/wolf-ref-components.json、単位 = 全高) ----------
kit.setup_ref_camera(REF_AZ, REF_EL)

if os.environ.get("WOLF_DEBUG"):
    for name, p in [("nose", (0, -0.94, 0.42)), ("shoulder_top", (0, -0.30, 0.83)), ("rump_top", (0, 0.36, 0.55)), ("tail_tip", (0, 1.05, 0.12)),
                    ("ear_tip_L", (-0.11, -0.64, 0.82)), ("belly", (0, -0.10, 0.33)), ("foot_FL", (-0.09, -0.45, 0)), ("foot_FR", (0.09, -0.58, 0)),
                    ("foot_HL", (-0.10, 0.52, 0)), ("foot_HR", (0.10, 0.15, 0))]:
        print(f"landmark {name}: fx,fy = {kit.frame_of(p)}")

for mirror in (False, True):
    tag = "L" if not mirror else "R"
    # 目: 細い切れ長 (参照 fx 0.71, fy 0.41)。濃色
    kit.decal_at(f"eye_{tag}", kit.at_ref(0.71, 0.41, objs=[head], mirror=mirror), almond(0.03, 0.008), DARK, tilt_deg=-15 if not mirror else 15, offset=0.003)
    # シアンの縁線: 背の稜線 (尾の付け根 → 肩 → 後頭部)、耳の前縁、胸の前縁、尾の上縁
    kit.ribbon(f"line_back_{tag}", [(-0.42, 0.37), (-0.30, 0.28), (-0.10, 0.10), (0.10, 0.02), (0.30, 0.0), (0.45, 0.06), (0.55, 0.15)], GLOW, width=0.014, offset=0.003, mirror=mirror, objs=[body, neck])
    kit.ribbon(f"line_tail_{tag}", [(-0.85, 0.70), (-0.70, 0.60), (-0.55, 0.48), (-0.44, 0.39)], GLOW, width=0.012, offset=0.003, mirror=mirror, objs=[tail, body])
    kit.ribbon(f"line_chest_{tag}", [(0.16, 0.28), (0.20, 0.36), (0.22, 0.46)], GLOW, width=0.01, offset=0.003, mirror=mirror, objs=[body, neck])
    kit.ribbon(f"line_ear_{tag}", [(0.60, 0.19), (0.66, 0.25)], GLOW, width=0.008, offset=0.003, mirror=mirror)

kit.finalize()
