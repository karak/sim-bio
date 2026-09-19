"""3D モデルを参照画像と同じポーズ・アングルで撮影し、参照画像と定量比較する。

使い方:
  ~/.claude/skills/blender/scripts/run_blender.sh tools/blender/compare_ref.py -- \
      assets/models/rabbit.blend assets/textures/concept/rabbit-angular.png <out_dir> [az] [el]

  az: カメラ方位 (度)。0 = 被写体の右真横 (+X)、正で正面側 (-Y) に回る。既定 30
  el: カメラ仰角 (度)。既定 15
  (参照画像は「被写体が画面左を向き、やや正面寄りの斜めから、少し上から」の構図)

出力 (<out_dir>/):
  render_flat.png   Workbench フラット (マテリアル色そのまま) の撮影。指標計算に使う
  render_shaded.png EEVEE の陰影付き撮影。目視比較用
  compare.png       参照 | 陰影付き撮影 | シルエット重ね (緑=一致, 赤=参照のみ, 青=モデルのみ)
  metrics.json      指標

指標:
  silhouette_iou    バウンディングボックス正規化後のシルエット IoU (1 が完全一致)
  aspect_ratio      シルエット bbox の 幅/高さ。ref と model を並記し差を出す
  color_fraction    シルエット内のピクセル分類割合 (fur / dark / glow)。ref と model
  fur_mean_rgb      fur と分類したピクセルの平均色 (sRGB 0-1) と、その距離
  row_profile_corr  高さ方向の幅プロファイル (各行のシルエット幅) の相関係数。等身・体型の一致度
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 3:
    raise SystemExit(__doc__)
blend, ref_path, out_dir = argv[0], argv[1], argv[2]
az = float(argv[3]) if len(argv) > 3 else 30.0
el = float(argv[4]) if len(argv) > 4 else 15.0
os.makedirs(out_dir, exist_ok=True)

# ---------- 参照画像 ----------
ref_img = bpy.data.images.load(os.path.abspath(ref_path))
RW, RH = ref_img.size
ref = np.array(ref_img.pixels[:], dtype=np.float32).reshape(RH, RW, 4)[::-1]  # 上が先頭になるよう反転
ref_rgb = ref[..., :3]  # sRGB 表示値 (PNG は sRGB なので pixels は sRGB のまま)

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
# 参照画像は被写体が高さの ~62% を占める。50mm/36mm センサーの縦画角から距離を決める
fov = 2 * math.atan(cam_data.sensor_width / 2 / cam_data.lens)
dist = (height / 0.62) / 2 / math.tan(fov / 2)
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


# フラット撮影: マテリアル色そのまま。Workbench はノードでなく viewport 表示色を使うので Base Color を写す
for m in bpy.data.materials:
    if m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
        m.diffuse_color = m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "MATERIAL"
flat = render(os.path.join(out_dir, "render_flat.png"))

# 陰影付き撮影: EEVEE + 太陽光
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


# ---------- シルエット抽出 ----------
def ref_mask(rgb):
    """参照画像: 外周の色を背景とし、背景から離れて彩度のある画素を被写体にする (影は無彩色なので除外)"""
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bgc = np.median(border, axis=0)
    dist = np.linalg.norm(rgb - bgc, axis=-1)
    sat = rgb.max(-1) - rgb.min(-1)
    return (dist > 0.12) & (sat > 0.12)


def model_mask(rgba):
    return rgba[..., 3] > 0.5


def bbox(mask):
    ys, xs = np.where(mask)
    return ys.min(), ys.max() + 1, xs.min(), xs.max() + 1


def normalize(mask, size=256):
    """bbox で切り出し、高さを size に揃えて (幅は比率維持) 中央に置く"""
    y0, y1, x0, x1 = bbox(mask)
    crop = mask[y0:y1, x0:x1]
    h, w = crop.shape
    scale = size / h
    nw = max(1, int(round(w * scale)))
    ys = np.clip((np.arange(size) / scale).astype(int), 0, h - 1)
    xs = np.clip((np.arange(nw) / scale).astype(int), 0, w - 1)
    res = crop[ys][:, xs]
    canvas = np.zeros((size, size * 2), dtype=bool)
    ox = size - nw // 2
    canvas[:, ox:ox + nw] = res[:, : size * 2 - ox]
    return canvas, w / h


def classify(rgb, mask):
    """シルエット内の画素を fur / dark / glow に分類 (sRGB 表示値で判定)"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    glow = mask & (b - r > 0.25) & (g > 0.5)
    dark = mask & ~glow & (rgb.max(-1) < 0.45)
    fur = mask & ~glow & ~dark
    n = mask.sum()
    return {
        "fraction": {"fur": float(fur.sum() / n), "dark": float(dark.sum() / n), "glow": float(glow.sum() / n)},
        "fur_mean_rgb": [float(v) for v in rgb[fur].mean(0)],
    }


