"""observe_creature_render.py の撮影結果を基準画と並べた比較画にする (Blender ではなく python3 + Pillow で動かす)。
observe_deer_sheet.py を種ごとの設定で一般化したもの。

使い方: python3 tools/blender/observe_creature_sheet.py <species> <raw_dir> docs/design/qa/observe
出力 (<species> = rabbit の例):
  rabbit-compare.png    上段 基準画 (creatures/rabbit.png の各体)、下段 モデル (同じ向き)
  rabbit-view-<名前>.png  モデル単体 (512²)
  rabbit-lod.png        近 LOD / 群れ LOD (+ 種ごとの追加の絵)
  rabbit-anim.png       アクションの見せ場のフレーム
  rabbit-seq-<アクション>.png  側面の連続
"""
import os
import sys

from PIL import Image, ImageDraw

species, raw, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = Image.open(os.path.join(ROOT, f"assets/textures/board/creatures/{species}.png")).convert("RGB")
BG = (222, 219, 213)

# views: 比較画に並べる向き。ref: 基準画の中の各体の枠 (x0, y0, x1, y1)。lod: 群れ LOD の並び (撮影名 or ("ref", 枠名))
SPECIES = {
    "deer": dict(
        views=["side", "front", "q34", "rear34"],
        ref={"side": (130, 0, 410, 400), "front": (470, 0, 680, 400), "q34": (760, 0, 1000, 400), "rear34": (1040, 0, 1270, 400),
             "doe": (190, 430, 430, 740), "fawn": (560, 490, 740, 740)},
        lod=[("view-side", "hero (LOD0)"), ("lod1-side", "crowd (LOD1)"), (("ref", "doe"), "ref doe"), ("doe-q34", "model doe")],
        anim=["idle", "walk", "run", "graze", "fall"]),
    "rabbit": dict(
        views=["side", "front", "q34", "alert", "graze"],
        ref={"side": (50, 25, 410, 450), "front": (470, 25, 650, 450), "q34": (740, 25, 1000, 450), "alert": (1040, 110, 1310, 710),
             "graze": (130, 440, 600, 740)},
        lod=[("view-side", "hero (LOD0)"), ("lod1-side", "crowd (LOD1)"), ("view-q34", "hero q34"), ("lod1-q34", "crowd q34"),
             ("rear34", "hero rear34")],
        anim=["idle", "hop", "run", "graze", "alert", "fall"]),
}
CFG = SPECIES[species]


def fit(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def crop_to_content(im, pad=0.06):
    """撮影画の背景 (紙色) を切り詰め、体の周りに少し余白を残す (基準画の枠と縮尺を揃えるため)"""
    px = im.load()
    bg = px[2, 2]
    w, h = im.size
    xs, ys = [], []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            p = px[x, y]
            if sum(abs(p[i] - bg[i]) for i in range(3)) > 40:
                xs.append(x)
                ys.append(y)
    if not xs:
        return im
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    m = int(max(x1 - x0, y1 - y0) * pad)
    return im.crop((max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)))


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 8 + 7 * len(text), 16), fill=(255, 255, 255))
    d.text((4, 2), text, fill=(40, 40, 40))
    return im


def row(cells, h, gap=8):
    cells = [fit(c, h) for c in cells]
    w = sum(c.width for c in cells) + gap * (len(cells) - 1)
    sheet = Image.new("RGB", (w, h), BG)
    x = 0
    for c in cells:
        sheet.paste(c, (x, 0))
        x += c.width + gap
    return sheet


def stack(rows, gap=8):
    w = max(r.width for r in rows)
    sheet = Image.new("RGB", (w, sum(r.height for r in rows) + gap * (len(rows) - 1)), BG)
    y = 0
    for r in rows:
        sheet.paste(r, ((w - r.width) // 2, y))
        y += r.height + gap
    return sheet


def rimg(name):
    return Image.open(os.path.join(raw, name)).convert("RGB")


def cell(src):
    if isinstance(src, tuple):
        return REF.crop(CFG["ref"][src[1]])
    return rimg(f"{src}.png")


views = CFG["views"]
tight = species != "deer"  # 鹿の比較画は observe_deer_sheet.py と同じ (切り詰めない)
refs = [label(REF.crop(CFG["ref"][v]), f"ref {v}") for v in views]
mods = [label(crop_to_content(rimg(f"view-{v}.png")) if tight else rimg(f"view-{v}.png"), f"model {v}") for v in views]
H = 420
stack([row(refs, H), row(mods, H)]).save(os.path.join(out, f"{species}-compare.png"))
for v in views:
    rimg(f"view-{v}.png").resize((512, 512), Image.LANCZOS).save(os.path.join(out, f"{species}-view-{v}.png"))

# 撮っていない絵 (observe_creature_render.py を views だけで回したときなど) は飛ばす
if all(isinstance(src, tuple) or os.path.exists(os.path.join(raw, f"{src}.png")) for src, _ in CFG["lod"]):
    row([label(cell(src), text) for src, text in CFG["lod"]], 360).save(os.path.join(out, f"{species}-lod.png"))

if all(os.path.exists(os.path.join(raw, f"anim-{a}.png")) for a in CFG["anim"]):
    anim = [label(rimg(f"anim-{a}.png"), a) for a in CFG["anim"]]
    row(anim, 360).save(os.path.join(out, f"{species}-anim.png"))

names = sorted({f.split("-")[1] for f in os.listdir(raw) if f.startswith("seq-")})
for name in names:
    frames = sorted(f for f in os.listdir(raw) if f.startswith(f"seq-{name}-"))
    row([label(rimg(f), f.split("-")[-1][:-4]) for f in frames], 300).save(os.path.join(out, f"{species}-seq-{name}.png"))
print("sheets written to", out)
