#!/usr/bin/env python3
"""材質色の補正ループ: 参照画像とパーツ別平均色の ΔE76 が全パーツで閾値未満になるまで回す。

使い方:
  python3 tools/blender/tune_colors.py [--target 1.0] [--max-iter 10] [--out <dir>]

各反復:
  1. rabbit.py でモデルを再ビルド (rabbit-colors.json の色を使う)
  2. compare_ref.py で参照と同アングル撮影し parts.<p>.color の ref_mean_rgb / model_mean_rgb を得る
  3. 各パーツの材質色 (リニア RGB) に ref/model の比を掛けて rabbit-colors.json を更新
     (glow クラスは glow と teal の 2 材質を含むので同じ比を両方に掛ける)
収束したら docs/design/qa/ に証跡 (compare.png, metrics.json) をコピーする。
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUN = os.path.expanduser("~/.claude/skills/blender/scripts/run_blender.sh")
COLORS_PATH = os.path.join(ROOT, "tools", "blender", "rabbit-colors.json")
CLASS_MATERIALS = {"fur": ["fur"], "ear_inner": ["ear_inner"], "dark": ["dark"], "glow": ["glow", "teal"]}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_lin(h):
    h = h.lstrip("#")
    return [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def lin_to_hex(rgb):
    return "#" + "".join(f"{int(round(linear_to_srgb(c) * 255)):02X}" for c in rgb)


def run(args):
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit(f"failed: {' '.join(args)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=float, default=1.0)
    ap.add_argument("--max-iter", type=int, default=10)
    ap.add_argument("--out", default=os.path.join(ROOT, "docs", "design", "qa", "tune"))
    ap.add_argument("--az", default="45")
    ap.add_argument("--el", default="10")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    colors = {"fur": "#D4AC54", "ear_inner": "#5C3C34", "dark": "#5C3C34", "glow": "#8CFCEC", "teal": "#5C847C"}
    if os.path.exists(COLORS_PATH):
        colors.update(json.load(open(COLORS_PATH)))

    history = []
    for it in range(a.max_iter + 1):
        json.dump(colors, open(COLORS_PATH, "w"), indent=2)
        run([RUN, "tools/blender/rabbit.py", "--", "assets/models"])
        run([RUN, "tools/blender/compare_ref.py", "--", "assets/models/rabbit.blend",
             "assets/textures/concept/rabbit-angular.png", a.out, a.az, a.el])
        m = json.load(open(os.path.join(a.out, "metrics.json")))
        des = {p: m["parts"][p]["color"]["delta_e76"] for p in CLASS_MATERIALS}
        history.append({"iter": it, "colors": dict(colors), "delta_e76": des})
        print(f"iter {it}: " + "  ".join(f"{p} dE={d:.2f}" for p, d in des.items()) + "  colors=" + json.dumps(colors))
        if all(d < a.target for d in des.values()):
            print("converged")
            break
        if it == a.max_iter:
            print("max iterations reached (not converged)")
            break
        # 補正: リニア空間で ref/model の比を材質色に掛ける (ゼロ割り回避のため下限 1/255)
        for p, mats in CLASS_MATERIALS.items():
            ref = [srgb_to_linear(max(c, 1) / 255) for c in m["parts"][p]["color"]["ref_mean_rgb"]]
            mod = [srgb_to_linear(max(c, 1) / 255) for c in m["parts"][p]["color"]["model_mean_rgb"]]
            for mat in mats:
                lin = hex_to_lin(colors[mat])
                colors[mat] = lin_to_hex([l * r / mo for l, r, mo in zip(lin, ref, mod)])

    json.dump(history, open(os.path.join(a.out, "history.json"), "w"), indent=2, ensure_ascii=False)
    return 0 if all(d < a.target for d in history[-1]["delta_e76"].values()) else 1


if __name__ == "__main__":
    sys.exit(main())
