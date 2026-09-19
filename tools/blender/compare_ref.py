"""3D モデルを参照画像と同じポーズ・アングルで撮影し、パーツ別の色と配置を参照画像と定量比較する。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
      assets/models/<creature>.blend assets/textures/concept/<creature>-angular.png <out_dir> [az] [el] [creature=<name>]

  az: カメラ方位 (度)。0 = 被写体の右真横 (+X)、正で正面側 (-Y) に回る。既定 45
  el: カメラ仰角 (度)。既定 10
  creature: rabbit / deer / wolf。省略時は blend または参照画像のファイル名の先頭から推定する

評価の考え方:
  モデル側はマテリアルを ID 色で描いた「ID パス」でパーツを正確に分割する。マテリアル名は <creature>_<part> (fur / dark / glow /
  teal / ear_inner) の規約で作る。参照側は色相と明度で同じクラスに分類する。パーツ構成と分類ルールは個体ごとに
  tools/blender/creature_parts.py に定義する (rabbit: fur / ear_inner / dark / glow、deer と wolf: fur / dark / glow)。
  両者をシルエットの bbox で正規化した同じ枠に置いて、パーツごとに比較する。

出力 (<out_dir>/):
  render_id.png      ID パス (fur=赤, ear_inner=緑, dark=青, glow=黄)
  ref_components.json 参照画像の模様の連結成分 (cyan_core / teal と、地色以外の各パーツ)。デカール配置の実測値に使う
  render_shaded.png  EEVEE の陰影付き撮影 (色比較に使う)
  compare.png        参照 | 陰影付き撮影 | 参照のクラス図 | モデルのクラス図 | 画素 ΔE ヒートマップ
  metrics.json       指標

metrics.json の主な項目:
  parts.<name>.fraction       シルエット内でそのパーツが占める割合 (ref / model / diff)
  parts.<name>.centroid       正規化枠での重心 (x, y ∈ [0,1]) と距離
  parts.<name>.mask_iou       正規化枠でのパーツマスク IoU (配置の一致度)
  parts.<name>.color.ref_mean_rgb / model_mean_rgb   参照とモデル撮影のそのパーツ平均 sRGB (0-255)
  parts.<name>.color.delta_e76                       その 2 色の CIE Lab ΔE76 (陰影込み同士の比較)
  parts.<name>.color.material_rgb / delta_e_material 参照平均色と、モデルのマテリアル設定色との ΔE76
  pixel_color.mean_delta_e / p90_delta_e             シルエット重なり領域の画素ごとの ΔE76 の平均と 90 パーセンタイル
  silhouette.iou / aspect                            参考値 (輪郭)
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creature_parts import CREATURES, creature_from_path  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
kw = dict(a.split("=", 1) for a in argv if "=" in a)
argv = [a for a in argv if "=" not in a]
if len(argv) < 3:
    raise SystemExit(__doc__)
blend, ref_path, out_dir = argv[0], argv[1], argv[2]
az = float(argv[3]) if len(argv) > 3 else 45.0
el = float(argv[4]) if len(argv) > 4 else 10.0
os.makedirs(out_dir, exist_ok=True)

CREATURE = kw.get("creature") or creature_from_path(blend, ref_path)
CFG = CREATURES[CREATURE]
PARTS = CFG["parts"]
ID_COLORS = CFG["id_colors"]
# クラス図の表示色
CLASS_VIS = CFG["class_vis"]
print(f"creature: {CREATURE}, parts: {PARTS}")


# ---------- 色空間 ----------
def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb):
    """sRGB (0-1, 表示値) → CIE Lab (D65)"""
    lin = srgb_to_linear(np.clip(rgb, 0, 1))
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T
    xyz = xyz / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def delta_e(rgb1, rgb2):
    return float(np.linalg.norm(rgb_to_lab(np.asarray(rgb1)) - rgb_to_lab(np.asarray(rgb2))))


def rgb_to_hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm, gm, bm = (mx == r) & nz, (mx == g) & nz & ~(mx == r), (mx == b) & nz & ~(mx == r) & ~(mx == g)
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h = h * 60
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def to255(rgb):
    return [int(round(float(c) * 255)) for c in rgb]


# ---------- 参照画像 ----------
ref_img = bpy.data.images.load(os.path.abspath(ref_path))
RW, RH = ref_img.size
ref = np.array(ref_img.pixels[:], dtype=np.float32).reshape(RH, RW, 4)[::-1]
ref_rgb = ref[..., :3]

# ---------- 撮影 ----------
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p[i] for p in pts) for i in range(3)))
hi = Vector((max(p[i] for p in pts) for i in range(3)))
center = (lo + hi) / 2
height = hi.z - lo.z

RES = 1024
scene.render.resolution_x = scene.render.resolution_y = RES
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"

cam_data = bpy.data.cameras.new("cmp_cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cmp_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
fov = 2 * math.atan(cam_data.sensor_width / 2 / cam_data.lens)
# 横長の個体は幅がフレームからはみ出すので、画面上の概算幅 (0.7·(dx+dy)) が全高を超えるときはそれを基準にする
fill_dim = max(height, 0.7 * ((hi.x - lo.x) + (hi.y - lo.y)))
dist = (fill_dim / 0.62) / 2 / math.tan(fov / 2)
a, e = math.radians(az), math.radians(el)
cam.location = center + Vector((math.cos(a) * math.cos(e) * dist, -math.sin(a) * math.cos(e) * dist, math.sin(e) * dist))
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(path):
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(scene.render.filepath)
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1]
    bpy.data.images.remove(img)
    return arr


# マテリアル名の末尾 → 評価クラス (個体別。rabbit ではティールの縁取り/パネル線を参照側の分類と同じく glow に含める)
MATERIAL_CLASS = CFG["material_class"]


def part_of_material(m):
    """マテリアル名からパーツ名を決める (例: rabbit_ear_inner → ear_inner)"""
    for suffix in sorted(MATERIAL_CLASS, key=len, reverse=True):
        if m.name.endswith(suffix):
            return MATERIAL_CLASS[suffix]
    return "fur"


# マテリアル設定色 (フラット色) を控えておく
material_rgb = {}
for m in bpy.data.materials:
    if m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
        lin = np.array(m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:3])
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
        material_rgb.setdefault(part_of_material(m), srgb)

# ID パス: Workbench フラットで、マテリアル表示色を ID 色にして描く
saved = {m.name: tuple(m.diffuse_color) for m in bpy.data.materials}
for m in bpy.data.materials:
    m.diffuse_color = (*ID_COLORS[part_of_material(m)], 1)
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "MATERIAL"
scene.display.render_aa = "OFF"
idpass = render(os.path.join(out_dir, "render_id.png"))
for m in bpy.data.materials:
    m.diffuse_color = saved[m.name]

# 陰影付き撮影: EEVEE + 太陽光 (参照画像は左上前方からの光)
scene.render.engine = "BLENDER_EEVEE"
world = bpy.data.worlds.new("cmp_world")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (1, 1, 1, 1)
bg.inputs[1].default_value = 0.5
scene.world = world
sun = bpy.data.objects.new("cmp_sun", bpy.data.lights.new("cmp_sun", "SUN"))
sun.data.energy = 2.5
sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-35))
scene.collection.objects.link(sun)
shaded = render(os.path.join(out_dir, "render_shaded.png"))


def rounded(o):
    """JSON 出力用に小数を 4 桁へ丸める (長い数字列は secrets スキャンに誤検知される)"""
    if isinstance(o, float):
        return round(o, 4)
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    if isinstance(o, list):
        return [rounded(v) for v in o]
    return o


# ---------- 分割 ----------
def bbox(mask):
    ys, xs = np.where(mask)
    return ys.min(), ys.max() + 1, xs.min(), xs.max() + 1


def ref_classes(rgb):
    """参照画像を silhouette と個体別クラスに分ける (分類ルールは creature_parts.py)"""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bgc = np.median(border, axis=0)
    dist = np.linalg.norm(rgb - bgc, axis=-1)
    h, s, v = rgb_to_hsv(rgb)
    sil = (dist > 0.12) & ((s > 0.10) | (v < 0.35))  # 影 (無彩色の灰) は除外、暗い茶は含める
    y0, y1, x0, x1 = bbox(sil)
    yy = np.broadcast_to((np.arange(rgb.shape[0])[:, None] - y0) / max(y1 - y0, 1), sil.shape)
    classes = CFG["classify"](h, s, v, sil, yy)
    assert set(classes) == set(PARTS), (set(classes), set(PARTS))
    return sil, classes


def model_classes(idp):
    sil = idp[..., 3] > 0.5
    rgb = idp[..., :3]
    out = {}
    for p, c in ID_COLORS.items():
        out[p] = sil & (np.linalg.norm(rgb - np.array(c), axis=-1) < 0.3)
    return sil, out


def norm_frame(mask, box, size, wide=False):
    """bbox で切り出して size×(2*size) の枠に正規化する (枠の単位 1 = 全高、中央揃え・上寄せ)。
    幅が高さの 2 倍を超える個体だけ幅基準に落とす (wide は表示の切り出し判定にも使う)"""
    y0, y1, x0, x1 = box
    crop = mask[y0:y1, x0:x1]
    h, w = crop.shape[:2]
    scale = min(size / h, (2 * size) / w)
    nh, nw = max(1, min(size, int(round(h * scale)))), max(1, min(2 * size, int(round(w * scale))))
    ys = np.clip((np.arange(nh) / scale).astype(int), 0, h - 1)
    xs = np.clip((np.arange(nw) / scale).astype(int), 0, w - 1)
    res = crop[ys][:, xs]
    canvas = np.zeros((size, size * 2) + crop.shape[2:], dtype=crop.dtype)
    ox = size - nw // 2
    canvas[:nh, ox:ox + nw] = res[:, : size * 2 - ox]
    return canvas


S = 384
r_sil, r_cls = ref_classes(ref_rgb)
m_sil, m_cls = model_classes(idpass)
rbox, mbox = bbox(r_sil), bbox(m_sil)
r_asp = (rbox[3] - rbox[2]) / (rbox[1] - rbox[0])
m_asp = (mbox[3] - mbox[2]) / (mbox[1] - mbox[0])
WIDE = r_asp > 1.0  # 参照が横長ならクラス図・ヒートマップを 2 倍幅で出す (中央 S×S に切り出さない)
print(f"frame: unit = height, {'wide layout' if WIDE else 'tall layout'}, ref aspect {r_asp:.2f}, model aspect {m_asp:.2f}")

rN = {p: norm_frame(r_cls[p], rbox, S, WIDE) for p in PARTS}
mN = {p: norm_frame(m_cls[p], mbox, S, WIDE) for p in PARTS}
r_silN, m_silN = norm_frame(r_sil, rbox, S, WIDE), norm_frame(m_sil, mbox, S, WIDE)
r_rgbN = norm_frame(ref_rgb, rbox, S, WIDE)
m_rgbN = norm_frame(shaded[..., :3], mbox, S, WIDE)


def centroid(maskN):
    ys, xs = np.where(maskN)
    if len(ys) == 0:
        return None
    return [float(xs.mean() / (2 * S)), float(ys.mean() / S)]


parts = {}
for p in PARTS:
    rm, mm = r_cls[p], m_cls[p]
    rf, mf = float(rm.sum() / r_sil.sum()), float(mm.sum() / m_sil.sum())
    rc, mc = centroid(rN[p]), centroid(mN[p])
    union = (rN[p] | mN[p]).sum()
    iou = float((rN[p] & mN[p]).sum() / union) if union else 0.0
    r_mean = ref_rgb[rm].mean(0) if rm.any() else np.zeros(3)
    m_mean = shaded[..., :3][mm].mean(0) if mm.any() else np.zeros(3)
    entry = {
        "fraction": {"ref": rf, "model": mf, "diff": mf - rf},
        "centroid": {"ref": rc, "model": mc, "dist": (float(np.linalg.norm(np.subtract(rc, mc))) if rc and mc else None)},
        "mask_iou": iou,
        "color": {
            "ref_mean_rgb": to255(r_mean),
            "model_mean_rgb": to255(m_mean),
            "delta_e76": delta_e(r_mean, m_mean),
        },
    }
    if p in material_rgb:
        entry["color"]["material_rgb"] = to255(material_rgb[p])
        entry["color"]["delta_e_material"] = delta_e(r_mean, material_rgb[p])
    parts[p] = entry

# 画素ごとの色差 (正規化枠でシルエットが重なる画素)
overlap = r_silN & m_silN
dE = np.linalg.norm(rgb_to_lab(r_rgbN) - rgb_to_lab(m_rgbN), axis=-1)
dE_ov = dE[overlap]
pixel_color = {
    "overlap_pixels": int(overlap.sum()),
    "mean_delta_e": float(dE_ov.mean()),
    "median_delta_e": float(np.median(dE_ov)),
    "p90_delta_e": float(np.percentile(dE_ov, 90)),
    "fraction_delta_e_over_20": float((dE_ov > 20).mean()),
}

metrics = {
    "camera": {"azimuth_deg": az, "elevation_deg": el, "distance_m": dist},
    "faces": int(sum(len(o.data.polygons) for o in meshes)),
    "tris": int(sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in meshes)),
    "parts": parts,
    "pixel_color": pixel_color,
    "silhouette": {"iou": float((r_silN & m_silN).sum() / (r_silN | m_silN).sum()), "aspect": {"ref": r_asp, "model": m_asp}},
}
with open(os.path.join(out_dir, "metrics.json"), "w") as f:
    json.dump(rounded(metrics), f, indent=2, ensure_ascii=False)


# ---------- 参照画像の模様を塊ごとに抽出 (モデル側でデカール位置を決めるのに使う) ----------
def components(mask):
    """連結成分ごとに (fx, fy, area, r_equiv) を返す。座標は bbox 正規化枠: fx = (x - S)/S (中心 0), fy = y/S (上 0)"""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    ys, xs = np.where(mask)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        stack = [(sy, sx)]
        seen[sy, sx] = True
        px = []
        while stack:
            y, x = stack.pop()
            px.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        arr = np.array(px)
        area = len(px) / (S * S)
        out.append({
            "fx": float((arr[:, 1].mean() - S) / S),
            "fy": float(arr[:, 0].mean() / S),
            "area": area,
            "r_equiv": float(math.sqrt(area / 2.598)),  # 六角形とみなした外接半径 (高さ 1 の枠に対する比)
            "bbox": [float((arr[:, 1].min() - S) / S), float(arr[:, 0].min() / S), float((arr[:, 1].max() - S) / S), float(arr[:, 0].max() / S)],
        })
    return sorted(out, key=lambda c: -c["area"])


h_, s_, v_ = rgb_to_hsv(r_rgbN)
core = r_silN & (h_ > 140) & (h_ < 215) & (s_ > 0.3) & (v_ > 0.75)  # 明るいシアン (六角の面・目)
teal = r_silN & (h_ > 140) & (h_ < 215) & (s_ > 0.2) & (v_ > 0.35) & (v_ <= 0.75)  # 縁取り・パネル線
ref_components = {
    "frame": "fx = (x - center)/height, fy = y_from_top/height; height = silhouette bbox height",
    "cyan_core": [c for c in components(core) if c["area"] > 2e-5],
    "teal": [c for c in components(teal) if c["area"] > 2e-5][:12],
}
for p in PARTS[1:]:  # 地色以外の各パーツの塊 (rabbit: ear_inner / dark / glow、deer・wolf: dark / glow)
    ref_components[p] = components(rN[p])[:6]
with open(os.path.join(out_dir, "ref_components.json"), "w") as f:
    json.dump(rounded(ref_components), f, indent=2)

# ---------- 比較画像 ----------
def resize_rgba(arr, size):
    h, w = arr.shape[:2]
    ys = np.clip((np.arange(size) * h / size).astype(int), 0, h - 1)
    xs = np.clip((np.arange(size) * w / size).astype(int), 0, w - 1)
    return arr[ys][:, xs]


def class_map(cls):
    img = np.ones((S, 2 * S, 4), dtype=np.float32)
    for p in PARTS:
        img[cls[p], :3] = CLASS_VIS[p]
    return img if WIDE else img[:, S // 2: S // 2 + S]  # 縦長なら中央 S×S を切り出す (横長は 2S 幅のまま)


tile_ref = resize_rgba(ref, S)
sh = resize_rgba(shaded, S)
al = sh[..., 3:4]
tile_shaded = sh * al + (1 - al) * np.array([1, 1, 1, 1], dtype=np.float32)
tile_rcls = class_map(rN)
tile_mcls = class_map(mN)
heat = np.ones((S, 2 * S, 4), dtype=np.float32)
t = np.clip(dE / 50.0, 0, 1)
heat[..., 1] = 1 - t
heat[..., 2] = 1 - t
heat[~overlap] = (0.92, 0.92, 0.92, 1)
tile_heat = heat if WIDE else heat[:, S // 2: S // 2 + S]
comp = np.concatenate([tile_ref, tile_shaded, tile_rcls, tile_mcls, tile_heat], axis=1)
out_img = bpy.data.images.new("compare", comp.shape[1], comp.shape[0], alpha=True)
out_img.pixels = comp[::-1].astype(np.float32).ravel().tolist()
out_img.filepath_raw = os.path.abspath(os.path.join(out_dir, "compare.png"))
out_img.file_format = "PNG"
out_img.save()

print(json.dumps(metrics, indent=2))