def row_profile(canvas):
    return canvas.sum(1).astype(np.float64)


rm = ref_mask(ref_rgb)
mm = model_mask(flat)
rn, r_aspect = normalize(rm)
mn, m_aspect = normalize(mm)
iou = float((rn & mn).sum() / (rn | mn).sum())
rp, mp = row_profile(rn), row_profile(mn)
corr = float(np.corrcoef(rp, mp)[0, 1])

# Workbench flat 撮影の色は Standard 変換で sRGB として保存されているのでそのまま比較
rc = classify(ref_rgb, rm)
mc = classify(flat[..., :3], mm)
fur_dist = float(np.linalg.norm(np.array(rc["fur_mean_rgb"]) - np.array(mc["fur_mean_rgb"])))

metrics = {
    "camera": {"azimuth_deg": az, "elevation_deg": el, "distance_m": dist},
    "silhouette_iou": iou,
    "row_profile_corr": corr,
    "aspect_ratio": {"ref": r_aspect, "model": m_aspect, "diff": m_aspect - r_aspect},
    "color_fraction": {"ref": rc["fraction"], "model": mc["fraction"]},
    "fur_mean_rgb": {"ref": rc["fur_mean_rgb"], "model": mc["fur_mean_rgb"], "dist": fur_dist},
    "faces": int(sum(len(o.data.polygons) for o in meshes)),
    "tris": int(sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)),
}
with open(os.path.join(out_dir, "metrics.json"), "w") as f:
    json.dump(metrics, f, indent=2, ensure_ascii=False)

# ---------- 比較画像: 参照 | 陰影付き | シルエット重ね ----------
S = 512


def resize_rgba(arr, size):
    h, w = arr.shape[:2]
    ys = np.clip((np.arange(size) * h / size).astype(int), 0, h - 1)
    xs = np.clip((np.arange(size) * w / size).astype(int), 0, w - 1)
    return arr[ys][:, xs]


ref_small = resize_rgba(ref, S)
shaded_small = resize_rgba(shaded, S)
# 透明部分を白に
alpha = shaded_small[..., 3:4]
shaded_small = shaded_small * alpha + (1 - alpha) * np.array([1, 1, 1, 1], dtype=np.float32)
ov = np.ones((S, S, 4), dtype=np.float32)
rn_s = resize_rgba(rn[:, :, None].astype(np.float32), S)[..., 0] > 0.5
mn_s = resize_rgba(mn[:, :, None].astype(np.float32), S)[..., 0] > 0.5
ov[rn_s & mn_s, :3] = (0.3, 0.8, 0.3)
ov[rn_s & ~mn_s, :3] = (0.9, 0.3, 0.3)
ov[~rn_s & mn_s, :3] = (0.3, 0.4, 0.9)
comp = np.concatenate([ref_small, shaded_small, ov], axis=1)
out_img = bpy.data.images.new("compare", comp.shape[1], comp.shape[0], alpha=True)
out_img.pixels = comp[::-1].astype(np.float32).ravel().tolist()
out_img.filepath_raw = os.path.abspath(os.path.join(out_dir, "compare.png"))
out_img.file_format = "PNG"
out_img.save()

print(json.dumps(metrics, indent=2))
