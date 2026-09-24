"""observe_wolf_render.py の撮影結果を基準画と並べた比較画にする (Blender ではなく python3 + Pillow で動かす)。

使い方: python3 tools/blender/observe_wolf_sheet.py <raw_dir> docs/design/qa/observe
出力:
  wolf-compare.png    上段 基準画 (creatures/wolf.png の 5 体: 側面・正面・斜め前・忍び寄り・疾走)、下段 モデル (同じ向き。上 3 体は rest)
  wolf-view-{side,front,q34,rear34}.png  モデル単体 (512²)
  wolf-lod.png        近 LOD / 群れ LOD (側面・斜め前)
  wolf-anim.png       6 つのアクションの見せ場のフレーム
  wolf-seq-{walk,stalk,run,pounce,fall}.png  側面の連続
"""
import os
import sys

from PIL import Image, ImageDraw

raw, out = sys.argv[1], sys.argv[2]
# (灰狼の作り直しで追加) 3 つ目の引数で出力の名前の頭を変える (既定 wolf。作り直しの後は wolf2)。4 つ目に作り直し前の撮影 (<raw_dir>) を渡すと、
# 頭の寄り (head-*) の前後を <prefix>-head.png に並べる
PRE = sys.argv[3] if len(sys.argv) > 3 else "wolf"
BEFORE = sys.argv[4] if len(sys.argv) > 4 else None
os.makedirs(out, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF = Image.open(os.path.join(ROOT, "assets/textures/board/creatures/wolf.png")).convert("RGB")
BG = (222, 219, 213)
# 基準画の中の各体の枠 (x0, y0, x1, y1)
REF_BOX = {"side": (40, 40, 630, 385), "front": (655, 35, 855, 395), "q34": (905, 30, 1325, 395),
           "stalk": (60, 405, 645, 735), "run": (690, 405, 1325, 735)}


def fit(im, h):
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def trim(im, pad=12):
    """背景 (紙色) の余白を切り詰める (基準画と大きさを揃えるため)"""
    px = im.load()
    bg = px[2, 2]
    xs, ys = [], []
    for y in range(0, im.height, 2):
        for x in range(0, im.width, 2):
            p = px[x, y]
            if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 40:
                xs.append(x)
                ys.append(y)
    if not xs:
        return im
    return im.crop((max(0, min(xs) - pad), max(0, min(ys) - pad), min(im.width, max(xs) + pad), min(im.height, max(ys) + pad)))


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


views = ["side", "front", "q34"]
poses = ["stalk", "run"]
refs1 = [label(REF.crop(REF_BOX[v]), f"ref {v}") for v in views]
mods1 = [label(trim(rimg(f"view-{v}.png")), f"model {v}") for v in views]
refs2 = [label(REF.crop(REF_BOX[p]), f"ref {p}") for p in poses]
mods2 = [label(trim(rimg(f"pose-{p}.png")), f"model {p}") for p in poses]
H = 300
stack([row(refs1, H), row(mods1, H), row(refs2, H), row(mods2, H)], gap=10).save(os.path.join(out, f"{PRE}-compare.png"))
for v in views + ["rear34"]:
    rimg(f"view-{v}.png").resize((512, 512), Image.LANCZOS).save(os.path.join(out, f"{PRE}-view-{v}.png"))

lod = [label(trim(rimg("view-side.png")), "hero (LOD0)"), label(trim(rimg("lod1-side.png")), "crowd (LOD1)"),
       label(trim(rimg("view-q34.png")), "hero q34"), label(trim(rimg("lod1-q34.png")), "crowd q34")]
row(lod, 300).save(os.path.join(out, f"{PRE}-lod.png"))

anim = [label(trim(rimg(f"anim-{a}.png")), a) for a in ("idle", "walk", "stalk", "run", "pounce", "fall")]
row(anim, 280).save(os.path.join(out, f"{PRE}-anim.png"))

for name in ("walk", "stalk", "run", "pounce", "fall"):
    frames = sorted(f for f in os.listdir(raw) if f.startswith(f"seq-{name}-"))
    row([label(rimg(f), f.split("-")[-1][:-4]) for f in frames], 260).save(os.path.join(out, f"{PRE}-seq-{name}.png"))
# (灰狼の作り直しで追加) 頭の寄り: 上段 基準画の頭 (側面・正面・斜め前)、中段 作り直し前、下段 作り直し後。最後に忍び寄り・飛びかかりの口
HEAD_BOX = {"side": (420, 60, 640, 280), "front": (680, 40, 840, 280), "q34": (1150, 40, 1330, 220)}
if os.path.exists(os.path.join(raw, "head-q34.png")):
    heads = ["side", "front", "q34"]
    rows = [row([label(REF.crop(HEAD_BOX[v]), f"ref {v}") for v in heads], 300)]
    if BEFORE:
        rows.append(row([label(trim(Image.open(os.path.join(BEFORE, f"head-{v}.png")).convert("RGB")), f"before {v}") for v in heads], 300))
    rows.append(row([label(trim(rimg(f"head-{v}.png")), f"after {v}") for v in heads], 300))
    rows.append(row([label(trim(rimg(f"head-{a}.png")), f"after {a}") for a in ("stalk", "pounce")], 300))
    stack(rows, gap=10).save(os.path.join(out, f"{PRE}-head.png"))
print("sheets written to", out)
