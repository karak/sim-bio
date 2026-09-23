"""observe_deer_render.py の撮影結果を基準画と並べた比較画にする (Blender ではなく python3 + Pillow で動かす)。

使い方: python3 tools/blender/observe_deer_sheet.py <raw_dir> docs/design/qa/observe
出力:
  deer-compare.png    上段 基準画 (creatures/deer.png 上段の 4 体)、下段 モデル (同じ向き・rest)
  deer-view-{side,front,q34,rear34}.png  モデル単体 (512²)
  deer-lod.png        近 LOD / 群れ LOD / 雌 (基準画の雌と並べる)
  deer-anim.png       5 つのアクションの見せ場のフレーム
  deer-seq-{walk,run,graze,fall}.png  側面の連続 (脚の順序・頭の上げ下げ・倒れ方)
"""
import os
import sys

from PIL import Image, ImageDraw

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = Image.open(os.path.join(ROOT, "assets/textures/board/creatures/deer.png")).convert("RGB")
BG = (222, 219, 213)
# 基準画の中の各体の枠 (x0, y0, x1, y1)
REF_BOX = {"side": (130, 0, 410, 400), "front": (470, 0, 680, 400), "q34": (760, 0, 1000, 400), "rear34": (1040, 0, 1270, 400),
           "doe": (190, 430, 430, 740), "fawn": (560, 490, 740, 740)}


def fit(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


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


views = ["side", "front", "q34", "rear34"]
refs = [label(REF.crop(REF_BOX[v]), f"ref {v}") for v in views]
mods = [label(rimg(f"view-{v}.png"), f"model {v}") for v in views]
H = 420
stack([row(refs, H), row(mods, H)]).save(os.path.join(out, "deer-compare.png"))
for v in views:
    rimg(f"view-{v}.png").resize((512, 512), Image.LANCZOS).save(os.path.join(out, f"deer-view-{v}.png"))

lod = [label(rimg("view-side.png"), "hero (LOD0)"), label(rimg("lod1-side.png"), "crowd (LOD1)"),
       label(REF.crop(REF_BOX["doe"]), "ref doe"), label(rimg("doe-q34.png"), "model doe")]
row(lod, 360).save(os.path.join(out, "deer-lod.png"))

anim = [label(rimg(f"anim-{a}.png"), a) for a in ("idle", "walk", "run", "graze", "fall")]
row(anim, 360).save(os.path.join(out, "deer-anim.png"))

for name in ("walk", "run", "graze", "fall"):
    frames = sorted(f for f in os.listdir(raw) if f.startswith(f"seq-{name}-"))
    row([label(rimg(f), f.split("-")[-1][:-4]) for f in frames], 300).save(os.path.join(out, f"deer-seq-{name}.png"))
print("sheets written to", out)
