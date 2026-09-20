"""岩狼 (wolf) のローポリ 3D モデルを参照画像 assets/textures/concept/wolf-angular.png から組む。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/wolf.py -- assets/models
出力: <out_dir>/wolf.blend と <out_dir>/wolf.glb
検証: compare_ref.py で参照と同アングル (方位 135°、仰角 10°、平行投影 proj=ortho) で撮影しパーツ別に比較する。
  参照は左側面 (-X 側) が手前で頭が画面右。横長なので比較枠は 2 倍幅で出る。
  参照は 4 本の足を同じ地面線に描いているので、透視 (50 mm) だと奥の脚が 0.2 H 高く写り輪郭の一致に下限が付く。
  そのため wolf は平行投影で評価し、デカールの投影 (setup_ref_camera) も同じ平行投影で行う

作り方 (共通部品は lowpoly_kit.py):
  - 前傾した忍び足のポーズ: 肩が最も高く、頭は低く前へ、尾は後ろ下へ。胴・首・頭・脚・尾は断面ロフト / チューブ
  - 濃色 (赤茶) は参照では陰の側 (顎の下、腹、脚の後ろ側、耳の内側) なので、法線の向きで面を塗り分ける
  - シアンの縁線: 参照では輪郭の外側に沿う細い光なので、尾の上縁〜背の稜線〜首は輪郭から突き出す薄い鰭 (Kit.fin) で、
    胸の前縁・耳の前縁は面上のリボン (Kit.ribbon) で表す (発光)
寸法: 全高 (肩) ≈ 0.85 m、鼻先〜尾先 ≈ 2.05 m (参照は頭+首が胴と同じくらい長く、尾は短い)。単位 m、Z up、正面 -Y、原点は足元。
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
REF_AZ, REF_EL, REF_ORTHO = 135.0, 10.0, True


def shade_faces(faces, pred, mat=DARK):
    """法線・位置の条件で面を塗る (参照の陰側を材質で表す)"""
    for f in faces:
        if pred(f):
            f.material_index = mat


# ---------- 胴 (尻 → 胸): 肩が最も高く尻へ下がる。胸は深い ----------
bm = bmesh.new()
body_sections = densify([
    (0.36, 0.32, 0.09, 0.11),  # 尻 (上端 z≈0.43)、後端は丸く落とす
    (0.42, 0.29, 0.06, 0.07),
    (0.26, 0.365, 0.13, 0.15),
    (0.10, 0.39, 0.15, 0.22),
    (-0.10, 0.44, 0.15, 0.30),  # 肩のすぐ後ろで背が急に下がり、腹は深い (下端 z≈0.14)
    (-0.30, 0.53, 0.15, 0.31),  # 肩 (最高点 z≈0.84)、胸は深い (下端 z≈0.22)
    (-0.45, 0.50, 0.11, 0.26),
    (-0.53, 0.48, 0.07, 0.17),  # 胸の前面
], bulge=1.0)
faces = loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, 12, math.pi / 12) for y, zc, rx, rz in body_sections])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < -0.3 or (f.normal.y < -0.3 and f.calc_center_median().z < 0.5))  # 腹の下面と胸の下部 (参照では陰)
body = kit.finish(bm, "body")

# ---------- 首: 肩から頭の後ろまで前へ長く伸びる太い楔。参照では首の下面が顎の線と同じ高さ (z≈0.38) で平ら ----------
bm = bmesh.new()
n0, n1 = Vector((0, -0.40, 0.60)), Vector((0, -0.72, 0.61))
axis = (n1 - n0).normalized()
uy = axis.cross(X).normalized()
faces = loft(bm, [ring(bm, n0 + (n1 - n0) * t, X, uy, rx, ry, 8, math.pi / 8) for t, rx, ry in [(0.0, 0.13, 0.25), (0.5, 0.13, 0.235), (1.0, 0.125, 0.215)]])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < 0.0)  # 喉〜胸の下面 (参照では首の下が大きな陰)
neck = kit.finish(bm, "neck")

# ---------- 頭: 後頭部から鼻先へ下がる楔。頬の平面が背高 ----------
HEAD_ANGLES = [45, 80, 100, 135, 225, 260, 280, 315]
bm = bmesh.new()
# 参照の頭は大きなブロック (長さ ≈ 0.5 m、参照では胴とほぼ同じ長さ): 顎の線はほぼ水平 (z≈0.38)、
# 頭頂は後頭部 (z≈0.77) から耳の付け根・眉 (y≈-1.0, z≈0.64) まで長い額がゆるく下がり、眉から鼻先 (z≈0.5) へ急に落ちる
head_sections = densify([
    (-0.72, 0.61, 0.125, 0.215),  # 後頭部 (上端 z≈0.82、肩とほぼ同じ高さ)
    (-0.85, 0.60, 0.125, 0.21),
    (-0.96, 0.585, 0.12, 0.18),  # 額
    (-1.04, 0.54, 0.115, 0.14),  # 眉・耳の付け根
    (-1.10, 0.47, 0.09, 0.075),  # 鼻梁の付け根 (ストップ)
    (-1.16, 0.465, 0.07, 0.055),
    (-1.22, 0.465, 0.05, 0.035),  # 鼻先 (鈍い平らなキャップ)
], bulge=1.0)
faces = loft(bm, [ring(bm, Vector((0, y, zc)), X, Z, rx, rz, angles=HEAD_ANGLES) for y, zc, rx, rz in head_sections])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < -0.2 or f.calc_center_median().y < -1.215)  # 顎の下面と鼻先
head = kit.finish(bm, "head")


# ---------- 耳: 頭頂の後ろから上へ立つ三角。内側は濃色 ----------
def make_ear(sgn):
    bm = bmesh.new()
    axis = Vector((sgn * 0.22, 0.22, 0.9)).normalized()  # 少し外へ開く (参照では手前と奥の耳の先が 0.15 H 離れて見える)
    ux = Y.cross(axis).normalized()
    uy = axis.cross(ux).normalized()
    base = Vector((sgn * 0.085, -0.99, 0.65))  # 額の上、眉のすぐ後ろ
    secs = [(0.0, 0.045, 0.02), (0.07, 0.06, 0.02), (0.14, 0.045, 0.012)]
    rings = [ring(bm, base + axis * t, ux, uy, w, th, angles=[0, 25, 90, 155, 180, 200, 340]) for t, w, th in secs]
    faces = loft(bm, rings + [bm.verts.new(base + axis * 0.22)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shade_faces(faces, lambda f: f.normal.dot(-uy) > 0.8 and (f.calc_center_median() - base).dot(axis) > 0.03)
    return kit.finish(bm, f"ear_{'R' if sgn > 0 else 'L'}")


ear_R = make_ear(1)
ear_L = make_ear(-1)


# ---------- 脚: 上 (胴の中) → 足。忍び足で前後にずれる。後ろ側の面は濃色 ----------
def make_leg(name, sx, y_top, y_foot, z_top=0.40):
    """上端 (胴の中、腿) → 足先。参照の脚は太くまっすぐ (幅 ≈ 0.12 H) なので途中で細らせない"""
    bm = bmesh.new()
    secs = [(z_top, y_top, 0.07, 0.11), (0.26, y_top * 0.5 + y_foot * 0.5, 0.06, 0.09), (0.12, y_foot, 0.055, 0.08), (0.04, y_foot - 0.03, 0.055, 0.095), (0.0, y_foot - 0.04, 0.057, 0.10)]
    faces = loft(bm, [ring(bm, Vector((sx, y, z)), X, Y, rx, ry, 8, math.pi / 8) for z, y, rx, ry in secs])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shade_faces(faces, lambda f: f.normal.y > 0.0 and f.calc_center_median().z > 0.05)  # 脚の後ろ半分 (参照では陰)
    return kit.finish(bm, name)


make_leg("foreleg_L", -0.09, -0.36, -0.42)
make_leg("foreleg_R", 0.09, -0.24, -0.49)  # 奥の前脚は胸の下から前へ斜めに出る (参照 fx 0.25 → 足 0.35)
make_leg("hindleg_L", -0.10, 0.30, 0.34, z_top=0.34)  # 手前の後脚はほぼ垂直に下りる (足 fx≈-0.5)。腿の上端は尻の後ろに少し出る (参照 fy≈0.46)
make_leg("hindleg_R", 0.10, 0.36, 0.22, z_top=0.34)  # 奥の後脚は前へ折れて出る (参照 fx -0.36 → 足 -0.25)

# ---------- 尾: 尻から後ろ下へ垂れる太い楔 ----------
bm = bmesh.new()
faces = tube(bm, [Vector((0, 0.38, 0.25)), Vector((0, 0.52, 0.16)), Vector((0, 0.70, 0.09)), Vector((0, 0.87, 0.05))], [0.09, 0.10, 0.085, 0.0], n=6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
shade_faces(faces, lambda f: f.normal.z < -0.5)
tail = kit.finish(bm, "tail")

# ---------- デカール: 参照座標 (docs/design/qa/wolf-ref-components.json、単位 = 全高) ----------
kit.setup_ref_camera(REF_AZ, REF_EL, ortho=REF_ORTHO)

if os.environ.get("WOLF_DEBUG"):
    for name, p in [("nose_top", (0, -1.22, 0.50)), ("nose_bottom", (0, -1.22, 0.41)), ("brow", (0, -1.04, 0.68)), ("jaw_back", (0, -0.75, 0.385)),
                    ("occiput", (0, -0.72, 0.82)), ("neck_bottom", (0, -0.45, 0.34)), ("shoulder_top", (0, -0.30, 0.84)), ("back_mid", (0, 0.10, 0.60)),
                    ("rump_top", (0, 0.36, 0.43)), ("rump_bottom", (0, 0.36, 0.21)), ("tail_tip", (0, 0.87, 0.05)), ("tail_mid_top", (0, 0.70, 0.185)), ("tail_mid_bottom", (0, 0.70, 0.015)),
                    ("ear_tip_L", (-0.13, -0.95, 0.80)), ("ear_tip_R", (0.13, -0.95, 0.80)), ("belly", (0, -0.10, 0.14)),
                    ("foot_FL", (-0.09, -0.45, 0)), ("foot_FR", (0.09, -0.52, 0)), ("foot_HL", (-0.10, 0.31, 0)), ("foot_HR", (0.10, 0.22, 0))]:
        print(f"landmark {name}: fx,fy = {kit.frame_of(p)}")

for mirror in (False, True):
    tag = "L" if not mirror else "R"
    # 目: 細い切れ長 (参照 fx 0.71, fy 0.41)。濃色
    kit.decal_at(f"eye_{tag}", kit.at_ref(0.71, 0.41, objs=[head], mirror=mirror), almond(0.03, 0.008), DARK, tilt_deg=-15 if not mirror else 15, offset=0.003)
    # シアンの線 (面上のリボン): 胸の前縁 (肩の前から胸の下へ)、首の上の 2 本目の線、奥の耳の前縁から額
    kit.ribbon(f"line_chest_{tag}", [(0.21, 0.30), (0.19, 0.40), (0.14, 0.45), (0.10, 0.49)], GLOW, width=0.014, offset=0.003, mirror=mirror, objs=[body, neck])
    kit.ribbon(f"line_neck_{tag}", [(0.12, 0.065), (0.25, 0.07), (0.30, 0.09), (0.35, 0.115), (0.40, 0.14), (0.45, 0.16)], GLOW, width=0.014, offset=0.003, mirror=mirror, objs=[body, neck])
    kit.ribbon(f"line_ear_{tag}", [(0.69, 0.26), (0.715, 0.17)], GLOW, width=0.01, offset=0.003, mirror=mirror, objs=[ear_R if not mirror else ear_L, head])  # 奥の耳の前縁 (参照 glow 成分 0.60-0.68, 0.19-0.26)

# 尾の上縁 → 背の稜線 → 首の上: 参照の光の線は輪郭のすぐ内側 (幅 ≈ 0.013 H) を走る。表面のリボンだと横から潰れて見えないので、
# 帯の内側の縁 (参照クラス図の glow 画素の下端を 0.05 刻みで読んだ値) を折れ線にし、画面上で線と直交する向きへ 0.013 m 立てた鰭で表す
# (screen=True: 鰭の上端がちょうど輪郭に来る)。正中線上なので左右で 1 枚
kit.fin("crest", [(-0.82, 0.665), (-0.80, 0.648), (-0.75, 0.609), (-0.70, 0.583), (-0.65, 0.557), (-0.60, 0.51), (-0.55, 0.466), (-0.50, 0.422),
                  (-0.45, 0.393), (-0.40, 0.315), (-0.35, 0.289), (-0.30, 0.26), (-0.25, 0.234), (-0.20, 0.216), (-0.15, 0.174), (-0.10, 0.141),
                  (-0.05, 0.107), (0.0, 0.073), (0.05, 0.039), (0.10, 0.021), (0.20, 0.035), (0.30, 0.047),
                  (0.40, 0.078), (0.45, 0.10), (0.50, 0.13)], GLOW, height=0.013, thickness=0.005, objs=[tail, body, neck], screen=True)  # 首の上は参照の房の凹凸を平均した滑らかな線にする

kit.finalize()
